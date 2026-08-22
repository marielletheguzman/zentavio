/**
 * HTTP only — no logic (`.claude/skills/backend-service/SKILL.md`).
 *
 * Two routes, and the interesting thing is what the write does not return: no score, no status, no
 * readiness. Recording a completion changes nothing about what the platform thinks you can do.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UnprocessableEntityException } from '@nestjs/common';
import type { Subject } from '@zentavio/auth';

import { CurrentSubject } from '../auth/current-subject.decorator.ts';
import { LearningService } from './learning.service.ts';
import { RecordCompletionDto } from './dto/record-completion.dto.ts';

@Controller('v1')
export class LearningController {
  readonly #service: LearningService;

  constructor(service: LearningService) {
    this.#service = service;
  }

  @Get('learning-resources')
  @HttpCode(HttpStatus.OK)
  async catalogue(@CurrentSubject() subject: Subject, @Query('skill') skillSlug: string) {
    return { resources: await this.#service.catalogue(subject.userId, skillSlug) };
  }

  @Post('learning-completions')
  @HttpCode(HttpStatus.OK)
  async record(@CurrentSubject() subject: Subject, @Body() body: RecordCompletionDto) {
    const outcome = await this.#service.record(subject.userId, {
      resourceId: body.resourceId,
      completedAt: body.completedAt,
    });

    if (outcome.kind === 'refused') throw new UnprocessableEntityException(outcome.reason);
    return outcome;
  }
}
