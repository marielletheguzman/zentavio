/**
 * The career a person says they are pursuing.
 *
 * **Keyed by slug, not by career id**, for the same reason as the correction route: the browser has
 * no business holding database UUIDs, and an unknown slug becomes a named 400 rather than a foreign
 * key violation surfacing as a 500.
 */

import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class ChooseTargetDto {
  /** **No `userId`.** The subject comes from the guard, never the body — ADR-0017. */

  /** Kebab-case, matching `careers.slug`. Shape validated here, existence by the service. */
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be kebab-case' })
  slug!: string;

  /**
   * ISO 3166-1 alpha-2, or omitted for the global requirement set.
   *
   * This is what decides whether German appears in the gap. Not a display preference — a different
   * market is a different set of requirements (`docs/database/entities/skill.md`).
   */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'market must be an ISO 3166-1 alpha-2 code' })
  market?: string;
}
