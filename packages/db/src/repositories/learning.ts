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

/** What a connector is, as `connector_sources` stores it. */
export interface ConnectorRegistration {
  readonly id: string;
  readonly kind: 'job-board' | 'salary' | 'company' | 'immigration' | 'learning' | 'market';
  readonly displayName: string;
  readonly connectorVersion: string;
  readonly sourceTier: number;
  readonly termsUrl: string;
  /** Why we are permitted to fetch this at all. A sentence, because "we checked" is not a record. */
  readonly legalBasis: string;
  readonly rateLimit: unknown;
  readonly refreshWindow: string;
  readonly schedule: string;
}

/**
 * Register a connector, or refresh what it says about itself.
 *
 * **Observed state is never overwritten here.** `reliability`, the breaker, the failure counters and
 * the cursor are what running the connector produced; re-registering describes the connector, and a
 * description should not reset a circuit breaker or restore a reliability score the source lost.
 */
export function registerConnectorSource(db: Kysely<Database>, source: ConnectorRegistration) {
  return db
    .insertInto('connector_sources')
    .values({
      id: source.id,
      kind: source.kind,
      display_name: source.displayName,
      connector_version: source.connectorVersion,
      source_tier: source.sourceTier,
      terms_url: source.termsUrl,
      legal_basis: source.legalBasis,
      rate_limit: JSON.stringify(source.rateLimit),
      refresh_window: source.refreshWindow,
      schedule: source.schedule,
    })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        display_name: source.displayName,
        connector_version: source.connectorVersion,
        source_tier: source.sourceTier,
        terms_url: source.termsUrl,
        legal_basis: source.legalBasis,
        rate_limit: JSON.stringify(source.rateLimit),
        refresh_window: source.refreshWindow,
        schedule: source.schedule,
        updated_at: new Date(),
      }),
    )
    .returningAll();
}

/**
 * Store a catalogue row and what it teaches.
 *
 * Upserted on `(provider, external_id)`: re-running a connector refreshes a page's title and its
 * link health rather than adding a second row for the same page.
 */
export async function upsertLearningResource(
  db: Kysely<Database>,
  row: {
    readonly provider: string;
    readonly externalId: string;
    readonly title: string;
    readonly url: string;
    readonly format: string;
    readonly language: string;
    readonly costBand: string;
    readonly sourceId: string;
    readonly sourceTier: number;
    readonly sourceUrl: string;
    readonly retrievedAt: string;
    readonly skillId: string;
    readonly coverage: string;
    readonly newId: () => string;
  },
): Promise<string> {
  const existing = await db
    .selectFrom('learning_resources')
    .select('id')
    .where('provider', '=', row.provider)
    .where('external_id', '=', row.externalId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  const id = existing?.id ?? row.newId();
  const at = new Date(row.retrievedAt);

  if (existing === undefined) {
    await db
      .insertInto('learning_resources')
      .values({
        id,
        provider: row.provider,
        external_id: row.externalId,
        title: row.title,
        url: row.url,
        format: row.format as never,
        language: row.language,
        cost_band: row.costBand as never,
        source_id: row.sourceId,
        source_tier: row.sourceTier,
        source_url: row.sourceUrl,
        retrieved_at: at,
        last_verified_at: at,
      })
      .execute();
  } else {
    await db
      .updateTable('learning_resources')
      .set({ title: row.title, url: row.url, retrieved_at: at, last_verified_at: at })
      .where('id', '=', id)
      .execute();
  }

  await db
    .insertInto('learning_resource_skills')
    .values({ id: row.newId(), resource_id: id, skill_id: row.skillId, coverage: row.coverage as never, basis: 'curated' })
    .onConflict((conflict) => conflict.columns(['resource_id', 'skill_id']).doNothing())
    .execute();

  return id;
}
