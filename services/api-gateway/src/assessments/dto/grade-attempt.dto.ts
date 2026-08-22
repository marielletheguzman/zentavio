/**
 * The answers to one attempt.
 *
 * **There is no score field, and that is the point** (ADR-0030). A client that can send its own
 * score has decided whether it passed; the answers come in and the score is computed against the
 * stored key.
 */

import { IsObject } from 'class-validator';

export class GradeAttemptDto {
  /**
   * `{ itemId: optionKey }`. An item absent from this map counts as wrong rather than skipped —
   * otherwise one correct answer passes an instrument of ten.
   */
  @IsObject()
  answers!: Record<string, string>;
}
