/**
 * Assessments, attempts, and the one place a skill may be promoted to `evidenced` (ADR-0030).
 *
 * ## The single writer
 *
 * `promoteFromAttempt` is the only function in this repository that sets `profile_skills.verified_at`
 * or writes `evidence_kind = 'assessment'`. That is not a convention — it is the decision, and a
 * test asserts no other module does it. A second writer is how a promotion appears with no basis
 * anyone can show.
 *
 * ## What a pass claims
 *
 * The attempt. This person passed *this version of this instrument* on this date. There is no
 * proctoring and no identity check here, so nothing in this module asserts who sat it — the surface
 * says so, and `verified_attempt_id` is what lets it.
 */

import type { Insertable, Kysely, Selectable } from 'kysely';
import type {
  AssessmentAttemptsTable,
  Database,
  SkillAssessmentsTable,
} from '../schema.ts';

export type NewSkillAssessment = Insertable<SkillAssessmentsTable>;
export type SkillAssessmentRow = Selectable<SkillAssessmentsTable>;
export type AssessmentAttemptRow = Selectable<AssessmentAttemptsTable>;

/** An attempt or promotion this repository refuses to write, and why. */
export class AssessmentInvariantError extends Error {
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(`${rule}: ${message}`);
    this.name = 'AssessmentInvariantError';
    this.rule = rule;
  }
}

/** The live version of each instrument for a skill. A draft is not offered; a retired one is gone. */
export function publishedAssessmentsForSkill(db: Kysely<Database>, skillId: string) {
  return db
    .selectFrom('skill_assessments')
    .selectAll()
    .where('skill_id', '=', skillId)
    .where('status', '=', 'published')
    .orderBy('slug');
}

/**
 * Start an attempt.
 *
 * Only against a **published** version. A draft has no settled items and a retired one is no longer
 * the instrument its slug names, so an attempt at either would produce evidence of nothing.
 */
export async function startAttempt(
  db: Kysely<Database>,
  options: { readonly userId: string; readonly assessmentId: string; readonly newId: () => string },
): Promise<AssessmentAttemptRow> {
  const assessment = await db
    .selectFrom('skill_assessments')
    .select(['id', 'status'])
    .where('id', '=', options.assessmentId)
    .executeTakeFirst();

  if (assessment === undefined) {
    throw new AssessmentInvariantError('assessment_id', 'no such assessment version');
  }
  if (assessment.status !== 'published') {
    throw new AssessmentInvariantError(
      'status',
      `this version is ${assessment.status}, so an attempt at it would evidence nothing`,
    );
  }

  return db
    .insertInto('assessment_attempts')
    .values({
      id: options.newId(),
      user_id: options.userId,
      assessment_id: options.assessmentId,
      outcome: 'in_progress',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Submit a score and decide the attempt.
 *
 * **The threshold comes from the instrument, never from the caller.** A pass mark supplied alongside
 * the score is a pass mark chosen after seeing it.
 */
export async function submitAttempt(
  db: Kysely<Database>,
  options: { readonly attemptId: string; readonly score: number; readonly at?: Date },
): Promise<AssessmentAttemptRow> {
  const attempt = await db
    .selectFrom('assessment_attempts')
    .innerJoin('skill_assessments', 'skill_assessments.id', 'assessment_attempts.assessment_id')
    .select([
      'assessment_attempts.id as id',
      'assessment_attempts.outcome as outcome',
      'skill_assessments.item_count as item_count',
      'skill_assessments.pass_threshold as pass_threshold',
    ])
    .where('assessment_attempts.id', '=', options.attemptId)
    .executeTakeFirst();

  if (attempt === undefined) {
    throw new AssessmentInvariantError('attempt_id', 'no such attempt');
  }
  if (attempt.outcome !== 'in_progress') {
    throw new AssessmentInvariantError(
      'outcome',
      `this attempt is already ${attempt.outcome} and a decided attempt is not re-decided`,
    );
  }
  if (!Number.isInteger(options.score) || options.score < 0 || options.score > attempt.item_count) {
    throw new AssessmentInvariantError(
      'score',
      `${String(options.score)} is not a possible score for an instrument of ${String(attempt.item_count)} items`,
    );
  }

  return db
    .updateTable('assessment_attempts')
    .set({
      score: options.score,
      submitted_at: options.at ?? new Date(),
      outcome: options.score >= attempt.pass_threshold ? 'passed' : 'failed',
    })
    .where('id', '=', options.attemptId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Promote the skill a passed attempt evidences.
 *
 * **The only writer of `verified_at` and of `evidence_kind = 'assessment'`** (ADR-0030). Returns the
 * promoted row, or throws — it never silently declines, because a promotion that quietly did not
 * happen looks identical to one that did until somebody reads the profile.
 *
 * A failed attempt promotes nothing. Neither does an unfinished one: the score is what decides, and
 * an attempt with no score has not been decided.
 *
 * The person may already claim the skill from their résumé. Promotion **upgrades that row in place**
 * rather than adding a second — `uq_profile_skills__profile_skill` — so a claim and its later
 * evidence remain one fact about them.
 */
export async function promoteFromAttempt(
  db: Kysely<Database>,
  options: {
    readonly attemptId: string;
    readonly profileId: string;
    readonly newId: () => string;
    readonly at?: Date;
  },
): Promise<{ readonly skillId: string; readonly promoted: boolean }> {
  const attempt = await db
    .selectFrom('assessment_attempts')
    .innerJoin('skill_assessments', 'skill_assessments.id', 'assessment_attempts.assessment_id')
    .select([
      'assessment_attempts.id as attempt_id',
      'assessment_attempts.outcome as outcome',
      'skill_assessments.skill_id as skill_id',
    ])
    .where('assessment_attempts.id', '=', options.attemptId)
    .executeTakeFirst();

  if (attempt === undefined) {
    throw new AssessmentInvariantError('attempt_id', 'no such attempt');
  }
  if (attempt.outcome !== 'passed') {
    throw new AssessmentInvariantError(
      'outcome',
      `an attempt with outcome '${attempt.outcome}' evidences nothing`,
    );
  }

  const verifiedAt = options.at ?? new Date();

  await db
    .insertInto('profile_skills')
    .values({
      id: options.newId(),
      user_profile_id: options.profileId,
      skill_id: attempt.skill_id,
      status: 'evidenced',
      evidence_kind: 'assessment',
      // The instrument decided this, not the person. `self_reported` stays false even though they
      // performed the act: the claim's author is the assessment.
      self_reported: false,
      confidence: 'high',
      verified_at: verifiedAt,
      verified_attempt_id: attempt.attempt_id,
    })
    .onConflict((conflict) =>
      conflict.columns(['user_profile_id', 'skill_id']).doUpdateSet({
        status: 'evidenced',
        evidence_kind: 'assessment',
        verified_at: verifiedAt,
        verified_attempt_id: attempt.attempt_id,
        updated_at: new Date(),
      }),
    )
    .execute();

  return { skillId: attempt.skill_id, promoted: true };
}

/** Every attempt a person has made, newest first. Failures included — they happened. */
export function attemptsForUser(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom('assessment_attempts')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('started_at', 'desc');
}
