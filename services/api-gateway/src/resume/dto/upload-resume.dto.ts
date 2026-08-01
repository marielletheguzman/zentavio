/**
 * The upload request, validated before it reaches a service method.
 *
 * `.claude/skills/backend-service/SKILL.md`: unvalidated input entering a use case is a defect. This
 * is also the first line of the threat model — `docs/features/resume-parsing.md` calls a crafted
 * document a threat, so type and size are rejected here, before any parser sees the bytes.
 */

import { IsIn, IsOptional, IsUUID } from 'class-validator';

/**
 * The formats the parser reads (ADR-0016).
 *
 * An allow-list rather than a deny-list. A deny-list on file types is a promise to have thought of
 * every dangerous format, which nobody can keep.
 */
export const ACCEPTED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const;

/**
 * 5 MB, matching the parser's own cap.
 *
 * Enforced in both places on purpose: the gateway rejects early so a large upload never crosses the
 * internal network, and the parser keeps its own limit because a service that trusts its caller's
 * limits has none.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export class UploadResumeDto {
  /**
   * Whose profile this becomes.
   *
   * Explicit until authentication exists (decided 2026-08-01: M1a runs against a seeded test user).
   * **This is exactly why M1a is not deployable** — a caller can name any user. When auth lands,
   * this field is removed and the subject comes from the token, never from the body.
   */
  @IsUUID()
  userId!: string;

  /** Optional override for the track this profile targets. */
  @IsOptional()
  @IsUUID()
  careerId?: string;

  @IsOptional()
  @IsIn(ACCEPTED_CONTENT_TYPES)
  contentType?: (typeof ACCEPTED_CONTENT_TYPES)[number];
}
