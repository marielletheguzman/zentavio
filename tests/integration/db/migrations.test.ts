/**
 * The migration set, applied to a real PostgreSQL.
 *
 * `packages/db/src/migrations/runner.test.ts` already proves the ordering and refusal logic against
 * a fake executor. What it cannot prove is that the SQL is valid, that it applies from empty, or
 * that a second run is a no-op against a live `schema_migrations` — which is what this covers.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { applyMigrations, loadMigrationFiles, migrationsDirectory } from '@zentavio/db';
import { migratedTestPool, resetSchema } from './database.ts';
import { parseDeclaredTables } from './declared-schema.ts';

let pool: Pool;

beforeAll(async () => {
  pool = await migratedTestPool();
});

afterAll(async () => {
  await pool?.end();
});

describe('migrations', () => {
  it('applies every file from an empty database', async () => {
    const files = await loadMigrationFiles(migrationsDirectory);
    expect(files.length).toBeGreaterThan(0);

    const { rows } = await pool.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM schema_migrations ORDER BY id',
    );

    expect(rows.map((r) => r.id)).toEqual(files.map((f) => f.id));
    // A recorded checksum is what makes an edited-after-applying migration detectable at all.
    expect(rows.every((r) => r.checksum.length > 0)).toBe(true);
  });

  it('is a no-op on a second run', async () => {
    const result = await applyMigrations({ pool });
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('creates the tables the Database interface declares', async () => {
    // Compared against the parsed interface rather than a literal. This assertion used to hardcode
    // its table list, so it had to be hand-edited on every migration and would have gone stale
    // silently the first time someone forgot — while still reading as though it checked the
    // interface it names.
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const declared = [...parseDeclaredTables().keys()].sort();
    expect(rows.map((r) => r.table_name)).toEqual(declared);
  });

  it('creates every documented index', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
    );
    const names = rows.map((r) => r.indexname);

    // The unique indexes are correctness, not performance: uq_req__current is what makes exactly
    // one live version per requirement_id true, and uq_ip__pathway_id is the foreign-key target.
    expect(names).toContain('uq_req__current');
    expect(names).toContain('uq_req__id_version');
    expect(names).toContain('uq_ip__pathway_id');
    expect(names).toContain('uq_users__email');
    expect(names).toContain('uq_users__auth_subject');

    // The profile schema's correctness indexes. uq_user_profiles__current is what makes "exactly
    // one live profile per user" true; uq_skill_aliases__normalized is what stops an ambiguous
    // alias resolving to whichever skill the planner returned first.
    expect(names).toContain('uq_careers__slug');
    expect(names).toContain('uq_skills__slug');
    expect(names).toContain('uq_skill_aliases__normalized');
    expect(names).toContain('uq_user_profiles__current');
    expect(names).toContain('uq_user_profiles__version');
    expect(names).toContain('uq_profile_skills__profile_skill');

    for (const index of [
      'idx_req__pathway_current',
      'idx_req__profession',
      'idx_req__domain',
      'idx_req__asof',
      'idx_req__stale',
    ]) {
      expect(names).toContain(index);
    }
  });

  it('applies cleanly again after the schema is dropped', async () => {
    // The state every fresh environment and every CI run starts in.
    await resetSchema(pool);
    const result = await applyMigrations({ pool });
    const files = await loadMigrationFiles(migrationsDirectory);
    expect(result.applied).toEqual(files.map((f) => f.id));
  });
});
