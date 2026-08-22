/**
 * Turning a job board's output into decisions about postings (ADR-0034).
 *
 * **Pure.** Connector output in, a list of decisions out; nothing here has touched the database.
 * That is what makes the interesting behaviour — what gets stored, what gets rejected, and above all
 * *whether anything may be expired* — testable without PostgreSQL, and what lets a caller show an
 * operator what a run would do before it does it. Same split as `requirement-ingest.ts`.
 *
 * **No source is named here.** This module takes a connector's metadata and its output; adding a
 * second job board must not require editing this file (ADR-0002).
 *
 * ## The decision this module exists to hold
 *
 * Expiry is licensed by **two** facts, and neither is sufficient alone:
 *
 * - the source **can** list everything (`meta.listing === 'exhaustive'`), which is a property of the
 *   source and is declared once;
 * - this **run actually finished** — every page consumed, nothing thrown, nothing truncated — which
 *   is a property of the run and is reported per run.
 *
 * A board that declares itself exhaustive and then dies on its second page produces a short list
 * that looks exactly like a board with fewer jobs. Trusting the declaration there would retire
 * postings somebody is tracking because our fetch broke, which
 * `docs/architecture/data-flow.md` names as the failure that must never happen.
 */

import { isIngestible, type ConnectorMeta, type ValidationIssue } from '@zentavio/connectors-core';
import type { PostingFields, SourceIdentity, SourceObservation } from '@zentavio/db';

/** What should happen to one posting the connector produced. */
export type PostingAction =
  /** Write it: insert if its source identity is new, update if it is not. */
  | 'store'
  /** The connector's own validation rejected the batch, or the posting cannot be identified. */
  | 'reject';

export interface PostingDecision {
  readonly identity: SourceIdentity;
  readonly action: PostingAction;
  readonly fields?: PostingFields;
  /** Why, when the action is `reject`. Never a bare failure. */
  readonly issues?: readonly ValidationIssue[];
}

/**
 * What a run says about itself.
 *
 * `completed` is the run's claim that it consumed everything it set out to: no thrown fetch, no
 * abandoned pagination, no rate-limit abort. A run that stopped early reports `false` **and says
 * why**, because a sweep that silently declines to run is indistinguishable from one that found
 * nothing missing.
 */
export interface RunOutcome {
  readonly completed: boolean;
  /** Required when `completed` is false, so a skipped sweep is never unexplained. */
  readonly reason?: string;
}

export interface PostingIngestInput {
  readonly meta: ConnectorMeta;
  /** The namespace these postings were listed under: a board slug, a tenant. `''` if the source has one. */
  readonly sourceScope: string;
  readonly observation: SourceObservation;
  readonly postings: readonly PostingCandidate[];
  /** The connector's own verdict on the batch it produced. */
  readonly validation: { readonly issues: readonly ValidationIssue[] };
  readonly run: RunOutcome;
}

/** One posting, as a connector normalized it, with the id it carries in its own source. */
export interface PostingCandidate {
  readonly externalId: string;
  readonly fields: PostingFields;
}

export interface ExpiryLicence {
  readonly licensed: boolean;
  /** Why not, when it is not. `null` when it is. */
  readonly refusedBecause: 'source-lists-partially' | 'run-did-not-complete' | 'nothing-was-listed' | null;
}

export interface PostingPlan {
  readonly sourceId: string;
  readonly sourceScope: string;
  readonly decisions: readonly PostingDecision[];
  /** Every external id this run listed — what an expiry sweep compares against. */
  readonly seenExternalIds: readonly string[];
  readonly expiry: ExpiryLicence;
}

/**
 * May this run expire what it did not list?
 *
 * Exported because it is the whole decision, and a caller reading a plan should be able to see the
 * reason rather than infer it from a boolean.
 */
export function expiryLicenceFor(
  meta: ConnectorMeta,
  run: RunOutcome,
  listedCount: number,
): ExpiryLicence {
  // Absent means partial. A connector that says nothing about its listing expires nothing.
  if (meta.listing !== 'exhaustive') return { licensed: false, refusedBecause: 'source-lists-partially' };
  if (!run.completed) return { licensed: false, refusedBecause: 'run-did-not-complete' };

  // A complete run of a live board that returns nothing is possible — an employer with nothing open
  // — but it is also what a silently-empty response looks like, and the two are indistinguishable
  // from here. Refusing to sweep costs a delayed expiry; accepting it costs the whole scope.
  if (listedCount === 0) return { licensed: false, refusedBecause: 'nothing-was-listed' };

  return { licensed: true, refusedBecause: null };
}

/**
 * Decide what a run should do, without doing any of it.
 *
 * **A batch its connector rejected stores nothing.** `validate` is the connector's judgement on its
 * own output, and storing a batch it refused would make that judgement decorative — the same rule
 * `planIngest` applies to requirements.
 *
 * The seen list is still built from a rejected batch, because what a source *listed* and what we
 * were willing to *store* are different facts. But expiry is refused for a rejected batch by the
 * same reasoning as a short run: a batch we could not read is not evidence about what is gone.
 */
export function planPostingIngest(input: PostingIngestInput): PostingPlan {
  const ingestible = isIngestible(input.validation);
  const seenExternalIds = input.postings.map((posting) => posting.externalId);

  const decisions: PostingDecision[] = input.postings.map((posting) => {
    const identity: SourceIdentity = {
      sourceId: input.meta.id,
      sourceScope: input.sourceScope,
      externalId: posting.externalId,
    };

    if (!ingestible) {
      return { identity, action: 'reject', issues: input.validation.issues };
    }

    return { identity, action: 'store', fields: posting.fields };
  });

  const expiry = ingestible
    ? expiryLicenceFor(input.meta, input.run, seenExternalIds.length)
    : ({ licensed: false, refusedBecause: 'run-did-not-complete' } as const);

  return { sourceId: input.meta.id, sourceScope: input.sourceScope, decisions, seenExternalIds, expiry };
}

export interface PostingPlanSummary {
  readonly store: number;
  readonly reject: number;
  readonly willSweep: boolean;
}

/** What a plan would do, for a run report or an operator preview. */
export function summarizePostings(plan: PostingPlan): PostingPlanSummary {
  return {
    store: plan.decisions.filter((decision) => decision.action === 'store').length,
    reject: plan.decisions.filter((decision) => decision.action === 'reject').length,
    willSweep: plan.expiry.licensed,
  };
}
