/**
 * `syncConnectorSources` against a real database (ADR-0041).
 *
 * **What this exists to catch.** Before ADR-0041 nothing in production wrote `connector_sources`,
 * and the payload every caller assembled by hand could not reach `regions` at all — the column
 * existed from the first migration and `ConnectorRegistration` omitted it, so it could only ever
 * hold its `'{}'` default while `meta.regions` said otherwise. A unit test cannot see that: the
 * projection looks complete in TypeScript and the gap is between the projection and the row.
 *
 * So this compares the **stored row** against the connector's own `meta`, column by column, for
 * every registered source.
 */

import { toRegistration } from '@zentavio/connectors-core';
import { createRegistry, type ConnectorDeps } from '@zentavio/connectors-core/registry';
import { registerConnectorSource, type Database } from '@zentavio/db';
import { syncConnectorSources } from '@zentavio/ingestion';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;

/**
 * Composed with no dependencies, exactly as `connector-registration.test.ts` does.
 *
 * A connector's constructor may only store what it is given. One that fetched, read configuration
 * or validated its dependencies would fail here — loudly, and correctly, because a connector doing
 * work at construction time is the defect.
 */
const registry = createRegistry({} as unknown as ConnectorDeps);

function storedRow(id: string) {
  return db.selectFrom('connector_sources').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

/**
 * `refresh_window` read back as text.
 *
 * The column is a PostgreSQL `interval`, and `pg` parses it into a `PostgresInterval` object — so a
 * row written from `'365 days'` reads back as `{ days: 365 }`, never as the string. `schema.ts`
 * types the column `string`, which is what a *write* accepts and not what a read returns. Casting
 * in SQL compares what was stored rather than what the driver chose to hand back.
 */
async function storedRefreshWindow(id: string): Promise<string> {
  const result = await pool.query<{ text: string }>(
    'SELECT refresh_window::text AS text FROM connector_sources WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no connector_sources row for ${id}`);
  return row.text;
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM connector_sources');
});

describe('syncConnectorSources', () => {
  it('writes one row for every connector in the registry', async () => {
    const report = await syncConnectorSources(db, registry);

    expect([...report.registered].sort()).toEqual([...registry.ids()].sort());

    const rows = await db.selectFrom('connector_sources').select('id').execute();
    expect(rows.map((row) => row.id).sort()).toEqual([...registry.ids()].sort());
  });

  it('stores what each connector declares, including the regions nothing could reach before', async () => {
    await syncConnectorSources(db, registry);

    for (const connector of registry.all()) {
      const declared = toRegistration(connector.meta);
      const row = await storedRow(declared.id);

      expect(row.kind, declared.id).toBe(declared.kind);
      expect(row.display_name, declared.id).toBe(declared.displayName);
      expect(row.connector_version, declared.id).toBe(declared.connectorVersion);
      expect(row.source_tier, declared.id).toBe(declared.sourceTier);
      expect(row.terms_url, declared.id).toBe(declared.termsUrl);
      expect(row.legal_basis, declared.id).toBe(declared.legalBasis);
      expect(await storedRefreshWindow(declared.id), declared.id).toBe(declared.refreshWindow);
      expect(row.schedule, declared.id).toBe(declared.schedule);
      // The motivating defect: `[...]` rather than `'{}'`, and the connector's own list.
      expect(row.regions, declared.id).toEqual([...declared.regions]);
      expect(row.rate_limit, declared.id).toEqual(declared.rateLimit);
    }
  });

  it('stores the rate limit the connector actually enforces, minimum interval included', async () => {
    // The defect ADR-0041 recorded as evidence: the hand-assembled payload stored
    // `{requests: 60, windowMs: 60_000}` for Lever while the connector declared
    // `minIntervalMs: 1000`, so the persisted limit disagreed with the limiter that ran.
    await syncConnectorSources(db, registry);

    const lever = registry.get('lever');
    const row = await storedRow('lever');
    expect(row.rate_limit).toEqual(lever.meta.rateLimit);
    expect((row.rate_limit as { minIntervalMs?: number }).minIntervalMs).toBe(1000);
  });

  it('is idempotent — a second sync refreshes rather than duplicates', async () => {
    await syncConnectorSources(db, registry);
    await syncConnectorSources(db, registry);

    const rows = await db.selectFrom('connector_sources').select('id').execute();
    expect(rows).toHaveLength(registry.ids().length);
  });

  it('describes the connector without resetting what running it produced', async () => {
    await syncConnectorSources(db, registry);

    // Everything a run writes: a reliability the source earned, a breaker that opened for a reason,
    // the failure counters and a resumable cursor. Written in SQL rather than through Kysely
    // because these are exactly the columns the repository refuses to expose for writing.
    await pool.query(
      `UPDATE connector_sources
          SET reliability = 0.7300,
              breaker_state = 'open',
              breaker_opened_at = '2026-08-24T10:00:00Z',
              consecutive_failures = 4,
              last_failure_kind = 'rate-limited',
              cursor = '{"page": 3}'::jsonb
        WHERE id = 'lever'`,
    );

    await syncConnectorSources(db, registry);

    const row = await storedRow('lever');
    expect(Number(row.reliability)).toBe(0.73);
    expect(row.breaker_state).toBe('open');
    expect(row.consecutive_failures).toBe(4);
    expect(row.last_failure_kind).toBe('rate-limited');
    expect(row.cursor).toEqual({ page: 3 });
  });

  it('never deletes a source the registry no longer holds', async () => {
    // `source_id` is a foreign key and the rows citing it are evidence of what wrote them. Retiring
    // a source is an operational act against `is_enabled`, not a side effect of deleting its folder.
    await registerConnectorSource(db, {
      id: 'retired-board',
      kind: 'job-board',
      displayName: 'A source that used to exist',
      connectorVersion: '1.0.0',
      sourceTier: 2,
      termsUrl: 'https://example.invalid/terms',
      legalBasis: 'Registered by an earlier version of this repository and kept as evidence.',
      rateLimit: { requests: 1, windowMs: 1000 },
      refreshWindow: '1 day',
      schedule: '0 0 * * *',
      regions: [],
    }).execute();

    await syncConnectorSources(db, registry);

    const survivor = await storedRow('retired-board');
    expect(survivor.id).toBe('retired-board');
    expect(survivor.is_enabled).toBe(true);
  });
});
