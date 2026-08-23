/**
 * The sponsorship pass: which postings have not been read at the current version, read them, record
 * that they were read (ADR-0039).
 *
 * **A separate pass from skill extraction, with its own marker**, because the two are independent
 * transformations over the same text. Sharing a marker would make an alias-scan bump re-run
 * sponsorship and a sponsorship-rule change re-run the whole skill corpus, and would leave one
 * version string trying to identify two algorithms.
 *
 * **This is a function, not a daemon**, like every other entry point here: what triggers it is a
 * deployment decision and nothing is deployed (ADR-0015, ADR-0021).
 *
 * ## `unknown` dominating is the designed outcome, not a failure
 *
 * On the only real board stored, 3 of 239 postings mention the topic at all and none states
 * availability. The report separates *processed* from *found* so that a run saying "239 processed, 0
 * stated" reads as the honest result rather than as a broken pass.
 */

import {
  postingsDueForSponsorship,
  recordSponsorship,
  type Database,
  type SponsorshipOutcome,
} from '@zentavio/db';
import type { Kysely } from 'kysely';

import {
  SPONSORSHIP_EXTRACTOR_VERSION,
  extractSponsorship,
  type SponsorshipFindings,
} from './sponsorship-extraction.ts';

/** How many postings one pass reads. A pass is resumable, so a cap costs only latency. */
export const DEFAULT_SPONSORSHIP_BATCH = 200;

export interface SponsorshipRunDeps {
  readonly now: () => Date;
  readonly batchSize?: number;
}

export interface SponsorshipRunReport {
  readonly ranAt: Date;
  readonly extractorVersion: string;
  /** Postings read this pass. */
  readonly considered: number;
  /** Postings where at least one benefit was stated either way. */
  readonly withAnyStatement: number;
  readonly statedAvailable: number;
  readonly statedUnavailable: number;
  /**
   * Postings whose text states nothing about any of the three benefits. The dominant outcome, counted
   * separately because it is a real answer rather than a failure to read.
   */
  readonly saidNothing: number;
  /** Whether the batch cap hid remaining work. Never inferred from `considered` alone. */
  readonly moreRemaining: boolean;
}

function toOutcome(found: SponsorshipFindings): SponsorshipOutcome {
  return {
    visaSponsorship: found.visa_sponsorship,
    relocationSupport: found.relocation_support,
    immigrationAssistance: found.immigration_assistance,
  };
}

/**
 * Read every posting behind the current sponsorship version, up to the batch cap.
 *
 * Every posting is stamped, whether or not anything was found. That is what makes the pass converge,
 * and it is the same mechanism ADR-0036 established for skills — deliberately duplicated rather than
 * shared, so each pipeline's state means one thing.
 */
export async function extractSponsorshipForDuePostings(
  db: Kysely<Database>,
  deps: SponsorshipRunDeps,
): Promise<SponsorshipRunReport> {
  const ranAt = deps.now();
  const batchSize = deps.batchSize ?? DEFAULT_SPONSORSHIP_BATCH;

  const due = await postingsDueForSponsorship(db, SPONSORSHIP_EXTRACTOR_VERSION, batchSize);

  let withAnyStatement = 0;
  let statedAvailable = 0;
  let statedUnavailable = 0;
  let saidNothing = 0;

  for (const posting of due) {
    const found = extractSponsorship({
      description: posting.description,
      requirementsText: posting.requirementsText,
    });
    const statuses = Object.values(found).map((benefit) => benefit.status);

    await recordSponsorship(db, posting.id, toOutcome(found), {
      version: SPONSORSHIP_EXTRACTOR_VERSION,
      at: ranAt,
    });

    if (statuses.every((status) => status === 'unknown')) saidNothing += 1;
    else {
      withAnyStatement += 1;
      if (statuses.includes('stated_available')) statedAvailable += 1;
      if (statuses.includes('stated_unavailable')) statedUnavailable += 1;
    }
  }

  return {
    ranAt,
    extractorVersion: SPONSORSHIP_EXTRACTOR_VERSION,
    considered: due.length,
    withAnyStatement,
    statedAvailable,
    statedUnavailable,
    saidNothing,
    moreRemaining: due.length === batchSize,
  };
}
