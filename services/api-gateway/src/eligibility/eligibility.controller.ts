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
import {
  InvalidFactValueError,
  UnknownFactKindError,
  factKinds,
  recordFact,
  type Database,
} from '@zentavio/db';
import type { PersonFactKindWire, PersonFactValueType } from '@zentavio/types';
import { Inject } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { CurrentSubject } from '../auth/current-subject.decorator.ts';
import { DATABASE } from '../tokens.ts';
import { RecordFactDto } from './dto/record-fact.dto.ts';
import { EligibilityService } from './eligibility.service.ts';
import { GapService } from '../gap/gap.service.ts';

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
  readonly #gap: GapService;
  readonly #db: Kysely<Database>;

  constructor(
    service: EligibilityService,
    gap: GapService,
    @Inject(DATABASE) db: Kysely<Database>,
  ) {
    this.#service = service;
    this.#gap = gap;
    this.#db = db;
  }

  @Get('eligibility')
  @HttpCode(HttpStatus.OK)
  async eligibility(
    @CurrentSubject() subject: Subject,
    @Query('pathway') pathway?: string,
    @Query('asOf') asOf?: string,
  ): Promise<unknown> {
    // `asOf` is deliberately not defaulted to today: a verdict must state the date its rules were
    // read as of, or it cannot be reproduced or explained later.
    const date = this.#requireInputs(pathway, asOf);

    const outcome = await this.#service.evaluate(subject.userId, pathway ?? '', date);

    if (outcome.kind === 'unavailable') {
      throw new ServiceUnavailableException(
        'Eligibility cannot be evaluated right now. No answer is better than a wrong one here.',
      );
    }

    return outcome.verdict;
  }

  /**
   * Viability — both axes, with the binding constraint named (ADR-0022).
   *
   * **No composite score is returned**, here or anywhere. The response is a pair plus the name of
   * whichever axis currently stops this being a pathway worth pursuing.
   */
  @Get('viability')
  @HttpCode(HttpStatus.OK)
  async viability(
    @CurrentSubject() subject: Subject,
    @Query('pathway') pathway?: string,
    @Query('asOf') asOf?: string,
  ): Promise<unknown> {
    const date = this.#requireInputs(pathway, asOf);

    const gap = await this.#gap.currentGap(subject.userId);
    if (gap.kind !== 'computed') {
      // Answering from eligibility alone here would produce exactly the bare `met` ADR-0022 exists
      // to stop, so the missing half is reported rather than papered over. Not a 503: the person
      // has not chosen a track or has no profile, which are answers they can act on.
      return { status: 'no-employability', reason: gap.kind };
    }

    const outcome = await this.#service.viability(subject.userId, pathway ?? '', date, gap.gap);

    if (outcome.kind === 'unavailable') {
      throw new ServiceUnavailableException(
        'Viability cannot be assessed right now. No answer is better than a wrong one here.',
      );
    }

    return outcome.viability;
  }

  /** Shared by both read routes, so they cannot drift on what they require. */
  #requireInputs(pathway?: string, asOf?: string): string {
    if (pathway === undefined || pathway === '') {
      throw new BadRequestException('pathway is required, e.g. ?pathway=de.eu-blue-card');
    }

    if (asOf === undefined || asOf === '') {
      throw new BadRequestException(
        'asOf is required, as YYYY-MM-DD. A verdict without a date is not reproducible.',
      );
    }

    const date = parseIsoDate(asOf);
    if (date === null) throw new BadRequestException('asOf must be a real date, as YYYY-MM-DD');
    return date;
  }

  /**
   * The catalogue of questions the product can accept an answer to.
   *
   * **A surface renders from this, never from its own copy.** The eligibility panel used to carry
   * a local map of prompts and units, which knew about one of the six kinds — so every question
   * added since rendered as its raw key in a free-text box, and a boolean answered "no" was stored
   * as the string `'no'`. The catalogue already held the type; nothing was reading it.
   *
   * `rationale` is served with the prompt on purpose: asking for a salary without saying which
   * rule needs it reads as data collection.
   */
  @Get('person-fact-kinds')
  @HttpCode(HttpStatus.OK)
  async factKinds(): Promise<{ readonly kinds: readonly PersonFactKindWire[] }> {
    const rows = await factKinds(this.#db);

    return {
      kinds: rows.map((row) => ({
        key: row.key,
        valueType: row.value_type as PersonFactValueType,
        unit: row.unit,
        prompt: row.prompt,
        rationale: row.rationale,
        // Carried so a surface can treat an answer with the care it deserves. Not a secret — it is
        // a property of the question, not of anybody's answer.
        sensitive: row.sensitive,
        allowedValues: row.allowed_values,
      })),
    };
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
      // Both name the key. "Bad request" without saying which field is a dead end for whoever is
      // debugging the client — and this route is reachable from a browser console, so the client
      // that sent it may not be ours at all.
      if (error instanceof UnknownFactKindError) throw new BadRequestException(error.message);

      // A value in the wrong shape is refused here rather than stored and interpreted later. The
      // string 'no' stored against a boolean kind read as `true` downstream and told somebody they
      // held a degree they had said they did not.
      if (error instanceof InvalidFactValueError) throw new BadRequestException(error.message);

      throw error;
    }
  }
}
