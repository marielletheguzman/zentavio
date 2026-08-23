/**
 * Scoring one person against one posting: retrieve, score, record (ADR-0037).
 *
 * **This is a function, not a daemon**, for the same reason `runDueJobBoards` and
 * `extractDuePostings` are: what triggers a scoring run is a deployment decision and nothing is
 * deployed (ADR-0015, ADR-0021).
 *
 * The retrieve/score/record split is `.claude/skills/ai-matching/SKILL.md`'s: facts come from
 * `packages/db` with their provenance, the number is arithmetic in a pure function, and the row
 * carries the versions that make it re-derivable. **No `ai/` call happens here.** A model may later
 * write prose from the computed evidence; it never produces the number.
 */

import {
  heldSkillsForUser,
  postingScoringState,
  recordMatch,
  requirementsForPosting,
  transferEdgesInto,
  type Database,
} from '@zentavio/db';
import type { Kysely } from 'kysely';

import { SCORER_VERSION, scoreSkillFit, type SkillFitResult } from './skill-fit.ts';

export interface ScoringDeps {
  readonly now: () => Date;
  readonly newId: () => string;
}

export interface ScoringRequest {
  readonly userId: string;
  readonly userProfileId: string;
  readonly jobPostingId: string;
}

export type ScoringRefusal = 'posting-not-found' | 'posting-expired';

export interface ScoringOutcome {
  readonly matchId: string | null;
  readonly result: SkillFitResult | null;
  /** Why nothing was written, when nothing was. Null when a row was recorded. */
  readonly refusedBecause: ScoringRefusal | null;
}

/**
 * Score one posting for one person and store the result.
 *
 * **An expired posting is refused rather than scored.** A number about a job nobody can apply for is
 * a number that will be shown to somebody, and `expiry_reason` already distinguishes the source
 * delisting it from our failing to fetch it — neither is a reason to spend a score.
 *
 * The refusal is named. A run that declines to score and says nothing is indistinguishable from a
 * run that scored zero, which is the failure this codebase keeps finding in other shapes.
 */
export async function scorePostingForUser(
  db: Kysely<Database>,
  request: ScoringRequest,
  deps: ScoringDeps,
): Promise<ScoringOutcome> {
  const posting = await postingScoringState(db, request.jobPostingId);
  if (posting === undefined) {
    return { matchId: null, result: null, refusedBecause: 'posting-not-found' };
  }
  if (posting.expired) {
    return { matchId: null, result: null, refusedBecause: 'posting-expired' };
  }

  const computedAt = deps.now();

  const requirements = await requirementsForPosting(db, request.jobPostingId);
  const held = await heldSkillsForUser(db, request.userProfileId);
  const edges = await transferEdgesInto(
    db,
    requirements.map((requirement) => requirement.skillId),
  );

  const result = scoreSkillFit({
    requirements,
    held,
    edges,
    extractedVersion: posting.extractedVersion,
  });

  const matchId = deps.newId();
  await recordMatch(db, {
    id: matchId,
    user_id: request.userId,
    job_posting_id: request.jobPostingId,
    // Kysely writes `numeric` as a string; null stays null and the CHECK pairs it with the status.
    score: result.score === null ? null : String(result.score),
    status: result.status,
    confidence: result.confidence,
    evidence: JSON.stringify(result.evidence),
    missing: JSON.stringify(result.missing),
    // Empty by decision, not by omission: the only hard constraint the feature defines is work
    // authorization, and ADR-0037 keeps it out of this score until it can actually be evaluated.
    constraints: JSON.stringify([]),
    scorer_version: SCORER_VERSION,
    // Null: no model was involved in a Skill Fit score, and a version here would claim one was.
    prompt_version: null,
    // The facts were read in this call, so the state of the world is this instant. When retrieval
    // grows a cursor, this becomes that cursor rather than the clock.
    knowledge_as_of: computedAt,
    computed_at: computedAt,
  });

  return { matchId, result, refusedBecause: null };
}
