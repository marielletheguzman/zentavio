/**
 * Luxembourg, end to end, against a real database and real object storage.
 *
 * **This is M3's actual verification.** Not "Luxembourg parses" — that is a unit test — but the
 * whole chain: both instruments archived, a threshold nobody published computed from them, the
 * rows stored, and every contributing instrument citable afterwards (ADR-0025).
 *
 * The property that matters most is the last one. A rule derived from two instruments can satisfy
 * ADR-0021's check by archiving one of them, and it would look audited while being unrecomputable.
 */

import { load, storageSchema } from '@zentavio/config';
import { LegiluxConnector, type LegiluxRaw } from '@zentavio/connector-lu-legilux';
import { archiveDerivedSources, executePlan, planIngest } from '@zentavio/ingestion';
import { S3DocumentStore } from '@zentavio/storage';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  recordRequirementSources,
  requirementSources,
  unevidencedRequirements,
} from '../../../packages/db/src/repositories/documents.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../fixtures/connectors/lu-legilux/rgd-26-09-2008.json', import.meta.url)),
    'utf8',
  ),
) as LegiluxRaw;

const config = load(storageSchema);
const BUCKET = `${config.storageBucket}-lu-${String(Date.now())}`;

let pool: Pool;
let db: Kysely<Database>;
let store: S3DocumentStore;

function connector() {
  return new LegiluxConnector({ fetchInstruments: async () => FIXTURE });
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
  await pool.query('DELETE FROM immigration_pathways');
  await pool.query(
    `INSERT INTO immigration_pathways (id, pathway_id, jurisdiction, name, official_sources)
     VALUES ($1,'lu.eu-blue-card','LU','Carte bleue européenne',$2)`,
    [uuidv7(), JSON.stringify([{ url: 'https://data.legilux.public.lu/x', authoritative_for: 'eligibility' }])],
  );
});

const deps = () => ({ store, db, newId: uuidv7 });

/** Archive both instruments, ingest the rules, and bind each rule to its instruments. */
async function ingest() {
  const source = connector();

  const archived = await archiveDerivedSources(source, FIXTURE, deps());
  if (archived.kind !== 'archived') throw new Error(`archive failed: ${JSON.stringify(archived)}`);

  // The formula instrument is the one the rule's own row cites — `document_id` and `source_url`.
  const primary = archived.instruments.find((instrument) => instrument.role === 'formula');
  const report = await executePlan(
    db,
    planIngest(source, source.normalize(FIXTURE), [], () => uuidv7(), {
      kind: 'archived',
      documentId: String(primary?.document_id),
    }),
  );

  const stored = await db.selectFrom('requirements').select(['id', 'requirement_id']).execute();
  for (const row of stored) {
    // **Bound per requirement, not fanned out across all of them.** This helper used to link every
    // stored rule to every archived instrument, which was harmless while both instruments fed the
    // one derived threshold — and became a lie the moment the statute arrived: the salary threshold
    // does not come from Art. 45, and recording that it does is exactly the false provenance
    // ADR-0025 exists to prevent. A qualification row cites the statute; a computed threshold cites
    // the formula and the operand it was multiplied from.
    const derived = row.requirement_id.startsWith('lu.eu-blue-card.qualification.')
      ? archived.instruments.filter((instrument) => instrument.role === 'primary')
      : archived.instruments.filter((instrument) => instrument.role !== 'primary');

    await recordRequirementSources(
      db,
      derived.map((instrument) => ({ id: uuidv7(), requirement_id: row.id, ...instrument })),
    );
  }

  return { report, stored, archived };
}

describe('both instruments are archived before any rule is stored', () => {
  it('archives the formula and the operand as separate documents', async () => {
    const { archived } = await ingest();

    expect(archived.instruments.map((i) => i.role).sort()).toEqual(['formula', 'operand', 'primary']);

    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM documents');
    expect(Number(rows[0]?.n)).toBe(3);
  });

  it('keeps them under distinct object keys', async () => {
    // One key for two instruments would archive one and silently overwrite the other, leaving the
    // rule half-evidenced with no error anywhere. Three instruments now — the statute joined them.
    await ingest();

    const { rows } = await pool.query<{ object_key: string }>('SELECT object_key FROM documents');
    expect(new Set(rows.map((r) => r.object_key)).size).toBe(3);
  });

  it('stores nothing when an instrument cannot be archived', async () => {
    // All or nothing: a rule citing one of its two instruments is worse than one citing none,
    // because it looks audited.
    const broken = new S3DocumentStore({
      endpoint: 'http://127.0.0.1:9',
      region: 'auto',
      bucket: BUCKET,
      provider: 'minio',
      accessKeyId: 'x',
      secretAccessKey: 'y',
    });

    const outcome = await archiveDerivedSources(connector(), FIXTURE, { store: broken, db, newId: uuidv7 });

    expect(outcome.kind).toBe('failed');
    const { rows } = await pool.query('SELECT id FROM documents');
    expect(rows).toEqual([]);
  });
});

describe('the computed threshold, stored', () => {
  it('stores both thresholds, the gate, and the qualification group', async () => {
    const { report, stored } = await ingest();

    expect(report.rejected).toBe(0);
    expect(stored.map((r) => r.requirement_id).sort()).toEqual([
      'lu.eu-blue-card.qualification.diploma',
      'lu.eu-blue-card.qualification.ict-experience',
      'lu.eu-blue-card.qualification.other-experience',
      'lu.eu-blue-card.reduced-threshold-occupations',
      'lu.eu-blue-card.salary-threshold.general',
      'lu.eu-blue-card.salary-threshold.reduced',
    ]);
  });

  it('stores the three qualification limbs as one any-of group', async () => {
    // ADR-0024 rule 10, asserted against the stored rows rather than the connector's output —
    // `applies_to` surviving the round trip is what the evaluator actually reads.
    await ingest();

    const { rows } = await pool.query<{ requirement_id: string; applies_to: { anyOf?: string } }>(
      "SELECT requirement_id, applies_to FROM requirements WHERE requirement_id LIKE 'lu.eu-blue-card.qualification.%'",
    );

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.applies_to.anyOf).toBe('qualification');
    }
  });

  it('leaves the salary rows on the routes they already had', async () => {
    // **The migration that was not needed.** A routeless any-of group is pathway-wide, so the
    // salary routes keep meaning exactly what they meant and no stored `applies_to` changes —
    // ADR-0024 rule 9's breaking-change cost is not incurred at all.
    await ingest();

    const { rows } = await pool.query<{ requirement_id: string; applies_to: { route?: string } }>(
      "SELECT requirement_id, applies_to FROM requirements WHERE requirement_id LIKE 'lu.eu-blue-card.salary%' OR requirement_id LIKE '%occupations'",
    );

    const routeOf = (id: string) => rows.find((r) => r.requirement_id === id)?.applies_to.route;
    expect(routeOf('lu.eu-blue-card.salary-threshold.general')).toBe('general');
    expect(routeOf('lu.eu-blue-card.salary-threshold.reduced')).toBe('citp-1-2');
    expect(routeOf('lu.eu-blue-card.reduced-threshold-occupations')).toBe('citp-1-2');
  });

  it('stores a threshold PostgreSQL accepts as money, not as a rounding artefact', async () => {
    await ingest();

    const { rows } = await pool.query<{ value: { amount: number } }>(
      `SELECT value FROM requirements WHERE requirement_id = 'lu.eu-blue-card.salary-threshold.general'`,
    );
    const amount = rows[0]?.value.amount ?? 0;

    // The relationship rather than the figure: the number is a product of two instruments and will
    // change every year, but it is always a plausible salary and always exactly two decimals.
    expect(amount).toBeGreaterThan(20_000);
    expect(Math.round(amount * 100) / 100).toBe(amount);
  });

  it('records the operands beside the result', async () => {
    await ingest();

    const { rows } = await pool.query<{ domain_detail: { derivedFrom: readonly { role: string }[] } }>(
      `SELECT domain_detail FROM requirements WHERE requirement_id = 'lu.eu-blue-card.salary-threshold.reduced'`,
    );

    expect(rows[0]?.domain_detail.derivedFrom.map((d) => d.role).sort()).toEqual([
      'formula',
      'operand',
    ]);
  });
});

describe('every contributing instrument is citable afterwards (ADR-0025)', () => {
  it('links each stored rule to both instruments', async () => {
    const { stored } = await ingest();

    for (const row of stored) {
      const sources = await requirementSources(db, row.id);
      const expected = row.requirement_id.startsWith('lu.eu-blue-card.qualification.')
        ? ['primary']
        : ['formula', 'operand'];
      expect(sources.map((s) => s.role).sort(), row.requirement_id).toEqual(expected);
      for (const source of sources) {
        expect(source.document_id).not.toBeNull();
        expect(source.instrument_id).toMatch(/^eli\//);
      }
    }
  });

  it('reports nothing unevidenced once the sources are recorded', async () => {
    await ingest();
    expect(await unevidencedRequirements(db).execute()).toEqual([]);
  });

  it('catches a rule that claims a derivation it cannot evidence', async () => {
    // The failure this table exists to make visible: a computed number citing fewer instruments
    // than it was computed from.
    const { stored } = await ingest();
    const victim = stored.find((r) => r.requirement_id.endsWith('.general'));
    await pool.query('DELETE FROM requirement_sources WHERE requirement_id = $1 AND role = $2', [
      victim?.id,
      'operand',
    ]);

    const unevidenced = await unevidencedRequirements(db).execute();
    expect(unevidenced.map((r) => r.requirement_id)).toEqual(['lu.eu-blue-card.salary-threshold.general']);
  });

  it('leaves single-source rules alone', async () => {
    // Germany's rules record no derivation and must not be flagged by a check written for
    // Luxembourg. The query keys on `domain_detail.derivedFrom`, which they do not have.
    await ingest();
    await pool.query(
      `UPDATE requirements SET domain_detail = '{"legalBasis":"x"}'::jsonb
        WHERE requirement_id = 'lu.eu-blue-card.reduced-threshold-occupations'`,
    );
    await pool.query(
      `DELETE FROM requirement_sources WHERE requirement_id IN (
         SELECT id FROM requirements WHERE requirement_id = 'lu.eu-blue-card.reduced-threshold-occupations'
       )`,
    );

    const unevidenced = await unevidencedRequirements(db).execute();
    expect(unevidenced.map((r) => r.requirement_id)).not.toContain(
      'lu.eu-blue-card.reduced-threshold-occupations',
    );
  });

  it('refuses to record an instrument twice in the same role', async () => {
    // Double-counting an operand would make the recorded derivation ambiguous.
    const { stored, archived } = await ingest();
    const duplicate = archived.instruments[0]!;

    await expect(
      recordRequirementSources(db, [
        { id: uuidv7(), requirement_id: stored[0]!.id, ...duplicate },
      ]),
    ).rejects.toThrow(/uq_reqsrc__instrument/);
  });
});
