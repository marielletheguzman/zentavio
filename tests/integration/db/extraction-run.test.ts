/**
 * ADR-0036 against a real database: the pass converges, and ingest does not disturb it gratuitously.
 *
 * The one that matters is **`does not re-select a posting that matched nothing`**. If the marker is
 * ever dropped, or the pass is rekeyed on `job_posting_skills` rows, that test fails and nothing else
 * does — the system would otherwise look healthy while re-extracting the whole corpus forever.
 *
 * The two negative cases exist because the marker's value is entirely in what does *not* clear it. A
 * sighting and a lower-tier refusal both bump `updated_at`; neither has changed a word of the prose,
 * and neither may cost a re-extraction.
 */

import { postingsDueForExtraction, upsertPostingFromSource } from '@zentavio/db';
import type { Database, PostingFields, SourceObservation } from '@zentavio/db';
import { EXTRACTOR_VERSION, extractDuePostings } from '@zentavio/ingestion';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;

const RUN_DEPS = { now: () => new Date('2026-08-23T10:00:00Z'), newId: uuidv7 };

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM job_posting_skills');
  await pool.query('DELETE FROM job_posting_sources');
  await pool.query('DELETE FROM job_postings');
  await pool.query('DELETE FROM skill_aliases');
  await pool.query('DELETE FROM skills');

  await pool.query(
    `INSERT INTO connector_sources
       (id, kind, display_name, connector_version, source_tier, terms_url, legal_basis,
        rate_limit, refresh_window, schedule)
     VALUES ('lever', 'job-board', 'Lever', '1.0.0', 2,
             'https://help.lever.co/', 'Published postings are publicly viewable',
             '{"requests":60,"per":"minute"}'::jsonb, '1 day', '0 4 * * *')
     ON CONFLICT (id) DO NOTHING`,
  );

  const kubernetesId = uuidv7();
  await pool.query(
    `INSERT INTO skills (id, slug, name, kind, source_tier, basis) VALUES ($1,'kubernetes','Kubernetes','technology',3,'curated')`,
    [kubernetesId],
  );
  await pool.query(
    `INSERT INTO skill_aliases (id, skill_id, alias, normalized, source_tier) VALUES ($1,$2,'kubernetes','kubernetes',3)`,
    [uuidv7(), kubernetesId],
  );
});

/** A posting inserted directly, so a test can choose exactly what prose it carries. */
async function givenPosting(description: string | null, requirementsText: string | null): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO job_postings
       (id, dedup_key, dedup_basis, title, url, first_seen_at, last_seen_at, stale_after,
        authority_tier, confidence, description, requirements_text)
     VALUES ($1,$2,'source-identity','Platform Engineer','https://jobs.example.invalid/pe',
             now(), now(), now() + interval '1 day', 2, 'medium', $3, $4)`,
    [id, uuidv7(), description, requirementsText],
  );
  return id;
}

async function markerOf(id: string) {
  const row = await db
    .selectFrom('job_postings')
    .select(['extracted_at', 'extracted_version'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row;
}

describe('the extraction pass converges', () => {
  it('does not re-select a posting that matched nothing', async () => {
    // The whole current corpus looks like this: prose that mentions no curated skill.
    const id = await givenPosting('We are looking for someone smart.', 'Qualifications:\n- Be smart');

    const first = await extractDuePostings(db, RUN_DEPS);
    expect(first.considered).toBe(1);
    expect(first.matchedNothing).toBe(1);
    expect(first.rowsWritten).toBe(0);

    // Zero skill rows, and yet the posting is finished.
    const stored = await db
      .selectFrom('job_posting_skills')
      .select('id')
      .where('job_posting_id', '=', id)
      .execute();
    expect(stored).toHaveLength(0);

    const second = await extractDuePostings(db, RUN_DEPS);
    expect(second.considered).toBe(0);
    expect(await postingsDueForExtraction(db, EXTRACTOR_VERSION, 10)).toHaveLength(0);
  });

  it('stamps the version it ran at, so a bump re-selects', async () => {
    const id = await givenPosting('We run Kubernetes.', null);

    await extractDuePostings(db, RUN_DEPS);
    expect(await markerOf(id)).toMatchObject({ extracted_version: EXTRACTOR_VERSION });

    // What a version bump looks like from the database's side.
    await pool.query(`UPDATE job_postings SET extracted_version = 'alias-scan@0.9.0' WHERE id = $1`, [id]);
    expect(await postingsDueForExtraction(db, EXTRACTOR_VERSION, 10)).toHaveLength(1);
  });

  it('selects a never-extracted posting, which a plain <> would not', async () => {
    // `null <> 'alias-scan@1.0.0'` is null, and a null predicate selects nothing. `IS DISTINCT FROM`
    // is the reason a first run finds anything at all.
    await givenPosting('We run Kubernetes.', null);
    expect(await postingsDueForExtraction(db, EXTRACTOR_VERSION, 10)).toHaveLength(1);
  });

  it('skips expired and soft-deleted postings', async () => {
    const expired = await givenPosting('We run Kubernetes.', null);
    const deleted = await givenPosting('We run Kubernetes.', null);
    await pool.query(
      `UPDATE job_postings SET expired_at = now(), expiry_reason = 'source-delisted' WHERE id = $1`,
      [expired],
    );
    await pool.query(`UPDATE job_postings SET deleted_at = now() WHERE id = $1`, [deleted]);

    expect((await extractDuePostings(db, RUN_DEPS)).considered).toBe(0);
  });

  it('reports an empty vocabulary rather than silently marking the corpus read', async () => {
    await pool.query('DELETE FROM skill_aliases');
    await givenPosting('We run Kubernetes.', null);

    const report = await extractDuePostings(db, RUN_DEPS);
    expect(report.aliasCount).toBe(0);
    expect(report.matchedNothing).toBe(1);
  });

  it('says when the batch cap hid remaining work', async () => {
    await givenPosting('We run Kubernetes.', null);
    await givenPosting('We run Kubernetes.', null);

    const report = await extractDuePostings(db, { ...RUN_DEPS, batchSize: 1 });
    expect(report.considered).toBe(1);
    expect(report.moreRemaining).toBe(true);
  });
});

describe('what ingest does to the marker', () => {
  const observation: SourceObservation = {
    sourceTier: 2,
    sourceUrl: 'https://api.lever.co/v0/postings/demo',
    retrievedAt: new Date('2026-08-23T09:00:00Z'),
    connectorVersion: '1.0.0',
    runId: uuidv7(),
  };
  const identity = { sourceId: 'lever', sourceScope: 'demo', externalId: 'p-1' };

  const fields = (description: string): PostingFields => ({
    title: 'Platform Engineer',
    url: 'https://jobs.example.invalid/pe',
    description,
    requirementsText: 'Qualifications:\n- Production Kubernetes',
  });

  async function ingestedAndExtracted(description: string): Promise<string> {
    const result = await upsertPostingFromSource(db, { identity, fields: fields(description), observation });
    await extractDuePostings(db, RUN_DEPS);
    return result.jobPostingId;
  }

  it('leaves the marker alone when a sighting rewrites the same prose', async () => {
    const id = await ingestedAndExtracted('We run Kubernetes.');
    const before = await markerOf(id);

    // The same board, read again, unchanged. `updated_at` moves; the marker must not.
    await upsertPostingFromSource(db, {
      identity,
      fields: fields('We run Kubernetes.'),
      observation: { ...observation, retrievedAt: new Date('2026-08-23T11:00:00Z') },
    });

    expect(await markerOf(id)).toEqual(before);
    expect(await postingsDueForExtraction(db, EXTRACTOR_VERSION, 10)).toHaveLength(0);
  });

  it('leaves the marker alone when a lower-tier write is refused', async () => {
    const id = await ingestedAndExtracted('We run Kubernetes.');
    const before = await markerOf(id);

    const result = await upsertPostingFromSource(db, {
      identity,
      // Tier 3 may not overwrite tier 2's words — and may not cost a re-extraction either.
      fields: fields('Something else entirely, with no Kubernetes in it.'),
      observation: { ...observation, sourceTier: 3, retrievedAt: new Date('2026-08-23T12:00:00Z') },
    });

    expect(result.action).toBe('refused-lower-tier');
    expect(await markerOf(id)).toEqual(before);
  });

  it('clears the marker when the prose actually changes', async () => {
    const id = await ingestedAndExtracted('We run Kubernetes.');
    expect((await markerOf(id)).extracted_version).toBe(EXTRACTOR_VERSION);

    await upsertPostingFromSource(db, {
      identity,
      fields: fields('We have moved off Kubernetes entirely.'),
      observation: { ...observation, retrievedAt: new Date('2026-08-23T13:00:00Z') },
    });

    expect(await markerOf(id)).toEqual({ extracted_at: null, extracted_version: null });
    expect(await postingsDueForExtraction(db, EXTRACTOR_VERSION, 10)).toHaveLength(1);
  });
});

describe('the schema, not the code, refuses a half-set marker', () => {
  it('rejects a version with no timestamp', async () => {
    const id = await givenPosting('We run Kubernetes.', null);
    await expect(
      pool.query(`UPDATE job_postings SET extracted_version = 'alias-scan@1.0.0' WHERE id = $1`, [id]),
    ).rejects.toThrow(/ck_job_postings__extraction_marker_paired/);
  });

  it('rejects a timestamp with no version', async () => {
    const id = await givenPosting('We run Kubernetes.', null);
    await expect(
      pool.query(`UPDATE job_postings SET extracted_at = now() WHERE id = $1`, [id]),
    ).rejects.toThrow(/ck_job_postings__extraction_marker_paired/);
  });
});
