/**
 * The integration suite's database handle.
 *
 * A real PostgreSQL, never a substitute: `docs/development/testing.md` forbids mocking it, because
 * dialect behaviour — what a `CHECK` actually rejects, what a partial unique index actually permits
 * — is the entire thing these tests exist to establish.
 *
 * Start it with:
 *
 *     docker compose -f infra/docker/docker-compose.dev.yml up -d --wait
 */

import { Pool } from 'pg';
import { load, testDatabaseSchema } from '@zentavio/config';
import { applyMigrations } from '@zentavio/db';

/**
 * The guard that makes `resetSchema` safe to run.
 *
 * `infra/docker/postgres/init/01-create-test-database.sql` creates a database named `zentavio_test`,
 * but that file cannot stop someone pointing `ZENTAVIO_TEST_DATABASE_URL` at their working
 * database. This can, and it is checked on every run rather than once at setup.
 */
export function assertTestDatabase(connectionString: string): void {
  let name: string;
  try {
    name = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('ZENTAVIO_TEST_DATABASE_URL is not a parseable connection string');
  }

  if (!name.endsWith('_test')) {
    throw new Error(
      `refusing to run integration tests against database "${name}": the suite drops and ` +
        'recreates its schema, and only a database whose name ends in _test may be treated that way.',
    );
  }
}

export function createTestPool(): Pool {
  const { testDatabaseUrl } = load(testDatabaseSchema);
  assertTestDatabase(testDatabaseUrl);
  return new Pool({ connectionString: testDatabaseUrl, max: 4, connectionTimeoutMillis: 5_000 });
}

/**
 * Drop everything and rebuild from the migrations.
 *
 * Rebuilding rather than truncating is deliberate: it proves on every run that the migration set
 * applies from empty, which is the only state a fresh environment or CI will ever be in.
 */
export async function resetSchema(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

export async function migratedTestPool(): Promise<Pool> {
  const pool = createTestPool();
  await resetSchema(pool);
  await applyMigrations({ pool });
  return pool;
}

/**
 * Run a statement expected to fail, and return the PostgreSQL error.
 *
 * Asserting on the constraint *name* is what makes a constraint test meaningful. A bare "it threw"
 * passes just as happily when the insert failed for a typo in a column name — which is exactly how
 * a constraint that never rejects anything gets a green test.
 */
export async function expectViolation(
  pool: Pool,
  run: () => Promise<unknown>,
): Promise<{ constraint: string | undefined; code: string | undefined; message: string }> {
  try {
    await run();
  } catch (error) {
    const pgError = error as { constraint?: string; code?: string; message?: string };
    return {
      constraint: pgError.constraint,
      code: pgError.code,
      message: pgError.message ?? String(error),
    };
  }
  throw new Error('expected the statement to be rejected, but it succeeded');
}
