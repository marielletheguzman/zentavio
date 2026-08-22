/**
 * Taking an assessment, and what the result is allowed to say (ADR-0030).
 *
 * The gateway orchestrates; the decision about what a pass evidences lives in the data. This reads
 * the instrument's own `does_not_evidence` and each item's `evidences` and hands both to the
 * surface — it never composes a claim of its own, because a sentence written here would be a claim
 * nobody authored and nobody could revise.
 *
 * ## The two things this must not do
 *
 * **Serve the answer key.** `itemsToAnswer` omits it in what it selects; nothing here re-adds it.
 *
 * **Accept a score.** A client that can send its own score has decided whether it passed. Answers
 * come in, the score is computed against the stored key, and the threshold is the instrument's.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  AssessmentInvariantError,
  currentProfile,
  gradeAttempt,
  itemsToAnswer,
  itemsWithClaims,
  promoteFromAttempt,
  publishedAssessmentsForSkill,
  startAttempt,
  uuidv7,
  type Database,
} from '@zentavio/db';

import { DATABASE } from '../tokens.ts';

export interface AssessmentSummary {
  readonly id: string;
  readonly slug: string;
  readonly version: number;
  readonly title: string;
  readonly description: string | null;
  readonly itemCount: number;
  readonly passThreshold: number;
  /** Shown **before** anybody starts, not only after they pass. */
  readonly doesNotEvidence: string;
}

export interface ItemForTaker {
  readonly id: string;
  readonly position: number;
  readonly stem: string;
  readonly options: readonly { readonly key: string; readonly text: string }[];
}

export type StartOutcome =
  | { readonly kind: 'started'; readonly attemptId: string; readonly assessment: AssessmentSummary; readonly items: readonly ItemForTaker[] }
  | { readonly kind: 'refused'; readonly reason: string };

export type GradeOutcome =
  | {
      readonly kind: 'graded';
      readonly score: number;
      readonly passThreshold: number;
      readonly itemCount: number;
      readonly passed: boolean;
      /** What each item this person got right supports. Empty when they did not pass. */
      readonly evidenced: readonly { readonly evidences: string; readonly sourceUrl: string }[];
      /** The instrument's own sentence. Shown whether they passed or failed. */
      readonly doesNotEvidence: string;
      readonly promotedSkillId: string | null;
    }
  | { readonly kind: 'refused'; readonly reason: string };

@Injectable()
export class AssessmentsService {
  readonly #db: Kysely<Database>;
  readonly #logger = new Logger(AssessmentsService.name);

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.#db = db;
  }

  /**
   * The published instruments for a skill, each already carrying what it will not claim.
   *
   * Accepts the skill's **slug or id**. A surface knows `git`; it has no reason to know a uuid, and
   * making it learn one would put a lookup in the browser that belongs here.
   */
  async forSkill(skill: string): Promise<readonly AssessmentSummary[]> {
    const resolved = /^[0-9a-f-]{36}$/i.test(skill)
      ? skill
      : (
          await this.#db
            .selectFrom('skills')
            .select('id')
            .where('slug', '=', skill)
            .where('deleted_at', 'is', null)
            .executeTakeFirst()
        )?.id;

    if (resolved === undefined) return [];

    const rows = await publishedAssessmentsForSkill(this.#db, resolved).execute();
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      version: row.version,
      title: row.title,
      description: row.description,
      itemCount: row.item_count,
      passThreshold: row.pass_threshold,
      // Non-null in practice — publishing requires it — and defaulted rather than asserted, because
      // an empty string on the wire is better than a 500 on a row somebody wrote by hand.
      doesNotEvidence: row.does_not_evidence ?? '',
    }));
  }

  /** Start an attempt and hand back the questions, without their answers. */
  async start(userId: string, assessmentId: string): Promise<StartOutcome> {
    let attemptId: string;
    try {
      const attempt = await startAttempt(this.#db, { userId, assessmentId, newId: uuidv7 });
      attemptId = attempt.id;
    } catch (error) {
      if (error instanceof AssessmentInvariantError) {
        return { kind: 'refused', reason: error.message };
      }
      throw error;
    }

    const [assessment] = await this.#db
      .selectFrom('skill_assessments')
      .selectAll()
      .where('id', '=', assessmentId)
      .execute();

    const items = await itemsToAnswer(this.#db, assessmentId).execute();

    return {
      kind: 'started',
      attemptId,
      assessment: {
        id: assessmentId,
        slug: assessment?.slug ?? '',
        version: assessment?.version ?? 0,
        title: assessment?.title ?? '',
        description: assessment?.description ?? null,
        itemCount: assessment?.item_count ?? items.length,
        passThreshold: assessment?.pass_threshold ?? 0,
        doesNotEvidence: assessment?.does_not_evidence ?? '',
      },
      items: items.map((item) => ({
        id: item.id,
        position: item.position,
        stem: item.stem,
        options: (item.options ?? []) as readonly { key: string; text: string }[],
      })),
    };
  }

  /**
   * Grade the answers, promote on a pass, and return what may be said about it.
   *
   * A pass promotes the skill; a failure promotes nothing and says so without dressing it up. Both
   * carry `doesNotEvidence`, because the limit of the instrument is not a consolation prize handed
   * to people who failed.
   */
  async grade(
    userId: string,
    attemptId: string,
    answers: Readonly<Record<string, string>>,
  ): Promise<GradeOutcome> {
    const owner = await this.#db
      .selectFrom('assessment_attempts')
      .select(['user_id', 'assessment_id'])
      .where('id', '=', attemptId)
      .executeTakeFirst();

    // The same answer whether it does not exist or belongs to somebody else, so this route cannot
    // be used to discover another person's attempt.
    if (owner === undefined || owner.user_id !== userId) {
      return { kind: 'refused', reason: 'no such attempt' };
    }

    let decided;
    try {
      decided = await gradeAttempt(this.#db, { attemptId, answers });
    } catch (error) {
      if (error instanceof AssessmentInvariantError) {
        return { kind: 'refused', reason: error.message };
      }
      throw error;
    }

    const assessment = await this.#db
      .selectFrom('skill_assessments')
      .select(['item_count', 'pass_threshold', 'does_not_evidence'])
      .where('id', '=', owner.assessment_id)
      .executeTakeFirstOrThrow();

    const passed = decided.outcome === 'passed';
    let promotedSkillId: string | null = null;

    if (passed) {
      const profile = await currentProfile(this.#db, userId);
      if (profile === undefined) {
        // Nothing to promote into. The pass stands and is still citable; the profile is what is
        // missing, and inventing one here would put a skill on a profile the person never made.
        this.#logger.warn(`attempt ${attemptId} passed but the user has no current profile`);
      } else {
        const promotion = await promoteFromAttempt(this.#db, {
          attemptId,
          profileId: profile.id,
          newId: uuidv7,
        });
        promotedSkillId = promotion.skillId;
      }
    }

    // Only what they actually got right. Listing every item's claim on a pass would credit them
    // with capabilities they demonstrably did not show.
    const claims = passed ? await itemsWithClaims(this.#db, owner.assessment_id).execute() : [];
    const correct = new Set(
      (
        await this.#db
          .selectFrom('assessment_items')
          .select(['id', 'correct_option'])
          .where('assessment_id', '=', owner.assessment_id)
          .execute()
      )
        .filter((item) => answers[item.id] === item.correct_option)
        .map((item) => item.id),
    );

    return {
      kind: 'graded',
      score: decided.score ?? 0,
      passThreshold: assessment.pass_threshold,
      itemCount: assessment.item_count,
      passed,
      evidenced: claims
        .filter((claim) => correct.has(claim.id))
        .map((claim) => ({ evidences: claim.evidences, sourceUrl: claim.source_url })),
      doesNotEvidence: assessment.does_not_evidence ?? '',
      promotedSkillId,
    };
  }
}
