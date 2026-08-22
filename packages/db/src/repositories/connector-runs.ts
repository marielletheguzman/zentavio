/**
 * What running a connector did, and which connectors are due to run.
 *
 * `connector_sources` has carried `last_success_at`, `last_failure_at`, `consecutive_failures` and
 * `schedule` since it was created, and **nothing has ever written them**. Registration describes a
 * connector; this module records what happened when one ran, which is the other half and the half a
 * scheduler reads.
 *
 * ## Observed, never declared
 *
 * `reliability` is not touched here. It is derived from validation pass rate and outcome feedback
 * over time (`docs/architecture/connectors.md`), and a run recording its own reliability would be a
 * source grading itself. What this writes is what happened: it succeeded, or it failed and here is
 * the kind.
 */

import { sql, type Kysely } from 'kysely';

import type { Database } from '../schema.ts';

/** A source that is due, with what a runner needs to decide how to treat it. */
export interface DueSource {
  readonly id: string;
  readonly kind: string;
  readonly sourceTier: number;
  readonly lastSuccessAt: Date | null;
  readonly consecutiveFailures: number;
}

/**
 * Sources of one kind that are due to run.
 *
 * **Due means the refresh window has elapsed**, not that a cron expression matched: the window is
 * what the source's own freshness claim is expressed in, and a run that happens twice inside it
 * learns nothing new while costing the source two requests.
 *
 * A source that has never succeeded is due immediately — otherwise a first run would depend on a
 * window measured from a success that never happened.
 *
 * **An open breaker is not due.** It is excluded here rather than attempted and refused, so a run
 * report distinguishes "we did not try" from "we tried and it failed again".
 */
export async function dueSources(
  db: Kysely<Database>,
  kind: string,
  now: Date,
): Promise<readonly DueSource[]> {
  const rows = await db
    .selectFrom('connector_sources')
    .select(['id', 'kind', 'source_tier', 'last_success_at', 'consecutive_failures'])
    .where('kind', '=', kind as never)
    .where('is_enabled', '=', true)
    .where('deleted_at', 'is', null)
    .where('breaker_state', '<>', 'open')
    // One fragment rather than a builder `or`: the window arithmetic is `interval` addition, which
    // has no expression-builder form, and splitting it would mean reading `refresh_window` into JS
    // and doing date maths against a value the database already knows how to add.
    .where(sql<boolean>`last_success_at IS NULL OR last_success_at + refresh_window <= ${now}::timestamptz`)
    .orderBy('id')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    sourceTier: row.source_tier,
    lastSuccessAt: row.last_success_at === null ? null : new Date(row.last_success_at),
    consecutiveFailures: row.consecutive_failures,
  }));
}

/**
 * Record that a run succeeded.
 *
 * Clears the failure counter, because consecutive means consecutive. It does not close a breaker:
 * whether a source is healthy again is `healthCheck`'s answer, and a successful read of one board
 * is not a statement about the source as a whole.
 */
export function recordRunSuccess(db: Kysely<Database>, sourceId: string, at: Date) {
  return db
    .updateTable('connector_sources')
    .set({ last_success_at: at, consecutive_failures: 0, updated_at: sql`now()` })
    .where('id', '=', sourceId)
    .execute();
}

/**
 * Record that a run failed, and why.
 *
 * The counter increments rather than being set, so a caller cannot accidentally report a first
 * failure as a fifth. Whether that count opens a breaker is the breaker's decision, not this one's.
 */
export function recordRunFailure(db: Kysely<Database>, sourceId: string, at: Date, kind: string) {
  return db
    .updateTable('connector_sources')
    .set({
      last_failure_at: at,
      last_failure_kind: kind,
      consecutive_failures: sql<number>`consecutive_failures + 1`,
      updated_at: sql`now()`,
    })
    .where('id', '=', sourceId)
    .execute();
}
