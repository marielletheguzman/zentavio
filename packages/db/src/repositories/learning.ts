/**
 * Reading learning resources, and recording what a person says they finished.
 *
 * ## The one thing this module must never do
 *
 * **Write `profile_skills`.** A completion is a claim about a resource; `evidenced` is a claim about
 * a person's competence, and `ai/skill-gap` credits only the second. Joining them here would be the
 * promotion M6 exists to refuse — the shortcut that lets somebody raise their readiness by clicking
 * *finished* (`docs/features/learning-paths.md`).
 *
 * Nothing in this file imports the profile repositories, and a test asserts that recording a
 * completion leaves `profile_skills` untouched.
 */

import type { Insertable, Kysely, Selectable } from 'kysely';
import type {
  Database,
  LearningCompletionsTable,
  LearningResourcesTable,
} from '../schema.ts';

export type NewLearningResource = Insertable<LearningResourcesTable>;
export type LearningResourceRow = Selectable<LearningResourcesTable>;
export type LearningCompletionRow = Selectable<LearningCompletionsTable>;

/** A completion this repository refuses to write, and why. */
export class CompletionInvariantError extends Error {
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(`${rule}: ${message}`);
    this.name = 'CompletionInvariantError';
    this.rule = rule;
  }
}

/**
 * Resources that can still be shown to somebody.
 *
 * Retired and dead-linked resources are excluded here rather than deleted, so a path that already
 * referenced one can still explain itself. A dead link surfaced in a learning path is a broken
 * promise; a path that cannot say what it once recommended is a different kind of broken.
 */
export function usableResources(
  db: Kysely<Database>,
  scope: { readonly language?: string; readonly costBand?: string; readonly format?: string } = {},
) {
  let query = db
    .selectFrom('learning_resources')
    .selectAll()
    .where('deleted_at', 'is', null)
    .where('retired_at', 'is', null)
    .where('link_status', '<>', 'dead');

  if (scope.language !== undefined) query = query.where('language', '=', scope.language);
  if (scope.costBand !== undefined) query = query.where('cost_band', '=', scope.costBand as never);
  if (scope.format !== undefined) query = query.where('format', '=', scope.format as never);

  return query.orderBy('title');
}

/**
 * The resources that teach a skill, most useful first.
 *
 * Ordered by coverage rather than by any quality judgement we have not earned: a `primary` resource
 * closes a gap, a `mentioned` one does not, and nothing here knows which course is *better*.
 */
export function resourcesForSkill(db: Kysely<Database>, skillId: string) {
  return db
    .selectFrom('learning_resource_skills')
    .innerJoin('learning_resources', 'learning_resources.id', 'learning_resource_skills.resource_id')
    .select([
      'learning_resources.id as id',
      'learning_resources.title as title',
      'learning_resources.url as url',
      'learning_resources.format as format',
      'learning_resources.cost_band as cost_band',
      'learning_resources.grants_evidence as grants_evidence',
      'learning_resource_skills.coverage as coverage',
    ])
    .where('learning_resource_skills.skill_id', '=', skillId)
    .where('learning_resources.deleted_at', 'is', null)
    .where('learning_resources.retired_at', 'is', null)
    .where('learning_resources.link_status', '<>', 'dead')
    .orderBy('learning_resource_skills.coverage')
    .orderBy('learning_resources.title');
}

export interface RecordCompletionOptions {
  readonly userId: string;
  readonly resourceId: string;
  /** ISO-8601. When they say they finished, not when they told us. */
  readonly completedAt: string;
  readonly evidenceUrl?: string | null;
  readonly note?: string | null;
  readonly newId: () => string;
  /** The clock, injected so the future-dating guard is testable without waiting. */
  readonly now?: () => Date;
}

/**
 * Record a completion.
 *
 * **Returns the row and nothing else.** No skill is promoted, no profile is touched, no readiness
 * changes. That is not an omission to be filled in later by this function: promotion needs a
 * verification path, and which one may promote is its own decision.
 *
 * Re-recording the same resource updates the existing row rather than adding a second — finishing a
 * course twice is one fact about a person, and two rows would double whatever an observed-pace
 * estimate later reads (`uq_lc__user_resource`).
 */
export async function recordCompletion(
  db: Kysely<Database>,
  options: RecordCompletionOptions,
): Promise<LearningCompletionRow> {
  const now = (options.now ?? (() => new Date()))();
  const completedAt = new Date(options.completedAt);

  if (Number.isNaN(completedAt.getTime())) {
    throw new CompletionInvariantError('completed_at', `'${options.completedAt}' is not a date`);
  }

  // **Enforced here because a CHECK cannot hold it.** PostgreSQL refuses a non-immutable function in
  // a constraint, so `completed_at <= now()` is not expressible in the schema. A future date is a
  // typo or a lie, and either way it corrupts an observed-pace estimate — which is the one thing
  // this table exists to make possible.
  if (completedAt.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    throw new CompletionInvariantError(
      'completed_at',
      'a completion cannot be dated in the future',
    );
  }

  return db
    .insertInto('learning_completions')
    .values({
      id: options.newId(),
      user_id: options.userId,
      resource_id: options.resourceId,
      completed_at: completedAt,
      basis: 'self_reported',
      evidence_url: options.evidenceUrl ?? null,
      note: options.note ?? null,
    })
    .onConflict((conflict) =>
      conflict
        .columns(['user_id', 'resource_id'])
        // **The index is partial, so the arbiter has to be too.** `uq_lc__user_resource` is scoped
        // `WHERE deleted_at IS NULL`; without repeating that predicate PostgreSQL finds no matching
        // constraint and refuses the statement outright.
        .where('deleted_at', 'is', null)
        .doUpdateSet({
          completed_at: completedAt,
          evidence_url: options.evidenceUrl ?? null,
          note: options.note ?? null,
          updated_at: new Date(),
        }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** What one person says they have finished, most recent first. */
export function completionsForUser(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom('learning_completions')
    .selectAll()
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .orderBy('completed_at', 'desc');
}
