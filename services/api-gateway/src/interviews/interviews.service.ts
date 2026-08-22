/**
 * Contributing an interview report, and reading what a pairing's reports add up to (ADR-0031, 0032).
 *
 * ## What this service never returns
 *
 * **Raw reports.** A caller receives a described process or a shortfall, and `processForPairing`
 * decides which — a second aggregator would be a second threshold, and the one thing worse than a
 * fabricated stage is two surfaces disagreeing about whether it exists.
 *
 * **Anybody else's contribution.** A report that belongs to another person gets the same answer as
 * one that does not exist, so no route here can be used to discover that somebody reported a
 * company. That matters more than usual: describing an employer's process is not something to be
 * traceable for.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  InterviewReportInvariantError,
  correctInterviewReport,
  processForPairing,
  recordInterviewReport,
  reportForPairing,
  reportsByUser,
  uuidv7,
  withdrawInterviewReport,
  type Database,
  type InterviewReportRow,
  type ProcessSupport,
} from '@zentavio/db';
import type { InterviewStageKindColumn } from '@zentavio/db';

import { DATABASE } from '../tokens.ts';

export interface StageInput {
  readonly position: number;
  readonly kind: InterviewStageKindColumn;
}

export type ContributionOutcome =
  | { readonly kind: 'recorded'; readonly report: InterviewReportRow }
  | { readonly kind: 'already-reported'; readonly reportId: string }
  | { readonly kind: 'refused'; readonly reason: string };

export type CorrectionOutcome =
  | { readonly kind: 'corrected'; readonly report: InterviewReportRow }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'refused'; readonly reason: string };

@Injectable()
export class InterviewsService {
  readonly #db: Kysely<Database>;

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.#db = db;
  }

  /**
   * The companies somebody can report on.
   *
   * Active only, and merged rows are excluded rather than followed — a merged company points
   * forward, and offering both would let two pairings accumulate reports about one employer.
   */
  companies(): Promise<readonly { readonly id: string; readonly name: string }[]> {
    return this.#db
      .selectFrom('companies')
      .select(['id', 'canonical_name as name'])
      .where('status', '=', 'active')
      .where('deleted_at', 'is', null)
      .orderBy('canonical_name')
      .execute();
  }

  /** What may be said about a pairing today: a described process, or the shortfall and its count. */
  process(companyId: string, roleFamily: string, asOf: string): Promise<ProcessSupport> {
    return processForPairing(this.#db, { companyId, roleFamily, asOf });
  }

  /** What this person has contributed. Withdrawn reports are absent by construction. */
  mine(userId: string): Promise<readonly InterviewReportRow[]> {
    return reportsByUser(this.#db, userId).execute();
  }

  /**
   * Record a report.
   *
   * A second report for the same pairing is **not** an error to show as a failure: the person
   * already contributed, and what they want is to correct it. The outcome says which, so the surface
   * can offer that rather than a rejection.
   */
  async contribute(
    userId: string,
    input: {
      readonly companyId: string;
      readonly roleFamily: string;
      readonly interviewedOn: string;
      readonly stages: readonly StageInput[];
      readonly notes?: string | null;
    },
  ): Promise<ContributionOutcome> {
    const existing = await reportForPairing(this.#db, {
      userId,
      companyId: input.companyId,
      roleFamily: input.roleFamily,
    });

    if (existing !== undefined) return { kind: 'already-reported', reportId: existing.id };

    try {
      const report = await recordInterviewReport(this.#db, {
        userId,
        companyId: input.companyId,
        roleFamily: input.roleFamily,
        interviewedOn: input.interviewedOn,
        stages: input.stages,
        notes: input.notes ?? null,
        newId: uuidv7,
      });
      return { kind: 'recorded', report };
    } catch (error) {
      if (error instanceof InterviewReportInvariantError) {
        return { kind: 'refused', reason: error.message };
      }
      throw error;
    }
  }

  /** Correct one's own report. Aggregation is at read time, so the change is simply counted. */
  async correct(
    userId: string,
    reportId: string,
    input: {
      readonly interviewedOn?: string;
      readonly stages?: readonly StageInput[];
      readonly notes?: string | null;
    },
  ): Promise<CorrectionOutcome> {
    try {
      const report = await correctInterviewReport(this.#db, {
        reportId,
        userId,
        newId: uuidv7,
        ...(input.interviewedOn === undefined ? {} : { interviewedOn: input.interviewedOn }),
        ...(input.stages === undefined ? {} : { stages: input.stages }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      });

      return report === undefined ? { kind: 'not-found' } : { kind: 'corrected', report };
    } catch (error) {
      if (error instanceof InterviewReportInvariantError) {
        return { kind: 'refused', reason: error.message };
      }
      throw error;
    }
  }

  /**
   * Withdraw one's own report.
   *
   * The attribution goes and the count stays (ADR-0032 part 4). The surface has already said so
   * before the report was made; this is where that promise is kept.
   */
  withdraw(userId: string, reportId: string): Promise<boolean> {
    return withdrawInterviewReport(this.#db, { reportId, userId });
  }
}
