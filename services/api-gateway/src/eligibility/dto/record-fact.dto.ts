/**
 * One answer to something `needsFromUser` asked for.
 *
 * **Keyed by the catalogue key**, which is the same string `requirements.needs_input` names. That
 * is deliberate and is the whole point of the catalogue: a rule may only ask for a fact the product
 * can accept, and an unknown key becomes a named 400 rather than a foreign key violation surfacing
 * as a 500.
 */

import { IsDefined, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class RecordFactDto {
  /** **No `userId`.** The subject comes from the guard, never the body — ADR-0017. */

  /** snake_case, matching `person_fact_kinds.key`. Shape here, existence in the repository. */
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'key must be snake_case' })
  @MaxLength(120)
  key!: string;

  /**
   * Typed by the kind's `value_type`, so this cannot be narrowed here without duplicating the
   * catalogue in the DTO layer. `@IsDefined` rather than `@IsOptional`: a fact with no value is not
   * an answer, and storing one would make an `undetermined` verdict look resolved.
   */
  @IsDefined()
  value!: unknown;

  /**
   * How we know. Defaults to `self_reported` in the repository, which is the honest default — a
   * stated salary is an intention, not evidence.
   */
  @IsOptional()
  @IsIn(['self_reported', 'derived', 'verified'])
  basis?: 'self_reported' | 'derived' | 'verified';

  /** What verified it — a signed offer, a certificate. Never the document itself. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  basisDetail?: string;
}
