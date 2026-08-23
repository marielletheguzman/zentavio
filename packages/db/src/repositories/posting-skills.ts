/**
 * Storing what a posting asks for, and serving the vocabulary that finds it (ADR-0035).
 *
 * ## What this module will not do
 *
 * **Invent a skill.** Resolution goes through `skill_aliases.normalized`, so a phrase that resolves
 * to nothing produces no row. That bounds recall to what the graph curates, and the unresolved
 * phrases are worth more as a curation backlog than as guessed rows.
 *
 * **Write `stated-requirement`.** No source states requirements in a structured field yet. The CHECK
 * constraint permits the value because the column is designed for the day one does; nothing in this
 * repository may produce it before then, and a test asserts the absence.
 */

import { sql, type Kysely, type Selectable } from 'kysely';

import type { Database, JobPostingSkillsTable } from '../schema.ts';

export type JobPostingSkillRow = Selectable<JobPostingSkillsTable>;

/** One alias, normalized as `skill_aliases` keys it, and the skill it resolves to. */
export interface AliasEntry {
  readonly normalized: string;
  readonly skillId: string;
}

/**
 * The whole alias vocabulary, for a scan to match against.
 *
 * Loaded once per run rather than queried per phrase: the graph is small, and a per-phrase round trip
 * would make extraction's cost depend on how wordy a posting is.
 */
export async function aliasIndex(db: Kysely<Database>): Promise<readonly AliasEntry[]> {
  const rows = await db
    .selectFrom('skill_aliases')
    .innerJoin('skills', 'skills.id', 'skill_aliases.skill_id')
    .select(['skill_aliases.normalized', 'skill_aliases.skill_id'])
    .where('skills.deleted_at', 'is', null)
    .execute();

  return rows.map((row) => ({ normalized: row.normalized, skillId: row.skill_id }));
}

/** A row as extraction produces it, before the database adds its timestamps. */
export type NewPostingSkill = Omit<JobPostingSkillRow, 'created_at' | 'updated_at'>;

/** A posting the extraction pass has selected, with the only two fields extraction reads. */
export interface PostingDueForExtraction {
  readonly id: string;
  readonly description: string | null;
  readonly requirementsText: string | null;
}

/**
 * Live postings whose recorded extractor version is not the current one (ADR-0036).
 *
 * `IS DISTINCT FROM` rather than `<>` is the whole query: a never-extracted posting has
 * `extracted_version IS NULL`, and `null <> 'alias-scan@1.0.0'` is null, which selects nothing. The
 * never-extracted rows are exactly the ones a first run must find.
 *
 * Expired and soft-deleted postings are skipped. Extracting a posting nobody can apply for spends
 * the run on rows matching will never read.
 */
export async function postingsDueForExtraction(
  db: Kysely<Database>,
  extractorVersion: string,
  limit: number,
): Promise<readonly PostingDueForExtraction[]> {
  const rows = await db
    .selectFrom('job_postings')
    .select(['id', 'description', 'requirements_text'])
    .where('extracted_version', 'is distinct from', extractorVersion)
    .where('deleted_at', 'is', null)
    .where('expired_at', 'is', null)
    // Oldest first, so a large backlog drains in a stable order rather than re-shuffling per run.
    .orderBy('first_seen_at')
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    requirementsText: row.requirements_text,
  }));
}

/**
 * Record one extraction: replace what the posting asks for, and stamp that it was read.
 *
 * **Replace, not append.** Re-extraction after a posting is edited, or after the extractor changes,
 * must not leave the previous run's skills behind: a skill the posting no longer mentions would
 * otherwise persist as a requirement nobody stated, and it would look exactly like a current one.
 *
 * **The stamp is not optional, which is why there is no function that writes rows without it.**
 * Writing skills and recording that extraction ran are the same event. Splitting them offers a
 * caller the state ADR-0036 exists to prevent — rows written, marker stale, posting re-selected
 * forever — and an API that can express a forbidden state eventually reaches it.
 *
 * **Stamped even when `rows` is empty.** A posting that mentions nothing the graph curates has been
 * extracted; it is finished, not pending. That is the difference between "never read" and "read,
 * found nothing", and it is the only reason the pass converges.
 *
 * One transaction, so a posting is never briefly skill-less while a reader is scoring it, and never
 * marked extracted with the previous run's rows still attached.
 */
export async function recordExtraction(
  db: Kysely<Database>,
  jobPostingId: string,
  rows: readonly NewPostingSkill[],
  extraction: { readonly version: string; readonly at: Date },
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    await trx.deleteFrom('job_posting_skills').where('job_posting_id', '=', jobPostingId).execute();

    if (rows.length > 0) {
      await trx
        .insertInto('job_posting_skills')
        .values(rows.map((row) => ({ ...row, updated_at: sql`now()` })))
        .execute();
    }

    await trx
      .updateTable('job_postings')
      .set({
        extracted_at: extraction.at,
        extracted_version: extraction.version,
        updated_at: sql`now()`,
      })
      .where('id', '=', jobPostingId)
      .execute();

    return rows.length;
  });
}

/** What a posting asks for, heaviest first — the order matching reads them in. */
export function skillsForPosting(db: Kysely<Database>, jobPostingId: string) {
  return db
    .selectFrom('job_posting_skills')
    .selectAll()
    .where('job_posting_id', '=', jobPostingId)
    .orderBy('weight', 'desc')
    .orderBy('skill_id');
}

/** Postings asking for one skill, for "who wants what I have" and for market frequency later. */
export function postingsForSkill(db: Kysely<Database>, skillId: string) {
  return db
    .selectFrom('job_posting_skills as jpsk')
    .innerJoin('job_postings as jp', 'jp.id', 'jpsk.job_posting_id')
    .select(['jp.id', 'jp.title', 'jp.url', 'jpsk.weight', 'jpsk.is_required', 'jpsk.source_span'])
    .where('jpsk.skill_id', '=', skillId)
    .where('jp.expired_at', 'is', null)
    .where('jp.deleted_at', 'is', null)
    .orderBy('jpsk.weight', 'desc');
}
