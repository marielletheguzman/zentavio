/**
 * What the company registry refuses.
 *
 * Every one of these is a duplicate or a wrong merge waiting to happen, and both corrupt outcome
 * data in ways no later check can find. Each test attempts the violation and asserts the **named**
 * constraint rejected it — "an error was thrown" would pass if the row failed for an unrelated
 * reason, which is how a constraint quietly stops existing.
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { expectViolation, migratedTestPool } from './database.ts';

let pool: Pool;

/**
 * A counter, **not** `uuidv7().slice(0, 8)`.
 *
 * That prefix is a millisecond timestamp, so two rows created in the same millisecond share it —
 * and the resulting slug collision makes every test fail on the wrong constraint. This project has
 * been bitten by exactly that before.
 */
let seq = 0;

async function insertCompany(overrides: Record<string, unknown> = {}): Promise<string> {
  seq += 1;
  const unique = `n${String(seq)}`;
  const row = {
    id: uuidv7(),
    slug: `acme-${unique}`,
    canonical_name: 'Acme',
    primary_domain: `acme-${unique}.com`,
    status: 'active',
    merged_into: null,
    source_tier: 2,
    ...overrides,
  };
  await pool.query(
    `INSERT INTO companies (id, slug, canonical_name, primary_domain, status, merged_into, source_tier)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.id, row.slug, row.canonical_name, row.primary_domain, row.status, row.merged_into, row.source_tier],
  );
  return String(row.id);
}

async function insertAlias(companyId: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const row = { alias: 'Acme Inc.', normalized: 'acme', source_tier: 3, ...overrides };
  await pool.query(
    `INSERT INTO company_aliases (id, company_id, alias, normalized, source_tier)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), companyId, row.alias, row.normalized, row.source_tier],
  );
}

beforeAll(async () => {
  pool = await migratedTestPool();
});

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM company_aliases');
  await pool.query('UPDATE companies SET merged_into = NULL, status = $1', ['active']);
  await pool.query('DELETE FROM companies');
});

describe('domain identity', () => {
  it('refuses two live companies on one domain', async () => {
    // The duplicate this table exists to prevent, and the one that makes an outcome count for the
    // wrong employer.
    await insertCompany({ primary_domain: 'acme.com' });
    const violation = await expectViolation(pool, () =>
      insertCompany({ primary_domain: 'acme.com' }),
    );
    expect(violation.constraint).toBe('uq_companies__domain');
  });

  it('allows many companies with no domain', async () => {
    // A company can be real and known without one. Uniqueness must not turn "unknown" into a
    // collision.
    await insertCompany({ primary_domain: null });
    await expect(insertCompany({ primary_domain: null })).resolves.toBeTypeOf('string');
  });

  it.each([
    'https://acme.com',
    'http://acme.com',
    'www.acme.com',
    'acme.com/careers',
    'Acme.com',
    'acme',
  ])('rejects %p — a domain stored two ways is two companies', async (domain) => {
    const violation = await expectViolation(pool, () => insertCompany({ primary_domain: domain }));
    expect(violation.constraint).toBe('ck_companies__domain');
  });

  it('accepts a real host, including subdomains and multi-part suffixes', async () => {
    await expect(insertCompany({ primary_domain: 'careers.acme.co.uk' })).resolves.toBeTypeOf('string');
  });
});

describe('merges', () => {
  it('requires a forward pointer when status is merged', async () => {
    // "merged" without saying where is a dead end for whoever is reading the history.
    const violation = await expectViolation(pool, () =>
      insertCompany({ status: 'merged', merged_into: null }),
    );
    expect(violation.constraint).toBe('ck_companies__merged');
  });

  it('refuses a forward pointer without the merged status', async () => {
    const target = await insertCompany();
    const violation = await expectViolation(pool, () =>
      insertCompany({ status: 'active', merged_into: target }),
    );
    expect(violation.constraint).toBe('ck_companies__merged');
  });

  it('refuses a company merged into itself', async () => {
    const id = uuidv7();
    const violation = await expectViolation(pool, () =>
      insertCompany({ id, status: 'merged', merged_into: id }),
    );
    expect(violation.constraint).toBe('ck_companies__no_self_merge');
  });

  it('keeps the old row after a merge, so an outcome citing it stays explicable', async () => {
    const successor = await insertCompany({ canonical_name: 'NewCo' });
    const old = await insertCompany({ canonical_name: 'OldCo', status: 'merged', merged_into: successor });

    const { rows } = await pool.query('SELECT canonical_name, merged_into FROM companies WHERE id = $1', [old]);
    expect(rows[0]?.canonical_name).toBe('OldCo');
    expect(rows[0]?.merged_into).toBe(successor);
  });

  it('refuses to delete a company another row points at', async () => {
    const successor = await insertCompany();
    await insertCompany({ status: 'merged', merged_into: successor });

    const violation = await expectViolation(pool, () =>
      pool.query('DELETE FROM companies WHERE id = $1', [successor]),
    );
    expect(violation.constraint).toBe('fk_companies__merged_into');
  });
});

describe('aliases', () => {
  it('refuses one normalized key resolving to two companies', async () => {
    // Without this, "acme" belongs to two employers and reconciliation picks whichever row the
    // query returned first.
    const first = await insertCompany();
    const second = await insertCompany();

    await insertAlias(first, { normalized: 'acme' });
    const violation = await expectViolation(pool, () => insertAlias(second, { normalized: 'acme' }));
    expect(violation.constraint).toBe('uq_company_aliases__normalized');
  });

  it('allows many aliases for one company', async () => {
    const company = await insertCompany();
    await insertAlias(company, { alias: 'Acme Inc.', normalized: 'acme' });
    await expect(
      insertAlias(company, { alias: 'Acme Health GmbH', normalized: 'acme health' }),
    ).resolves.toBeUndefined();
  });

  it('refuses an empty normalized key', async () => {
    // Every empty key collides with every other — the worst possible merge.
    const company = await insertCompany();
    const violation = await expectViolation(pool, () => insertAlias(company, { normalized: '' }));
    expect(violation.constraint).toBe('ck_company_aliases__normalized');
  });

  it('refuses an alias for a company that does not exist', async () => {
    const violation = await expectViolation(pool, () => insertAlias(uuidv7()));
    expect(violation.constraint).toBe('fk_company_aliases__companies');
  });

  it('refuses to delete a company that still has aliases', async () => {
    const company = await insertCompany();
    await insertAlias(company);

    const violation = await expectViolation(pool, () =>
      pool.query('DELETE FROM companies WHERE id = $1', [company]),
    );
    expect(violation.constraint).toBe('fk_company_aliases__companies');
  });
});

describe('provenance and shape', () => {
  it('requires a source tier on every company', async () => {
    const violation = await expectViolation(pool, () => insertCompany({ source_tier: 5 }));
    expect(violation.constraint).toBe('ck_companies__tier');
  });

  it('refuses a slug that is not kebab-case', async () => {
    const violation = await expectViolation(pool, () => insertCompany({ slug: 'Acme Corp' }));
    expect(violation.constraint).toBe('ck_companies__slug');
  });

  it('refuses a status outside the closed set', async () => {
    const violation = await expectViolation(pool, () => insertCompany({ status: 'acquired' }));
    expect(violation.constraint).toBe('ck_companies__status');
  });

  it('refuses two live companies on one slug', async () => {
    await insertCompany({ slug: 'acme' });
    const violation = await expectViolation(pool, () => insertCompany({ slug: 'acme' }));
    expect(violation.constraint).toBe('uq_companies__slug');
  });
});
