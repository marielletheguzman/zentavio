/**
 * HTTP only — no logic (`.claude/skills/backend-service/SKILL.md`).
 *
 * Two writes and a read, and the mapping worth reading is what the response *omits*. An
 * application row carries `predicted_score` and `scorer_version`; the wire shape carries them too,
 * because a person is entitled to see what we predicted about them before they applied. It does
 * **not** carry another user's anything: every query is scoped to the subject from the guard.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { Subject } from '@zentavio/auth';
import type { ApplicationRow, OutcomeRow } from '@zentavio/db';
import type { ApplicationWire, OutcomeWire } from '@zentavio/types';

import { CurrentSubject } from '../auth/current-subject.decorator.ts';
import { ApplicationsService } from './applications.service.ts';
import { RecordApplicationDto } from './dto/record-application.dto.ts';
import { RecordOutcomeDto } from './dto/record-outcome.dto.ts';

/**
 * `numeric(5,4)` arrives from pg as a **string**. Converted once, here, so no surface has to know
 * that — the same rule the gap route follows for its weights.
 */
function score(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A `timestamptz` as an instant. Null stays null — an absent date is not "now". */
function instant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? null : String(value);
}

function toOutcomeWire(row: OutcomeRow): OutcomeWire {
  return {
    id: row.id,
    kind: row.kind,
    occurredAt: instant(row.occurred_at) ?? '',
    source: row.source,
    confidence: row.confidence,
    elapsedDays: row.elapsed_days,
    // What we had said before this happened. The pairing is the reason the row exists, and showing
    // it is what makes our own score falsifiable to the person it was about.
    predictedScore: score(row.predicted_score),
    predictedKind: row.predicted_kind,
    scorerVersion: row.scorer_version,
  };
}

function toApplicationWire(row: ApplicationRow, outcomes: readonly OutcomeRow[]): ApplicationWire {
  return {
    id: row.id,
    externalRole: row.external_role,
    status: row.status,
    appliedAt: instant(row.applied_at),
    closedAt: instant(row.closed_at),
    countryCode: row.country_code,
    requiredSponsorship: row.required_sponsorship,
    predictedScore: score(row.predicted_score),
    scorerVersion: row.scorer_version,
    outcomes: outcomes.map(toOutcomeWire),
  };
}

@Controller('v1')
export class ApplicationsController {
  readonly #service: ApplicationsService;

  constructor(service: ApplicationsService) {
    this.#service = service;
  }

  /**
   * Record an application.
   *
   * **200, not 201.** The client's next action is to render the row it got back, and this product
   * has no URL for a single application to point a `Location` header at.
   */
  @Post('applications')
  @HttpCode(HttpStatus.OK)
  async record(
    @CurrentSubject() subject: Subject,
    @Body() body: RecordApplicationDto,
  ): Promise<ApplicationWire> {
    const row = await this.#service.record(subject.userId, {
      externalRole: body.externalRole,
      countryCode: body.countryCode ?? null,
      requiredSponsorship: body.requiredSponsorship ?? false,
    });

    return toApplicationWire(row, []);
  }

  @Get('applications')
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentSubject() subject: Subject,
  ): Promise<{ readonly applications: readonly ApplicationWire[] }> {
    const rows = await this.#service.list(subject.userId);

    return {
      applications: rows.map((row) => toApplicationWire(row.application, row.outcomes)),
    };
  }

  /**
   * Record what happened.
   *
   * **Append-only**: there is no route to edit or delete an outcome, and that is deliberate. A
   * correction is another row, because what we believed at the time is itself the data.
   */
  @Post('applications/:id/outcomes')
  @HttpCode(HttpStatus.OK)
  async recordOutcome(
    @CurrentSubject() subject: Subject,
    @Param('id') applicationId: string,
    @Body() body: RecordOutcomeDto,
  ): Promise<OutcomeWire> {
    const outcome = await this.#service.recordOutcome(subject.userId, {
      applicationId,
      kind: body.kind,
      ...(body.occurredAt === undefined ? {} : { occurredAt: new Date(body.occurredAt) }),
      ...(body.source === undefined ? {} : { source: body.source }),
      ...(body.confidence === undefined ? {} : { confidence: body.confidence }),
    });

    if (outcome.kind === 'unknown-application') {
      // The same answer whether it does not exist or belongs to somebody else, so this route
      // cannot be used to discover that another person's application exists.
      throw new NotFoundException('No such application.');
    }

    return toOutcomeWire(outcome.outcome);
  }
}
