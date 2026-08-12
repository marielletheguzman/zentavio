/**
 * HTTP only — no logic (`.claude/skills/backend-service/SKILL.md`).
 *
 * The refusals mirror `/v1/eligibility` exactly, and for the same reasons: `asOf` is **required**,
 * because a comparison without a stated date is unreproducible, and a missing readiness is an
 * **answer** rather than an error — the person has not chosen a track or has no profile, and
 * neither is fixed by retrying.
 *
 * A 503 means one destination could not be evaluated. That is deliberate: rendering the other four
 * would present a partial comparison as a complete one.
 */

import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Subject } from '@zentavio/auth';

import { ComparisonService } from './comparison.service.ts';
import { CurrentSubject } from '../auth/current-subject.decorator.ts';

/** `YYYY-MM-DD`, and a real date — `2026-02-31` parses in JS and is not a day. */
function parseIsoDate(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const at = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime())) return null;
  return at.toISOString().slice(0, 10) === raw ? raw : null;
}

@Controller('v1')
export class ComparisonController {
  readonly #service: ComparisonService;

  constructor(service: ComparisonService) {
    this.#service = service;
  }

  @Get('comparison')
  @HttpCode(HttpStatus.OK)
  async comparison(
    @CurrentSubject() subject: Subject,
    @Query('asOf') asOf?: string,
  ): Promise<unknown> {
    if (asOf === undefined || asOf === '') {
      throw new BadRequestException(
        'asOf is required, as YYYY-MM-DD. A comparison without a date is not reproducible.',
      );
    }

    const date = parseIsoDate(asOf);
    if (date === null) throw new BadRequestException('asOf must be a real date, as YYYY-MM-DD');

    const outcome = await this.#service.compare(subject.userId, date);

    if (outcome.kind === 'unavailable') {
      throw new ServiceUnavailableException(
        'The comparison cannot be built right now. A partial comparison would be worse than none.',
      );
    }

    // 200, because it is an answer. The surface has a sentence for each reason and neither is a
    // retry.
    if (outcome.kind === 'no-employability') {
      return { status: 'no-employability', reason: outcome.reason };
    }

    return outcome.comparison;
  }
}
