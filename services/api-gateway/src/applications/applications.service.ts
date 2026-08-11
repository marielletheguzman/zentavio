/**
 * Recording an attempt, and what came of it.
 *
 * **The interesting work is the prediction capture, not the orchestration.** ADR-0019's whole
 * argument is that calibration data cannot be backfilled: a score is only checkable against a
 * result if it was written down at the moment it was shown. So recording an application computes
 * the person's readiness *now* and stores it on the row — not later, when the outcome arrives and
 * the score would already have moved.
 *
 * **A missing prediction is recorded as missing.** Someone with no profile or no chosen track has
 * no readiness score, and storing a zero for them would put a number nobody predicted into the
 * table that exists to check numbers. `ck_applications__predicted` refuses a score with no scorer
 * for the same reason.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  UnknownApplicationError,
  applicationOutcomes,
  recordApplication,
  recordOutcome,
  userApplications,
  type ApplicationRow,
  type Database,
  type OutcomeRow,
  type PredictionAtApply,
} from '@zentavio/db';
import type { Kysely } from 'kysely';

import { DATABASE } from '../tokens.ts';
import { GapService } from '../gap/gap.service.ts';

export interface RecordApplicationInput {
  readonly externalRole: string;
  readonly countryCode?: string | null;
  readonly requiredSponsorship?: boolean;
}

export interface RecordOutcomeInput {
  readonly applicationId: string;
  readonly kind: OutcomeRow['kind'];
  readonly occurredAt?: Date;
  readonly source?: OutcomeRow['source'];
  readonly confidence?: 'high' | 'medium' | 'low';
}

export type RecordOutcomeResult =
  | { readonly kind: 'recorded'; readonly outcome: OutcomeRow }
  | { readonly kind: 'unknown-application' };

/** One application with the timeline recorded against it. */
export interface ApplicationWithOutcomes {
  readonly application: ApplicationRow;
  readonly outcomes: readonly OutcomeRow[];
}

@Injectable()
export class ApplicationsService {
  readonly #db: Kysely<Database>;
  readonly #gap: GapService;
  readonly #logger = new Logger(ApplicationsService.name);

  constructor(@Inject(DATABASE) db: Kysely<Database>, gap: GapService) {
    this.#db = db;
    this.#gap = gap;
  }

  async record(userId: string, input: RecordApplicationInput): Promise<ApplicationRow> {
    return recordApplication(this.#db, {
      userId,
      externalRole: input.externalRole,
      countryCode: input.countryCode ?? null,
      requiredSponsorship: input.requiredSponsorship ?? false,
      prediction: await this.#predictionNow(userId),
      // Recorded outside Zentavio: there is no posting row and no match. That is the honest
      // source value, and it is what distinguishes this data from anything M4 will produce.
      source: 'user-recorded',
    });
  }

  async list(userId: string): Promise<readonly ApplicationWithOutcomes[]> {
    const applications = await userApplications(this.#db, userId);

    return Promise.all(
      applications.map(async (application) => ({
        application,
        outcomes: await applicationOutcomes(this.#db, application.id),
      })),
    );
  }

  async recordOutcome(userId: string, input: RecordOutcomeInput): Promise<RecordOutcomeResult> {
    try {
      const outcome = await recordOutcome(this.#db, {
        userId,
        applicationId: input.applicationId,
        kind: input.kind,
        ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
      });

      return { kind: 'recorded', outcome };
    } catch (error) {
      // Not found *or* not theirs — the same answer to both, so the route cannot be used to
      // discover that somebody else's application exists.
      if (error instanceof UnknownApplicationError) return { kind: 'unknown-application' };
      throw error;
    }
  }

  /**
   * What this product currently predicts about this person, if anything.
   *
   * Readiness, because it is the only score shown before an application exists — match scores are
   * M4, and the application row will say which kind it stored when they do.
   *
   * **Every failure here is `null`, never a thrown error.** A person recording what they did must
   * not be blocked because the scoring service is down; the honest consequence is an application
   * with no prediction attached, which is a row that cannot calibrate rather than a row that
   * calibrates wrongly.
   */
  async #predictionNow(userId: string): Promise<PredictionAtApply | null> {
    const outcome = await this.#gap.currentGap(userId);

    if (outcome.kind !== 'computed') {
      this.#logger.log(`no prediction to record for this application: ${outcome.kind}`);
      return null;
    }

    const { readiness, scorer_version: scorerVersion, knowledge_as_of: knowledgeAsOf } = outcome.gap;
    if (readiness.status !== 'ok' || readiness.score === null) return null;

    return {
      score: readiness.score,
      scorerVersion,
      knowledgeAsOf: knowledgeAsOf === null ? null : new Date(knowledgeAsOf),
    };
  }
}
