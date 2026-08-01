/**
 * The profile repository against a real PostgreSQL.
 *
 * The property under test is the one M1a's milestone is stated in terms of: a user disagrees with an
 * extracted skill, corrects it, and the change is visible **without destroying the profile the
 * previous score was computed from**. That is only demonstrable against a real database, because it
 * is enforced by `uq_user_profiles__current` and by the version chain.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import {
  ProfileInvariantError,
  applyCorrection,
  applySeed,
  createProfileVersion,
  currentProfile,
  loadSeedFile,
  profileSkills,
  seedsDirectory,
  uuidv7,
  validateProfileSkill,
  type Database,
} from '@zentavio/db';
import { join } from 'node:path';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let userId: string;
let kubernetesId: string;
let terraformId: string;

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

beforeEach(async () => {
  await pool.query('DELETE FROM user_profiles');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM skill_aliases');
  await pool.query('DELETE FROM skills');
  await pool.query('DELETE FROM careers');

  await applySeed(pool, await loadSeedFile(join(seedsDirectory, 'cloud-platform-engineering.json')));

  userId = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
    userId,
    `subject-${userId.slice(0, 8)}@example.invalid`,
  ]);

  const { rows } = await pool.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM skills WHERE slug IN ('kubernetes', 'terraform')`,
  );
  kubernetesId = rows.find((r) => r.slug === 'kubernetes')!.id;
  terraformId = rows.find((r) => r.slug === 'terraform')!.id;
});

afterAll(async () => {
  await db?.destroy();
});

const evidenced = (skillId: string, span: string) =>
  ({
    skill_id: skillId,
    status: 'evidenced' as const,
    evidence_kind: 'role' as const,
    source_span: span,
    confidence: 'high' as const,
  });

describe('createProfileVersion', () => {
  it('writes version 1 and makes it current', async () => {
    const created = await createProfileVersion(db, {
      userId,
      skills: [evidenced(kubernetesId, 'Led a Kubernetes migration across 40 services')],
    });

    expect(created.version).toBe(1);
    const current = await currentProfile(db, userId);
    expect(current?.id).toBe(created.id);
    expect(await profileSkills(db, created.id)).toHaveLength(1);
  });

  it('demotes the previous version in the same transaction', async () => {
    // uq_user_profiles__current permits exactly one live current row. If the demotion were a
    // separate statement, this would fail on a constraint instead of succeeding.
    const first = await createProfileVersion(db, { userId, skills: [] });
    const second = await createProfileVersion(db, { userId, skills: [] });

    expect(second.version).toBe(2);
    const current = await currentProfile(db, userId);
    expect(current?.id).toBe(second.id);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM user_profiles WHERE user_id = $1 AND is_current`,
      [userId],
    );
    expect(Number((rows[0] as { n: string }).n)).toBe(1);
    expect(first.id).not.toBe(second.id);
  });

  it('refuses an evidenced skill with no evidence_kind, before reaching the database', async () => {
    await expect(
      createProfileVersion(db, {
        userId,
        skills: [
          { skill_id: kubernetesId, status: 'evidenced', source_span: 'x', confidence: 'high' },
        ],
      }),
    ).rejects.toBeInstanceOf(ProfileInvariantError);
  });

  it('refuses an extracted evidenced skill with no source span', async () => {
    // Not a database constraint — the column is nullable because a manually entered profile has no
    // source text. But an extraction the user cannot see the basis of is not correctable.
    await expect(
      createProfileVersion(db, {
        userId,
        skills: [
          { skill_id: kubernetesId, status: 'evidenced', evidence_kind: 'role', confidence: 'high' },
        ],
      }),
    ).rejects.toThrow(/source span/);
  });
});

describe('applyCorrection — the milestone property', () => {
  it('records the correction as a new version and leaves the old one readable', async () => {
    // M1a: "a real user reads the number, disagrees with one extracted skill, corrects it, and
    // watches the number change for a reason they can see." The old version must survive, or every
    // score already computed from it becomes unreproducible.
    const original = await createProfileVersion(db, {
      userId,
      skills: [
        evidenced(kubernetesId, 'Led a Kubernetes migration across 40 services'),
        { skill_id: terraformId, status: 'claimed', confidence: 'medium' },
      ],
    });

    const corrected = await applyCorrection(db, userId, {
      kind: 'upsert',
      skillId: terraformId,
      status: 'evidenced',
      evidenceKind: 'project',
    });

    expect(corrected.version).toBe(2);

    // The previous version still reads exactly as it did.
    const before = await profileSkills(db, original.id);
    expect(before.find((s) => s.slug === 'terraform')?.status).toBe('claimed');

    const after = await profileSkills(db, corrected.id);
    const terraform = after.find((s) => s.slug === 'terraform');
    expect(terraform?.status).toBe('evidenced');
    expect(terraform?.evidence_kind).toBe('project');
    expect(terraform?.self_reported).toBe(true);
    // The person is the authority on their own experience.
    expect(terraform?.confidence).toBe('high');
  });

  it('carries every uncorrected skill forward unchanged', async () => {
    const original = await createProfileVersion(db, {
      userId,
      skills: [
        evidenced(kubernetesId, 'Led a Kubernetes migration across 40 services'),
        { skill_id: terraformId, status: 'claimed', confidence: 'medium' },
      ],
    });

    const corrected = await applyCorrection(db, userId, { kind: 'remove', skillId: terraformId });
    const after = await profileSkills(db, corrected.id);

    expect(after.map((s) => s.slug)).toEqual(['kubernetes']);
    const kubernetes = after[0];
    expect(kubernetes?.source_span).toBe('Led a Kubernetes migration across 40 services');
    expect(kubernetes?.self_reported).toBe(false);

    // And the removal did not reach backwards.
    expect((await profileSkills(db, original.id)).map((s) => s.slug)).toEqual([
      'kubernetes',
      'terraform',
    ]);
  });

  it('keeps the source span after a correction, so the user can still see what was read', async () => {
    await createProfileVersion(db, {
      userId,
      skills: [evidenced(kubernetesId, 'Mentioned Kubernetes once in a list')],
    });

    const corrected = await applyCorrection(db, userId, {
      kind: 'upsert',
      skillId: kubernetesId,
      status: 'claimed',
    });

    const skill = (await profileSkills(db, corrected.id)).find((s) => s.slug === 'kubernetes');
    expect(skill?.status).toBe('claimed');
    expect(skill?.source_span).toBe('Mentioned Kubernetes once in a list');
  });

  it('does not carry verification onto a corrected row', async () => {
    // Verification is in-platform. A user editing a skill has not re-verified it, and
    // ck_profile_skills__verified_is_evidenced would reject the downgrade anyway.
    await createProfileVersion(db, {
      userId,
      skills: [
        {
          skill_id: kubernetesId,
          status: 'evidenced',
          evidence_kind: 'assessment',
          source_span: 'Passed the in-platform assessment',
          confidence: 'high',
          verified_at: new Date(),
        },
      ],
    });

    const corrected = await applyCorrection(db, userId, {
      kind: 'upsert',
      skillId: kubernetesId,
      status: 'claimed',
    });

    const skill = (await profileSkills(db, corrected.id)).find((s) => s.slug === 'kubernetes');
    expect(skill?.verified_at).toBeNull();
  });

  it('refuses to correct a user with no profile', async () => {
    await expect(
      applyCorrection(db, userId, { kind: 'remove', skillId: kubernetesId }),
    ).rejects.toBeInstanceOf(ProfileInvariantError);
  });
});

describe('validateProfileSkill', () => {
  it('reports every violation at once', () => {
    const errors = validateProfileSkill({
      skill_id: uuidv7(),
      status: 'claimed',
      confidence: 'high',
      verified_at: new Date(),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.rule).toBe('ck_profile_skills__verified_is_evidenced');
  });

  it('accepts a self-reported evidenced skill without a span', () => {
    // A correction has no source text, and demanding one would make the correction path impossible.
    expect(
      validateProfileSkill({
        skill_id: uuidv7(),
        status: 'evidenced',
        evidence_kind: 'role',
        confidence: 'high',
        self_reported: true,
      }),
    ).toEqual([]);
  });
});
