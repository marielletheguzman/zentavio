/**
 * HTTP only — no logic (`.claude/skills/backend-service/SKILL.md`).
 *
 * Its whole job is translation: multipart in, `UploadOutcome` from the service, HTTP status out. The
 * mapping from outcome to status is the interesting part, and it is the same distinction the parser
 * client makes one layer down — a résumé that could not be read is **200**, because it is a result
 * the user must be shown, not a failure to retry.
 */

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Subject } from '@zentavio/auth';
import { CurrentSubject } from '../auth/current-subject.decorator.ts';
import { CorrectSkillDto } from './dto/correct-skill.dto.ts';
import { ACCEPTED_CONTENT_TYPES, MAX_UPLOAD_BYTES, UploadResumeDto } from './dto/upload-resume.dto.ts';
import { ResumeService } from './resume.service.ts';

/**
 * The two fields of an uploaded file this controller actually uses.
 *
 * Declared here rather than leaning on the ambient `Express.Multer.File` namespace: an interface we
 * own does not depend on a global type augmentation resolving, and it makes the surface obvious —
 * notably that `originalname` is never read, because a filename is user data with no use here.
 */
interface UploadedResumeFile {
  readonly buffer: Buffer;
  readonly mimetype: string;
}

/** Versioned route: `.claude/skills/backend-service/SKILL.md` requires it of every public path. */
@Controller('v1/resume')
export class ResumeController {
  readonly #service: ResumeService;

  constructor(service: ResumeService) {
    this.#service = service;
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      // Enforced by multer before the buffer is fully in memory, so an oversized upload is refused
      // rather than absorbed and then measured.
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(
    @CurrentSubject() subject: Subject,
    @UploadedFile() file: UploadedResumeFile | undefined,
    @Body() dto: UploadResumeDto,
  ): Promise<unknown> {
    if (!file) throw new BadRequestException('A résumé file is required.');

    const contentType = dto.contentType ?? file.mimetype;
    if (!ACCEPTED_CONTENT_TYPES.includes(contentType as (typeof ACCEPTED_CONTENT_TYPES)[number])) {
      // The message names the type and nothing about the file — a filename is user data, and this
      // string reaches a log.
      throw new BadRequestException(`Unsupported file type: ${contentType}. Upload a PDF or a DOCX.`);
    }

    const outcome = await this.#service.upload({
      // From the credential, never the body.
      userId: subject.userId,
      careerId: dto.careerId,
      content: file.buffer,
      contentType,
    });

    switch (outcome.kind) {
      case 'stored':
        return {
          stored: true,
          profileId: outcome.profile.id,
          version: outcome.profile.version,
          parse: outcome.parse,
        };

      case 'not-stored':
        // 200, deliberately. The parse succeeded as an operation and produced an honest `unknown`
        // or an empty result; the user needs the reason, not an error page.
        return { stored: false, parse: outcome.parse };

      case 'rejected':
        throw new BadRequestException(outcome.message);

      case 'unavailable':
        // 503 maps to UPSTREAM_UNAVAILABLE with `retryable: true` in the envelope filter, which is
        // what tells the client this one is worth trying again.
        throw new ServiceUnavailableException('The résumé parser is unavailable. Try again shortly.');
    }
  }

  /**
   * Record a user's disagreement with one extracted skill.
   *
   * **This is the half of M1a that is not optional** — "a profile a user cannot fix is a profile
   * they will not trust" (`docs/roadmap/milestones.md`). The route existed nowhere until an
   * end-to-end run made the omission obvious: every layer beneath it worked, and no user could
   * reach any of it.
   *
   * Returns the **new version number**, because the repository writes a new profile version rather
   * than editing the current one — the caller was looking at v1 and is now looking at v2.
   */
  @Post('corrections')
  @HttpCode(HttpStatus.OK)
  async correct(
    @CurrentSubject() subject: Subject,
    @Body() dto: CorrectSkillDto,
  ): Promise<unknown> {
    const outcome = await this.#service.correct({
      userId: subject.userId,
      slug: dto.slug,
      status: dto.status,
      ...(dto.evidenceKind ? { evidenceKind: dto.evidenceKind } : {}),
    });

    switch (outcome.kind) {
      case 'corrected':
        return { version: outcome.version, skills: outcome.skills };

      case 'no-profile':
        throw new NotFoundException('There is no profile to correct yet. Upload a résumé first.');

      case 'unknown-skill':
        // Named rather than generic: the user picked from a list we supplied, so an unknown slug
        // means our list and our registry disagree — worth saying out loud.
        throw new BadRequestException(`Unknown skill: ${outcome.slug}`);
    }
  }
}
