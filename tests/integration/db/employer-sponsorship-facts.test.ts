/**
 * `employer_sponsorship_facts` — the constraints, and the superseding writer.
 *
 * **Every rule is exercised by direct INSERT, never through the repository.** That is ADR-0039's
 * own pattern and the reason for it has not changed: a rule that lives only in a function is
 * bypassed by the next writer's UPDATE, and the next writer is usually a migration or a one-off
 * script rather than the module somebody remembered to route through.
 *
 * The claim this table holds is the most damaging fabrication available in this repository — a
 * person reads "this employer sponsors", applies, and moves their expectations about where they
 * will live. So the tests below are mostly about what the table *refuses*.
 */

import { registerConnectorSource, recordSponsorshipFact, liveSponsorshipFact, liveSponsorshipFacts, staleSponsorshipFacts, type Database } from '@zentavio/db';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

/** A complete, valid row. Each test overrides exactly the field it is about. */
async function insertFact(overrides: Record<string, unknown> = {}): Promise<string> {
  const row: Record<string, unknown> = {
    id: uuidv7(),
    company_id: overrides['company_id'] ?? (await insertCompany()),
    jurisdiction: 'DE',
    claim: 'visa_sponsorship',
    status: 'stated_available',
    source_id: null,
    source_tier: 2,
    source_url: 'https://acme.test/careers/visas',
    source_kind: 'employer_statement',
    retrieved_at: new Date('2026-08-26T00:00:00Z'),
    support_count: null,
    support_window: null,
    effective_from: '2026-08-01',
    effective_to: null,
    supersedes: null,
    refresh_after: '2027-08-01',
    ...overrides,
  };

  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${String(index + 1)}`).join(', ');
  await pool.query(
    `INSERT INTO employer_sponsorship_facts (${columns.join(', ')}) VALUES (${placeholders})`,
    Object.values(row),
  );
  return row['id'] as string;
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM employer_sponsorship_facts');
});

describe('what the table refuses', () => {
  it('refuses a stated claim with no URL, because an unsourced one is unre-checkable', async () => {
    const violation = await expectViolation(pool, () => insertFact({ source_url: null }));
    expect(violation.constraint).toBe('ck_esf__stated_needs_url');
  });

  it('accepts an unknown with no URL, because nobody-said needs nothing to point at', async () => {
    await expectFactStored({ status: 'unknown', source_url: null });
  });

  it('refuses an inference with no sample size', async () => {
    const violation = await expectViolation(pool, () =>
      insertFact({ status: 'inferred_likely', source_kind: 'observed_outcome', support_count: null }),
    );
    expect(violation.constraint).toBe('ck_esf__inferred_needs_support');
  });

  it('refuses an inference drawn from prose — ADR-0039 rule 3, in the table it was reserved for', async () => {
    // `inferred_likely` is refused outright on `job_postings`, because a posting has only prose.
    // Here it is allowed, and confined to the two sources the reservation named. Without this the
    // rule would survive one table away and evaporate in this one.
    for (const sourceKind of ['posting_text', 'employer_statement']) {
      const violation = await expectViolation(pool, () =>
        insertFact({
          status: 'inferred_likely',
          source_kind: sourceKind,
          support_count: 12,
          support_window: '365 days',
        }),
      );
      expect(violation.constraint, sourceKind).toBe('ck_esf__inferred_source_kind');
    }
  });

  it('accepts an inference from a register or from aggregated outcomes', async () => {
    for (const sourceKind of ['official_register', 'observed_outcome']) {
      await expectFactStored({
        status: 'inferred_likely',
        source_kind: sourceKind,
        support_count: 12,
        support_window: '365 days',
      });
    }
  });

  it('refuses a sample of nothing', async () => {
    const violation = await expectViolation(pool, () =>
      insertFact({
        status: 'inferred_likely',
        source_kind: 'observed_outcome',
        support_count: 0,
        support_window: '365 days',
      }),
    );
    expect(violation.constraint).toBe('ck_esf__support_count');
  });

  it('refuses a third-party listing as a source kind', async () => {
    // The absent fifth value. Aggregator "we think they sponsor" pages are not a source.
    const violation = await expectViolation(pool, () => insertFact({ source_kind: 'third_party_listing' }));
    expect(violation.constraint).toBe('ck_esf__source_kind');
  });

  it('refuses a claim outside the closed vocabulary', async () => {
    const violation = await expectViolation(pool, () => insertFact({ claim: 'good_vibes' }));
    expect(violation.constraint).toBe('ck_esf__claim');
  });

  it('refuses a validity window that ends before it starts', async () => {
    const violation = await expectViolation(pool, () => insertFact({ effective_to: '2026-07-01' }));
    expect(violation.constraint).toBe('ck_esf__validity');
  });

  it('refuses two live facts for the same company, country and claim', async () => {
    const companyId = await insertCompany();
    await insertFact({ company_id: companyId });

    const violation = await expectViolation(pool, () => insertFact({ company_id: companyId }));
    expect(violation.constraint).toBe('uq_esf__current');
  });

  it('permits a superseded fact beside a live one, which is what versioning means', async () => {
    const companyId = await insertCompany();
    await insertFact({ company_id: companyId, effective_to: '2026-08-20' });
    await insertFact({ company_id: companyId });

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM employer_sponsorship_facts');
    expect(rows[0].n).toBe(2);
  });

  it('separates the same claim in two countries, because support is per country', async () => {
    const companyId = await insertCompany();
    await insertFact({ company_id: companyId, jurisdiction: 'DE' });
    await insertFact({ company_id: companyId, jurisdiction: 'LU' });

    const facts = await liveSponsorshipFacts(db, companyId).execute();
    expect(facts.map((fact) => fact.jurisdiction)).toEqual(['DE', 'LU']);
  });
});

/** Insert a row that should be accepted, and prove it landed rather than assuming it. */
async function expectFactStored(overrides: Record<string, unknown>): Promise<void> {
  const id = await insertFact({ company_id: await insertCompany(), ...overrides });
  const { rows } = await pool.query('SELECT id FROM employer_sponsorship_facts WHERE id = $1', [id]);
  expect(rows).toHaveLength(1);
}

describe('recordSponsorshipFact', () => {
  it('supersedes the previous live fact rather than overwriting it', async () => {
    const companyId = await insertCompany();

    const first = await recordSponsorshipFact(db, {
      companyId,
      jurisdiction: 'DE',
      claim: 'visa_sponsorship',
      status: 'stated_available',
      sourceTier: 2,
      sourceUrl: 'https://acme.test/careers/visas',
      sourceKind: 'employer_statement',
      retrievedAt: new Date('2026-01-15T00:00:00Z'),
      effectiveFrom: '2026-01-15',
      refreshAfter: '2027-01-15',
    });

    const second = await recordSponsorshipFact(db, {
      companyId,
      jurisdiction: 'DE',
      claim: 'visa_sponsorship',
      status: 'stated_unavailable',
      sourceTier: 2,
      sourceUrl: 'https://acme.test/careers/visas',
      sourceKind: 'employer_statement',
      retrievedAt: new Date('2026-08-26T00:00:00Z'),
      effectiveFrom: '2026-08-26',
      refreshAfter: '2027-08-26',
    });

    // The old fact is kept: an application recorded in February was made on that belief.
    const closed = await db
      .selectFrom('employer_sponsorship_facts')
      .selectAll()
      .where('id', '=', first.id)
      .executeTakeFirstOrThrow();

    expect(closed.effective_to).toBe('2026-08-26');
    expect(closed.status).toBe('stated_available');
    expect(second.supersedes).toBe(first.id);
    expect(second.effective_to).toBeNull();

    // The windows abut rather than overlap, so "what did we believe on this date" has one answer.
    const live = await liveSponsorshipFact(db, companyId, 'DE', 'visa_sponsorship');
    expect(live?.id).toBe(second.id);
    expect(live?.status).toBe('stated_unavailable');
  });

  it('records the first fact with nothing to supersede', async () => {
    const companyId = await insertCompany();

    const fact = await recordSponsorshipFact(db, {
      companyId,
      jurisdiction: 'LU',
      claim: 'relocation_support',
      status: 'unknown',
      sourceTier: 3,
      sourceKind: 'posting_text',
      retrievedAt: new Date('2026-08-26T00:00:00Z'),
      effectiveFrom: '2026-08-26',
      refreshAfter: '2026-11-26',
    });

    expect(fact.supersedes).toBeNull();
    expect(fact.source_url).toBeNull();
  });

  it('attributes an ingested fact to the connector that produced it', async () => {
    await registerConnectorSource(db, {
      id: 'uk-sponsor-register',
      kind: 'company',
      displayName: 'UK register of licensed sponsors',
      connectorVersion: '1.0.0',
      sourceTier: 1,
      termsUrl: 'https://example.test/terms',
      legalBasis: 'Published register, open licence, checked before the connector was written.',
      rateLimit: { requests: 10, windowMs: 60_000 },
      refreshWindow: '30 days',
      schedule: '0 4 * * 1',
      regions: ['GB'],
    }).execute();

    const companyId = await insertCompany();
    const fact = await recordSponsorshipFact(db, {
      companyId,
      jurisdiction: 'GB',
      claim: 'sponsor_licence_held',
      status: 'stated_available',
      sourceId: 'uk-sponsor-register',
      sourceTier: 1,
      sourceUrl: 'https://example.test/register/acme',
      sourceKind: 'official_register',
      retrievedAt: new Date('2026-08-26T00:00:00Z'),
      effectiveFrom: '2026-08-26',
      refreshAfter: '2026-09-26',
    });

    expect(fact.source_id).toBe('uk-sponsor-register');
  });

  it('lists what has gone stale, which is how a lapsed licence gets re-checked', async () => {
    const companyId = await insertCompany();
    await insertFact({ company_id: companyId, refresh_after: '2026-01-01' });
    await insertFact({ company_id: companyId, jurisdiction: 'LU', refresh_after: '2099-01-01' });

    const stale = await staleSponsorshipFacts(db, '2026-08-26').execute();
    expect(stale).toHaveLength(1);
    expect(stale[0]?.jurisdiction).toBe('DE');
  });
});
