/**
 * An application the person made, recorded after the fact.
 *
 * **No prediction on the body.** What was predicted is computed server-side at the moment of
 * recording (ADR-0019) — a client-supplied score would be a claim about what we said, made by
 * something that was not us.
 */

import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class RecordApplicationDto {
  /** **No `userId`.** The subject comes from the guard, never the body — ADR-0017. */

  /**
   * The role as the person describes it.
   *
   * Free text, and the only free text this path accepts — `ck_applications__identifies_role`
   * requires either a posting id or this, because an application to nothing in particular cannot
   * be calibrated against anything. It stays on `applications`; **`outcomes` has no free-text
   * column and never gains one.**
   */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  externalRole!: string;

  /** ISO 3166-1 alpha-2. Where the job is, which is what makes an outcome a relocation signal. */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be an ISO 3166-1 alpha-2 code' })
  countryCode?: string;

  /** Whether this application needed a visa. The distinction the product exists to serve. */
  @IsOptional()
  @IsBoolean()
  requiredSponsorship?: boolean;
}
