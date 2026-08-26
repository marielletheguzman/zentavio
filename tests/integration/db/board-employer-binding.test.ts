/**
 * What the board-to-employer binding refuses, and what resolution does with nothing (ADR-0040).
 *
 * Every rule here is fired by **direct `INSERT`**, never through the repository. A rule that lives
 * only in a pure function is a rule the next writer bypasses with an `UPDATE`, and this is the field
 * where that costs somebody an application and possibly a move: a posting attributed to the wrong
 * employer moves outcome data onto a company they never applied to.
 *
 * Each test asserts the **named** constraint rejected the row. "It threw" passes just as happily when
 * the insert failed for a typo, which is how a constraint quietly stops existing.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  backfillPostingEmployer,
  bindBoardToCompany,
  createCompany,
  employerForBoard,
  resolveCompany,
} from '../../../packages/db/src/repositories/companies.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { normalizeCompanyAlias } from '../../../packages/db/src/seed.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { expectViolation, migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let seq = 0;

/** A counter rather than a uuid prefix: two rows in one millisecond would collide on the slug. */
function unique(): string {
  seq += 1;
  return `n${String(seq)}`;
}

async function insertCompany(): Promise<string> {
  const id = uuidv7();
  const suffix = unique();
  await pool.query(
    `INSERT INTO companies (id, slug, canonical_name, primary_domain, source_tier)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, `acme-${suffix}`, 'Acme', `acme-${suffix}.com`, 2],
  );
  return id;
}

async function insertSource(id: string): Promise<string> {
  await pool.query(
    `INSERT INTO connector_sources
       (id, kind, display_name, connector_version, source_tier, terms_url, legal_basis,
        rate_limit, refresh_window, schedule)
     VALUES ($1, 'job-board', $1, '1.0.0', 2, 'https://example.test/terms', 'public postings API',
             '{"perMinute":10}'::jsonb, '1 day', 'daily')
     ON CONFLICT (id) DO NOTHING`,
    [id],
  );
  return id;
}

async function insertBinding(overrides: Record<string, unknown> = {}): Promise<void> {
  const row = {
    id: uuidv7(),
    source_id: await insertSource(`lever-${unique()}`),
    source_scope: 'zoox',
    company_id: await insertCompany(),
    source_tier: 2,
    source_url: 'https://zoox.test/careers',
    retrieved_at: new Date(),
    ...overrides,
  };

  await pool.query(
    `INSERT INTO job_board_employers
       (id, source_id, source_scope, company_id, source_tier, source_url, retrieved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.id,
      row.source_id,
      row.source_scope,
      row.company_id,
      row.source_tier,
      row.source_url,
      row.retrieved_at,
    ],
  );
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

beforeEach(async () => {
  await pool.query('TRUNCATE job_board_employers, company_aliases, companies, connector_sources CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('a binding is a sourced claim, not configuration', () => {
  it('accepts one that carries its evidence', async () => {
    await expect(insertBinding()).resolves.toBeUndefined();
  });

  it('refuses tier 4 — an employer identity is not an anecdote', async () => {
    const violation = await expectViolation(pool, () => insertBinding({ source_tier: 4 }));
    expect(violation.constraint).toBe('ck_jbe__tier');
  });

  it('refuses a source that is not a URL, so the claim stays re-checkable', async () => {
    const violation = await expectViolation(pool, () => insertBinding({ source_url: 'zoox.test' }));
    expect(violation.constraint).toBe('ck_jbe__source_url');
  });

  it('refuses a scope with surrounding whitespace, which is one board spelled two ways', async () => {
    const violation = await expectViolation(pool, () => insertBinding({ source_scope: ' zoox' }));
    expect(violation.constraint).toBe('ck_jbe__source_scope');
  });

  it('refuses a second live binding for the same board', async () => {
    const sourceId = await insertSource('lever-dup');
    await insertBinding({ source_id: sourceId, source_scope: 'zoox' });

    const violation = await expectViolation(pool, () => insertBinding({ source_id: sourceId, source_scope: 'zoox' }));
    expect(violation.constraint).toBe('uq_jbe__source_scope');
  });

  it('permits the empty scope a single-namespace source uses', async () => {
    await expect(insertBinding({ source_scope: '' })).resolves.toBeUndefined();
  });
});

describe('the repository', () => {
  it('supersedes rather than rewrites when a board changes hands', async () => {
    const sourceId = await insertSource('lever-rebind');
    const first = await insertCompany();
    const second = await insertCompany();
    const at = new Date();

    const created = await bindBoardToCompany(db, {
      sourceId,
      sourceScope: 'zoox',
      companyId: first,
      sourceTier: 2,
      sourceUrl: 'https://one.test/careers',
      retrievedAt: at,
    });
    const rebound = await bindBoardToCompany(db, {
      sourceId,
      sourceScope: 'zoox',
      companyId: second,
      sourceTier: 2,
      sourceUrl: 'https://two.test/careers',
      retrievedAt: at,
    });

    expect(created.action).toBe('created');
    expect(rebound.action).toBe('rebound');
    expect(await employerForBoard(db, sourceId, 'zoox')).toBe(second);

    // The superseded row is kept: it is the evidence for every posting resolved under it.
    const rows = await pool.query('SELECT company_id, deleted_at FROM job_board_employers ORDER BY created_at');
    expect(rows.rowCount).toBe(2);
    expect(rows.rows[0].company_id).toBe(first);
    expect(rows.rows[0].deleted_at).not.toBeNull();
  });

  it('re-checking the same employer moves the date and not the claim', async () => {
    const sourceId = await insertSource('lever-recheck');
    const company = await insertCompany();
    const binding = {
      sourceId,
      sourceScope: 'zoox',
      companyId: company,
      sourceTier: 2,
      sourceUrl: 'https://one.test/careers',
    };

    await bindBoardToCompany(db, { ...binding, retrievedAt: new Date('2026-01-01T00:00:00Z') });
    const again = await bindBoardToCompany(db, { ...binding, retrievedAt: new Date('2026-08-25T00:00:00Z') });

    expect(again.action).toBe('unchanged');
    const rows = await pool.query('SELECT retrieved_at FROM job_board_employers WHERE deleted_at IS NULL');
    expect(rows.rowCount).toBe(1);
    expect(new Date(rows.rows[0].retrieved_at).toISOString()).toBe('2026-08-25T00:00:00.000Z');
  });

  it('reports no employer for an unbound board, rather than throwing', async () => {
    await insertSource('lever-unbound');

    expect(await employerForBoard(db, 'lever-unbound', 'someboard')).toBeNull();
  });
});

describe('resolution', () => {
  it('prefers the domain, then the alias, and otherwise resolves nothing', async () => {
    const id = await createCompany(db, {
      slug: 'zoox-test',
      canonicalName: 'Zoox, Inc.',
      primaryDomain: 'zoox.test',
      sourceTier: 2,
    });

    expect(await resolveCompany(db, { primaryDomain: 'zoox.test' })).toEqual({
      companyId: id,
      basis: 'primary-domain',
    });
    expect(await resolveCompany(db, { name: 'Zoox Inc' })).toEqual({ companyId: id, basis: 'alias' });
    expect(await resolveCompany(db, { name: 'Someone Else' })).toEqual({ companyId: null, basis: 'unresolved' });
  });

  /**
   * ADR-0040 rule 2, stated as provenance rather than as string equality.
   *
   * **"No alias equals a board slug" is not the invariant, and cannot be.** A board slug usually
   * *is* the employer's name — `normalizeCompanyAlias('Zoox, Inc.')` and `normalizeCompanyAlias('zoox')`
   * are both `zoox` — so that assertion is unsatisfiable in exactly the case the feature exists for.
   * The first draft of this test asserted it and failed against its own fixture.
   *
   * What must be true is that the alias got there because somebody curated a **name**, and that
   * binding a board contributes nothing to that table. The bound company below is deliberately named
   * something the slug does not resemble: `uq_company_aliases__normalized` is global, so a slug
   * stored as a name would let one board swallow an unrelated employer's postings and look correct
   * doing it.
   */
  it('binding a board writes no alias, and a slug never becomes one', async () => {
    const sourceId = await insertSource('lever-slug');
    const company = await createCompany(db, {
      slug: 'aperture-science',
      canonicalName: 'Aperture Science',
      primaryDomain: 'aperture.test',
      sourceTier: 2,
    });

    const before = await pool.query('SELECT normalized FROM company_aliases ORDER BY normalized');

    await bindBoardToCompany(db, {
      sourceId,
      sourceScope: 'zoox',
      companyId: company,
      sourceTier: 2,
      sourceUrl: 'https://aperture.test/careers',
      retrievedAt: new Date(),
    });

    const after = await pool.query('SELECT normalized FROM company_aliases ORDER BY normalized');
    const normalized = after.rows.map((row: { normalized: string }) => row.normalized);

    // The binding contributed nothing at all.
    expect(after.rows).toEqual(before.rows);
    expect(normalized).not.toContain(normalizeCompanyAlias('zoox'));
    // The counterpart: the curated name did become an alias, so an empty table is not what passes.
    expect(normalized).toContain(normalizeCompanyAlias('Aperture Science'));
    // And the slug resolves to nobody, which is the failure mode being prevented.
    expect(await resolveCompany(db, { name: 'zoox' })).toEqual({ companyId: null, basis: 'unresolved' });
  });
});

describe('the backfill', () => {
  async function insertPosting(sourceId: string, scope: string, companyId: string | null): Promise<string> {
    const id = uuidv7();
    const suffix = unique();
    await pool.query(
      `INSERT INTO job_postings (id, dedup_key, dedup_basis, title, url, company_id, authority_tier,
                                 confidence, first_seen_at, last_seen_at, stale_after)
       VALUES ($1, $2, 'source-identity', 'Engineer', 'https://example.test/j', $3, 2, 'medium',
               now(), now(), now() + interval '1 day')`,
      [id, `key-${suffix}`, companyId],
    );
    await pool.query(
      `INSERT INTO job_posting_sources
         (id, job_posting_id, source_id, source_scope, external_id, source_tier, source_url,
          retrieved_at, connector_version, run_id)
       VALUES ($1, $2, $3, $4, $5, 2, 'https://example.test/j', now(), '1.0.0', $6)`,
      [uuidv7(), id, sourceId, scope, `ext-${suffix}`, uuidv7()],
    );
    return id;
  }

  it('fills only the postings of that board whose employer is still unknown', async () => {
    const sourceId = await insertSource('lever-backfill');
    const company = await insertCompany();
    const other = await insertCompany();

    const unresolved = await insertPosting(sourceId, 'zoox', null);
    const elsewhere = await insertPosting(sourceId, 'otherboard', null);
    const alreadyResolved = await insertPosting(sourceId, 'zoox', other);

    const updated = await backfillPostingEmployer(db, sourceId, 'zoox', company);

    expect(updated).toBe(1);

    const rows = await pool.query('SELECT id, company_id FROM job_postings ORDER BY id');
    const byId = new Map(rows.rows.map((row: { id: string; company_id: string | null }) => [row.id, row.company_id]));

    expect(byId.get(unresolved)).toBe(company);
    expect(byId.get(elsewhere)).toBeNull();
    // Never moves a posting from one employer to another — that is a merge, not a repair.
    expect(byId.get(alreadyResolved)).toBe(other);
  });
});
