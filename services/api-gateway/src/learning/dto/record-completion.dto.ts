/**
 * One completion.
 *
 * **No skill field, and that is the point.** A completion is about a resource. Naming a skill here
 * would be the caller asserting what finishing it demonstrated, which is exactly the promotion M6
 * refuses (ADR-0030).
 */

import { IsISO8601, IsUUID } from 'class-validator';

export class RecordCompletionDto {
  @IsUUID()
  resourceId!: string;

  /** When they say they finished, not when they told us. The repository refuses a future date. */
  @IsISO8601()
  completedAt!: string;
}
