/**
 * The scheduled entry point, against a real database.
 *
 * **`connector_sources` has carried `last_success_at`, `last_failure_at` and `consecutive_failures`
 * since it was created and nothing has ever written them.** This is what writes them, and what a
 * scheduler reads to decide whether a source is due. The cases worth asserting are the ones where a
 * wrong answer is invisible: a source that is not due must not be run, and a failed run must not be
 * recorded as a success just because the process did not crash.
 */

import { ConnectorRegistry } from '@zentavio/connectors-core';
import { LeverConnector, REGISTRATION, type BoardRaw } from '@zentavio/connector-lever';
import { livePostings, registerConnectorSource } from '@zentavio/db';
import type { Database } from '@zentavio/db';
import { runDueJobBoards } from '@zentavio/ingestion';
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

function deps(now = new Date('2026-08-23T06:00:00Z')) {
  return { db, newId: uuidv7, now: () => now };
}

function registryWith(board: BoardRaw | null = FIXTURE) {
  return new ConnectorRegistry().register(
    new LeverConnector({ fetchBoard: async () => board, configuredBoards: [BOARD] }),
  );
}

function throwingRegistry() {
  return new ConnectorRegistry().register(
    new LeverConnector({
      fetchBoard: async () => {
        throw new Error('ECONNRESET');
      },
      configuredBoards: [BOARD],
    }),
  );
}

async function register() {
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
}

function runState() {
  return db
    .selectFrom('connector_sources')
    .select(['last_success_at', 'last_failure_at', 'last_failure_kind', 'consecutive_failures'])
    .where('id', '=', 'lever')
    .executeTakeFirstOrThrow();
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
  await register();
});

describe('what is due', () => {
  it('runs a source that has never succeeded', async () => {
    // Otherwise a first run waits on a window measured from a success that never happened.
    const report = await runDueJobBoards(db, registryWith(), deps());

    expect(report.due).toEqual(['lever']);
    expect(report.run?.scopes).toHaveLength(1);
    expect(await livePostings(db).execute()).toHaveLength(3);
  });

  it('records the success, which nothing has ever written before', async () => {
    await runDueJobBoards(db, registryWith(), deps());

    const state = await runState();
    expect(state.last_success_at).not.toBeNull();
    expect(state.consecutive_failures).toBe(0);
  });

  it('does not run again inside the refresh window', async () => {
    // Lever's window is one day. Running twice inside it learns nothing and costs the source two
    // requests.
    await runDueJobBoards(db, registryWith(), deps());

    const soon = await runDueJobBoards(db, registryWith(), deps(new Date('2026-08-23T07:00:00Z')));

    expect(soon.due).toEqual([]);
    expect(soon.skipped).toEqual(['lever']);
    // Null rather than an empty report, so "did not run" is not read as "ran and found nothing".
    expect(soon.run).toBeNull();
  });

  it('runs again once the window has elapsed', async () => {
    await runDueJobBoards(db, registryWith(), deps());

    const later = await runDueJobBoards(db, registryWith(), deps(new Date('2026-08-24T07:00:00Z')));

    expect(later.due).toEqual(['lever']);
    expect(later.run?.scopes[0]).toMatchObject({ updated: 3 });
  });
});

describe('when a run fails', () => {
  it('records the failure and its reason rather than a success', async () => {
    const report = await runDueJobBoards(db, throwingRegistry(), deps());

    expect(report.run?.unreadable).toEqual([{ sourceId: 'lever', reason: 'ECONNRESET' }]);

    const state = await runState();
    expect(state.last_success_at).toBeNull();
    expect(state.last_failure_kind).toBe('ECONNRESET');
    expect(state.consecutive_failures).toBe(1);
  });

  it('counts consecutive failures, and forgets them after a success', async () => {
    await runDueJobBoards(db, throwingRegistry(), deps());
    await runDueJobBoards(db, throwingRegistry(), deps(new Date('2026-08-23T08:00:00Z')));

    expect((await runState()).consecutive_failures).toBe(2);

    await runDueJobBoards(db, registryWith(), deps(new Date('2026-08-23T09:00:00Z')));

    expect((await runState()).consecutive_failures).toBe(0);
  });

  it('stays due while it keeps failing', async () => {
    // A source that never succeeds never sets `last_success_at`, so the window never starts and the
    // next run tries again rather than waiting a day on a failure.
    await runDueJobBoards(db, throwingRegistry(), deps());

    const next = await runDueJobBoards(db, throwingRegistry(), deps(new Date('2026-08-23T06:05:00Z')));
    expect(next.due).toEqual(['lever']);
  });
});

describe('what it will not touch', () => {
  it('skips a source whose breaker is open', async () => {
    // Excluded rather than attempted and refused, so a report distinguishes "we did not try" from
    // "we tried and it failed again".
    await pool.query("UPDATE connector_sources SET breaker_state = 'open', breaker_opened_at = now() WHERE id = 'lever'");

    const report = await runDueJobBoards(db, registryWith(), deps());

    expect(report.due).toEqual([]);
    expect(await livePostings(db).execute()).toHaveLength(0);
  });

  it('skips a disabled source', async () => {
    await pool.query("UPDATE connector_sources SET is_enabled = false WHERE id = 'lever'");

    expect((await runDueJobBoards(db, registryWith(), deps())).due).toEqual([]);
  });

  it('records nothing for a due source that produced neither scopes nor errors', async () => {
    // No boards configured: nothing was attempted, so there is no success to claim and no failure to
    // punish.
    const empty = new ConnectorRegistry().register(
      new LeverConnector({ fetchBoard: async () => FIXTURE, configuredBoards: [] }),
    );

    await runDueJobBoards(db, empty, deps());

    const state = await runState();
    expect(state.last_success_at).toBeNull();
    expect(state.consecutive_failures).toBe(0);
  });
});
