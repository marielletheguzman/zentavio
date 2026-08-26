/**
 * A job board, ingested end to end: connector → plan → executor → database (ADR-0034).
 *
 * **The connector is the real one and nothing here names it twice.** The plan is built from
 * `connector.meta`, so what the test exercises is the path a registry-driven run takes, not a
 * hand-assembled imitation of it.
 *
 * The property asserted hardest is the negative one: **a run that did not finish writes postings and
 * expires nothing.** That is the case where trusting a connector's own `listing: 'exhaustive'` would
 * retire jobs somebody is tracking because our fetch broke.
 */

import { toRegistration } from '@zentavio/connectors-core';
import { LeverConnector, type BoardRaw } from '@zentavio/connector-lever';
import type { JobPosting } from '@zentavio/types';
import { registerConnectorSource, livePostings } from '@zentavio/db';
import type { Database } from '@zentavio/db';
import { executePostingPlan, planPostingIngest, type RunOutcome } from '@zentavio/ingestion';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

/** The connector's own declared metadata — the single source the registration row is projected from (ADR-0041). */
const CONNECTOR_META = new LeverConnector({ fetchBoard: async () => null, configuredBoards: [] }).meta;

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../fixtures/connectors/lever/leverdemo.json', import.meta.url)), 'utf8'),
) as BoardRaw;

const BOARD = 'leverdemo';

let pool: Pool;
let db: Kysely<Database>;

function connector(board: BoardRaw = FIXTURE) {
  return new LeverConnector({ fetchBoard: async () => board, configuredBoards: [BOARD] });
}

function observation() {
  return {
    sourceTier: CONNECTOR_META.sourceTier,
    sourceUrl: `https://api.lever.co/v0/postings/${BOARD}?mode=json`,
    retrievedAt: new Date('2026-08-22T00:00:00Z'),
    connectorVersion: '1.0.0',
    runId: uuidv7(),
  };
}

/** What the ingestion service does with a board: normalize, validate, plan, execute. */
async function ingest(board: BoardRaw = FIXTURE, run: RunOutcome = { completed: true }) {
  const source = connector(board);
  const rows = source.normalize(board);

  const plan = planPostingIngest({
    meta: source.meta,
    sourceScope: board.board,
    observation: observation(),
    postings: rows.map((row: JobPosting) => ({
      externalId: row.externalId,
      fields: {
        title: row.title,
        url: row.url,
        locationRaw: row.locationText,
        countryCode: row.countryCode,
        isRemote: row.isRemote,
        remoteScope: row.remoteScope,
        commitmentRaw: row.commitment,
        departmentRaw: row.department,
        teamRaw: row.team,
        salaryIsStated: row.salaryIsStated,
        postedAt: row.postedAt === null ? null : new Date(row.postedAt),
      },
    })),
    validation: source.validate(rows),
    run,
  });

  return executePostingPlan(db, plan, observation());
}

/** The same board with some postings removed, as a later run would see it. */
function boardWithout(count: number): BoardRaw {
  return { ...FIXTURE, postings: FIXTURE.postings.slice(0, FIXTURE.postings.length - count) };
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM job_posting_sources');
  await pool.query('DELETE FROM job_postings');
  await pool.query('DELETE FROM connector_sources');

  await registerConnectorSource(db, toRegistration(CONNECTOR_META)).execute();
});

describe('a board arriving for the first time', () => {
  it('stores every posting it listed', async () => {
    const report = await ingest();

    expect(report).toMatchObject({ sourceId: 'lever', sourceScope: BOARD, inserted: 3, updated: 0, rejected: 0 });
    expect(await livePostings(db).execute()).toHaveLength(3);
  });

  it('sweeps, because the board lists exhaustively and the run finished', async () => {
    const report = await ingest();

    expect(report.sweepRefusedBecause).toBeNull();
    expect(report.expired).toEqual([]);
  });
});

describe('the same board again', () => {
  it('updates rather than duplicating', async () => {
    await ingest();
    const report = await ingest();

    expect(report).toMatchObject({ inserted: 0, updated: 3 });
    expect(await livePostings(db).execute()).toHaveLength(3);
  });

  it('never counts a posting it just refreshed as missing', async () => {
    // The sweep runs after the writes and in the same transaction. Reversed, a run would expire the
    // postings it had come to refresh.
    await ingest();
    const report = await ingest();

    expect(report.expired).toEqual([]);
    expect(await livePostings(db).execute()).toHaveLength(3);
  });
});

describe('a posting that disappears from the board', () => {
  it('survives one absence and expires on the second', async () => {
    await ingest();

    const first = await ingest(boardWithout(1));
    expect(first.expired).toEqual([]);
    expect(await livePostings(db).execute()).toHaveLength(3);

    const second = await ingest(boardWithout(1));
    expect(second.expired).toHaveLength(1);
    expect(await livePostings(db).execute()).toHaveLength(2);
  });

  it('is retained, not deleted', async () => {
    await ingest();
    await ingest(boardWithout(1));
    await ingest(boardWithout(1));

    const all = await db.selectFrom('job_postings').select(['id', 'expiry_reason']).execute();
    expect(all).toHaveLength(3);
    expect(all.filter((row) => row.expiry_reason === 'source-delisted')).toHaveLength(1);
  });

  it('comes back without penalty if it reappears', async () => {
    await ingest();
    await ingest(boardWithout(1));
    await ingest();
    await ingest(boardWithout(1));

    // Two absences, but not consecutive: the reappearance reset the count.
    expect(await livePostings(db).execute()).toHaveLength(3);
  });
});

describe('a run that did not finish', () => {
  it('writes what it read and expires nothing', async () => {
    // The case the whole licence exists for: a short board looks exactly like a smaller board.
    await ingest();

    const short = await ingest(boardWithout(2), { completed: false, reason: 'fetch failed on page 2' });

    expect(short.updated).toBe(1);
    expect(short.expired).toEqual([]);
    expect(short.sweepRefusedBecause).toBe('run-did-not-complete');
    expect(await livePostings(db).execute()).toHaveLength(3);
  });

  it('does not let a short run count towards a later expiry', async () => {
    await ingest();
    await ingest(boardWithout(2), { completed: false });
    await ingest(boardWithout(2), { completed: false });

    // Two runs missed them, and neither was evidence.
    expect(await livePostings(db).execute()).toHaveLength(3);
    const counts = await db.selectFrom('job_posting_sources').select('missed_runs').execute();
    expect(counts.every((row) => row.missed_runs === 0)).toBe(true);
  });
});

describe('an empty board', () => {
  it('expires nothing, because empty and broken are indistinguishable from here', async () => {
    await ingest();

    const empty = await ingest({ ...FIXTURE, postings: [] });

    expect(empty.sweepRefusedBecause).toBe('nothing-was-listed');
    expect(await livePostings(db).execute()).toHaveLength(3);
  });
});

describe('what reaches the database', () => {
  it('stores tier-2 confidence and the board as a namespace', async () => {
    await ingest();

    const posting = await db
      .selectFrom('job_postings')
      .select(['confidence', 'authority_tier', 'dedup_basis', 'company_name_raw'])
      .executeTakeFirstOrThrow();
    const source = await db.selectFrom('job_posting_sources').select(['source_scope', 'source_id']).executeTakeFirstOrThrow();

    expect(posting).toMatchObject({ confidence: 'medium', authority_tier: 2, dedup_basis: 'source-identity' });
    expect(posting.company_name_raw).toBeNull();
    expect(source).toMatchObject({ source_id: 'lever', source_scope: BOARD });
  });

  it('records silence about remote work as silence', async () => {
    await ingest();

    const stated = await db.selectFrom('job_postings').select(['is_remote', 'remote_scope']).execute();
    expect(stated.every((row) => row.remote_scope === null)).toBe(true);
    expect(stated.every((row) => row.is_remote !== true)).toBe(true);
  });
});
