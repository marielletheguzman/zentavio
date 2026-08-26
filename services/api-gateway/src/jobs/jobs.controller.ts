/**
 * HTTP only — no logic (`.claude/skills/backend-service/SKILL.md`).
 *
 * The listing is scoped to the subject from the guard, because Skill Fit is *about a person*: the
 * same posting carries a different score for two people, and a route that took a `userId` from the
 * query would serve one person's readiness to another.
 */

import { Controller, Get, Query } from '@nestjs/common';
import type { Subject } from '@zentavio/auth';
import type { JobPostingWire } from '@zentavio/types';

import { CurrentSubject } from '../auth/current-subject.decorator.ts';
import { ListJobsDto } from './dto/list-jobs.dto.ts';
import { JobsService } from './jobs.service.ts';

/** A page nobody asked to size. Bounded so an unfiltered listing cannot ask for the whole corpus. */
const DEFAULT_LIMIT = 25;

@Controller('jobs')
export class JobsController {
  readonly #jobs: JobsService;

  constructor(jobs: JobsService) {
    this.#jobs = jobs;
  }

  @Get()
  async list(
    @CurrentSubject() subject: Subject,
    @Query() query: ListJobsDto,
  ): Promise<{ readonly jobs: readonly JobPostingWire[] }> {
    const jobs = await this.#jobs.list(subject.userId, {
      ...(query.country === undefined ? {} : { countryCode: query.country }),
      ...(query.remote === undefined ? {} : { isRemote: query.remote }),
      ...(query.statedSponsorshipOnly === undefined
        ? {}
        : { statedSponsorshipOnly: query.statedSponsorshipOnly }),
      limit: query.limit ?? DEFAULT_LIMIT,
    });

    return { jobs };
  }
}
