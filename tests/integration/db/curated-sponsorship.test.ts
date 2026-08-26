/**
 * `syncCuratedSponsorship` against a real database.
 *
 * The rules themselves are unit-tested beside the module, against real sentences from real
 * employers. What needs a database is the half that touches rows: that an accepted entry lands as a
 * versioned fact, that re-applying supersedes rather than duplicates, and that a slug matching no
 * company is **reported rather than created**.
 */

import { syncCuratedSponsorship, type CuratedSponsorshipFile } from '@zentavio/ingestion';
import { liveSponsorshipFact, type Database } from '@zentavio/db';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;

const SLUG = 'acme-sponsors';

async function insertCompany(slug: string = SLUG): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO companies (id, slug, canonical_name, primary_domain, source_tier)
     VALUES ($1, $2, 'Acme', $3, 2)`,
    [id, slug, `${slug}.test`],
  );
  return id;
}

function file(overrides: Record<string, unknown> = {}): CuratedSponsorshipFile {
  return {
    facts: [
      {
        companySlug: SLUG,
        jurisdiction: 'DE',
        claim: 'visa_sponsorship',
        status: 'stated_available',
        sourceUrl: 'https://acme.test/careers/relocation',
        span: 'Visa sponsorship is available for all engineering roles in Berlin.',
        retrievedAt: '2026-08-26T00:00:00Z',
        effectiveFrom: '2026-08-26',
        refreshAfter: '2027-08-26',
        ...overrides,
      },
    ],
  } as CuratedSponsorshipFile;
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
  await pool.query('DELETE FROM companies');
});

describe('syncCuratedSponsorship', () => {
  it('records an accepted entry as an employer_statement fact with its span', async () => {
    const companyId = await insertCompany();
    const report = await syncCuratedSponsorship(db, file());

    expect(report.recorded).toEqual([`${SLUG}/DE/visa_sponsorship`]);
    expect(report.rejected).toEqual([]);
    expect(report.unresolved).toEqual([]);

    const fact = await liveSponsorshipFact(db, companyId, 'DE', 'visa_sponsorship');
    expect(fact?.status).toBe('stated_available');
    expect(fact?.source_kind).toBe('employer_statement');
    expect(fact?.source_tier).toBe(2);
    // The sentence travels with the row, so the claim stays traceable to what was read.
    expect((fact?.detail as { span?: string }).span).toContain('Visa sponsorship is available');
  });

  it('supersedes on re-application rather than duplicating', async () => {
    const companyId = await insertCompany();
    await syncCuratedSponsorship(db, file());
    await syncCuratedSponsorship(
      db,
      file({
        status: 'stated_unavailable',
        span: 'We do not offer visa sponsorship for this position.',
        effectiveFrom: '2026-09-01',
      }),
    );

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM employer_sponsorship_facts');
    expect(rows[0].n).toBe(2);

    const live = await liveSponsorshipFact(db, companyId, 'DE', 'visa_sponsorship');
    expect(live?.status).toBe('stated_unavailable');
    expect(live?.supersedes).not.toBeNull();
  });

  it('reports a slug that resolves to nothing, and creates no company for it', async () => {
    const report = await syncCuratedSponsorship(db, file({ companySlug: 'never-heard-of-them' }));

    expect(report.unresolved).toEqual(['never-heard-of-them']);
    expect(report.recorded).toEqual([]);

    // Recording a fact about an employer must not bring the employer into existence as a side
    // effect — the inversion `docs/database/entities/company.md` refuses.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM companies');
    expect(rows[0].n).toBe(0);
  });

  it('writes nothing for an entry its own span does not support', async () => {
    await insertCompany();
    const report = await syncCuratedSponsorship(
      db,
      file({ span: "If you're asked to relocate, our People Services team will help with visa assistance." }),
    );

    expect(report.recorded).toEqual([]);
    expect(report.rejected).toHaveLength(1);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM employer_sponsorship_facts');
    expect(rows[0].n).toBe(0);
  });
});
