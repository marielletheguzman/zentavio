/**
 * Interview reports, and the support floors that decide whether a process may be described
 * (ADR-0031).
 *
 * ## Where the floors live, and why here
 *
 * A `CHECK` cannot count rows in another table, so nothing in the schema can enforce "five reports
 * before a process is described". This module is that enforcement, and it is the only place that
 * decides — a caller receives either a described process or a shortfall, never a list of reports to
 * aggregate itself. A second aggregator would be a second threshold, and the one thing worse than a
 * fabricated stage is two surfaces disagreeing about whether it exists.
 *
 * ## The numbers, and that they are judgement
 *
 * Five reports for a pairing, three for any single stage, eighteen months. ADR-0031 records them as
 * chosen rather than derived, and nothing calibrates them until enough reports exist to check
 * whether pairings that cleared the floor described a process people actually met.
 */

import { sql } from 'kysely';
import type { Insertable, Kysely, Selectable } from 'kysely';
import type {
  Database,
  InterviewReportsTable,
  InterviewStageKindColumn,
} from '../schema.ts';

export type NewInterviewReport = Insertable<InterviewReportsTable>;
export type InterviewReportRow = Selectable<InterviewReportsTable>;

/** A pairing needs this many reports in the window before its process is described at all. */
export const PAIRING_SUPPORT_FLOOR = 5;

/** A single stage needs this many mentions before it appears. Stops one report inventing a round. */
export const STAGE_SUPPORT_FLOOR = 3;

/** Only reports from this window count. A process from four years ago is a different company's. */
export const SUPPORT_WINDOW_MONTHS = 18;

/** A report this repository refuses to write, and why. */
export class InterviewReportInvariantError extends Error {
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(`${rule}: ${message}`);
    this.name = 'InterviewReportInvariantError';
    this.rule = rule;
  }
}

export interface RecordReportOptions {
  readonly userId: string;
  readonly companyId: string;
  readonly roleFamily: string;
  /** ISO date. When they interviewed, not when they told us. */
  readonly interviewedOn: string;
  readonly stages: readonly { readonly position: number; readonly kind: InterviewStageKindColumn }[];
  readonly notes?: string | null;
  readonly newId: () => string;
  readonly now?: () => Date;
}

/**
 * Record one person's report.
 *
 * **One per person per pairing** — `uq_ir__user_pairing`. Five reports is not many, and without that
 * a single motivated person, or a company, could clear a floor alone.
 *
 * A report with no stages is refused. It contributes to a count while describing nothing, which is
 * the cheapest way to push a pairing over its floor without adding any information.
 */
export async function recordInterviewReport(
  db: Kysely<Database>,
  options: RecordReportOptions,
): Promise<InterviewReportRow> {
  if (options.stages.length === 0) {
    throw new InterviewReportInvariantError(
      'stages',
      'a report with no stages counts toward support while describing nothing',
    );
  }

  const positions = new Set(options.stages.map((stage) => stage.position));
  if (positions.size !== options.stages.length) {
    throw new InterviewReportInvariantError(
      'position',
      'two stages at the same position describe a process nobody could have observed',
    );
  }

  const interviewedOn = new Date(options.interviewedOn);
  if (Number.isNaN(interviewedOn.getTime())) {
    throw new InterviewReportInvariantError(
      'interviewed_on',
      `'${options.interviewedOn}' is not a date`,
    );
  }

  const now = (options.now ?? (() => new Date()))();
  if (interviewedOn.getTime() > now.getTime()) {
    // A future interview has not happened, so there is nothing to report about it.
    throw new InterviewReportInvariantError(
      'interviewed_on',
      'an interview that has not happened yet cannot be reported',
    );
  }

  return db.transaction().execute(async (trx) => {
    const report = await trx
      .insertInto('interview_reports')
      .values({
        id: options.newId(),
        user_id: options.userId,
        company_id: options.companyId,
        role_family: options.roleFamily,
        interviewed_on: options.interviewedOn.slice(0, 10),
        basis: 'self_reported',
        notes: options.notes ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('interview_report_stages')
      .values(
        options.stages.map((stage) => ({
          id: options.newId(),
          report_id: report.id,
          position: stage.position,
          kind: stage.kind,
        })),
      )
      .execute();

    return report;
  });
}

export interface StagePattern {
  readonly kind: InterviewStageKindColumn;
  /** How many reports in the window describe this stage. Always shown beside the claim. */
  readonly reportCount: number;
  /** The position most reports put it at. Reported, never averaged into a fraction. */
  readonly typicalPosition: number;
}

export type ProcessSupport =
  | {
      readonly kind: 'described';
      readonly reportCount: number;
      readonly windowMonths: number;
      readonly stages: readonly StagePattern[];
      /** Capped at `medium`, always. Tier 4 has a ceiling consistency does not raise. */
      readonly confidence: 'low' | 'medium';
    }
  | {
      readonly kind: 'below-support';
      readonly reportCount: number;
      readonly needed: number;
      readonly windowMonths: number;
    };

/**
 * What may be said about a pairing's process today.
 *
 * Returns a described process **or** a shortfall — never raw reports. Below the floor the shortfall
 * carries the count and what is still needed, because *"3 reports, we need 5"* invites somebody to
 * add one and *"not enough"* is a dead end (ADR-0031 part 5).
 *
 * **Confidence never exceeds `medium`.** Fifty agreeing reports are still fifty strangers'
 * recollections. An officially published process is tier 1 and outranks all of them, and does not
 * come from this table.
 */
export async function processForPairing(
  db: Kysely<Database>,
  options: {
    readonly companyId: string;
    readonly roleFamily: string;
    /** The date support is judged as of. Supplied, never read from a clock, so a result is reproducible. */
    readonly asOf: string;
  },
): Promise<ProcessSupport> {
  const since = new Date(options.asOf);
  since.setMonth(since.getMonth() - SUPPORT_WINDOW_MONTHS);
  const windowStart = since.toISOString().slice(0, 10);

  const reports = await db
    .selectFrom('interview_reports')
    .select('id')
    .where('company_id', '=', options.companyId)
    .where('role_family', '=', options.roleFamily)
    .where('interviewed_on', '>=', windowStart)
    .where('interviewed_on', '<=', options.asOf.slice(0, 10))
    .execute();

  const reportCount = reports.length;

  if (reportCount < PAIRING_SUPPORT_FLOOR) {
    return {
      kind: 'below-support',
      reportCount,
      needed: PAIRING_SUPPORT_FLOOR - reportCount,
      windowMonths: SUPPORT_WINDOW_MONTHS,
    };
  }

  const ids = reports.map((report) => report.id);

  const patterns = await db
    .selectFrom('interview_report_stages')
    .select((eb) => [
      'kind',
      eb.fn.count<string>('report_id').distinct().as('report_count'),
      // The position most reports put it at. A mode rather than a mean: "stage 2.4" describes no
      // process anybody sat.
      sql<number>`mode() within group (order by position)`.as('typical_position'),
    ])
    .where('report_id', 'in', ids)
    .groupBy('kind')
    .execute();

  const stages = patterns
    .map((pattern) => ({
      kind: pattern.kind,
      reportCount: Number(pattern.report_count),
      typicalPosition: Number(pattern.typical_position),
    }))
    // Below the stage floor it does not appear at all. One report describing a round nobody else
    // mentions is exactly the fabricated specificity ADR-0031 exists to prevent.
    .filter((pattern) => pattern.reportCount >= STAGE_SUPPORT_FLOOR)
    .sort((left, right) => left.typicalPosition - right.typicalPosition);

  return {
    kind: 'described',
    reportCount,
    windowMonths: SUPPORT_WINDOW_MONTHS,
    stages,
    // `medium` only once the pairing is comfortably above the floor; `low` while it is scraping it.
    // Neither is `high`, at any count.
    confidence: reportCount >= PAIRING_SUPPORT_FLOOR * 2 ? 'medium' : 'low',
  };
}

/**
 * Detach one person's reports on erasure.
 *
 * **Detached, not deleted** — the same shape as `outcomes`. A report's value is aggregate: other
 * people's answers depend on it being counted, and deleting one would silently drop a pairing below
 * its floor and change what a stranger is told. The link to the person is the sensitive part, so
 * that is what goes.
 */
export function anonymizeInterviewReports(db: Kysely<Database>, userId: string) {
  return db
    .updateTable('interview_reports')
    .set({ user_id: null, anonymized_at: sql`now()`, updated_at: sql`now()` })
    .where('user_id', '=', userId);
}
