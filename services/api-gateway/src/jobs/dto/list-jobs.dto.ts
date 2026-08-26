/**
 * Query parameters for the discovery listing.
 *
 * **`statedSponsorshipOnly` is the honest filter, and it is opt-in.**
 * `docs/features/migration-friendly-jobs.md` splits "only show jobs with sponsorship" into two
 * controls on purpose: hiding postings that state *no* sponsorship is safe and small, while showing
 * only those that state it is honest and hides most of the market. This is the second one, and the
 * surface is required to say so rather than presenting it as a neutral toggle.
 *
 * There is deliberately **no `sponsorship=unknown` exclusion**. `unknown` is not `no`, and a filter
 * that drops it would silently discard almost every posting on the corpus that exists.
 */

import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

/** `'true'` / `'false'` in a query string, or absent. Absent must not become `false`. */
function optionalBoolean({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value === 'true' || value === true;
}

export class ListJobsDto {
  /** **No `userId`.** The subject comes from the guard, never the query — ADR-0017. */

  /** ISO-3166-1 alpha-2, as `job_postings.country_code` stores it. */
  @IsOptional()
  @IsString()
  @Length(2, 2, { message: 'country must be an ISO-3166-1 alpha-2 code' })
  @Matches(/^[A-Z]{2}$/, { message: 'country must be uppercase, as stored' })
  readonly country?: string;

  /**
   * Filters on what a source *stated*. Absent asks for both, which is not the same as asking for
   * `is_remote = false` — a silent source is not an on-site job (ADR-0033).
   */
  @IsOptional()
  @Transform(optionalBoolean)
  @IsBoolean()
  readonly remote?: boolean;

  /** Opt-in, and it hides most of the market. See the note above. */
  @IsOptional()
  @Transform(optionalBoolean)
  @IsBoolean()
  readonly statedSponsorshipOnly?: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit?: number;
}
