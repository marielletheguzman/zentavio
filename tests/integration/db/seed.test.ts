/**
 * The seed against a real PostgreSQL.
 *
 * Two things are only knowable here: that the shipped seed file actually satisfies the constraints
 * the schema imposes, and that re-running it changes nothing. The second is what makes the command
 * safe to put in a startup script — an "idempotent" loader that quietly duplicates rows on the
 * second run is worse than one that refuses.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { applySeed, loadSeedFile, normalizeAlias, seedsDirectory, validateSeed } from '@zentavio/db';
import { join } from 'node:path';
import { migratedTestPool } from './database.ts';

let pool: Pool;
const seedPath = join(seedsDirectory, 'cloud-platform-engineering.json');

beforeAll(async () => {
  pool = await migratedTestPool();
});

beforeEach(async () => {
  await pool.query('DELETE FROM skill_aliases');
  await pool.query('DELETE FROM skills');
  await pool.query('DELETE FROM careers');
});

afterAll(async () => {
  await pool?.end();
});

async function counts(): Promise<{ skills: number; careers: number; aliases: number }> {
  const { rows } = await pool.query<{ skills: string; careers: string; aliases: string }>(
    `SELECT (SELECT count(*) FROM skills)        AS skills,
            (SELECT count(*) FROM careers)       AS careers,
            (SELECT count(*) FROM skill_aliases) AS aliases`,
  );
  const row = rows[0] as { skills: string; careers: string; aliases: string };
  return { skills: Number(row.skills), careers: Number(row.careers), aliases: Number(row.aliases) };
}

describe('the shipped seed file', () => {
  it('passes its own validation', async () => {
    // If the file that actually ships is invalid, every unit test above proved a hypothetical.
    expect(validateSeed(await loadSeedFile(seedPath))).toEqual([]);
  });

  it('loads into a real schema', async () => {
    const seed = await loadSeedFile(seedPath);
    const plan = await applySeed(pool, seed);

    expect(plan.careersInserted).toBe(1);
    expect(plan.skillsInserted).toBe(seed.skills.length);
    expect(plan.skillsUpdated).toBe(0);

    const after = await counts();
    expect(after.skills).toBe(seed.skills.length);
    expect(after.careers).toBe(1);
    expect(after.aliases).toBeGreaterThan(seed.skills.length);
  });

  it('is idempotent — a second run inserts nothing', async () => {
    const seed = await loadSeedFile(seedPath);
    await applySeed(pool, seed);
    const first = await counts();

    const second = await applySeed(pool, seed);
    expect(second.skillsInserted).toBe(0);
    expect(second.careersInserted).toBe(0);
    expect(second.aliasesInserted).toBe(0);
    expect(await counts()).toEqual(first);
  });

  it('writes nothing on a dry run', async () => {
    const seed = await loadSeedFile(seedPath);
    const plan = await applySeed(pool, seed, { dryRun: true });

    // The plan reports what *would* happen, and the database is untouched. A dry run that writes is
    // not a dry run.
    expect(plan.skillsInserted).toBe(seed.skills.length);
    expect(await counts()).toEqual({ skills: 0, careers: 0, aliases: 0 });
  });

  it('resolves the aliases a résumé would actually contain', async () => {
    await applySeed(pool, await loadSeedFile(seedPath));

    const expected: ReadonlyArray<readonly [string, string]> = [
      ['k8s', 'kubernetes'],
      ['Kubernetes (K8s)', 'kubernetes'],
      ['golang', 'go'],
      ['Postgres', 'postgresql'],
      ['CI/CD', 'ci-cd'],
      ['IaC', 'infrastructure-as-code'],
      ['Deutsch', 'german'],
    ];

    for (const [phrase, slug] of expected) {
      const { rows } = await pool.query<{ slug: string }>(
        `SELECT s.slug FROM skill_aliases a JOIN skills s ON s.id = a.skill_id WHERE a.normalized = $1`,
        [normalizeAlias(phrase)],
      );
      expect(rows.map((r) => r.slug), `"${phrase}" should resolve to ${slug}`).toEqual([slug]);
    }
  });

  it('stores every row at the tier its provenance justifies', async () => {
    // tier 3 maps to `low` confidence. If a seeded row ever claims tier 1, everything computed from
    // it starts presenting as confident — which is the failure this assertion exists to catch.
    await applySeed(pool, await loadSeedFile(seedPath));

    const { rows } = await pool.query<{ source_tier: number; basis: string; retrieved_at: Date | null }>(
      'SELECT source_tier, basis, retrieved_at FROM skills',
    );
    expect(rows.every((r) => r.source_tier === 3)).toBe(true);
    expect(rows.every((r) => r.basis === 'curated')).toBe(true);
    // Nothing was retrieved, so nothing claims to have been.
    expect(rows.every((r) => r.retrieved_at === null)).toBe(true);
  });

  it('leaves the graph empty — the skill set is not the graph', async () => {
    // M1b owns requires-edges and career_skills, and neither table exists yet. If a future seed
    // starts asserting edges without a method, every learning path becomes a guess presented as a
    // sequence.
    await applySeed(pool, await loadSeedFile(seedPath));

    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('skill_edges', 'career_skills', 'career_edges')`,
    );
    expect(rows).toEqual([]);
  });
});
