/**
 * The profile repository (ADR-0012, `docs/features/resume-parsing.md`).
 *
 * As with `requirements.ts`: the database's CHECK constraints are the guarantee, these guards are
 * the diagnosis. A guard fails with a message naming the rule before a round trip; the constraint
 * catches anything that reaches the database by another path.
 *
 * **The one design decision here that is not obvious: a correction creates a new profile version.**
 * `user_profiles` is versioned so a score can be reproduced against the profile as it stood
 * (`docs/database/entities/user.md`). Editing a skill in place on the current version would silently
 * invalidate every score already computed from it — the inputs would have moved while the recorded
 * `version` stayed the same. Versioning that a correction bypasses is not versioning.
 */

import { sql, type Insertable, type Kysely, type Transaction } from 'kysely';
import type { Database, ProfileSkillsTable, UserProfilesTable } from '../schema.ts';
import { uuidv7 } from '../uuid.ts';

export class ProfileInvariantError extends Error {
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(`${rule}: ${message}`);
    this.name = 'ProfileInvariantError';
    this.rule = rule;
  }
}

export type NewProfile = Insertable<UserProfilesTable>;
export type NewProfileSkill = Insertable<ProfileSkillsTable>;

/** A skill as supplied by the parser or a correction — without the ids the repository assigns. */
export interface ProfileSkillInput {
  readonly skill_id: string;
  readonly status: 'evidenced' | 'claimed';
  readonly evidence_kind?: 'role' | 'project' | 'certification' | 'assessment' | 'artifact' | null;
  readonly source_span?: string | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly self_reported?: boolean;
  readonly verified_at?: Date | null;
  /**
   * The attempt that verified it (ADR-0030).
   *
   * Travels with `verified_at` or not at all. A version carrying verification with no citable
   * instrument is a promotion whose basis was lost in the copy.
   */
  readonly verified_attempt_id?: string | null;
}

/**
 * Every rule that must hold before a profile skill is written. Returns all violations rather than
 * the first, so a malformed parser output reports everything wrong with it at once.
 */
export function validateProfileSkill(row: ProfileSkillInput): readonly ProfileInvariantError[] {
  const errors: ProfileInvariantError[] = [];

  // The rule that makes readiness honest. Mirrors ck_profile_skills__evidence.
  if (row.status === 'evidenced' && (row.evidence_kind === null || row.evidence_kind === undefined)) {
    errors.push(
      new ProfileInvariantError(
        'ck_profile_skills__evidence',
        'an evidenced skill must say what evidences it. Without evidence_kind, "evidenced" is a ' +
          'label rather than a claim, and a padded skills list inflates readiness.',
      ),
    );
  }

  // Mirrors ck_profile_skills__attempt_verified. The pair travels together: a `verified_at` with no
  // attempt cannot say what verified it, and an attempt id with no timestamp is a promotion that
  // never happened.
  const hasVerifiedAt = row.verified_at !== null && row.verified_at !== undefined;
  const hasAttempt = row.verified_attempt_id !== null && row.verified_attempt_id !== undefined;
  if (hasVerifiedAt !== hasAttempt) {
    errors.push(
      new ProfileInvariantError(
        'ck_profile_skills__attempt_verified',
        'verification and the attempt that produced it are one fact: a verified skill must name ' +
          'the attempt, and an attempt id means nothing without the time it verified.',
      ),
    );
  }

  // Mirrors ck_profile_skills__verified_is_evidenced.
  if (row.verified_at !== null && row.verified_at !== undefined && row.status !== 'evidenced') {
    errors.push(
      new ProfileInvariantError(
        'ck_profile_skills__verified_is_evidenced',
        'a verified skill cannot be merely claimed — verification is in-platform and produces ' +
          'evidence, so this would mean the platform checked something it never recorded.',
      ),
    );
  }

  // Not a database constraint, and deliberately so: the column is nullable because a manually
  // entered profile has no source text. But an *evidenced* skill claims a sentence exists, and one
  // that cannot show it is not correctable by the user — which is the whole point of the span.
  if (row.status === 'evidenced' && row.self_reported !== true) {
    const span = row.source_span;
    if (span === null || span === undefined || span.trim() === '') {
      errors.push(
        new ProfileInvariantError(
          'evidenced_needs_span',
          'an extracted evidenced skill must carry the verbatim source span it came from. A user ' +
            'cannot disagree with an extraction whose basis they cannot see.',
        ),
      );
    }
  }

  return errors;
}

function assertValidSkills(rows: readonly ProfileSkillInput[]): void {
  const errors = rows.flatMap((row) => validateProfileSkill(row));
  if (errors.length > 0) {
    throw new ProfileInvariantError(
      'profile_skills',
      `${String(errors.length)} invariant violation(s): ${errors.map((e) => e.message).join('; ')}`,
    );
  }
}

export interface CreateProfileVersionOptions {
  readonly userId: string;
  readonly skills: readonly ProfileSkillInput[];
  readonly headline?: string | null;
  readonly parsedFrom?: 'resume-upload' | 'manual' | 'import';
  readonly parserVersion?: string | null;
  readonly completeness?: number | null;
  readonly currentCareerId?: string | null;
}

export interface ProfileVersion {
  readonly id: string;
  readonly version: number;
}

/**
 * Write a new profile version and make it the current one.
 *
 * The previous current version is demoted in the **same transaction**, because
 * `uq_user_profiles__current` permits exactly one live current row per user — two writers racing
 * would otherwise have one of them fail on a constraint rather than serialise.
 *
 * Version numbers are dense and never reused, including after a soft delete, so this reads the
 * maximum rather than counting live rows.
 */
export async function createProfileVersion(
  db: Kysely<Database>,
  options: CreateProfileVersionOptions,
): Promise<ProfileVersion> {
  assertValidSkills(options.skills);

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('user_profiles')
      .set({ is_current: false, updated_at: sql`now()` })
      .where('user_id', '=', options.userId)
      .where('is_current', '=', true)
      .execute();

    const previous = await trx
      .selectFrom('user_profiles')
      .select('version')
      .where('user_id', '=', options.userId)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();

    const version = (previous?.version ?? 0) + 1;
    const id = uuidv7();

    await trx
      .insertInto('user_profiles')
      .values({
        id,
        user_id: options.userId,
        version,
        is_current: true,
        headline: options.headline ?? null,
        current_career_id: options.currentCareerId ?? null,
        parsed_from: options.parsedFrom ?? 'resume-upload',
        parser_version: options.parserVersion ?? null,
        parsed_at: sql`now()`,
        completeness: options.completeness === undefined ? null : String(options.completeness),
      })
      .execute();

    await insertSkills(trx, id, options.skills);

    return { id, version };
  });
}

async function insertSkills(
  trx: Transaction<Database>,
  profileId: string,
  skills: readonly ProfileSkillInput[],
): Promise<void> {
  if (skills.length === 0) return;
  await trx
    .insertInto('profile_skills')
    .values(
      skills.map((skill) => ({
        id: uuidv7(),
        user_profile_id: profileId,
        skill_id: skill.skill_id,
        status: skill.status,
        evidence_kind: skill.evidence_kind ?? null,
        source_span: skill.source_span ?? null,
        confidence: skill.confidence,
        self_reported: skill.self_reported ?? false,
        verified_at: skill.verified_at ?? null,
        verified_attempt_id: skill.verified_attempt_id ?? null,
      })),
    )
    .execute();
}

/** The live profile for a user, or `undefined` when none has been created. */
export function currentProfile(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom('user_profiles')
    .selectAll()
    .where('user_id', '=', userId)
    .where('is_current', '=', true)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
}

/** Every skill on a profile version, with the slug so a caller need not join twice. */
export function profileSkills(db: Kysely<Database>, profileId: string) {
  return db
    .selectFrom('profile_skills')
    .innerJoin('skills', 'skills.id', 'profile_skills.skill_id')
    .select([
      'profile_skills.id',
      'profile_skills.skill_id',
      'profile_skills.status',
      'profile_skills.evidence_kind',
      'profile_skills.source_span',
      'profile_skills.confidence',
      'profile_skills.self_reported',
      'profile_skills.verified_at',
      'profile_skills.verified_attempt_id',
      'skills.slug',
      'skills.name',
    ])
    .where('profile_skills.user_profile_id', '=', profileId)
    .orderBy('skills.slug')
    .execute();
}

export type Correction =
  | { readonly kind: 'remove'; readonly skillId: string }
  | {
      readonly kind: 'upsert';
      readonly skillId: string;
      readonly status: 'evidenced' | 'claimed';
      readonly evidenceKind?: ProfileSkillInput['evidence_kind'];
      readonly confidence?: 'high' | 'medium' | 'low';
    };

/**
 * Apply a user's correction by writing a **new profile version**.
 *
 * A correction is the highest-quality signal available about a profile
 * (`docs/features/resume-parsing.md`), and it outweighs an inference — so the corrected row is
 * marked `self_reported`, and its confidence defaults to `high` because the person is the authority
 * on their own experience.
 *
 * `verified_at` is deliberately **not** carried forward onto a corrected row: verification is
 * in-platform, and a user editing a skill has not re-verified it. Every other skill is copied
 * forward unchanged, verification included.
 *
 * Returns the new version. The previous one remains readable, which is what keeps an already-issued
 * score reproducible.
 */
export async function applyCorrection(
  db: Kysely<Database>,
  userId: string,
  correction: Correction,
): Promise<ProfileVersion> {
  const profile = await currentProfile(db, userId);
  if (!profile) {
    throw new ProfileInvariantError('no_current_profile', `user ${userId} has no current profile to correct`);
  }

  const existing = await profileSkills(db, profile.id);

  const carried: ProfileSkillInput[] = existing
    .filter((row) => row.skill_id !== correction.skillId)
    .map((row) => ({
      skill_id: row.skill_id,
      status: row.status,
      evidence_kind: row.evidence_kind,
      source_span: row.source_span,
      confidence: row.confidence,
      self_reported: row.self_reported,
      // Carried, not created. An assessment pass survives a later correction to a different skill,
      // and it keeps citing the attempt it came from.
      verified_at: row.verified_at,
      verified_attempt_id: row.verified_attempt_id,
    }));

  if (correction.kind === 'upsert') {
    const previous = existing.find((row) => row.skill_id === correction.skillId);
    carried.push({
      skill_id: correction.skillId,
      status: correction.status,
      evidence_kind:
        correction.evidenceKind ?? (correction.status === 'evidenced' ? 'role' : null),
      // Kept so the user can still see what the parser read, even after disagreeing with it.
      source_span: previous?.source_span ?? null,
      confidence: correction.confidence ?? 'high',
      self_reported: true,
      // A user editing a skill has not re-taken an assessment, so both halves go.
      verified_at: null,
      verified_attempt_id: null,
    });
  }

  return createProfileVersion(db, {
    userId,
    skills: carried,
    headline: profile.headline,
    parsedFrom: 'manual',
    parserVersion: profile.parser_version,
    currentCareerId: profile.current_career_id,
  });
}
