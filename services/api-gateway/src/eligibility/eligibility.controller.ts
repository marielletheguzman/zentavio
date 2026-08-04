/**
 * HTTP only — no logic (`.claude/skills/backend-service/SKILL.md`).
 *
 * The mapping is the part worth reading, and it mirrors the evaluator's own contract: **every
 * eligibility outcome is a 200**, `unknown` included. "Nobody has modelled this pathway" and "this
 * profession is licence-gated and we have no recognition rule" are answers a person must be shown.
 * Only an unreachable evaluator is a 503.
 *
 * `as_of` is **required**. A verdict without a stated evaluation date is unreproducible, so a
 * missing one is a 400 here rather than a silent "today" — the same refusal the evaluator makes,
 * enforced at the edge so the round trip is not wasted.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Subject } from '@zentavio/auth';
import { UnknownFactKindError, recordFact, type Database } from '@zentavio/db';
import { Inject } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { CurrentSubject } from '../auth/current-subject.decorator.ts';
import { DATABASE } from '../tokens.ts';
import { RecordFactDto } from './dto/record-fact.dto.ts';
import { EligibilityService } from './eligibility.service.ts';

/** `YYYY-MM-DD`, and a real date — `2026-02-31` parses in JS and is not a day. */
function parseIsoDate(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const at = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime())) return null;
  return at.toISOString().slice(0, 10) === raw ? raw : null;
}

@Controller('v1')
export class EligibilityController {
  readonly #service: EligibilityService;
  readonly #db: Kysely<Database>;

  constructor(service: EligibilityService, @Inject(DATABASE) db: Kysely<Database>) {
    this.#service = service;
    this.#db = db;
  }

  @Get('eligibility')
  @HttpCode(HttpStatus.OK)
  async eligibility(
    @CurrentSubject() subject: Subject,
    @Query('pathway') pathway?: string,
    @Query('asOf') asOf?: string,
  ): Promise<unknown> {
    if (pathway === undefined || pathway === '') {
      throw new BadRequestException('pathway is required, e.g. ?pathway=de.eu-blue-card');
    }

    if (asOf === undefined || asOf === '') {
      // Deliberately not defaulted to today. A verdict must state the date its rules were read
      // as of, or it cannot be reproduced or explained later.
      throw new BadRequestException('asOf is required, as YYYY-MM-DD. A verdict without a date is not reproducible.');
    }

    const date = parseIsoDate(asOf);
    if (date === null) throw new BadRequestException('asOf must be a real date, as YYYY-MM-DD');

    const outcome = await this.#service.evaluate(subject.userId, pathway, date);

    if (outcome.kind === 'unavailable') {
      throw new ServiceUnavailableException(
        'Eligibility cannot be evaluated right now. No answer is better than a wrong one here.',
      );
    }

    return outcome.verdict;
  }

  /**
   * Answer something `needsFromUser` asked for.
   *
   * A correction is a **new version**, never an edit — the repository enforces that. The response
   * reports the version so a client can tell a first answer from a correction.
   */
  @Post('person-facts')
  @HttpCode(HttpStatus.OK)
  async recordFact(
    @CurrentSubject() subject: Subject,
    @Body() body: RecordFactDto,
  ): Promise<{ readonly key: string; readonly version: number }> {
    try {
      // Spread rather than assigned: `exactOptionalPropertyTypes` distinguishes "absent" from
      // "present and undefined", and the repository's defaults only apply to the former.
      const row = await recordFact(this.#db, {
        userId: subject.userId,
        key: body.key,
        value: body.value,
        ...(body.basis === undefined ? {} : { basis: body.basis }),
        ...(body.basisDetail === undefined ? {} : { basisDetail: body.basisDetail }),
      });
      return { key: row.kind_key, version: row.version };
    } catch (error) {
      if (error instanceof UnknownFactKindError) {
        // Names the key. "Bad request" without saying which field is a dead end for whoever is
        // debugging the client.
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
