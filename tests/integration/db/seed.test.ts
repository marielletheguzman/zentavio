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
  await pool.query('DELETE FROM career_skills');
  await pool.query('DELETE FROM skill_edges');
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

  it('seeds a graph whose every edge is sourced and tier-bounded', async () => {
    // "Sourced edges" is on M1b's not-cuttable list. Curated at tier 3 is the honest posture for a
    // hand-authored graph: it is checkable, and tier 3 maps to `low` confidence downstream, which
    // is the intended consequence rather than a shortcoming to fix later.
    await applySeed(pool, await loadSeedFile(seedPath));

    const { rows } = await pool.query<{ bad: string }>(
      `SELECT count(*)::text AS bad FROM skill_edges
        WHERE deleted_at IS NULL AND (source_tier <> 3 OR basis <> 'curated')`,
    );
    expect(rows[0]?.bad).toBe('0');

    const { rows: requirements } = await pool.query<{ bad: string }>(
      `SELECT count(*)::text AS bad FROM career_skills
        WHERE deleted_at IS NULL AND (source_tier <> 3 OR basis <> 'curated')`,
    );
    expect(requirements[0]?.bad).toBe('0');
  });

  it('keeps requires-edges sparse enough to be walkable', async () => {
    // An over-eager prerequisite makes a learning path longer than the gap requires, which makes a
    // reachable target look unreachable (`docs/database/entities/skill.md`). This is a smell test,
    // not a proof: it fails loudly if someone starts asserting that everything requires everything.
    await applySeed(pool, await loadSeedFile(seedPath));

    const { rows } = await pool.query<{ requires: string; skills: string }>(
      `SELECT (SELECT count(*) FROM skill_edges WHERE edge_type = 'requires' AND deleted_at IS NULL)::text AS requires,
              (SELECT count(*) FROM skills WHERE deleted_at IS NULL)::text AS skills`,
    );
    const requires = Number(rows[0]?.requires);
    const skills = Number(rows[0]?.skills);
    expect(requires).toBeGreaterThan(0);
    expect(requires).toBeLessThan(skills);
  });

  it('has no cycle among requires-edges, so a gap has a first step', async () => {
    // The database cannot catch this: every individual row is legal, and only the whole set is
    // cyclic. A ring of prerequisites means there is nothing the user can start with.
    await applySeed(pool, await loadSeedFile(seedPath));

    const { rows } = await pool.query<{ cycle: string | null }>(
      `WITH RECURSIVE walk(root, node, depth) AS (
         SELECT from_skill_id, to_skill_id, 1 FROM skill_edges
          WHERE edge_type = 'requires' AND deleted_at IS NULL
         UNION ALL
         SELECT w.root, e.to_skill_id, w.depth + 1
           FROM walk w
           JOIN skill_edges e ON e.from_skill_id = w.node
          WHERE e.edge_type = 'requires' AND e.deleted_at IS NULL AND w.depth < 20
       )
       SELECT s.slug AS cycle FROM walk w JOIN skills s ON s.id = w.root
        WHERE w.node = w.root LIMIT 1`,
    );
    expect(rows[0]?.cycle ?? null).toBeNull();
  });

  it('does not migrate career_edges — transferability has no reader yet', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'career_edges'`,
    );
    expect(rows).toEqual([]);
  });

  it('scopes a market-specific requirement rather than making it global', async () => {
    // German is a real requirement for a Berlin role and absent for a remote-worldwide one.
    // Storing it globally would put it in every gap, everywhere.
    await applySeed(pool, await loadSeedFile(seedPath));

    const { rows } = await pool.query<{ slug: string; market_scope: string | null }>(
      `SELECT s.slug, cs.market_scope FROM career_skills cs
         JOIN skills s ON s.id = cs.skill_id
        WHERE cs.market_scope IS NOT NULL AND cs.deleted_at IS NULL`,
    );
    expect(rows).toEqual([{ slug: 'german', market_scope: 'DE' }]);
  });
});
