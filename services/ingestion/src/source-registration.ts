/**
 * Register every connector in the registry as a `connector_sources` row (ADR-0041).
 *
 * **The gap this closes.** Before this pass nothing in production wrote that table.
 * `registerConnectorSource` had five call sites and all five were integration tests; the dev
 * database held `lever` and `git-scm` because a session inserted them by hand. A source absent from
 * the table is not a soft failure — `staleAfter` resolves `refresh_window` through a subquery, so a
 * missing row returns null and every posting insert fails on `stale_after NOT NULL`, naming the
 * column and neither the source nor the cause.
 *
 * **No source is named here.** The pass iterates the registry and projects each connector's `meta`,
 * which is why ADR-0041 put the declared fields on the contract: a pass that reached for a
 * per-connector constant would have to import connector packages by name, and `eslint.config.mjs`
 * fails that outside `default-registry.ts` (ADR-0002, ADR-0005).
 *
 * **Nothing calls this.** Like `runDueJobBoards`, `extractDuePostings` and `scorePostingForUser`, it
 * is a function with no caller: what triggers it is a deployment decision and nothing is deployed.
 */

import { toRegistration, type ConnectorRegistry } from '@zentavio/connectors-core';
import { registerConnectorSource, type Database } from '@zentavio/db';
import type { Kysely } from 'kysely';

export interface SourceRegistrationReport {
  /** Every source id written, in registry order. */
  readonly registered: readonly string[];
}

/**
 * Write or refresh one row per registered connector.
 *
 * **Idempotent, and describing rather than resetting.** `registerConnectorSource` upserts on `id`
 * and touches only declared columns; `reliability`, `breaker_state`, `breaker_opened_at`, the
 * failure counters and the cursor are what running the connector produced, and re-registering must
 * not restore a reliability score the source lost or close a breaker that opened for a reason.
 *
 * **It never deletes and never disables.** A connector removed from the registry keeps its row,
 * because `source_id` is a foreign key and the rows citing it are evidence of what wrote them.
 * Disabling a source is an operational act against `is_enabled`, not a side effect of a code change.
 */
export async function syncConnectorSources(
  db: Kysely<Database>,
  registry: ConnectorRegistry,
): Promise<SourceRegistrationReport> {
  const registered: string[] = [];

  for (const connector of registry.all()) {
    await registerConnectorSource(db, toRegistration(connector.meta)).execute();
    registered.push(connector.meta.id);
  }

  return { registered };
}
