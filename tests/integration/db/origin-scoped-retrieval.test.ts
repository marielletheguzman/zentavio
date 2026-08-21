/**
 * The three gathers ADR-0029 introduced, against a real database.
 *
 * **What the unit tests cannot prove.** `eligibility.service.test.ts` stubs the database and shows
 * the gateway asks three times and merges the answers; `requirements.test.ts` compiles the SQL and
 * shows the predicates are the intended ones. Neither shows PostgreSQL returning the right rows —
 * that a `profession`-scoped query really does return a recognition row carrying no pathway, or
 * that `imposed_by = 'origin'` really does isolate the Philippine duties from the German ones.
 * This does, and the difference has caught this repository before.
 *
 * **What this file still does not cover, stated rather than implied:** it exercises the repository
 * against real SQL, not the gateway's composition of it. Nothing here builds an
 * `EligibilityService`, and no verdict is produced — matching a gathered rule against a person's
 * origin is `applies_to.origin_jurisdiction`, which is ADR-0029's third follow-up and is not
 * implemented yet.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { requirementsAsOf } from '../../../packages/db/src/repositories/requirements.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { migratedTestPool } from './database.ts';
import { PATHWAY_ID, insertPathway, insertRequirement, validRequirement } from './fixtures.ts';

let pool: Pool;
let db: Kysely<Database>;

const AS_OF = '2026-06-01';

/** The rules a Filipino nurse moving to Germany is subject to, plus the ones she is not. */
async function seedThreeDomains(): Promise<void> {
  await insertPathway(pool, PATHWAY_ID);

  // 1 — the pathway's own rule. Carries a pathway, no profession.
  await insertRequirement(
    pool,
    validRequirement({
      requirement_id: 'de.eu-blue-card.salary-threshold',
      domain: 'immigration',
      pathway_id: PATHWAY_ID,
      profession: null,
    }),
  );

  // 2 — the destination's rule for her profession. Carries a profession, **no pathway**, which is
  // why no pathway-scoped query has ever returned it.
  await insertRequirement(
    pool,
    validRequirement({
      requirement_id: 'de.nursing.licence-recognition',
      domain: 'recognition',
      jurisdiction: 'DE',
      pathway_id: null,
      profession: 'registered-nurse',
      kind: 'assessment',
      evaluation: 'manual',
    }),
  );

  // 3 — the origin state's duty. Imposed by PH, applies to every departing worker.
  await insertRequirement(
    pool,
    validRequirement({
      requirement_id: 'ph.overseas-employment.clearance',
      domain: 'employment_clearance',
      imposed_by: 'origin',
      jurisdiction: 'PH',
      pathway_id: null,
      profession: null,
      kind: 'document',
      evaluation: 'document-present',
    }),
  );

  // Decoys, one per way the scoping could be wrong.
  await insertRequirement(
    pool,
    validRequirement({
      requirement_id: 'lu.nursing.licence-recognition',
      domain: 'recognition',
      jurisdiction: 'LU',
      pathway_id: null,
      profession: 'registered-nurse',
      kind: 'assessment',
      evaluation: 'manual',
    }),
  );
  await insertRequirement(
    pool,
    validRequirement({
      requirement_id: 'de.physiotherapy.licence-recognition',
      domain: 'recognition',
      jurisdiction: 'DE',
      pathway_id: null,
      profession: 'physiotherapist',
      kind: 'assessment',
      evaluation: 'manual',
    }),
  );
  await insertRequirement(
    pool,
    validRequirement({
      requirement_id: 'ph.teaching.board-licence',
      domain: 'recognition',
      imposed_by: 'origin',
      jurisdiction: 'PH',
      pathway_id: null,
      profession: 'teacher',
      kind: 'assessment',
      evaluation: 'manual',
    }),
  );
}

async function idsFrom(
  scope: Parameters<typeof requirementsAsOf>[1],
): Promise<string[]> {
  const rows = await requirementsAsOf(db, scope, AS_OF).execute();
  return rows.map((row) => row.requirement_id).sort();
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await pool.query('TRUNCATE requirements, immigration_pathways CASCADE');
  await seedThreeDomains();
});

describe('gathering across domains', () => {
  it('returns only the pathway rule when scoped to the pathway', async () => {
    // The state before ADR-0029, kept as the baseline: this is the whole set retrieval used to see,
    // and it contains nothing about a licence.
    expect(await idsFrom({ pathwayId: PATHWAY_ID })).toEqual(['de.eu-blue-card.salary-threshold']);
  });

  it("returns the destination's recognition rule when scoped to the profession", async () => {
    expect(await idsFrom({ jurisdiction: 'DE', profession: 'registered-nurse' })).toEqual([
      'de.nursing.licence-recognition',
    ]);
  });

  it('does not return another destination’s rule for the same profession', async () => {
    // Luxembourg's nursing rules must not arrive in a German verdict.
    const ids = await idsFrom({ jurisdiction: 'DE', profession: 'registered-nurse' });
    expect(ids).not.toContain('lu.nursing.licence-recognition');
  });

  it('does not return another profession’s rule in the same destination', async () => {
    const ids = await idsFrom({ jurisdiction: 'DE', profession: 'registered-nurse' });
    expect(ids).not.toContain('de.physiotherapy.licence-recognition');
  });

  it("returns the origin state's duty, which no destination-scoped query can see", async () => {
    const ids = await idsFrom({
      jurisdiction: 'PH',
      imposedBy: 'origin',
      profession: 'registered-nurse',
      includeProfessionless: true,
    });

    // The clearance names no profession and still applies to her; the teaching licence names one
    // and does not.
    expect(ids).toEqual(['ph.overseas-employment.clearance']);
  });

  it('drops the professionless origin duty when widening is not asked for', async () => {
    // The failure the flag exists to prevent, pinned so the default cannot quietly change: scoped
    // exactly, the clearance disappears and the person is told nothing about a step they still
    // have to take.
    expect(
      await idsFrom({ jurisdiction: 'PH', imposedBy: 'origin', profession: 'registered-nurse' }),
    ).toEqual([]);
  });

  it('keeps a rule out of the set once it is no longer in force on the date asked about', async () => {
    await pool.query(
      `UPDATE requirements SET effective_to = '2026-03-01' WHERE requirement_id = 'de.nursing.licence-recognition'`,
    );

    expect(await idsFrom({ jurisdiction: 'DE', profession: 'registered-nurse' })).toEqual([]);
    // ...and is still there for a verdict given while it was in force.
    const rows = await requirementsAsOf(
      db,
      { jurisdiction: 'DE', profession: 'registered-nurse' },
      '2026-02-01',
    ).execute();
    expect(rows.map((row) => row.requirement_id)).toEqual(['de.nursing.licence-recognition']);
  });

  it('gathers a rule that declares no origin scope, because absent means broader', async () => {
    // ADR-0029's conservative reading, at the level retrieval can hold it: `applies_to` is never a
    // predicate here, so a rule declaring no origin is returned for everybody and the evaluator
    // decides. A SQL filter on that key would drop precisely the rules that apply to all origins.
    const rows = await requirementsAsOf(
      db,
      { jurisdiction: 'DE', profession: 'registered-nurse' },
      AS_OF,
    ).execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.applies_to).toEqual({});
  });
});
