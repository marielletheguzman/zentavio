/**
 * The `documents` table and its link to `requirements`.
 *
 * The constraints here exist to keep archived evidence trustworthy: a malformed checksum fails
 * every read as an integrity error, and two rows for one key make "which document is this"
 * ambiguous at exactly the moment someone is checking provenance.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DocumentConflictError,
  attachDocument,
  recordDocument,
  unarchivedRequirements,
} from '../../../packages/db/src/repositories/documents.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { expectViolation, migratedTestPool } from './database.ts';

const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);

let pool: Pool;
let db: Kysely<Database>;
let seq = 0;

function newDocument(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: uuidv7(),
    object_key: `immigration/de/2026/doc-n${String(seq)}.pdf`,
    provider: 'minio',
    bucket: 'zentavio-documents',
    mime_type: 'application/pdf',
    size_bytes: '2048',
    sha256: SHA,
    source_url: 'https://www.bundesanzeiger.de/x',
    retrieved_at: new Date('2026-08-04T00:00:00Z'),
    ...overrides,
  };
}

async function insertDocument(overrides: Record<string, unknown> = {}): Promise<void> {
  const row = newDocument(overrides);
  await pool.query(
    `INSERT INTO documents (id, object_key, provider, bucket, mime_type, size_bytes, sha256, source_url, retrieved_at, archived_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, now()))`,
    [
      row.id, row.object_key, row.provider, row.bucket, row.mime_type,
      row.size_bytes, row.sha256, row.source_url, row.retrieved_at,
      (overrides['archived_at'] as Date | undefined) ?? null,
    ],
  );
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('UPDATE requirements SET document_id = NULL');
  await pool.query('DELETE FROM documents');
  await pool.query('DELETE FROM requirements');
  await pool.query('DELETE FROM immigration_pathways');
});

describe('checksum shape', () => {
  it.each(['', 'abc', SHA.toUpperCase(), `${SHA}00`, 'z'.repeat(64)])(
    'refuses %p as a sha256',
    async (sha256) => {
      // A truncated or upper-case digest compares unequal to the one DocumentStore computes, so
      // every read would fail as an integrity error and send someone hunting a tampering incident
      // that never happened.
      const violation = await expectViolation(pool, () => insertDocument({ sha256 }));
      expect(violation.constraint).toBe('ck_documents__sha256');
    },
  );

  it('accepts a lower-case 64-character digest', async () => {
    await expect(insertDocument({ sha256: SHA })).resolves.toBeUndefined();
  });
});

describe('the two timestamps', () => {
  it('refuses an archive that precedes its retrieval', async () => {
    // The pair exists to make a fetch-succeeded-archive-failed gap visible. A negative gap is not
    // a gap, it is a clock or a bug.
    const violation = await expectViolation(pool, () =>
      insertDocument({
        retrieved_at: new Date('2026-08-04T10:00:00Z'),
        archived_at: new Date('2026-08-04T09:00:00Z'),
      }),
    );
    expect(violation.constraint).toBe('ck_documents__archived_after_retrieved');
  });

  it('allows them to be the same instant', async () => {
    const at = new Date('2026-08-04T10:00:00Z');
    await expect(insertDocument({ retrieved_at: at, archived_at: at })).resolves.toBeUndefined();
  });
});

describe('one row per key', () => {
  it('refuses a second document under the same object key', async () => {
    // Two rows for one key make "which document is this" ambiguous at the moment someone is
    // checking provenance.
    await insertDocument({ object_key: 'immigration/de/2026/same.pdf' });
    const violation = await expectViolation(pool, () =>
      insertDocument({ object_key: 'immigration/de/2026/same.pdf' }),
    );
    expect(violation.constraint).toBe('uq_documents__object_key');
  });

  it('refuses a zero-byte document', async () => {
    const violation = await expectViolation(pool, () => insertDocument({ size_bytes: '0' }));
    expect(violation.constraint).toBe('ck_documents__size');
  });
});

describe('recordDocument', () => {
  it('creates on first archive', async () => {
    const { created, row } = await recordDocument(db, newDocument());
    expect(created).toBe(true);
    expect(row.sha256).toBe(SHA);
  });

  it('is idempotent — re-archiving an unchanged source returns the stored row', async () => {
    // Keys are deterministic, so a scheduled run re-reading an unchanged page produces the same
    // key. Failing there on a unique violation would break every repeat run.
    const first = await recordDocument(db, newDocument({ object_key: 'k/1.pdf' }));
    const again = await recordDocument(db, newDocument({ object_key: 'k/1.pdf' }));

    expect(again.created).toBe(false);
    expect(again.row.id).toBe(first.row.id);
  });

  it('refuses a different checksum under the same key rather than merging', async () => {
    // The key derives from the document's identity, so this is either a source that changed
    // without changing its identity, or a key collision. Neither is safe to resolve silently.
    await recordDocument(db, newDocument({ object_key: 'k/2.pdf', sha256: SHA }));

    await expect(
      recordDocument(db, newDocument({ object_key: 'k/2.pdf', sha256: OTHER_SHA })),
    ).rejects.toThrow(DocumentConflictError);
  });
});

describe('linking a requirement to its evidence', () => {
  async function insertRequirement(): Promise<string> {
    const pathwayId = 'de.eu-blue-card';
    await pool.query(
      `INSERT INTO immigration_pathways (id, pathway_id, jurisdiction, name, official_sources)
       VALUES ($1,$2,'DE','Blaue Karte EU',$3) ON CONFLICT (pathway_id) DO NOTHING`,
      [uuidv7(), pathwayId, JSON.stringify([{ url: 'https://x', authoritative_for: 'eligibility' }])],
    );

    const id = uuidv7();
    await pool.query(
      `INSERT INTO requirements (id, requirement_id, domain, imposed_by, jurisdiction, pathway_id,
                                 kind, value, evaluation, source_tier, source_url, retrieved_at,
                                 authority, effective_from, version, refresh_after)
       VALUES ($1,'de.eu-blue-card.x','immigration','destination','DE',$2,'threshold','{}'::jsonb,
               'numeric-gte',1,'https://x',now(),'BMI','2026-01-01','2026','2026-12-31')`,
      [id, pathwayId],
    );
    return id;
  }

  it('starts unarchived, and says so', async () => {
    // The query ADR-0021's enforcement phase must return empty before the flip.
    const id = await insertRequirement();

    const unarchived = await unarchivedRequirements(db).execute();
    expect(unarchived.map((r) => r.id)).toContain(id);
  });

  it('links, and drops out of the unarchived list', async () => {
    const requirementId = await insertRequirement();
    const { row } = await recordDocument(db, newDocument());

    await attachDocument(db, requirementId, row.id).execute();

    expect(await unarchivedRequirements(db).execute()).toEqual([]);
  });

  it('refuses to delete a document a requirement still cites', async () => {
    // Evidence is not deletable while something depends on it — the whole point of archiving.
    const requirementId = await insertRequirement();
    const { row } = await recordDocument(db, newDocument());
    await attachDocument(db, requirementId, row.id).execute();

    const violation = await expectViolation(pool, () =>
      pool.query('DELETE FROM documents WHERE id = $1', [row.id]),
    );
    expect(violation.constraint).toBe('fk_req__documents');
  });

  it('refuses a document id that does not exist', async () => {
    const requirementId = await insertRequirement();
    const violation = await expectViolation(pool, () =>
      attachDocument(db, requirementId, uuidv7()).execute(),
    );
    expect(violation.constraint).toBe('fk_req__documents');
  });
});

describe('the replaced column', () => {
  it('no longer exists', async () => {
    // Two ways to say where a document is means two answers that can disagree, and the old text
    // column had no checksum and nothing to join to.
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'requirements' AND column_name IN ('source_document','document_id')`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(['document_id']);
  });
});
