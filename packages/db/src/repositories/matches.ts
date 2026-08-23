/**
 * The reads a score needs, and the write that records one (ADR-0037).
 *
 * ## What this module will not do
 *
 * **Compute anything.** The arithmetic lives in `services/matching` where it is pure and testable
 * without a database. This module retrieves facts with their provenance and stores a result with its
 * versions — the two halves `.claude/skills/ai-matching/SKILL.md` keeps apart.
 *
 * **Compare unresolved strings.** Both sides are already resolved to `skills.id` by the time they
 * reach here: the profile through the parser's alias recall, the posting through the alias scan. A
 * match on text would be a match on spelling.
 */

import { sql, type Kysely, type Selectable } from 'kysely';

import type { Database, MatchesTable } from '../schema.ts';

export type MatchRow = Selectable<MatchesTable>;

/** One thing a posting asks for, with the evidence for why we think so. */
export interface PostingRequirement {
  readonly skillId: string;
  readonly label: string;
  /** 0..1, computed by the extractor from where the span sits and how often it recurs. */
  readonly weight: number;
  readonly isRequired: boolean;
  /** The sentence as published. Carried so evidence can show it rather than describe it. */
  readonly sourceSpan: string | null;
}

/** One thing a person holds, and how well we know it. */
export interface HeldSkill {
  readonly skillId: string;
  readonly label: string;
  readonly status: 'evidenced' | 'claimed';
  /** Set only by in-platform verification — never by the parser or by the user saying so. */
  readonly verified: boolean;
}

/** One `transfers_to` edge: competence in `fromSkillId` carries into `toSkillId` at `weight`. */
export interface TransferEdge {
  readonly id: string;
  readonly fromSkillId: string;
  readonly toSkillId: string;
  readonly weight: number;
}

/**
 * What a posting asks for, heaviest first.
 *
 * The skill's name comes back with it so evidence can be labelled without a second lookup — a score
 * whose explanation says `"a1b2c3…"` explains nothing.
 */
export async function requirementsForPosting(
  db: Kysely<Database>,
  jobPostingId: string,
): Promise<readonly PostingRequirement[]> {
  const rows = await db
    .selectFrom('job_posting_skills as jpsk')
    .innerJoin('skills as s', 's.id', 'jpsk.skill_id')
    .select(['jpsk.skill_id', 's.name', 'jpsk.weight', 'jpsk.is_required', 'jpsk.source_span'])
    .where('jpsk.job_posting_id', '=', jobPostingId)
    .where('s.deleted_at', 'is', null)
    .orderBy('jpsk.weight', 'desc')
    .orderBy('jpsk.skill_id')
    .execute();

  return rows.map((row) => ({
    skillId: row.skill_id,
    label: row.name,
    weight: Number(row.weight),
    isRequired: row.is_required,
    sourceSpan: row.source_span,
  }));
}

/**
 * What a person holds, from their live profile.
 *
 * Reads the profile the user last confirmed. A superseded profile version is history, and scoring
 * against it would answer a question about who they used to be.
 */
export async function heldSkillsForUser(
  db: Kysely<Database>,
  userProfileId: string,
): Promise<readonly HeldSkill[]> {
  const rows = await db
    .selectFrom('profile_skills as ps')
    .innerJoin('skills as s', 's.id', 'ps.skill_id')
    .select(['ps.skill_id', 's.name', 'ps.status', 'ps.verified_at'])
    .where('ps.user_profile_id', '=', userProfileId)
    .where('s.deleted_at', 'is', null)
    .execute();

  return rows.map((row) => ({
    skillId: row.skill_id,
    label: row.name,
    status: row.status,
    verified: row.verified_at !== null,
  }));
}

/**
 * The `transfers_to` edges that could cover any of `intoSkillIds`.
 *
 * Loaded for the requirement set rather than per requirement, and **only `transfers_to`**: `requires`
 * is a prerequisite relation and `adjacent_to` is a neighbourhood. Neither means competence carries,
 * and treating them as if it did would credit a person for a skill they do not have.
 */
export async function transferEdgesInto(
  db: Kysely<Database>,
  intoSkillIds: readonly string[],
): Promise<readonly TransferEdge[]> {
  if (intoSkillIds.length === 0) return [];

  const rows = await db
    .selectFrom('skill_edges')
    .select(['id', 'from_skill_id', 'to_skill_id', 'weight'])
    .where('edge_type', '=', 'transfers_to')
    .where('to_skill_id', 'in', intoSkillIds)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    fromSkillId: row.from_skill_id,
    toSkillId: row.to_skill_id,
    weight: Number(row.weight),
  }));
}

/** What a posting says about its own extraction state, which decides whether a score is possible. */
export interface PostingScoringState {
  readonly id: string;
  /** Null means extraction has never read this posting (ADR-0036). */
  readonly extractedVersion: string | null;
  readonly expired: boolean;
}

export async function postingScoringState(
  db: Kysely<Database>,
  jobPostingId: string,
): Promise<PostingScoringState | undefined> {
  const row = await db
    .selectFrom('job_postings')
    .select(['id', 'extracted_version', 'expired_at'])
    .where('id', '=', jobPostingId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (row === undefined) return undefined;
  return { id: row.id, extractedVersion: row.extracted_version, expired: row.expired_at !== null };
}

/** A match as the scorer produces it, before the database adds its timestamps. */
export type NewMatch = Omit<MatchRow, 'created_at' | 'updated_at' | 'deleted_at'>;

/**
 * Record a match, replacing the live one for this person and posting.
 *
 * **Replace, not append.** `uq_matches__user_job` allows one live row per pair, and a match is a
 * judgment at a point in time rather than a cache: recomputation writes a new value with new
 * versions instead of silently editing the old number in place, so "why did my score change?" stays
 * answerable from `computed_at` and `knowledge_as_of`.
 *
 * The insert carries `evidence` even for an `unknown` row. `ck_matches__evidence_present` refuses
 * anything else, and it is right to: a row that cannot say what it determined is a number's worth of
 * storage with none of a number's obligations.
 */
export async function recordMatch(db: Kysely<Database>, match: NewMatch): Promise<string> {
  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('matches')
      .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
      .where('user_id', '=', match.user_id)
      .where('job_posting_id', '=', match.job_posting_id)
      .where('deleted_at', 'is', null)
      .execute();

    await trx
      .insertInto('matches')
      .values({ ...match, updated_at: sql`now()` })
      .execute();

    return match.id;
  });
}

/** A person's live matches, best first. `unknown` rows sort last rather than as zeros. */
export function matchesForUser(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom('matches')
    .selectAll()
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .orderBy(sql`score desc nulls last`)
    .orderBy('computed_at', 'desc');
}
