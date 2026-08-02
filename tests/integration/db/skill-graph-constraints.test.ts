/**
 * What the skill graph refuses.
 *
 * M1b computes a gap by subtracting a profile from `career_skills` and ordering the remainder by
 * `skill_edges.requires`. Both inputs are facts about the world, so the constraints here are the
 * ones that keep a model's opinion, a duplicate weight, or a self-referential edge out of a
 * calculation a person will act on.
 *
 * Each test attempts the violation and asserts the *named* constraint rejected it. Asserting only
 * that "an error was thrown" would pass if the row failed for an unrelated reason, and that is how
 * a constraint quietly stops existing.
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
  await pool.query('DELETE FROM user_targets');
  await pool.query('DELETE FROM career_skills');
  await pool.query('DELETE FROM skill_edges');
  await pool.query('DELETE FROM skills');
  await pool.query('DELETE FROM careers');
  await pool.query('DELETE FROM users');
});

afterAll(async () => {
  await pool?.end();
});

// UUIDv7's leading hex is a millisecond timestamp, so two ids minted in the same millisecond
// share their prefix. Deriving a slug from `id.slice(0, 8)` collided on `uq_skills__slug` as soon
// as a test inserted two rows in a tight loop — a counter is the honest source of uniqueness here.
let sequence = 0;
function nextSlug(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

async function insertSkill(slug?: string): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO skills (id, slug, name, kind, source_tier, basis)
     VALUES ($1, $2, 'Placeholder Skill', 'technology', 1, 'curated')`,
    [id, slug ?? nextSlug('skill')],
  );
  return id;
}

async function insertCareer(slug?: string): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO careers (id, slug, name, family, licence_gated, source_tier, basis)
     VALUES ($1, $2, 'Placeholder Track', 'software-it', false, 1, 'curated')`,
    [id, slug ?? nextSlug('track')],
  );
  return id;
}

interface EdgeOverrides {
  readonly from?: string;
  readonly to?: string;
  readonly edgeType?: string;
  readonly weight?: number;
  readonly basis?: string;
  readonly support?: number | null;
  readonly sourceTier?: number;
  readonly deletedAt?: string | null;
}

async function insertEdge(from: string, to: string, overrides: EdgeOverrides = {}): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO skill_edges (id, from_skill_id, to_skill_id, edge_type, weight, basis, support, source_tier, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      overrides.from ?? from,
      overrides.to ?? to,
      overrides.edgeType ?? 'requires',
      overrides.weight ?? 0.8,
      overrides.basis ?? 'curated',
      overrides.support ?? null,
      overrides.sourceTier ?? 3,
      overrides.deletedAt ?? null,
    ],
  );
  return id;
}

interface CareerSkillOverrides {
  readonly weight?: number;
  readonly cluster?: string;
  readonly basis?: string;
  readonly support?: number | null;
  readonly marketScope?: string | null;
  readonly sourceTier?: number;
}

async function insertCareerSkill(
  careerId: string,
  skillId: string,
  overrides: CareerSkillOverrides = {},
): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO career_skills (id, career_id, skill_id, weight, cluster, basis, support, market_scope, source_tier)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      careerId,
      skillId,
      overrides.weight ?? 0.9,
      overrides.cluster ?? 'core',
      overrides.basis ?? 'curated',
      overrides.support ?? null,
      overrides.marketScope ?? null,
      overrides.sourceTier ?? 3,
    ],
  );
  return id;
}

describe('skill_edges', () => {
  it('rejects an edge from a skill to itself', async () => {
    // A self-edge makes any dependency ordering cyclic on arrival, and the gap M1b produces is
    // dependency-ordered.
    const skill = await insertSkill();
    const violation = await expectViolation(pool, () => insertEdge(skill, skill));
    expect(violation.constraint).toBe('ck_skill_edges__no_self');
  });

  it('rejects a tier-5 edge', async () => {
    // The enforcement of "no tier-5 value in a fact table". An LLM asked "what skills relate to
    // Kubernetes?" produces a tier-5 answer, and this is what stops it being written here.
    const [from, to] = [await insertSkill(), await insertSkill()];
    const violation = await expectViolation(pool, () => insertEdge(from, to, { sourceTier: 5 }));
    expect(violation.constraint).toBe('ck_skill_edges__tier');
  });

  it('rejects a weight outside 0..1', async () => {
    const [from, to] = [await insertSkill(), await insertSkill()];
    const violation = await expectViolation(pool, () => insertEdge(from, to, { weight: 1.5 }));
    expect(violation.constraint).toBe('ck_skill_edges__weight');
  });

  it('rejects an unknown edge type', async () => {
    const [from, to] = [await insertSkill(), await insertSkill()];
    const violation = await expectViolation(pool, () =>
      insertEdge(from, to, { edgeType: 'related_somehow' }),
    );
    expect(violation.constraint).toBe('ck_skill_edges__type');
  });

  it('rejects a co-occurrence edge that does not say how many observations back it', async () => {
    // A weight of 0.8 from two postings and from two thousand are different facts.
    const [from, to] = [await insertSkill(), await insertSkill()];
    const violation = await expectViolation(pool, () =>
      insertEdge(from, to, { basis: 'posting-cooccurrence', support: null }),
    );
    expect(violation.constraint).toBe('ck_skill_edges__derived_support');
  });

  it('accepts a co-occurrence edge that states its support', async () => {
    const [from, to] = [await insertSkill(), await insertSkill()];
    await expect(
      insertEdge(from, to, { basis: 'posting-cooccurrence', support: 2000 }),
    ).resolves.toBeTruthy();
  });

  it('rejects a duplicate (from, to, type) among live rows', async () => {
    // Two `requires` edges with different weights would make the gap depend on row order.
    const [from, to] = [await insertSkill(), await insertSkill()];
    await insertEdge(from, to, { weight: 0.8 });
    const violation = await expectViolation(pool, () => insertEdge(from, to, { weight: 0.4 }));
    expect(violation.constraint).toBe('uq_skill_edges__triple');
  });

  it('allows the same pair under two different edge types', async () => {
    // `requires` and `tooling_of` are different claims about the same pair, and both are useful.
    const [from, to] = [await insertSkill(), await insertSkill()];
    await insertEdge(from, to, { edgeType: 'requires' });
    await expect(insertEdge(from, to, { edgeType: 'tooling_of' })).resolves.toBeTruthy();
  });

  it('allows a replacement once the old edge is soft-deleted', async () => {
    // The unique index is partial, so correcting an edge does not require destroying the record
    // that the old one existed.
    const [from, to] = [await insertSkill(), await insertSkill()];
    const first = await insertEdge(from, to);
    await pool.query('UPDATE skill_edges SET deleted_at = now() WHERE id = $1', [first]);
    await expect(insertEdge(from, to, { weight: 0.4 })).resolves.toBeTruthy();
  });

  it('refuses to delete a skill an edge still points at', async () => {
    // RESTRICT, not CASCADE: removing a skill must not silently remove the graph around it.
    const [from, to] = [await insertSkill(), await insertSkill()];
    await insertEdge(from, to);
    const violation = await expectViolation(pool, () =>
      pool.query('DELETE FROM skills WHERE id = $1', [to]),
    );
    expect(violation.constraint).toBe('fk_skill_edges__to');
  });
});

describe('career_skills', () => {
  it('rejects an unknown cluster', async () => {
    const [career, skill] = [await insertCareer(), await insertSkill()];
    const violation = await expectViolation(pool, () =>
      insertCareerSkill(career, skill, { cluster: 'nice-to-have' }),
    );
    expect(violation.constraint).toBe('ck_career_skills__cluster');
  });

  it('rejects a tier-5 requirement', async () => {
    const [career, skill] = [await insertCareer(), await insertSkill()];
    const violation = await expectViolation(pool, () =>
      insertCareerSkill(career, skill, { sourceTier: 5 }),
    );
    expect(violation.constraint).toBe('ck_career_skills__tier');
  });

  it('rejects a posting-derived requirement with no support', async () => {
    const [career, skill] = [await insertCareer(), await insertSkill()];
    const violation = await expectViolation(pool, () =>
      insertCareerSkill(career, skill, { basis: 'posting-frequency', support: null }),
    );
    expect(violation.constraint).toBe('ck_career_skills__derived_support');
  });

  it('rejects two global rows for the same career and skill', async () => {
    // The COALESCE in the unique index is what makes this fail. A plain unique index would permit
    // it, because in SQL NULL is distinct from NULL — and the gap would then count one requirement
    // twice.
    const [career, skill] = [await insertCareer(), await insertSkill()];
    await insertCareerSkill(career, skill, { marketScope: null });
    const violation = await expectViolation(pool, () =>
      insertCareerSkill(career, skill, { marketScope: null }),
    );
    expect(violation.constraint).toBe('uq_career_skills__career_skill_market');
  });

  it('allows a global row and a market-specific row to coexist', async () => {
    // German for a Berlin role is real in one market and absent in another. Both rows exist and the
    // more specific one wins during evaluation.
    const [career, skill] = [await insertCareer(), await insertSkill()];
    await insertCareerSkill(career, skill, { marketScope: null });
    await expect(insertCareerSkill(career, skill, { marketScope: 'DE' })).resolves.toBeTruthy();
  });
});

describe('user_targets', () => {
  async function insertUser(): Promise<string> {
    const id = newId();
    await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
      id,
      `${nextSlug('user')}@example.invalid`,
    ]);
    return id;
  }

  async function insertTarget(
    userId: string,
    careerId: string,
    overrides: { rank?: number; status?: string } = {},
  ): Promise<string> {
    const id = newId();
    await pool.query(
      `INSERT INTO user_targets (id, user_id, career_id, rank, status) VALUES ($1, $2, $3, $4, $5)`,
      [id, userId, careerId, overrides.rank ?? 1, overrides.status ?? 'active'],
    );
    return id;
  }

  it('rejects an unknown status', async () => {
    const [user, career] = [await insertUser(), await insertCareer()];
    const violation = await expectViolation(pool, () =>
      insertTarget(user, career, { status: 'maybe' }),
    );
    expect(violation.constraint).toBe('ck_user_targets__status');
  });

  it('rejects a rank below 1', async () => {
    const [user, career] = [await insertUser(), await insertCareer()];
    const violation = await expectViolation(pool, () => insertTarget(user, career, { rank: 0 }));
    expect(violation.constraint).toBe('ck_user_targets__rank');
  });

  it('rejects the same career targeted twice by one user', async () => {
    const [user, career] = [await insertUser(), await insertCareer()];
    await insertTarget(user, career, { rank: 1 });
    const violation = await expectViolation(pool, () =>
      insertTarget(user, career, { rank: 2 }),
    );
    expect(violation.constraint).toBe('uq_user_targets__user_career');
  });

  it('rejects two active targets at the same rank', async () => {
    const user = await insertUser();
    await insertTarget(user, await insertCareer(), { rank: 1 });
    const second = await insertCareer();
    const violation = await expectViolation(pool, () => insertTarget(user, second, { rank: 1 }));
    expect(violation.constraint).toBe('uq_user_targets__user_rank');
  });

  it('frees a rank when a target is abandoned', async () => {
    // The rank index is partial on `status = 'active'`, so giving up on a target does not force a
    // renumber of everything below it.
    const user = await insertUser();
    const abandoned = await insertTarget(user, await insertCareer(), { rank: 1 });
    await pool.query(`UPDATE user_targets SET status = 'abandoned' WHERE id = $1`, [abandoned]);
    await expect(insertTarget(user, await insertCareer(), { rank: 1 })).resolves.toBeTruthy();
  });

  it('refuses to delete a career someone is targeting', async () => {
    const [user, career] = [await insertUser(), await insertCareer()];
    await insertTarget(user, career);
    const violation = await expectViolation(pool, () =>
      pool.query('DELETE FROM careers WHERE id = $1', [career]),
    );
    expect(violation.constraint).toBe('fk_user_targets__careers');
  });
});
