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

/**
 * Replace what a posting asks for.
 *
 * **Replace, not append.** Re-extraction after a posting is edited, or after the extractor changes,
 * must not leave the previous run's skills behind: a skill the posting no longer mentions would
 * otherwise persist as a requirement nobody stated, and it would look exactly like a current one.
 *
 * One transaction, so a posting is never briefly skill-less while a reader is scoring it.
 */
export async function replacePostingSkills(
  db: Kysely<Database>,
  jobPostingId: string,
  rows: readonly NewPostingSkill[],
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    await trx.deleteFrom('job_posting_skills').where('job_posting_id', '=', jobPostingId).execute();

    if (rows.length === 0) return 0;

    await trx
      .insertInto('job_posting_skills')
      .values(rows.map((row) => ({ ...row, updated_at: sql`now()` })))
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
