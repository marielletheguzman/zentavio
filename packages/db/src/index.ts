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

export { createCompileOnlyDb, createDb, type DbConnectionOptions } from './client.ts';

export { applyMigrations, migrationsDirectory, type ApplyMigrationsOptions } from './migrations/apply.ts';
export { PostgresMigrationExecutor } from './migrations/executor.ts';
export { loadMigrationFiles, migrationIdFromFilename } from './migrations/files.ts';

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
} from './migrations/runner.ts';

export {
  RequirementInvariantError,
  insertRequirement,
  requirementsAsOf,
  staleRequirements,
  supersedeRequirement,
  validateRequirement,
  type NewRequirement,
} from './repositories/requirements.ts';

export type {
  Database,
  EvaluationColumn,
  ImmigrationPathwaysTable,
  ImposedByColumn,
  RequirementDomainColumn,
  RequirementKindColumn,
  RequirementsTable,
  SchemaMigrationsTable,
  UserStatusColumn,
  UsersTable,
} from './schema.ts';
