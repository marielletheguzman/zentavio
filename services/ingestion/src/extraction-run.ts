/**
 * The extraction pass: which postings have not been read at the current version, read them, record
 * that they were read (ADR-0036).
 *
 * **This is a function, not a daemon**, for the same reason `runDueJobBoards` is: what triggers it is
 * a deployment decision and nothing is deployed (ADR-0015, ADR-0021). Writing a scheduler here would
 * produce an undeployable component that looks finished.
 *
 * ## Why it is not a step inside ingest
 *
 * `executePostingPlan` opens one transaction per scope so a board either updates and sweeps or does
 * neither. Extraction inside that boundary would put the whole `skill_aliases` index and a scan over
 * every posting's prose in the same transaction as a network-fed write — so a skill-graph query
 * failure would roll back a board's ingest, and a `refused-lower-tier` posting whose fields were not
 * written would be extracted against text this run did not supply.
 *
 * Ingest reads a connector; extraction reads the skill graph. They fail independently and are
 * scheduled independently.
 *
 * ## Why a posting that matches nothing is still stamped
 *
 * A posting that mentions no curated skill writes zero `job_posting_skills` rows. If the pass keyed
 * on those rows it would re-select that posting forever — on the corpus that exists today, every
 * posting on every run, converging never and looking healthy throughout. `extracted_version` on the
 * posting is what separates *never read* from *read, found nothing*, and stamping it unconditionally
 * is what makes the backlog drain.
 *
 * `matchedNothing` in the report is therefore a **normal count, not an error count**. It is also the
 * number that would have said the corpus was the problem.
 */

import {
  aliasIndex,
  postingsDueForExtraction,
  recordExtraction,
  type Database,
} from '@zentavio/db';
import type { Kysely } from 'kysely';

import { EXTRACTOR_VERSION, extractSkills, rowsFor } from './skill-extraction.ts';

/** How many postings one pass will read. A pass is resumable, so a cap costs only latency. */
export const DEFAULT_EXTRACTION_BATCH = 200;

export interface ExtractionRunDeps {
  readonly now: () => Date;
  readonly newId: () => string;
  /** Defaults to `DEFAULT_EXTRACTION_BATCH`. */
  readonly batchSize?: number;
}

export interface ExtractionRunReport {
  readonly ranAt: Date;
  readonly extractorVersion: string;
  /** Postings read this pass. */
  readonly considered: number;
  /** Postings that produced at least one skill row. */
  readonly matched: number;
  /**
   * Postings read that mention nothing the graph curates. A normal outcome, counted separately
   * because it is the difference between an empty result and a broken one.
   */
  readonly matchedNothing: number;
  /** Skill rows written across the pass. */
  readonly rowsWritten: number;
  /**
   * Whether the batch cap was reached, so a caller knows a further pass has work. Never inferred
   * from `considered` alone — a backlog of exactly the batch size is indistinguishable otherwise.
   */
  readonly moreRemaining: boolean;
  /** Empty when the graph curates no aliases, which makes every extraction vacuously empty. */
  readonly aliasCount: number;
}

/**
 * Read every posting that is behind the current extractor version, up to the batch cap.
 *
 * The alias index is loaded **once per pass**, not per posting: the graph is small, and a per-posting
 * query would make the pass's cost depend on how many postings are behind rather than on how large
 * the vocabulary is (`aliasIndex` documents the same reasoning).
 *
 * **An empty alias index is reported, not treated as an error.** A run against a database whose skill
 * graph has not been seeded extracts nothing from every posting and stamps them all as read, which
 * would quietly mark the whole corpus done. `aliasCount: 0` is what makes that visible.
 */
export async function extractDuePostings(
  db: Kysely<Database>,
  deps: ExtractionRunDeps,
): Promise<ExtractionRunReport> {
  const ranAt = deps.now();
  const batchSize = deps.batchSize ?? DEFAULT_EXTRACTION_BATCH;

  const aliases = await aliasIndex(db);
  const due = await postingsDueForExtraction(db, EXTRACTOR_VERSION, batchSize);

  let matched = 0;
  let matchedNothing = 0;
  let rowsWritten = 0;

  for (const posting of due) {
    const found = extractSkills(
      { description: posting.description, requirementsText: posting.requirementsText },
      aliases,
    );
    const rows = rowsFor(posting.id, found, deps.newId);

    // Stamped whether or not `rows` is empty. That is the whole mechanism.
    await recordExtraction(db, posting.id, rows, { version: EXTRACTOR_VERSION, at: ranAt });

    if (rows.length === 0) matchedNothing += 1;
    else {
      matched += 1;
      rowsWritten += rows.length;
    }
  }

  return {
    ranAt,
    extractorVersion: EXTRACTOR_VERSION,
    considered: due.length,
    matched,
    matchedNothing,
    rowsWritten,
    moreRemaining: due.length === batchSize,
    aliasCount: aliases.length,
  };
}
