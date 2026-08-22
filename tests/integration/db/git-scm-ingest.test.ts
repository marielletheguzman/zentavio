/**
 * The Git documentation catalogue, end to end, against a real database.
 *
 * **This is what made `learning_resources` non-empty.** The table was real and had no rows, so a
 * completion had nothing to be recorded against and the half of M6 that says "completing a course
 * does not move readiness" could be asserted and never demonstrated.
 *
 * The property worth asserting hardest is still the negative one: ingesting a catalogue writes rows
 * about *resources* and touches nothing about any person.
 */

import { GitScmConnector, KNOWN_PAGES, REGISTRATION, type DocPageRaw } from '@zentavio/connector-git-scm';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  registerConnectorSource,
  resourcesForSkill,
  upsertLearningResource,
  usableResources,
} from '../../../packages/db/src/repositories/learning.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../fixtures/connectors/git-scm/git-stash.json', import.meta.url)),
    'utf8',
  ),
) as DocPageRaw;

let pool: Pool;
let db: Kysely<Database>;
let skillId: string;

function connector() {
  return new GitScmConnector({ fetchPage: async () => FIXTURE });
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM learning_completions');
  await pool.query('DELETE FROM learning_resource_skills');
  await pool.query('DELETE FROM learning_resources');
  await pool.query('DELETE FROM connector_sources');
  await pool.query('DELETE FROM profile_skills');
  await pool.query('DELETE FROM skills');

  skillId = uuidv7();
  await pool.query(
    `INSERT INTO skills (id, slug, name, kind, source_tier, basis)
     VALUES ($1,'git','Git','technology',3,'curated')`,
    [skillId],
  );
});

/** Register the source, then store the catalogue row the connector produced. */
async function ingest() {
  await registerConnectorSource(db, {
    id: REGISTRATION.id,
    kind: REGISTRATION.kind,
    displayName: REGISTRATION.displayName,
    connectorVersion: '1.0.0',
    sourceTier: REGISTRATION.sourceTier,
    termsUrl: REGISTRATION.termsUrl,
    legalBasis: REGISTRATION.legalBasis,
    rateLimit: { requests: 20, windowMs: 60_000 },
    refreshWindow: REGISTRATION.refreshWindow,
    schedule: REGISTRATION.schedule,
  }).execute();

  const rows = connector().normalize(FIXTURE);
  for (const row of rows) {
    await upsertLearningResource(db, {
      provider: row.provider,
      externalId: row.externalId,
      title: row.title,
      url: row.url,
      format: row.format,
      language: row.language,
      costBand: row.costBand,
      sourceId: row.sourceId,
      sourceTier: row.sourceTier,
      sourceUrl: row.sourceUrl,
      retrievedAt: row.retrievedAt,
      skillId,
      coverage: row.coverage,
      newId: uuidv7,
    });
  }

  return rows;
}

describe('registering the source', () => {
  it('records why we are permitted to read it', async () => {
    // A source with no stated legal basis is one nobody checked. The column is NOT NULL for that
    // reason, and this is the row that has to fill it.
    await ingest();

    const { rows } = await pool.query<{ legal_basis: string; source_tier: number; kind: string }>(
      'SELECT legal_basis, source_tier, kind FROM connector_sources WHERE id = $1',
      [REGISTRATION.id],
    );
    expect(rows[0]?.kind).toBe('learning');
    expect(rows[0]?.source_tier).toBe(1);
    expect(rows[0]?.legal_basis).toContain('robots.txt');
  });

  it('does not reset observed state when the connector is re-registered', async () => {
    // Reliability and the breaker are what running it produced. A description should not restore a
    // score the source lost, or close a breaker that opened for a reason.
    await ingest();
    await pool.query(
      `UPDATE connector_sources SET reliability = 0.200, breaker_state = 'open', breaker_opened_at = now(),
              consecutive_failures = 4 WHERE id = $1`,
      [REGISTRATION.id],
    );

    await ingest();

    const { rows } = await pool.query<{ reliability: string; breaker_state: string; consecutive_failures: number }>(
      'SELECT reliability, breaker_state, consecutive_failures FROM connector_sources WHERE id = $1',
      [REGISTRATION.id],
    );
    expect(Number(rows[0]?.reliability)).toBe(0.2);
    expect(rows[0]?.breaker_state).toBe('open');
    expect(rows[0]?.consecutive_failures).toBe(4);
  });
});

describe('the stored catalogue', () => {
  it('stores the page as free documentation for the Git skill', async () => {
    await ingest();

    const rows = await resourcesForSkill(db, skillId).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'git-stash',
      url: 'https://git-scm.com/docs/git-stash',
      format: 'documentation',
      cost_band: 'free',
      coverage: 'primary',
      grants_evidence: false,
    });
  });

  it('refreshes rather than duplicating when the connector runs again', async () => {
    await ingest();
    await ingest();

    const rows = await usableResources(db).execute();
    expect(rows).toHaveLength(1);
  });

  it('refuses a resource whose source was never registered', async () => {
    // `fk_lr__sources`: a catalogue row that cannot name the connector it came from has no
    // provenance, and provenance is the entire reason this table has a source at all.
    await expect(
      pool.query(
        `INSERT INTO learning_resources
           (id, provider, external_id, title, url, format, language, cost_band,
            source_id, source_tier, source_url, retrieved_at, last_verified_at)
         VALUES ($1,'git-scm.com','git-log','git-log','https://git-scm.com/docs/git-log',
                 'documentation','en','free','never-registered',1,'https://git-scm.com/docs/git-log',now(),now())`,
        [uuidv7()],
      ),
    ).rejects.toThrow(/fk_lr__sources/);
  });

  it('writes nothing about any person', async () => {
    // A catalogue is about resources. The moment ingesting one touched a profile it would be
    // promotion by another name.
    await ingest();

    const { rows: skills } = await pool.query('SELECT id FROM profile_skills');
    const { rows: completions } = await pool.query('SELECT id FROM learning_completions');
    expect(skills).toEqual([]);
    expect(completions).toEqual([]);
  });
});

describe('what the catalogue covers', () => {
  it('offers the pages the assessment cites, and no others', () => {
    // An assessment citing one page and a catalogue offering a different one would be two opinions
    // about where to learn something.
    expect([...KNOWN_PAGES].sort()).toEqual([
      'git-checkout',
      'git-cherry-pick',
      'git-commit',
      'git-fetch',
      'git-merge',
      'git-rebase',
      'git-reset',
      'git-revert',
      'git-stash',
      'gitignore',
    ]);
  });
});
