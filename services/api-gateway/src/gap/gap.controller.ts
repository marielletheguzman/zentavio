/**
 * HTTP only — no logic (`.claude/skills/backend-service/SKILL.md`).
 *
 * The whole job is translating a `GapOutcomeForUser` into a status, and that mapping is the part
 * worth reading. Three of the four outcomes are **200**, because "you have not chosen a target",
 * "you have no profile yet", and a computed gap are all results a person must be shown rather than
 * failures to retry. Only an unreachable gap service is a 503.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Post, ServiceUnavailableException } from '@nestjs/common';
import type { Subject } from '@zentavio/auth';
import { CurrentSubject } from '../auth/current-subject.decorator.ts';
import { ChooseTargetDto } from './dto/choose-target.dto.ts';
import { GapService } from './gap.service.ts';

/** Versioned route, as every public path must be. */
@Controller('v1')
export class GapController {
  readonly #service: GapService;

  constructor(service: GapService) {
    this.#service = service;
  }

  @Post('targets')
  @HttpCode(HttpStatus.OK)
  async chooseTarget(
    @CurrentSubject() subject: Subject,
    @Body() body: ChooseTargetDto,
  ): Promise<{ readonly slug: string; readonly rank: number; readonly market: string | null }> {
    const outcome = await this.#service.chooseTarget(
      subject.userId,
      body.slug,
      body.market ?? null,
    );

    if (outcome.kind === 'unknown-career') {
      // Names the slug, because "not found" without saying what was not found is a dead end for
      // whoever is debugging the client.
      throw new NotFoundException(`Unknown career: ${outcome.slug}`);
    }

    return { slug: outcome.careerSlug, rank: outcome.rank, market: body.market ?? null };
  }

  @Get('gap')
  @HttpCode(HttpStatus.OK)
  async currentGap(@CurrentSubject() subject: Subject): Promise<unknown> {
    const outcome = await this.#service.currentGap(subject.userId);

    switch (outcome.kind) {
      case 'computed':
        return { status: 'gap', gap: outcome.gap };

      case 'no-target':
        // Not a 404: the person exists and so does the feature. They have not answered the
        // question yet, and the answer is a prompt to choose, not an error page.
        return {
          status: 'no-target',
          reason: 'Choose a career track to compare your profile against.',
        };

      case 'no-profile':
        return {
          status: 'no-profile',
          reason:
            'Upload a résumé first. Without a profile every requirement reads as missing, which is true and not useful.',
        };

      case 'unavailable':
        throw new ServiceUnavailableException(
          `The gap could not be computed right now (${outcome.reason}). Try again shortly.`,
        );
    }
  }
}
