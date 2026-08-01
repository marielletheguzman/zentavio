/**
 * A user disagreeing with one extracted skill.
 *
 * **Keyed by slug, not by skill id.** The browser has no business holding database UUIDs, and the
 * closed set is the server's concern — the same reason the parser is given slugs rather than asked
 * to invent them. The service resolves the slug, so an unknown one is a 400 rather than a foreign
 * key violation.
 */

import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export const PROFILE_SKILL_STATUSES = ['evidenced', 'claimed'] as const;
export const EVIDENCE_KINDS = ['role', 'project', 'certification', 'assessment', 'artifact'] as const;

export class CorrectSkillDto {
  /** **No `userId`.** The subject comes from the guard, never the body — see ADR-0017. */

  /** Kebab-case, matching `skills.slug`. Validated in shape here, in existence by the service. */
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be kebab-case' })
  slug!: string;

  @IsIn(PROFILE_SKILL_STATUSES)
  status!: (typeof PROFILE_SKILL_STATUSES)[number];

  /**
   * Required by the schema when `status` is `evidenced`, and defaulted by the repository when the
   * user does not say which kind — a person correcting a skill should not have to pick from an
   * ontology to be heard.
   */
  @IsOptional()
  @IsIn(EVIDENCE_KINDS)
  evidenceKind?: (typeof EVIDENCE_KINDS)[number];
}
