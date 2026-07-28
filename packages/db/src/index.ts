/**
 * `@zentavio/db` — schema, migrations, and repositories (ADR-0012).
 *
 * PostgreSQL is the system of record. `pg` is the driver, Kysely provides typed queries, and
 * migrations are plain `.sql` files applied by the runner here — no ORM and no schema DSL, because
 * `docs/database/entities/*.md` is the schema specification.
 *
 * **What exists so far:** the migration runner and its tests. The migration SQL, the `Database`
 * interface, and the repositories are not written yet — see the README for why, and what unblocks
 * them.
 */

export {
  MigrationError,
  checksum,
  isNonTransactional,
  migrate,
  plan,
  type MigrateResult,
  type MigrationExecutor,
  type MigrationFile,
  type PlanEntry,
} from './migrations/runner.js';
