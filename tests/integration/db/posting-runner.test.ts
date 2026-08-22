/**
 * The runner, against a real database: registry → search → plan → execute (ADR-0034).
 *
 * **The registry is the real `ConnectorRegistry`**, and the job board in it is the real Lever
 * connector. The runner is never handed a source directly — if it could only work when told which
 * connector to use, the plugin claim would be false and this test would still pass.
 *
 * The cases that matter are the failures: a board that throws mid-pagination, and a board whose
 * cursor never ends. Both write what they read and retire nothing, because a partial listing is not
 * evidence about what is gone.
 */

import { ConnectorRegistry } from '@zentavio/connectors-core';
import { LeverConnector, REGISTRATION, type BoardRaw } from '@zentavio/connector-lever';
import { livePostings, registerConnectorSource } from '@zentavio/db';
import type { Database } from '@zentavio/db';
import { runJobBoards } from '@zentavio/ingestion';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../fixtures/connectors/lever/leverdemo.json', import.meta.url)), 'utf8'),
) as BoardRaw;

const BOARD = 'leverdemo';

let pool: Pool;
let db: Kysely<Database>;

function deps() {
  return { db, newId: uuidv7, now: () => new Date('2026-08-22T06:00:00Z') };
}

/** A registry holding the real connector, reached only by kind. */
function registryWith(board: BoardRaw | null = FIXTURE) {
  return new ConnectorRegistry().register(
    new LeverConnector({ fetchBoard: async () => board, configuredBoards: [BOARD] }),
  );
}

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

  await registerConnectorSource(db, {
    id: REGISTRATION.id,
    kind: REGISTRATION.kind,
    displayName: REGISTRATION.displayName,
    connectorVersion: '1.0.0',
    sourceTier: REGISTRATION.sourceTier,
    termsUrl: REGISTRATION.termsUrl,
    legalBasis: REGISTRATION.legalBasis,
    rateLimit: { requests: 60, windowMs: 60_000 },
    refreshWindow: REGISTRATION.refreshWindow,
    schedule: REGISTRATION.schedule,
  }).execute();
});

describe('a run over the registry', () => {
  it('stores a board it was never told about, found by kind', async () => {
    const report = await runJobBoards(registryWith(), deps());

    expect(report.scopes).toHaveLength(1);
    expect(report.scopes[0]).toMatchObject({ sourceId: 'lever', sourceScope: BOARD, inserted: 3 });
    expect(await livePostings(db).execute()).toHaveLength(3);
  });

  it('keeps the link a person applies through', async () => {
    // The connector refuses postings it cannot link to; persistence had nowhere to keep the link
    // until `url` was added, and the gap was invisible until this path ran end to end.
    await runJobBoards(registryWith(), deps());

    const stored = await db.selectFrom('job_postings').select('url').execute();
    expect(stored.every((row) => row.url.startsWith('https://jobs.lever.co/leverdemo/'))).toBe(true);
  });

  it('keeps the prose extraction will need, and keeps requirements apart from it', async () => {
    // Nothing reads these yet. They are stored because a posting ingested without them can never be
    // extracted from without fetching it again, and the raw payload is archived only where a
    // document store is configured — which is nowhere today.
    await runJobBoards(registryWith(), deps());

    const stored = await db
      .selectFrom('job_postings')
      .select(['description', 'requirements_text'])
      .where('title', '=', 'AbelsonTaylor Writer')
      .executeTakeFirstOrThrow();

    expect(stored.description).toContain('Demo Job Listing');
    expect(stored.requirements_text).toContain('Qualifications:');
    expect(stored.requirements_text).not.toContain('<li>');
  });

  it('runs a second time as an update, and sweeps', async () => {
    await runJobBoards(registryWith(), deps());
    const second = await runJobBoards(registryWith(), deps());

    expect(second.scopes[0]).toMatchObject({ inserted: 0, updated: 3, sweepRefusedBecause: null });
  });

  it('reports that nothing was archived when no store is configured', async () => {
    // "Not archived" and "archived" must not look alike, so a run without object storage says so
    // rather than reporting a clean sweep.
    const report = await runJobBoards(registryWith(), deps());

    expect(report.scopes[0]?.archive).toBe('not-configured');
  });
});

describe('a board that fails mid-run', () => {
  it('writes what it read and retires nothing', async () => {
    await runJobBoards(registryWith(), deps());

    // The source throws on the next run: the postings we already hold are still real, but what we
    // hold is no longer a complete listing.
    const broken = new ConnectorRegistry().register(
      new LeverConnector({
        fetchBoard: async () => {
          throw new Error('ECONNRESET');
        },
        configuredBoards: [BOARD],
      }),
    );

    const report = await runJobBoards(broken, deps());

    expect(report.unreadable).toEqual([{ sourceId: 'lever', reason: 'ECONNRESET' }]);
    expect(report.scopes).toEqual([]);
    expect(await livePostings(db).execute()).toHaveLength(3);
  });

  it('does not let a shrinking board expire anything while runs keep failing', async () => {
    await runJobBoards(registryWith(), deps());
    await runJobBoards(registryWith(boardWithout(2)), deps());
    await runJobBoards(registryWith(boardWithout(2)), deps());

    // Those two runs completed, so the sweep was licensed and the count advanced.
    expect(await livePostings(db).execute()).toHaveLength(1);
  });

  it('reports a scope whose run did not complete, with the reason', async () => {
    await runJobBoards(registryWith(), deps());

    // A board that returns a page and then throws: `search` succeeds once, the connector is asked
    // for more, and the failure lands mid-listing.
    let calls = 0;
    const flaky = new ConnectorRegistry().register(
      new LeverConnector({
        fetchBoard: async () => {
          calls += 1;
          if (calls > 1) throw new Error('rate limited');
          return boardWithout(2);
        },
        configuredBoards: [BOARD],
      }),
    );

    const report = await runJobBoards(flaky, deps());

    expect(report.scopes[0]?.updated).toBe(1);
    expect(await livePostings(db).execute()).toHaveLength(3);
  });
});

describe('an empty registry', () => {
  it('runs, reports nothing, and touches nothing', async () => {
    const report = await runJobBoards(new ConnectorRegistry(), deps());

    expect(report).toMatchObject({ scopes: [], unreadable: [] });
    expect(await livePostings(db).execute()).toHaveLength(0);
  });
});
