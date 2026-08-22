/**
 * Applying a posting plan.
 *
 * The executor **decides nothing**. Whether a posting is stored, and whether this run may expire
 * anything, was settled by `planPostingIngest` — which is pure and tested without a database. This
 * module writes what the plan says and reports what it wrote.
 *
 * **One transaction per scope.** A half-applied board is the bad outcome available here: postings
 * written, sweep not run, or worse, a sweep run against a partially written set that then expires the
 * postings the failed half would have refreshed. Wrapping the two together means a run either
 * updates a board and sweeps it, or does neither.
 */

import { expireMissing, upsertPostingFromSource, type SourceObservation } from '@zentavio/db';
import type { Database } from '@zentavio/db';
import type { Kysely } from 'kysely';

import type { PostingPlan } from './posting-ingest.ts';

export interface PostingExecutionReport {
  readonly sourceId: string;
  readonly sourceScope: string;
  readonly inserted: number;
  readonly updated: number;
  /** Written by a source whose tier is worse than the one that wrote the fields; the sighting counts, the words do not. */
  readonly refusedLowerTier: number;
  readonly rejected: number;
  /** Postings whose recomputed key would have collided with another live row, left unmerged. */
  readonly collisionsRefused: number;
  readonly expired: readonly string[];
  /** Why no sweep ran, when none did. `null` when one did. */
  readonly sweepRefusedBecause: string | null;
}

/**
 * Write the plan.
 *
 * The expiry sweep runs **after** the writes and inside the same transaction, so a posting that this
 * run refreshed can never be counted as missing by this run's own sweep.
 */
export async function executePostingPlan(
  db: Kysely<Database>,
  plan: PostingPlan,
  observation: SourceObservation,
): Promise<PostingExecutionReport> {
  return db.transaction().execute(async (trx) => {
    let inserted = 0;
    let updated = 0;
    let refusedLowerTier = 0;
    let rejected = 0;
    let collisionsRefused = 0;

    for (const decision of plan.decisions) {
      if (decision.action === 'reject' || decision.fields === undefined) {
        rejected += 1;
        continue;
      }

      const result = await upsertPostingFromSource(trx, {
        identity: decision.identity,
        fields: decision.fields,
        observation,
      });

      if (result.action === 'inserted') inserted += 1;
      if (result.action === 'updated') updated += 1;
      if (result.action === 'refused-lower-tier') refusedLowerTier += 1;
      if (result.collisionRefused) collisionsRefused += 1;
    }

    if (!plan.expiry.licensed) {
      return {
        sourceId: plan.sourceId,
        sourceScope: plan.sourceScope,
        inserted,
        updated,
        refusedLowerTier,
        rejected,
        collisionsRefused,
        expired: [],
        // Never null when no sweep ran: a run that declines to expire must say why, or a silent
        // decline is indistinguishable from a sweep that found nothing missing.
        sweepRefusedBecause: plan.expiry.refusedBecause ?? 'unstated',
      };
    }

    const sweep = await expireMissing(trx, {
      identity: { sourceId: plan.sourceId, sourceScope: plan.sourceScope },
      seenExternalIds: plan.seenExternalIds,
      listingIsExhaustive: true,
    });

    return {
      sourceId: plan.sourceId,
      sourceScope: plan.sourceScope,
      inserted,
      updated,
      refusedLowerTier,
      rejected,
      collisionsRefused,
      expired: sweep.expired,
      sweepRefusedBecause: null,
    };
  });
}
