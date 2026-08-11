/**
 * Recording what a person attempted, and what came of it (ADR-0019).
 *
 * ## What this is for, stated once
 *
 * Every score this product shows is a claim. `outcomes` is where a claim becomes checkable: the
 * row carries **what was predicted at the time** beside what actually happened, so `0.72` can
 * later be asked whether it meant anything. Without that pairing the table describes a job market
 * and calibrates nothing.
 *
 * **Calibration data cannot be backfilled** — a prediction is only checkable against a result if
 * it was written down when it was made. That is the whole argument of ADR-0019, and it is why
 * `recordApplication` captures the prediction at the moment the person acts rather than leaving
 * the column for later.
 *
 * ## Two rules the schema cannot enforce alone
 *
 * **Outcomes are append-only.** A correction is a new row. What we believed at the time is itself
 * the data, and editing it destroys the only record of what we got wrong. There is deliberately no
 * update or delete here.
 *
 * **No free text ever reaches `outcomes`.** The table has no column for it, and this module adds
 * none: a notes field on an outcome would be the most sensitive and least controllable column in
 * the schema (`docs/database/entities/outcome.md`).
 */

import type { Kysely, Selectable } from 'kysely';
import { sql } from 'kysely';
import type {
  ApplicationStatusColumn,
  ApplicationsTable,
  Database,
  OutcomeKindColumn,
  OutcomeSourceColumn,
  OutcomesTable,
} from '../schema.ts';
import { uuidv7 } from '../uuid.ts';

export type ApplicationRow = Selectable<ApplicationsTable>;
export type OutcomeRow = Selectable<OutcomesTable>;

export class UnknownApplicationError extends Error {
  readonly applicationId: string;

  constructor(applicationId: string) {
    super(
      `No application ${applicationId} for this person. An outcome must attach to something they ` +
        'actually attempted, or there is no prediction for it to check.',
    );
    this.name = 'UnknownApplicationError';
    this.applicationId = applicationId;
  }
}

/**
 * The prediction that was on screen when the person acted.
 *
 * Both fields or neither: `ck_applications__predicted` refuses a score with no scorer, because a
 * number nobody can attribute to a version of the code is not a prediction anyone can check.
 */
export interface PredictionAtApply {
  readonly score: number;
  readonly scorerVersion: string;
  /** What the score was computed against. Null when the scorer did not state one. */
  readonly knowledgeAsOf?: Date | null;
}

export interface RecordApplicationOptions {
  readonly userId: string;
  /** Free-form title, for something applied to outside Zentavio. */
  readonly externalRole: string;
  readonly companyId?: string | null;
  readonly countryCode?: string | null;
  readonly requiredSponsorship?: boolean;
  readonly appliedAt?: Date;
  /** Absent when nothing had been scored yet — recorded honestly as absent, never as zero. */
  readonly prediction?: PredictionAtApply | null;
  readonly source?: 'zentavio' | 'user-recorded' | 'imported';
}

/**
 * Record an application, with whatever we had predicted about this person at that moment.
 *
 * `status` starts at `applied` rather than `saved`: this records something already done. The
 * status is the *current* stage and moves as outcomes arrive; the history lives in `outcomes`,
 * which is what makes `application_events` unnecessary for now (see the migration header).
 */
export async function recordApplication(
  db: Kysely<Database>,
  options: RecordApplicationOptions,
): Promise<ApplicationRow> {
  const appliedAt = options.appliedAt ?? new Date();

  return db
    .insertInto('applications')
    .values({
      id: uuidv7(),
      user_id: options.userId,
      job_posting_id: null,
      match_id: null,
      company_id: options.companyId ?? null,
      external_role: options.externalRole,
      status: 'applied',
      applied_at: appliedAt,
      closed_at: null,
      // `numeric(5,4)` arrives back as a string from pg; written as a number here and converted
      // once, on read, in the same place every other numeric column is.
      predicted_score: options.prediction?.score ?? null,
      scorer_version: options.prediction?.scorerVersion ?? null,
      required_sponsorship: options.requiredSponsorship ?? false,
      sponsorship_status_at_apply: null,
      country_code: options.countryCode ?? null,
      source: options.source ?? 'user-recorded',
      deleted_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** A person's own applications, newest attempt first. Soft-deleted rows excluded. */
export async function userApplications(
  db: Kysely<Database>,
  userId: string,
): Promise<readonly ApplicationRow[]> {
  return db
    .selectFrom('applications')
    .selectAll()
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .orderBy('applied_at', 'desc')
    .execute();
}

/** Every outcome recorded against one application, oldest first — it is a timeline. */
export async function applicationOutcomes(
  db: Kysely<Database>,
  applicationId: string,
): Promise<readonly OutcomeRow[]> {
  return db
    .selectFrom('outcomes')
    .selectAll()
    .where('application_id', '=', applicationId)
    .orderBy('occurred_at')
    .execute();
}

export interface RecordOutcomeOptions {
  readonly userId: string;
  readonly applicationId: string;
  readonly kind: OutcomeKindColumn;
  readonly occurredAt?: Date;
  readonly source?: OutcomeSourceColumn;
  readonly confidence?: 'high' | 'medium' | 'low';
  /** Ids and status only. Anything else would put a résumé in the most re-identifiable table. */
  readonly skillSnapshot?: readonly { readonly skillId: string; readonly status: string }[];
  readonly careerId?: string | null;
  readonly targetCareerId?: string | null;
  readonly wasRelocation?: boolean;
  readonly wasCareerChange?: boolean;
  readonly seniority?: string | null;
}

/**
 * The stage an outcome moves an application to, where it moves it at all.
 *
 * `relocated`, `course_completed` and `assessment_passed` are absent on purpose: they are things
 * that happened to a *person*, not transitions of this application, and forcing them onto a status
 * would make the column mean two things.
 */
const STATUS_AFTER: Partial<Record<OutcomeKindColumn, ApplicationStatusColumn>> = {
  applied: 'applied',
  screened: 'screening',
  interviewed: 'interviewing',
  offered: 'offered',
  accepted: 'accepted',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
  started: 'accepted',
};

/** The stages that end an application. `closed_at` is set when one of them arrives. */
const CLOSING: ReadonlySet<OutcomeKindColumn> = new Set(['rejected', 'withdrawn', 'accepted', 'started']);

/**
 * Record what happened, carrying the prediction it is checking.
 *
 * The prediction is copied from the application rather than passed in: it is what was on screen
 * when the person applied, and re-supplying it at outcome time would let a caller record a
 * prediction it never made. `predicted_kind` is `readiness` because that is the score this product
 * currently shows before an application — when match scores exist (M4) the application will carry
 * which kind it stored.
 *
 * One transaction, because the outcome and the application's new stage must not be separable: a
 * timeline that disagrees with the status is worse than either alone.
 */
export async function recordOutcome(
  db: Kysely<Database>,
  options: RecordOutcomeOptions,
): Promise<OutcomeRow> {
  const occurredAt = options.occurredAt ?? new Date();

  return db.transaction().execute(async (trx) => {
    const application = await trx
      .selectFrom('applications')
      .select([
        'id',
        'user_id',
        'company_id',
        'country_code',
        'applied_at',
        'predicted_score',
        'scorer_version',
      ])
      .where('id', '=', options.applicationId)
      .where('user_id', '=', options.userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    // Scoped to the person as well as the id: an outcome recorded against somebody else's
    // application would be a cross-user write, and "not found" is the right answer to both.
    if (application === undefined) throw new UnknownApplicationError(options.applicationId);

    const outcome = await trx
      .insertInto('outcomes')
      .values({
        id: uuidv7(),
        user_id: options.userId,
        application_id: application.id,
        kind: options.kind,
        occurred_at: occurredAt,
        // **Computed by PostgreSQL, not here.** `ck_outcomes__month` compares against
        // `date_trunc('month', occurred_at)::date` evaluated by the server, and a month truncated
        // in JavaScript disagrees with it for anyone east of UTC in the first hours of a month.
        // The same timezone trap that shifted `effective_to` back a day in PR #63.
        occurred_month: sql`date_trunc('month', ${occurredAt}::timestamptz)::date`,
        career_id: options.careerId ?? null,
        target_career_id: options.targetCareerId ?? null,
        company_id: application.company_id,
        country_code: application.country_code,
        seniority: options.seniority ?? null,
        was_relocation: options.wasRelocation ?? false,
        was_career_change: options.wasCareerChange ?? false,
        // Carried from the application. This is the pairing the table exists for.
        predicted_score: application.predicted_score,
        predicted_kind: application.predicted_score === null ? null : 'readiness',
        scorer_version: application.scorer_version,
        knowledge_as_of: null,
        elapsed_days: elapsedDays(application.applied_at, occurredAt),
        skill_snapshot: JSON.stringify(options.skillSnapshot ?? []),
        source: options.source ?? 'user-reported',
        confidence: options.confidence ?? 'high',
        anonymized_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const status = STATUS_AFTER[options.kind];
    if (status !== undefined) {
      await trx
        .updateTable('applications')
        .set({
          status,
          // `now()`, matching every other repository: the moment the row was written is the
          // database's clock, not the application server's.
          updated_at: sql`now()`,
          ...(CLOSING.has(options.kind) ? { closed_at: occurredAt } : {}),
        })
        .where('id', '=', application.id)
        .execute();
    }

    return outcome;
  });
}

/**
 * Whole days from the application to the outcome, or null when either end is unknown.
 *
 * Null rather than zero: zero means *same day*, which is a real and different answer. A negative
 * span means the caller supplied an outcome before the application, and that is not a duration —
 * it is bad input, recorded as absent rather than as a negative number nobody can interpret.
 */
function elapsedDays(appliedAt: Date | null, occurredAt: Date): number | null {
  if (appliedAt === null) return null;

  const days = Math.floor((occurredAt.getTime() - appliedAt.getTime()) / 86_400_000);
  return days < 0 ? null : days;
}
