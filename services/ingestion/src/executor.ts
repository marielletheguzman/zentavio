/**
 * Applying an ingest plan.
 *
 * The executor **decides nothing**. Every business rule — what supersedes what, what is already
 * stored, what the connector rejected — was settled by `planIngest`, which is pure and tested
 * without a database. This module opens a transaction and does what the plan says.
 *
 * That split is the point. A rule that lives in the executor is a rule that can only be tested
 * against PostgreSQL, and a rule that can only be tested against PostgreSQL is one nobody exercises
 * at every edge.
 *
 * **One transaction for the whole plan.** A partially applied plan is the worst outcome available:
 * a threshold superseded with its replacement missing leaves the pathway with no current rule, and
 * an eligibility verdict computed in that window is wrong in a way that looks like an answer.
 */

import { insertRequirement, supersedeRequirement } from '@zentavio/db';
import type { Database } from '@zentavio/db';
import type { Kysely } from 'kysely';

import type { IngestDecision, IngestPlan } from './requirement-ingest.ts';

export interface ExecutionReport {
  readonly sourceId: string;
  readonly inserted: number;
  readonly superseded: number;
  readonly unchanged: number;
  readonly rejected: number;
  /** Requirement ids the connector rejected, so a run reports what it refused rather than only what it wrote. */
  readonly rejectedIds: readonly string[];
}

/**
 * A decision that writes. Narrowing here rather than at each call site keeps the exhaustiveness
 * check below honest — a new action added to `IngestAction` fails to compile until it is handled.
 */
function isWrite(decision: IngestDecision): boolean {
  return decision.action === 'insert' || decision.action === 'supersede';
}

/**
 * Apply a plan.
 *
 * `dryRun` executes nothing and returns the same report, so an operator can see what a run would do
 * against the real database — including whether a supersession is about to fire — without doing it.
 */
export async function executePlan(
  db: Kysely<Database>,
  plan: IngestPlan,
  options: { readonly dryRun?: boolean } = {},
): Promise<ExecutionReport> {
  const report = {
    sourceId: plan.sourceId,
    inserted: plan.decisions.filter((d) => d.action === 'insert').length,
    superseded: plan.decisions.filter((d) => d.action === 'supersede').length,
    unchanged: plan.decisions.filter((d) => d.action === 'unchanged').length,
    rejected: plan.decisions.filter((d) => d.action === 'reject').length,
    rejectedIds: plan.decisions.filter((d) => d.action === 'reject').map((d) => d.requirementId),
  };

  if (options.dryRun === true || !plan.decisions.some(isWrite)) return report;

  await db.transaction().execute(async (trx) => {
    for (const decision of plan.decisions) {
      if (decision.row === undefined) continue;

      if (decision.action === 'insert') {
        await insertRequirement(trx, decision.row).execute();
        continue;
      }

      if (decision.action === 'supersede') {
        if (decision.supersedes === undefined) {
          // Unreachable via `planIngest`, which always pairs the two. Thrown rather than skipped
          // because silently inserting without closing the predecessor leaves two live rows, which
          // `uq_req__current` would reject anyway — but with a constraint name instead of a cause.
          throw new Error(
            `supersede decision for ${decision.requirementId} carries no row to close; the plan is malformed`,
          );
        }

        // Order matters: close first. Inserting first would leave both rows live for the duration
        // of the statement and trip `uq_req__current` inside the transaction.
        const { close, insert } = supersedeRequirement(trx, decision.supersedes, decision.row);
        await close.execute();
        await insert.execute();
      }
    }
  });

  return report;
}
