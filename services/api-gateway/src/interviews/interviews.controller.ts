/**
 * HTTP only — no logic (`.claude/skills/backend-service/SKILL.md`).
 *
 * Four routes, and the shape worth reading is what happens when a report is not yours: **404, the
 * same as one that does not exist**. Describing an employer's interview process is not something to
 * be traceable for, so no route here distinguishes "somebody else's" from "no such thing".
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Subject } from '@zentavio/auth';

import { CurrentSubject } from '../auth/current-subject.decorator.ts';
import { InterviewsService } from './interviews.service.ts';
import { CorrectReportDto, RecordReportDto } from './dto/record-report.dto.ts';

@Controller('v1')
export class InterviewsController {
  readonly #service: InterviewsService;

  constructor(service: InterviewsService) {
    this.#service = service;
  }

  /**
   * What may be said about a pairing.
   *
   * Returns a described process **or** a shortfall carrying the count and what is still needed. The
   * shortfall is an answer, not an error, so it is a 200 — a 404 here would tell somebody the
   * company does not exist when what is missing is reports about it.
   */
  @Get('interview-process')
  @HttpCode(HttpStatus.OK)
  async process(
    @Query('company') companyId: string,
    @Query('roleFamily') roleFamily: string,
    @Query('asOf') asOf: string,
  ) {
    return this.#service.process(companyId, roleFamily, asOf);
  }

  /** Who can be reported on. Names only — nothing here says anything about anybody's interview. */
  @Get('companies')
  @HttpCode(HttpStatus.OK)
  async companies() {
    return { companies: await this.#service.companies() };
  }

  @Get('interview-reports')
  @HttpCode(HttpStatus.OK)
  async mine(@CurrentSubject() subject: Subject) {
    return { reports: await this.#service.mine(subject.userId) };
  }

  @Post('interview-reports')
  @HttpCode(HttpStatus.OK)
  async contribute(@CurrentSubject() subject: Subject, @Body() body: RecordReportDto) {
    const outcome = await this.#service.contribute(subject.userId, {
      companyId: body.companyId,
      roleFamily: body.roleFamily,
      interviewedOn: body.interviewedOn,
      stages: body.stages,
      notes: body.notes ?? null,
    });

    if (outcome.kind === 'refused') throw new UnprocessableEntityException(outcome.reason);
    return outcome;
  }

  @Patch('interview-reports/:id')
  @HttpCode(HttpStatus.OK)
  async correct(
    @CurrentSubject() subject: Subject,
    @Param('id') reportId: string,
    @Body() body: CorrectReportDto,
  ) {
    const outcome = await this.#service.correct(subject.userId, reportId, {
      ...(body.interviewedOn === undefined ? {} : { interviewedOn: body.interviewedOn }),
      ...(body.stages === undefined ? {} : { stages: body.stages }),
      ...(body.notes === undefined ? {} : { notes: body.notes }),
    });

    if (outcome.kind === 'not-found') throw new NotFoundException('no such report');
    if (outcome.kind === 'refused') throw new UnprocessableEntityException(outcome.reason);
    return outcome;
  }

  /**
   * Withdraw a report.
   *
   * **The count stays and the attribution goes** (ADR-0032 part 4), which the contribution form has
   * already said before the report was made. This is where that promise is kept.
   */
  @Post('interview-reports/:id/withdrawal')
  @HttpCode(HttpStatus.OK)
  async withdraw(@CurrentSubject() subject: Subject, @Param('id') reportId: string) {
    const withdrawn = await this.#service.withdraw(subject.userId, reportId);
    if (!withdrawn) throw new NotFoundException('no such report');

    return {
      kind: 'withdrawn' as const,
      // Restated in the response, because this is the moment somebody finds out whether we meant it.
      note: 'Your name is no longer attached to this report. It still counts toward what this company’s process looks like, as the form said before you contributed.',
    };
  }
}
