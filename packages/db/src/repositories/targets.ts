/**
 * Career targets, and everything a gap is computed from (`docs/database/entities/user.md`).
 *
 * Two responsibilities that belong together because they are two halves of one question: which
 * track is this person pursuing, and what does that track require.
 *
 * **The gap service holds no state** (ADR-0003), so this module is where every fact it needs is
 * read. That is deliberate: it puts the queries next to the schema they depend on, and it keeps the
 * gap itself a pure function of what it was handed — which is what makes its determinism testable.
 */

import { sql, type Kysely, type Selectable } from 'kysely';
import type { Database, UserTargetsTable } from '../schema.ts';
import { uuidv7 } from '../uuid.ts';

export type UserTarget = Selectable<UserTargetsTable>;

export interface SetTargetOptions {
  readonly userId: string;
  readonly careerId: string;
  /** 1 is the primary target. */
  readonly rank?: number;
  /** ISO 3166-1 alpha-2. `null` targets the global requirement set. */
  readonly marketScope?: string | null;
}

/**
 * Record what a person is pursuing, or update it if they already were.
 *
 * Upsert rather than insert-or-fail: re-selecting the same track is a normal thing for a person to
 * do, and making it an error would push the retry logic into every caller. Re-targeting an
 * *abandoned* track revives it, because changing your mind back is not a new decision requiring a
 * new row — and a second row would violate `uq_user_targets__user_career` anyway.
 */
export async function setTarget(
  db: Kysely<Database>,
  options: SetTargetOptions,
): Promise<UserTarget> {
  const { userId, careerId, rank = 1, marketScope = null } = options;

  const row = await db
    .insertInto('user_targets')
    .values({
      id: uuidv7(),
      user_id: userId,
      career_id: careerId,
      rank,
      market_scope: marketScope,
      status: 'active',
    })
    .onConflict((conflict) =>
      conflict
        // The partial unique index needs its predicate repeated, or PostgreSQL cannot match it to
        // an inference specification. Omitting the `where` fails at runtime with "there is no
        // unique or exclusion constraint matching the ON CONFLICT specification" — the same defect
        // that made every first OIDC sign-in fail.
        .columns(['user_id', 'career_id'])
        .where('deleted_at', 'is', null)
        .doUpdateSet({
          rank,
          market_scope: marketScope,
          status: 'active',
          decided_at: sql`now()`,
          updated_at: sql`now()`,
        }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();

  return row;
}

/** The track a person is currently pursuing, or `undefined` when they have not chosen one. */
export async function primaryTarget(
  db: Kysely<Database>,
  userId: string,
): Promise<UserTarget | undefined> {
  return db
    .selectFrom('user_targets')
    .selectAll()
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .where('deleted_at', 'is', null)
    .orderBy('rank', 'asc')
    .limit(1)
    .executeTakeFirst();
}

export interface RequirementRow {
  readonly skillId: string;
  readonly weight: number | null;
  readonly cluster: string;
  readonly marketScope: string | null;
  readonly basis: string;
  readonly support: number | null;
}

/**
 * What a track requires, by **slug** rather than uuid.
 *
 * The gap service never sees a database id. Slugs are the vocabulary the whole AI layer speaks —
 * the parser's closed set, the prompts' ids, the gap's items — and handing it uuids would make
 * every response unreadable and every fixture a lookup table.
 *
 * Both global and market-specific rows are returned. Choosing between them is the gap's job, and
 * doing it here would hide the market rule inside a query nobody reads.
 */
export async function careerRequirements(
  db: Kysely<Database>,
  careerId: string,
): Promise<readonly RequirementRow[]> {
  const rows = await db
    .selectFrom('career_skills')
    .innerJoin('skills', 'skills.id', 'career_skills.skill_id')
    .select([
      'skills.slug as skillId',
      'career_skills.weight as weight',
      'career_skills.cluster as cluster',
      'career_skills.market_scope as marketScope',
      'career_skills.basis as basis',
      'career_skills.support as support',
    ])
    .where('career_skills.career_id', '=', careerId)
    .where('career_skills.deleted_at', 'is', null)
    .where('skills.deleted_at', 'is', null)
    // Ordered so the request body is stable run to run. The gap sorts its own output, but a stable
    // request keeps a captured payload diffable when someone is debugging one.
    .orderBy('skills.slug', 'asc')
    .execute();

  return rows.map((row) => ({
    skillId: row.skillId,
    // numeric(4,3) arrives as a string from pg — it is exact decimal, and JS numbers are not.
    // Converting here rather than at the wire keeps the coercion in one place.
    weight: row.weight === null ? null : Number(row.weight),
    cluster: row.cluster,
    marketScope: row.marketScope,
    basis: row.basis,
    support: row.support,
  }));
}

export interface EdgeRow {
  readonly fromSkillId: string;
  readonly toSkillId: string;
  readonly edgeType: string;
  readonly weight: number;
  readonly sourceUrl: string | null;
  readonly sourceTier: number;
}

/**
 * The graph, by slug.
 *
 * Every live edge, not only those touching the target's requirements: a `transfers_to` edge from a
 * skill the person holds to one they need is exactly the edge a narrower query would drop, and it
 * is the one that produces partial credit. The seeded graph is tens of rows, so filtering would
 * trade correctness for nothing measurable.
 */
export async function skillGraph(db: Kysely<Database>): Promise<readonly EdgeRow[]> {
  const rows = await db
    .selectFrom('skill_edges')
    .innerJoin('skills as source', 'source.id', 'skill_edges.from_skill_id')
    .innerJoin('skills as target', 'target.id', 'skill_edges.to_skill_id')
    .select([
      'source.slug as fromSkillId',
      'target.slug as toSkillId',
      'skill_edges.edge_type as edgeType',
      'skill_edges.weight as weight',
      'skill_edges.source_url as sourceUrl',
      'skill_edges.source_tier as sourceTier',
    ])
    .where('skill_edges.deleted_at', 'is', null)
    .where('source.deleted_at', 'is', null)
    .where('target.deleted_at', 'is', null)
    .orderBy('source.slug', 'asc')
    .orderBy('target.slug', 'asc')
    .orderBy('skill_edges.edge_type', 'asc')
    .execute();

  return rows.map((row) => ({
    fromSkillId: row.fromSkillId,
    toSkillId: row.toSkillId,
    edgeType: row.edgeType,
    weight: Number(row.weight),
    sourceUrl: row.sourceUrl,
    sourceTier: row.sourceTier,
  }));
}

export interface HeldSkillRow {
  readonly skillId: string;
  readonly status: string;
  readonly confidence: string;
}

/**
 * What the person's **current** profile version says they have, by slug.
 *
 * Current version only. A superseded version is what they used to look like, and computing a gap
 * against a profile they have already corrected would answer a question nobody asked.
 */
export async function heldSkills(
  db: Kysely<Database>,
  userId: string,
): Promise<readonly HeldSkillRow[]> {
  const rows = await db
    .selectFrom('profile_skills')
    .innerJoin('user_profiles', 'user_profiles.id', 'profile_skills.user_profile_id')
    .innerJoin('skills', 'skills.id', 'profile_skills.skill_id')
    .select([
      'skills.slug as skillId',
      'profile_skills.status as status',
      'profile_skills.confidence as confidence',
    ])
    .where('user_profiles.user_id', '=', userId)
    .where('user_profiles.is_current', '=', true)
    .where('user_profiles.deleted_at', 'is', null)
    .where('skills.deleted_at', 'is', null)
    .orderBy('skills.slug', 'asc')
    .execute();

  return rows.map((row) => ({
    skillId: row.skillId,
    status: row.status,
    confidence: row.confidence,
  }));
}

/** A career by slug, so a caller can name a track the way a user would. */
export async function careerBySlug(
  db: Kysely<Database>,
  slug: string,
): Promise<{ readonly id: string; readonly slug: string } | undefined> {
  return db
    .selectFrom('careers')
    .select(['id', 'slug'])
    .where('slug', '=', slug)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
}

export interface LicenceScope {
  /** The profession the track is licensed as, or `null` when it is not licence-gated. */
  readonly profession: string | null;
  readonly licenceGated: boolean;
}

/**
 * Whether the track a person is pursuing is licence-gated, and the profession it is gated by.
 *
 * **This exists because the guard that depends on it was unreachable.** `ai/career-roadmap` refuses
 * to give a licence-gated profession a visa-only verdict — it returns `unknown` with recognition
 * named (ADR-0010) — but the flag that triggers it was an optional argument no caller ever passed,
 * so a nurse would have received the visa answer. Derived from the target rather than accepted as a
 * parameter: an optional input that must never be omitted is the shape of the original defect.
 *
 * `undefined` when the person has no active target. That is not "not gated" — the caller has no
 * track to reason about at all, and eligibility for a pathway is still answerable.
 */
export async function licenceScopeForUser(
  db: Kysely<Database>,
  userId: string,
): Promise<LicenceScope | undefined> {
  const row = await db
    .selectFrom('user_targets')
    .innerJoin('careers', 'careers.id', 'user_targets.career_id')
    .select(['careers.profession as profession', 'careers.licence_gated as licenceGated'])
    .where('user_targets.user_id', '=', userId)
    .where('user_targets.status', '=', 'active')
    .where('user_targets.deleted_at', 'is', null)
    .where('careers.deleted_at', 'is', null)
    .orderBy('user_targets.rank', 'asc')
    .limit(1)
    .executeTakeFirst();

  if (row === undefined) return undefined;
  return { profession: row.profession, licenceGated: row.licenceGated };
}
