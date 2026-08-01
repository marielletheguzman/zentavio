/**
 * Loader + executor + runner, wired together.
 *
 * This is the only place the three meet, which keeps each of them independently testable: the
 * runner without a filesystem, the loader without a database, and this without either being
 * mocked — `docs/development/testing.md` forbids mocking PostgreSQL, so the test for this is an
 * integration test against a real one.
 */

import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { PostgresMigrationExecutor } from './executor.ts';
import { loadMigrationFiles } from './files.ts';
import { migrate, type MigrateResult } from './runner.ts';

/**
 * `packages/db/migrations/`, resolved from this module rather than from the working directory —
 * running migrations must not depend on where the command was typed.
 */
export const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));

export interface ApplyMigrationsOptions {
  readonly pool: Pool;
  /** Overridable so an integration test can apply a fixture set. */
  readonly directory?: string;
}

export async function applyMigrations(options: ApplyMigrationsOptions): Promise<MigrateResult> {
  const executor = new PostgresMigrationExecutor(options.pool);
  await executor.ensureBookkeeping();
  const files = await loadMigrationFiles(options.directory ?? migrationsDirectory);
  return migrate(files, executor);
}
