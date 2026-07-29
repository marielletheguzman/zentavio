/**
 * `@zentavio/db` — schema, migrations, and repositories (ADR-0012).
 *
 * PostgreSQL is the system of record. `pg` is the driver, Kysely provides typed queries, and
 * migrations are plain `.sql` files applied by the runner here — no ORM and no schema DSL, because
 * `docs/database/entities/*.md` is the schema specification.
 *
 * **What is not here yet:** a standalone `migrate` command. Applying migrations is exported from
 * here and exercised by the integration suite; a CLI needs a decision about how TypeScript is run
 * outside Vitest. See the README.
 */

export { createCompileOnlyDb, createDb, type DbConnectionOptions } from './client.js';

export { applyMigrations, migrationsDirectory, type ApplyMigrationsOptions } from './migrations/apply.js';
export { PostgresMigrationExecutor } from './migrations/executor.js';
export { loadMigrationFiles, migrationIdFromFilename } from './migrations/files.js';

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

export {
  RequirementInvariantError,
  insertRequirement,
  requirementsAsOf,
  staleRequirements,
  supersedeRequirement,
  validateRequirement,
  type NewRequirement,
} from './repositories/requirements.js';

export type {
  Database,
  EvaluationColumn,
  ImmigrationPathwaysTable,
  ImposedByColumn,
  RequirementDomainColumn,
  RequirementKindColumn,
  RequirementsTable,
  SchemaMigrationsTable,
} from './schema.js';
