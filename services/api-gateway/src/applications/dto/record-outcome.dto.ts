/**
 * What happened to an application.
 *
 * The closed set is `ck_outcomes__kind`'s, restated here so an unknown kind is a named 400 rather
 * than a constraint violation surfacing as a 500. **Deliberately no `note` field**: `outcomes` has
 * no free-text column, and adding one would make it the most sensitive and least controllable
 * column in the schema (`docs/database/entities/outcome.md`).
 */

import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export const OUTCOME_KINDS = [
  'applied',
  'screened',
  'interviewed',
  'offered',
  'rejected',
  'withdrawn',
  'accepted',
  'started',
  'relocated',
  'course_completed',
  'assessment_passed',
] as const;

export class RecordOutcomeDto {
  /** **No `userId`.** The subject comes from the guard, never the body — ADR-0017. */

  @IsIn(OUTCOME_KINDS, {
    message: `kind must be one of: ${OUTCOME_KINDS.join(', ')}`,
  })
  kind!: (typeof OUTCOME_KINDS)[number];

  /**
   * When it happened, if not now.
   *
   * Accepted because outcomes are usually recorded after the fact — a rejection remembered on
   * Thursday happened on Monday, and `elapsed_days` is wrong if we record Thursday.
   */
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  /**
   * How we know. Defaults to `user-reported`, which is what this route is.
   *
   * `inferred` exists for "no response in 60 days" and travels with a lower `confidence` — the
   * strengths are genuinely different and the aggregate must be able to tell them apart.
   */
  @IsOptional()
  @IsIn(['user-reported', 'inferred', 'platform-observed'])
  source?: 'user-reported' | 'inferred' | 'platform-observed';

  @IsOptional()
  @IsIn(['high', 'medium', 'low'])
  confidence?: 'high' | 'medium' | 'low';
}
