/**
 * The ingest pipeline, end to end, against a real database.
 *
 * Uses the **real `de-bundesanzeiger` connector and its committed fixture** rather than a stub, so
 * what is exercised is the path a scheduled run takes: the actual 2026 Bekanntmachung text, the
 * actual normalization, the actual validation, the actual rows.
 *
 * What the unit tests cannot prove is here: that the rows the planner produces are ones PostgreSQL
 * will accept, that consecutive years leave no gap and no overlap, and that a rejected plan leaves
 * the database untouched.
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

/**
 * The ISO date pg actually stored.
 *
 * Two traps, one after the other. `String(d).slice(0,10)` yields `'Thu Dec 31'`. And
 * `toISOString()` is **wrong** here: pg returns a `date` column as a `Date` at *local* midnight,
 * so in any timezone east of UTC it converts back to the previous day — `2026-12-31` reads as
 * `2026-12-30`. CI runs UTC and cannot catch that; a machine in UTC+8 catches it immediately.
 *
 * Local date parts are what the column actually holds.
 */
function isoDate(value: unknown): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(value.getFullYear())}-${month}-${day}`;
}

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
    effectiveTo: r.effective_to === null ? null : isoDate(r.effective_to),
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
  it('stores both 2026 figures from the actual Bekanntmachung, one row per route', async () => {
    // **Three rows from two figures.** The document says the 45,3 % minimum applies "nach § 18 g
    // Absatz 1 Satz 2 sowie nach § 18g Absatz 2", and a row carries one route (ADR-0024). Stored
    // once, the Abs. 2 route would have no salary rule and would open on its occupation and
    // experience alone — met at any wage.
    const source = connector();
    const normalized = source.normalize(FIXTURE);
    const report = await executePlan(db, planIngest(source, normalized, [], () => uuidv7()));

    expect(report).toMatchObject({ sourceId: 'de-bundesanzeiger', inserted: 3, rejected: 0 });

    const rows = await storedRequirements();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.requirement_id)).toEqual([
      'de.eu-blue-card.salary-threshold.general',
      'de.eu-blue-card.salary-threshold.reduced',
      'de.eu-blue-card.salary-threshold.reduced.abs2',
    ]);
  });

  it('gives each route its own row, with the same figure and its own id', async () => {
    // The two reduced rows are one announced figure reported twice, not two figures. They can
    // diverge the moment BMI announces different ones, which is why the route is on the row rather
    // than inferred at read time.
    const source = connector();
    await executePlan(db, planIngest(source, source.normalize(FIXTURE), [], () => uuidv7()));

    const { rows } = await pool.query<{ requirement_id: string; applies_to: { route?: string } }>(
      `SELECT requirement_id, applies_to FROM requirements ORDER BY requirement_id`,
    );

    expect(rows.map((r) => r.applies_to.route)).toEqual(['abs1-s1', 'abs1-s2', 'abs2']);
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

    // Deliberately NOT filtered on `effective_to IS NULL`: these rows are annually bounded and
    // born closed, so that filter matches nothing and would make this check vacuous again.
    const { rows } = await pool.query<{ missing: string }>(
      `SELECT DISTINCT unnest(needs_input) AS missing FROM requirements
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

    expect(second).toMatchObject({ inserted: 0, superseded: 0, unchanged: 3 });
    expect(await storedRequirements()).toEqual(afterFirst);
  });
});

describe('annually bounded rules do not supersede', () => {
  it('adds next year as a new row rather than closing this year', async () => {
    // The Bekanntmachung is explicitly *for one calendar year*, so `normalize` sets `effective_to`
    // to 31 December. These rows are born closed. Nothing is ever `effective_to IS NULL`, so the
    // supersession path does not fire for this source — each year is simply another row.
    //
    // That is the honest model for this rule, and it has a consequence worth knowing:
    // `uq_req__current` is partial on `effective_to IS NULL`, so it enforces nothing here. What
    // keeps exactly one rule applicable on a given date is that the year ranges do not overlap,
    // and no constraint checks that. See the README.
    const source = connector();
    await executePlan(db, planIngest(source, source.normalize(FIXTURE), [], () => uuidv7()));

    const next2027 = source.normalize({
      ...FIXTURE,
      publicationId: 'BAnz AT 18.12.2026 B3',
      documentText: FIXTURE.documentText.replace(/2026/g, '2027').replace('50 700', '52 000'),
    });

    const report = await executePlan(db, planIngest(source, next2027, await existing(), () => uuidv7()));
    expect(report).toMatchObject({ inserted: 3, superseded: 0 });
    expect(await storedRequirements()).toHaveLength(6);
  });

  it('leaves no gap and no overlap between consecutive years', async () => {
    // The property that actually matters: on any date, exactly one row applies.
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

    const rows = (await storedRequirements()).filter((r) => r.requirement_id.endsWith('.general'));
    const y2026 = rows.find((r) => r.version === '2026');
    const y2027 = rows.find((r) => r.version === '2027');

    expect(isoDate(y2026?.effective_to)).toBe('2026-12-31');
    expect(isoDate(y2027?.effective_from)).toBe('2027-01-01');
  });

  it('keeps history queryable — the rule as it stood is still there', async () => {
    // "What rule existed on a particular date?" is the question versioning exists to answer, and
    // it is answered by the date range rather than by a null `effective_to`.
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

    expect(report.rejected).toBe(3);
    expect(report.rejectedIds).toHaveLength(3);
    expect(await storedRequirements()).toEqual([]);
  });
});

describe('dry run', () => {
  it('reports what would happen and writes nothing', async () => {
    const source = connector();
    const plan = planIngest(source, source.normalize(FIXTURE), [], () => uuidv7());

    const report = await executePlan(db, plan, { dryRun: true });

    expect(report.inserted).toBe(3);
    expect(await storedRequirements()).toEqual([]);
  });
});
