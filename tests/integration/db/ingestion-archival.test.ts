/**
 * Archive-then-store, end to end (ADR-0021 rollout phase 5).
 *
 * Real connector, real MinIO, real PostgreSQL. What only this combination proves: that the bytes a
 * connector calls its source actually round-trip through storage, that the recorded checksum
 * verifies on read, and that a stored requirement ends up citing the document it came from rather
 * than nothing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { load, storageSchema } from '@zentavio/config';
import { AufenthgConnector, type StatuteRaw } from '@zentavio/connector-de-aufenthg';
import { archiveSource, executePlan, planIngest } from '@zentavio/ingestion';
import { S3DocumentStore } from '@zentavio/storage';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../fixtures/connectors/de-aufenthg/aufenthg-18g.json', import.meta.url)),
    'utf8',
  ),
) as StatuteRaw;

const config = load(storageSchema);
const BUCKET = `${config.storageBucket}-archival-${String(Date.now())}`;

let pool: Pool;
let db: Kysely<Database>;
let store: S3DocumentStore;

function connector() {
  return new AufenthgConnector({
    knownDocuments: [FIXTURE.documentId],
    fetchDocument: async () => FIXTURE,
  });
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
  await pool.query('UPDATE requirements SET document_id = NULL');
  await pool.query('DELETE FROM requirements');
  await pool.query('DELETE FROM documents');
  await pool.query('DELETE FROM immigration_pathways');
  await pool.query(
    `INSERT INTO immigration_pathways (id, pathway_id, jurisdiction, name, official_sources)
     VALUES ($1,'de.eu-blue-card','DE','Blaue Karte EU',$2)`,
    [uuidv7(), JSON.stringify([{ url: 'https://x', authoritative_for: 'eligibility' }])],
  );
});

const deps = () => ({ store, db, newId: uuidv7 });

describe('archiving the source', () => {
  it('stores the bytes and records the document', async () => {
    const outcome = await archiveSource(
      connector(),
      FIXTURE,
      FIXTURE.sourceUrl,
      FIXTURE.fetchedAt,
      deps(),
    );

    expect(outcome.kind).toBe('archived');
    if (outcome.kind !== 'archived') return;

    expect(outcome.document.object_key).toBe('immigration/de/2023/aufenthg-18g.html');
    expect(outcome.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The statute is published as HTML, so these bytes are the document itself.
    expect(outcome.isOriginal).toBe(true);
  });

  it('archives bytes that read back and verify', async () => {
    // The point of the checksum: a document that changed since archiving is not the document the
    // claim was made from, and `get` refuses it.
    const outcome = await archiveSource(connector(), FIXTURE, FIXTURE.sourceUrl, FIXTURE.fetchedAt, deps());
    if (outcome.kind !== 'archived') throw new Error('expected an archive');

    const bytes = await store.get(outcome.document.object_key, outcome.document.sha256);
    expect(new TextDecoder().decode(bytes)).toContain('Blaue Karte EU');
  });

  it('is idempotent — re-archiving an unchanged source reuses the row', async () => {
    // Keys are deterministic, so a scheduled run re-reading an unchanged page must not fail.
    const first = await archiveSource(connector(), FIXTURE, FIXTURE.sourceUrl, FIXTURE.fetchedAt, deps());
    const again = await archiveSource(connector(), FIXTURE, FIXTURE.sourceUrl, FIXTURE.fetchedAt, deps());

    if (first.kind !== 'archived' || again.kind !== 'archived') throw new Error('expected archives');
    expect(again.document.id).toBe(first.document.id);

    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM documents');
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('reports a storage failure rather than throwing', async () => {
    // The caller decides what a failed archive means — a warning today, a rejection once the
    // enforcement phase lands. Throwing here would take that choice away.
    const broken = new S3DocumentStore({
      endpoint: 'http://127.0.0.1:9', // nothing listens
      region: 'auto',
      bucket: BUCKET,
      provider: 'minio',
      accessKeyId: 'x',
      secretAccessKey: 'y',
    });

    const outcome = await archiveSource(connector(), FIXTURE, FIXTURE.sourceUrl, FIXTURE.fetchedAt, {
      store: broken,
      db,
      newId: uuidv7,
    });

    expect(outcome.kind).toBe('failed');
  });
});

describe('the stored rule cites its evidence', () => {
  it('carries document_id through to the database', async () => {
    const source = connector();
    const archive = await archiveSource(source, FIXTURE, FIXTURE.sourceUrl, FIXTURE.fetchedAt, deps());
    if (archive.kind !== 'archived') throw new Error('expected an archive');

    const plan = planIngest(source, source.normalize(FIXTURE), [], () => uuidv7(), {
      kind: 'archived',
      documentId: archive.document.id,
    });
    const report = await executePlan(db, plan);

    // Seven provisions, once § 18g's Abs. 1 S. 2 Nr. 2 gate, its S. 5 widening and the whole of
    // Abs. 2 are extracted (ADR-0024). Every one of them cites the same archived page.
    expect(report.inserted).toBe(7);

    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM requirements WHERE document_id = $1',
      [archive.document.id],
    );
    expect(Number(rows[0]?.n)).toBe(7);
  });

  it('leaves nothing unarchived once the document is attached', async () => {
    const source = connector();
    const archive = await archiveSource(source, FIXTURE, FIXTURE.sourceUrl, FIXTURE.fetchedAt, deps());
    if (archive.kind !== 'archived') throw new Error('expected an archive');

    await executePlan(
      db,
      planIngest(source, source.normalize(FIXTURE), [], () => uuidv7(), {
        kind: 'archived',
        documentId: archive.document.id,
      }),
    );

    const { rows } = await pool.query('SELECT id FROM requirements WHERE document_id IS NULL');
    expect(rows).toEqual([]);
  });

  it('rejects every rule when the archive failed', async () => {
    // ADR-0021's enforcement point. A rule with no retrievable evidence is a number nobody can
    // audit, so none of them are stored — not even the ones that parsed cleanly.
    const source = connector();
    const plan = planIngest(source, source.normalize(FIXTURE), [], () => uuidv7(), {
      kind: 'failed',
      reason: 'storage unreachable',
    });

    const report = await executePlan(db, plan);

    expect(report.inserted).toBe(0);
    expect(report.rejected).toBe(7);
    expect((await pool.query('SELECT id FROM requirements')).rows).toEqual([]);
  });

  it('still stores when a connector declares it has nothing to archive', async () => {
    // Distinct from a failure on purpose: a source with no document — a pure API whose response we
    // already keep — is a connector making a deliberate statement, not an incident. Collapsing the
    // two would let a storage outage look like a source that never had a document.
    const source = connector();
    await executePlan(db, planIngest(source, source.normalize(FIXTURE), [], () => uuidv7()));

    const { rows } = await pool.query('SELECT id FROM requirements WHERE document_id IS NULL');
    expect(rows).toHaveLength(7);
  });
});
