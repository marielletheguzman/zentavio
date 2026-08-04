/**
 * The ingest pipeline, end to end, against a real database.
 *
 * Uses the **real `de-bundesanzeiger` connector and its committed fixture** rather than a stub, so
 * what is exercised is the path a scheduled run takes: the actual 2026 Bekanntmachung text, the
 * actual normalization, the actual validation, the actual rows.
 *
 * What the unit tests cannot prove is here: that the rows the planner produces are ones PostgreSQL
 * will accept, that supersession satisfies `uq_req__current`, and that a rejected plan leaves the
 * database untouched.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BundesanzeigerConnector, type BekanntmachungRaw } from '@zentavio/connector-de-bundesanzeiger';
import { executePlan, planIngest, type ExistingRequirement } from '@zentavio/ingestion';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../fixtures/connectors/de-bundesanzeiger/banz-at-18-12-2025-b3.json', import.meta.url),
    ),
    'utf8',
  ),
) as BekanntmachungRaw;

const PATHWAY_ID = 'de.eu-blue-card';

let pool: Pool;
let db: Kysely<Database>;

function connector() {
  return new BundesanzeigerConnector({
    knownPublications: [FIXTURE.publicationId],
    fetchDocument: async (id) => (id === FIXTURE.publicationId ? FIXTURE : null),
  });
}

async function storedRequirements() {
  return db
    .selectFrom('requirements')
    .select(['id', 'requirement_id', 'version', 'effective_from', 'effective_to', 'value', 'supersedes'])
    .orderBy('requirement_id')
    .orderBy('version')
    .execute();
}

/** What planning needs to know about current state — read back rather than assumed. */
async function existing(): Promise<readonly ExistingRequirement[]> {
  const rows = await db
    .selectFrom('requirements')
    .select(['id', 'requirement_id', 'version', 'effective_to'])
    .execute();
  return rows.map((r) => ({
    id: r.id,
    requirementId: r.requirement_id,
    version: r.version,
    effectiveTo: r.effective_to === null ? null : String(r.effective_to).slice(0, 10),
  }));
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM requirements');
  await pool.query('DELETE FROM immigration_pathways');

  // The foreign key `requirements.pathway_id` needs this row. Its absence is what blocked the
  // first real insert until the pathway was seeded.
  await pool.query(
    `INSERT INTO immigration_pathways (id, pathway_id, jurisdiction, name, official_sources)
     VALUES ($1, $2, 'DE', 'Blaue Karte EU', $3)`,
    [
      uuidv7(),
      PATHWAY_ID,
      JSON.stringify([
        { url: 'https://www.gesetze-im-internet.de/aufenthg_2004/__18g.html', authoritative_for: 'eligibility' },
      ]),
    ],
  );
});

describe('the first real ingest', () => {
  it('stores both 2026 thresholds from the actual Bekanntmachung', async () => {
    const source = connector();
    const normalized = source.normalize(FIXTURE);
    const report = await executePlan(db, planIngest(source, normalized, [], () => uuidv7()));

    expect(report).toMatchObject({ sourceId: 'de-bundesanzeiger', inserted: 2, rejected: 0 });

    const rows = await storedRequirements();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.requirement_id)).toEqual([
      'de.eu-blue-card.salary-threshold.general',
      'de.eu-blue-card.salary-threshold.reduced',
    ]);
  });

  it('stores the verified figures, with currency and period intact', async () => {
    const source = connector();
    await executePlan(db, planIngest(source, source.normalize(FIXTURE), [], () => uuidv7()));

    const rows = await storedRequirements();
    const general = rows.find((r) => r.requirement_id.endsWith('.general'));
    const reduced = rows.find((r) => r.requirement_id.endsWith('.reduced'));

    expect(general?.value).toEqual({ amount: 50700, currency: 'EUR', period: 'year', basis: 'gross' });
    expect(reduced?.value).toEqual({ amount: 45934.2, currency: 'EUR', period: 'year', basis: 'gross' });
  });

  it('carries needs_input through to the database — this is what produces needsFromUser', async () => {
    const source = connector();
    await executePlan(db, planIngest(source, source.normalize(FIXTURE), [], () => uuidv7()));

    const { rows } = await pool.query<{ needs_input: string[] }>(
      'SELECT needs_input FROM requirements LIMIT 1',
    );
    expect(rows[0]?.needs_input).toEqual(['expected_gross_annual_salary_eur']);
  });

  it('every stored key exists in the fact catalogue', async () => {
    // The cross-check in `person-facts-constraints.test.ts` is vacuous while `requirements` is
    // empty. With real rows stored it is not — a rule asking for a fact nobody can supply would
    // fail here.
    const source = connector();
    await executePlan(db, planIngest(source, source.normalize(FIXTURE), [], () => uuidv7()));
    await pool.query(
      `INSERT INTO person_fact_kinds (key, value_type, unit, prompt, rationale)
       VALUES ('expected_gross_annual_salary_eur', 'monetary', 'EUR/year', 'What salary?', 'Blue Card threshold')
       ON CONFLICT (key) DO NOTHING`,
    );

    const { rows } = await pool.query<{ missing: string }>(
      `SELECT DISTINCT unnest(needs_input) AS missing FROM requirements WHERE effective_to IS NULL
       EXCEPT SELECT key FROM person_fact_kinds`,
    );
    expect(rows).toEqual([]);
  });
});

describe('re-running an ingest', () => {
  it('changes nothing the second time', async () => {
    const source = connector();
    const normalized = source.normalize(FIXTURE);

    await executePlan(db, planIngest(source, normalized, [], () => uuidv7()));
    const afterFirst = await storedRequirements();

    const second = await executePlan(db, planIngest(source, normalized, await existing(), () => uuidv7()));

    expect(second).toMatchObject({ inserted: 0, superseded: 0, unchanged: 2 });
    expect(await storedRequirements()).toEqual(afterFirst);
  });
});

describe('supersession', () => {
  it('closes the old row and inserts the new one, leaving exactly one current', async () => {
    const source = connector();
    await executePlan(db, planIngest(source, source.normalize(FIXTURE), [], () => uuidv7()));

    // The same document with next year's figures — the shape this source actually takes each
    // December.
    const next2027 = source.normalize({
      ...FIXTURE,
      publicationId: 'BAnz AT 18.12.2026 B3',
      documentText: FIXTURE.documentText.replace(/2026/g, '2027').replace('50 700', '52 000'),
    });

    const report = await executePlan(db, planIngest(source, next2027, await existing(), () => uuidv7()));
    expect(report).toMatchObject({ superseded: 2, inserted: 0 });

    const rows = await storedRequirements();
    expect(rows).toHaveLength(4);

    // Exactly one live row per requirement id — the property `uq_req__current` exists for, and the
    // one an evaluator depends on to be deterministic.
    const { rows: live } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM requirements WHERE effective_to IS NULL`,
    );
    expect(Number(live[0]?.n)).toBe(2);
  });

  it('closes the old row the day before the new one starts, leaving no gap and no overlap', async () => {
    const source = connector();
    await executePlan(db, planIngest(source, source.normalize(FIXTURE), [], () => uuidv7()));

    const next2027 = source.normalize({
      ...FIXTURE,
      documentText: FIXTURE.documentText.replace(/2026/g, '2027'),
    });
    await executePlan(db, planIngest(source, next2027, await existing(), () => uuidv7()));

    const rows = await storedRequirements();
    const general = rows.filter((r) => r.requirement_id.endsWith('.general'));
    const closed = general.find((r) => r.version === '2026');
    const current = general.find((r) => r.version === '2027');

    expect(String(closed?.effective_to).slice(0, 10)).toBe('2026-12-31');
    expect(String(current?.effective_from).slice(0, 10)).toBe('2027-01-01');
    expect(current?.supersedes).toBe(closed?.id);
  });

  it('keeps history queryable — the rule as it stood is still there', async () => {
    // "What rule existed on a particular date?" is the question versioning exists to answer.
    const source = connector();
    await executePlan(db, planIngest(source, source.normalize(FIXTURE), [], () => uuidv7()));
    await executePlan(
      db,
      planIngest(
        source,
        source.normalize({ ...FIXTURE, documentText: FIXTURE.documentText.replace(/2026/g, '2027') }),
        await existing(),
        () => uuidv7(),
      ),
    );

    const { rows } = await pool.query<{ version: string }>(
      `SELECT version FROM requirements
        WHERE requirement_id = 'de.eu-blue-card.salary-threshold.general'
          AND effective_from <= '2026-06-01' AND (effective_to IS NULL OR effective_to >= '2026-06-01')`,
    );
    expect(rows.map((r) => r.version)).toEqual(['2026']);
  });
});

describe('a rejected plan', () => {
  it('writes nothing', async () => {
    const source = connector();
    // The €700 parse defect, as the extraction defect would actually produce it.
    const broken = source.normalize(FIXTURE).map((r) => ({
      ...r,
      value: { amount: 700, currency: 'EUR', period: 'year' as const, basis: 'gross' as const },
    }));

    const report = await executePlan(db, planIngest(source, broken, [], () => uuidv7()));

    expect(report.rejected).toBe(2);
    expect(report.rejectedIds).toHaveLength(2);
    expect(await storedRequirements()).toEqual([]);
  });
});

describe('dry run', () => {
  it('reports what would happen and writes nothing', async () => {
    const source = connector();
    const plan = planIngest(source, source.normalize(FIXTURE), [], () => uuidv7());

    const report = await executePlan(db, plan, { dryRun: true });

    expect(report.inserted).toBe(2);
    expect(await storedRequirements()).toEqual([]);
  });
});
