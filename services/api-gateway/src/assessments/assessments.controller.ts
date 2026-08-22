/**
 * HTTP only — no logic (`.claude/skills/backend-service/SKILL.md`).
 *
 * The mapping worth reading is what these responses carry that a simpler design would omit: every
 * one of them includes `doesNotEvidence`. It is on the list before you start, on the result when
 * you pass, and on the result when you fail — because a limit shown only in the small print of a
 * success is a limit nobody reads (ADR-0030 part 2).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type { Subject } from '@zentavio/auth';

import { CurrentSubject } from '../auth/current-subject.decorator.ts';
import { AssessmentsService } from './assessments.service.ts';
import { GradeAttemptDto } from './dto/grade-attempt.dto.ts';

@Controller('v1')
export class AssessmentsController {
  readonly #service: AssessmentsService;

  constructor(service: AssessmentsService) {
    this.#service = service;
  }

  @Get('assessments')
  @HttpCode(HttpStatus.OK)
  async forSkill(@Query('skill') skillId: string) {
    return { assessments: await this.#service.forSkill(skillId) };
  }

  /** Start an attempt. Returns the questions **without** their answers. */
  @Post('assessments/:id/attempts')
  @HttpCode(HttpStatus.OK)
  async start(@CurrentSubject() subject: Subject, @Param('id') assessmentId: string) {
    const outcome = await this.#service.start(subject.userId, assessmentId);
    if (outcome.kind === 'refused') throw new NotFoundException(outcome.reason);
    return outcome;
  }

  /** Submit answers. The score is computed here from the stored key, never accepted from a client. */
  @Post('attempts/:id/answers')
  @HttpCode(HttpStatus.OK)
  async grade(
    @CurrentSubject() subject: Subject,
    @Param('id') attemptId: string,
    @Body() body: GradeAttemptDto,
  ) {
    const outcome = await this.#service.grade(subject.userId, attemptId, body.answers);
    if (outcome.kind === 'refused') throw new NotFoundException(outcome.reason);
    return outcome;
  }
}
