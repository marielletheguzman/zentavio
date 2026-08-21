/**
 * The Bavarian engineer title, end to end, against a real database and real object storage.
 *
 * **This is M5's actual verification.** Not "BayIngG parses" — that is a unit test — but the whole
 * chain: both articles archived, origin-scoped recognition rows stored, each row citing the
 * instruments it came from, and a verdict that changes with the person's origin.
 *
 * The property that matters most is the last one. Until ADR-0029 no `recognition` row could reach
 * the evaluator at all, because a recognition row carries a profession and no pathway while
 * retrieval asked only for a pathway's rules. Everything here would have stored correctly and been
 * invisible.
 *
 * **What this does not cover, stated rather than implied:** no `EligibilityService` is built here
 * and no HTTP boundary is crossed. The gateway's composition is unit-tested; this asserts the
 * database and the evaluator's inputs.
 */

import { load, storageSchema } from '@zentavio/config';
import { BayIngGConnector, type BayIngGRaw } from '@zentavio/connector-de-bayingg';
import { archiveDerivedSources, executePlan, planIngest } from '@zentavio/ingestion';
import { S3DocumentStore } from '@zentavio/storage';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { recordRequirementSources, requirementSources } from '../../../packages/db/src/repositories/documents.ts';
import { requirementsAsOf } from '../../../packages/db/src/repositories/requirements.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../fixtures/connectors/de-bayingg/bayingg-art2-art3.json', import.meta.url)),
    'utf8',
  ),
) as BayIngGRaw;

const config = load(storageSchema);
const BUCKET = `${config.storageBucket}-bayingg-${String(Date.now())}`;

const AS_OF = '2026-08-21';
const PROFESSION = 'ingenieur-protected-title';

let pool: Pool;
let db: Kysely<Database>;
let store: S3DocumentStore;

function connector() {
  return new BayIngGConnector({ fetchDocument: async () => null });
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  store = new S3DocumentStore({
    endpoint: config.storageEndpoint,
    region: config.storageRegion,
    bucket: BUCKET,
    provider: config.storageProvider,
    accessKeyId: config.storageAccessKeyId,
    secretAccessKey: config.storageSecretAccessKey,
  });
  await store.ensureBucket();
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM requirement_sources');
  await pool.query('UPDATE requirements SET document_id = NULL');
  await pool.query('DELETE FROM requirements');
  await pool.query('DELETE FROM documents');
});

const deps = () => ({ store, db, newId: uuidv7 });

/** Archive both articles, ingest the rules, and bind each rule to both instruments. */
async function ingest() {
  const source = connector();

  const archived = await archiveDerivedSources(source, FIXTURE, deps());
  if (archived.kind !== 'archived') throw new Error(`archive failed: ${JSON.stringify(archived)}`);

  // Art. 2 is what a row cites in its own `source_url` and `document_id`; both articles are bound
  // through `requirement_sources`, because a row citing only Art. 2 is unreadable as the rule it is.
  const title = archived.instruments.find((instrument) => instrument.instrument_id === 'BayIngG2016-2');
  const report = await executePlan(
    db,
    planIngest(source, source.normalize(FIXTURE), [], () => uuidv7(), {
      kind: 'archived',
      documentId: String(title?.document_id),
    }),
  );

  const stored = await db.selectFrom('requirements').select(['id', 'requirement_id']).execute();
  for (const row of stored) {
    await recordRequirementSources(
      db,
      archived.instruments.map((instrument) => ({
        id: uuidv7(),
        requirement_id: row.id,
        ...instrument,
      })),
    );
  }

  return { report, stored, archived };
}

describe('both articles are archived before any rule is stored', () => {
  it('archives Art. 2 and Art. 3 as separate documents', async () => {
    const { archived } = await ingest();

    expect(archived.instruments).toHaveLength(2);
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM documents');
    expect(Number(rows[0]?.n)).toBe(2);
  });

  it('keeps them under distinct object keys', async () => {
    // One key for two instruments archives one and silently overwrites the other, leaving the rule
    // half-evidenced with no error anywhere.
    await ingest();

    const { rows } = await pool.query<{ object_key: string }>('SELECT object_key FROM documents');
    expect(new Set(rows.map((r) => r.object_key)).size).toBe(2);
  });

  it('cites both instruments from every stored rule', async () => {
    const { stored } = await ingest();

    for (const row of stored) {
      const sources = await requirementSources(db, row.id);
      expect(sources).toHaveLength(2);
    }
  });
});

describe('the stored rules', () => {
  it('stores the two conditions and the permission', async () => {
    const { report, stored } = await ingest();

    expect(report.rejected).toBe(0);
    expect(stored.map((r) => r.requirement_id).sort()).toEqual([
      'de.ingenieur-title.by.ects-credits.ph',
      'de.ingenieur-title.by.permission.ph',
      'de.ingenieur-title.by.study-duration.ph',
    ]);
  });

  it('stores them as recognition rows scoped to a profession and a Land', async () => {
    await ingest();

    const { rows } = await pool.query<{ domain: string; profession: string; subdivision: string; pathway_id: string | null }>(
      'SELECT domain, profession, subdivision, pathway_id FROM requirements',
    );

    for (const row of rows) {
      expect(row.domain).toBe('recognition');
      expect(row.profession).toBe(PROFESSION);
      expect(row.subdivision).toBe('BY');
      // `ck_req__scope` — a recognition row carries a profession, never a pathway.
      expect(row.pathway_id).toBeNull();
    }
  });

  it('stores the origin scope as the evaluator reads it', async () => {
    await ingest();

    const { rows } = await pool.query<{ applies_to: { origin_jurisdiction?: string[] } }>(
      'SELECT applies_to FROM requirements',
    );

    for (const row of rows) {
      expect(row.applies_to.origin_jurisdiction).toEqual(['PH']);
    }
  });
});

describe('retrieval reaches them, which is what ADR-0029 changed', () => {
  it('returns nothing for a pathway-scoped read', async () => {
    // The state before #116, kept as the baseline: these rows exist, carry no pathway, and were
    // invisible to the only query the gateway made.
    await ingest();

    const rows = await requirementsAsOf(db, { pathwayId: 'de.eu-blue-card' }, AS_OF).execute();
    expect(rows).toEqual([]);
  });

  it('returns them for a profession-scoped read in the destination', async () => {
    await ingest();

    const rows = await requirementsAsOf(db, { jurisdiction: 'DE', profession: PROFESSION }, AS_OF).execute();
    expect(rows).toHaveLength(3);
  });

  it('returns them regardless of the person, because placement is the evaluator’s', async () => {
    // Retrieval never filters on `applies_to`. A SQL predicate on the scope key would drop rules
    // declaring none — the ones that apply to everybody — so gathering is deliberately wider than
    // applying, and the evaluator discards.
    await ingest();

    const rows = await requirementsAsOf(db, { jurisdiction: 'DE', profession: PROFESSION }, AS_OF).execute();
    expect(rows.map((row) => (row.applies_to as { origin_jurisdiction: string[] }).origin_jurisdiction)).toEqual([
      ['PH'],
      ['PH'],
      ['PH'],
    ]);
  });
});
