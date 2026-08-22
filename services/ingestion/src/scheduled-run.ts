/**
 * The scheduled entry point: which sources are due, run them, record what happened.
 *
 * **This is a function, not a daemon.** What triggers it — a cron container, a platform scheduler, a
 * developer typing a command — is a deployment decision, and nothing is deployed yet (ADR-0015,
 * ADR-0021). Making the trigger a caller's problem is what keeps this testable and what stops an
 * undeployable scheduler from being written to look finished.
 *
 * ## Why "due" is read from the database rather than a cron expression
 *
 * `connector_sources.refresh_window` is the source's own freshness claim, and it is already copied
 * onto every fact as `stale_after`. Running twice inside that window learns nothing and costs the
 * source two requests; a cron expression that disagrees with the window is a second source of truth
 * about the same thing. `schedule` remains as the *hint* to whoever configures the trigger.
 */

import { dueSources, recordRunFailure, recordRunSuccess } from '@zentavio/db';
import type { Database } from '@zentavio/db';
import type { ConnectorRegistry } from '@zentavio/connectors-core';
import type { Kysely } from 'kysely';

import { runJobBoards, type RunReport, type RunnerDeps } from './posting-runner.ts';

export interface ScheduledRunReport {
  readonly ranAt: Date;
  /** Sources that were due. Empty is a normal outcome, not a failure. */
  readonly due: readonly string[];
  /** Sources skipped because their refresh window had not elapsed, or their breaker was open. */
  readonly skipped: readonly string[];
  /** Null when nothing was due, so a caller can tell "did not run" from "ran and found nothing". */
  readonly run: RunReport | null;
}

/**
 * Run the job boards that are due.
 *
 * A source is marked successful when it produced at least one scope and reported nothing unreadable;
 * failed when it appears in `unreadable`. **A source that was due and produced neither is left
 * untouched** — no boards configured is not a success to record, and it is not a failure to punish
 * either, because nothing was attempted.
 */
export async function runDueJobBoards(
  db: Kysely<Database>,
  registry: ConnectorRegistry,
  deps: RunnerDeps,
): Promise<ScheduledRunReport> {
  const ranAt = deps.now();
  const registered = registry.byKind('job-board').map((connector) => connector.meta.id);
  const due = await dueSources(db, 'job-board', ranAt);
  const dueIds = new Set(due.map((source) => source.id));

  const skipped = registered.filter((id) => !dueIds.has(id));

  if (dueIds.size === 0) {
    return { ranAt, due: [], skipped, run: null };
  }

  const report = await runJobBoards(registry, deps);

  const failed = new Map(report.unreadable.map((entry) => [entry.sourceId, entry.reason]));
  const succeeded = new Set(report.scopes.map((scope) => scope.sourceId));

  for (const source of due) {
    if (failed.has(source.id)) {
      await recordRunFailure(db, source.id, deps.now(), failed.get(source.id) ?? 'unstated');
      continue;
    }
    if (succeeded.has(source.id)) {
      await recordRunSuccess(db, source.id, deps.now());
    }
  }

  return { ranAt, due: due.map((source) => source.id), skipped, run: report };
}
