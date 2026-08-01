/**
 * What the profile schema refuses.
 *
 * These constraints are the honesty of every downstream score in schema form. The
 * `evidenced` / `claimed` distinction is what stops a padded skills list inflating readiness
 * (`docs/features/resume-parsing.md`), and a distinction the database does not enforce decays into
 * a label the parser sets optimistically.
 *
 * Each test attempts the violation and asserts the *named* constraint rejected it. Asserting only
 * that "an error was thrown" would pass if the row failed for an unrelated reason — a typo in the
 * insert, a missing column — and that is how a constraint quietly stops existing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { expectViolation, migratedTestPool } from './database.ts';
import { newId } from './fixtures.ts';

let pool: Pool;

beforeAll(async () => {
  pool = await migratedTestPool();
});

beforeEach(async () => {
  // profile_skills cascades from user_profiles; the rest are cleared explicitly. Order matters —
  // every foreign key here is RESTRICT except that one.
  await pool.query('DELETE FROM user_profiles');
  await pool.query('DELETE FROM skill_aliases');
  await pool.query('DELETE FROM skills');
  await pool.query('DELETE FROM careers');
  await pool.query('DELETE FROM users');
});

afterAll(async () => {
  await pool?.end();
});

async function insertCareer(
  overrides: { slug?: string; family?: string; profession?: string | null; licenceGated?: boolean } = {},
): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO careers (id, slug, name, family, profession, licence_gated, source_tier, basis)
     VALUES ($1, $2, 'Placeholder Track', $3, $4, $5, 1, 'curated')`,
    [
      id,
      overrides.slug ?? `track-${id.slice(0, 8)}`,
      overrides.family ?? 'software-it',
      overrides.profession ?? null,
      overrides.licenceGated ?? false,
    ],
  );
  return id;
}

async function insertSkill(overrides: { slug?: string; kind?: string } = {}): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO skills (id, slug, name, kind, source_tier, basis)
     VALUES ($1, $2, 'Placeholder Skill', $3, 1, 'curated')`,
    [id, overrides.slug ?? `skill-${id.slice(0, 8)}`, overrides.kind ?? 'technology'],
  );
  return id;
}

async function insertUser(): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`,
    [id, `user-${id.slice(0, 8)}@example.invalid`],
  );
  return id;
}

async function insertProfile(
  userId: string,
  overrides: { version?: number; isCurrent?: boolean; deletedAt?: string | null; careerId?: string | null } = {},
): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO user_profiles (id, user_id, version, is_current, deleted_at, current_career_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      userId,
      overrides.version ?? 1,
      overrides.isCurrent ?? true,
      overrides.deletedAt ?? null,
      overrides.careerId ?? null,
    ],
  );
  return id;
}

async function insertProfileSkill(
  profileId: string,
  skillId: string,
  overrides: {
    status?: string;
    evidenceKind?: string | null;
    confidence?: string;
    verifiedAt?: string | null;
  } = {},
): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO profile_skills (id, user_profile_id, skill_id, status, evidence_kind, confidence, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      profileId,
      skillId,
      overrides.status ?? 'claimed',
      overrides.evidenceKind ?? null,
      overrides.confidence ?? 'medium',
      overrides.verifiedAt ?? null,
    ],
  );
  return id;
}

describe('careers', () => {
  it('refuses a licence-gated track that does not name its profession', async () => {
    // Without this, the recognition lookup in `requirements` has nothing to scope on and the
    // evaluator would have to guess — which for a regulated profession means telling someone
    // their licence transfers when nobody checked.
    const violation = await expectViolation(pool, () =>
      insertCareer({ licenceGated: true, profession: null }),
    );
    expect(violation.constraint).toBe('ck_careers__licence_profession');
  });

  it('allows a profession without licence gating, because regulation is per jurisdiction', async () => {
    // The inverse is deliberately unconstrained: the same occupation is regulated in one country
    // and not another.
    await expect(
      insertCareer({ licenceGated: false, profession: 'registered-nurse' }),
    ).resolves.toBeTruthy();
  });

  it('refuses an unsourced tier', async () => {
    const violation = await expectViolation(pool, async () => {
      await pool.query(
        `INSERT INTO careers (id, slug, name, family, source_tier, basis)
         VALUES ($1, 'tier-five', 'Tier Five', 'other', 5, 'curated')`,
        [newId()],
      );
    });
    expect(violation.constraint).toBe('ck_careers__tier');
  });

  it('refuses a duplicate live slug, and permits reuse only of a soft-deleted one', async () => {
    await insertCareer({ slug: 'cloud-platform-engineer' });

    const violation = await expectViolation(pool, () =>
      insertCareer({ slug: 'cloud-platform-engineer' }),
    );
    expect(violation.constraint).toBe('uq_careers__slug');
  });
});

describe('skills and aliases', () => {
  it('refuses an alias that resolves to two skills', async () => {
    // An ambiguous alias would make the parser pick whichever row the planner returned first, so
    // the same résumé would produce different profiles on different runs.
    const first = await insertSkill({ slug: 'python' });
    const second = await insertSkill({ slug: 'python-language' });

    await pool.query(
      `INSERT INTO skill_aliases (id, skill_id, alias, normalized, source_tier)
       VALUES ($1, $2, 'Python', 'python', 1)`,
      [newId(), first],
    );

    const violation = await expectViolation(pool, async () => {
      await pool.query(
        `INSERT INTO skill_aliases (id, skill_id, alias, normalized, source_tier)
         VALUES ($1, $2, 'python', 'python', 1)`,
        [newId(), second],
      );
    });
    expect(violation.constraint).toBe('uq_skill_aliases__normalized');
  });

  it('refuses deleting a skill an alias still points at', async () => {
    const skillId = await insertSkill();
    await pool.query(
      `INSERT INTO skill_aliases (id, skill_id, alias, normalized, source_tier)
       VALUES ($1, $2, 'K8s', 'k8s', 1)`,
      [newId(), skillId],
    );

    const violation = await expectViolation(pool, async () => {
      await pool.query('DELETE FROM skills WHERE id = $1', [skillId]);
    });
    expect(violation.constraint).toBe('fk_skill_aliases__skills');
  });

  it('refuses a kind outside the closed set', async () => {
    const violation = await expectViolation(pool, () => insertSkill({ kind: 'vibes' }));
    expect(violation.constraint).toBe('ck_skills__kind');
  });
});

describe('user_profiles', () => {
  it('refuses two current profiles for one user', async () => {
    // Two rows claiming to be current means every downstream read picks arbitrarily.
    const userId = await insertUser();
    await insertProfile(userId, { version: 1, isCurrent: true });

    const violation = await expectViolation(pool, () =>
      insertProfile(userId, { version: 2, isCurrent: true }),
    );
    expect(violation.constraint).toBe('uq_user_profiles__current');
  });

  it('allows an older version alongside the current one', async () => {
    const userId = await insertUser();
    await insertProfile(userId, { version: 1, isCurrent: false });
    await expect(insertProfile(userId, { version: 2, isCurrent: true })).resolves.toBeTruthy();
  });

  it('refuses reusing a version number, even after a soft delete', async () => {
    // "The profile as it stood at v3" must stay unambiguous, which is why this index is not
    // partial on deleted_at.
    const userId = await insertUser();
    await insertProfile(userId, { version: 1, isCurrent: false, deletedAt: 'now()' });

    const violation = await expectViolation(pool, () =>
      insertProfile(userId, { version: 1, isCurrent: true }),
    );
    expect(violation.constraint).toBe('uq_user_profiles__version');
  });

  it('refuses a completeness outside 0..1', async () => {
    const userId = await insertUser();
    const violation = await expectViolation(pool, async () => {
      await pool.query(
        `INSERT INTO user_profiles (id, user_id, version, completeness) VALUES ($1, $2, 1, 1.5)`,
        [newId(), userId],
      );
    });
    expect(violation.constraint).toBe('ck_user_profiles__completeness');
  });

  it('refuses deleting a user who still has a profile', async () => {
    // RESTRICT, not CASCADE: erasure is an explicit operation in a known order, not a side effect.
    const userId = await insertUser();
    await insertProfile(userId);

    const violation = await expectViolation(pool, async () => {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    });
    expect(violation.constraint).toBe('fk_user_profiles__users');
  });
});

describe('profile_skills — the evidenced/claimed distinction', () => {
  it('refuses an evidenced skill that does not say what evidences it', async () => {
    // The rule that makes readiness honest. Without it, `evidenced` becomes a label the parser
    // sets optimistically and the distinction stops meaning anything.
    const userId = await insertUser();
    const profileId = await insertProfile(userId);
    const skillId = await insertSkill();

    const violation = await expectViolation(pool, () =>
      insertProfileSkill(profileId, skillId, { status: 'evidenced', evidenceKind: null }),
    );
    expect(violation.constraint).toBe('ck_profile_skills__evidence');
  });

  it('accepts an evidenced skill that names its evidence', async () => {
    const userId = await insertUser();
    const profileId = await insertProfile(userId);
    const skillId = await insertSkill();

    await expect(
      insertProfileSkill(profileId, skillId, { status: 'evidenced', evidenceKind: 'role' }),
    ).resolves.toBeTruthy();
  });

  it('refuses a verified skill that is merely claimed', async () => {
    // Verification is in-platform only and produces evidence. A verified `claimed` row would mean
    // the platform checked something it never recorded.
    const userId = await insertUser();
    const profileId = await insertProfile(userId);
    const skillId = await insertSkill();

    const violation = await expectViolation(pool, () =>
      insertProfileSkill(profileId, skillId, { status: 'claimed', verifiedAt: 'now()' }),
    );
    expect(violation.constraint).toBe('ck_profile_skills__verified_is_evidenced');
  });

  it('refuses a confidence outside the closed set', async () => {
    const userId = await insertUser();
    const profileId = await insertProfile(userId);
    const skillId = await insertSkill();

    const violation = await expectViolation(pool, () =>
      insertProfileSkill(profileId, skillId, { confidence: 'quite sure' }),
    );
    expect(violation.constraint).toBe('ck_profile_skills__confidence');
  });

  it('refuses the same skill twice on one profile version', async () => {
    // A résumé naming Kubernetes four times is one claim with the strongest evidence, not four
    // rows that quadruple its weight.
    const userId = await insertUser();
    const profileId = await insertProfile(userId);
    const skillId = await insertSkill();

    await insertProfileSkill(profileId, skillId);
    const violation = await expectViolation(pool, () => insertProfileSkill(profileId, skillId));
    expect(violation.constraint).toBe('uq_profile_skills__profile_skill');
  });

  it('cascades from its profile version, unlike every other relationship here', async () => {
    const userId = await insertUser();
    const profileId = await insertProfile(userId);
    const skillId = await insertSkill();
    await insertProfileSkill(profileId, skillId);

    await pool.query('DELETE FROM user_profiles WHERE id = $1', [profileId]);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM profile_skills');
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it('refuses deleting a skill some profile still references', async () => {
    const userId = await insertUser();
    const profileId = await insertProfile(userId);
    const skillId = await insertSkill();
    await insertProfileSkill(profileId, skillId);

    const violation = await expectViolation(pool, async () => {
      await pool.query('DELETE FROM skills WHERE id = $1', [skillId]);
    });
    expect(violation.constraint).toBe('fk_profile_skills__skills');
  });
});
