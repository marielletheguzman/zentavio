/**
 * `@zentavio/db` — schema, migrations, and repositories (ADR-0012).
 *
 * PostgreSQL is the system of record. `pg` is the driver, Kysely provides typed queries, and
 * migrations are plain `.sql` files applied by the runner here — no ORM and no schema DSL, because
 * `docs/database/entities/*.md` is the schema specification.
 *
 * **What is not here yet:** the migration `.sql` files, because no PostgreSQL was reachable to
 * execute them and this schema's meaning lives largely in `CHECK` constraints. See the README.
 */

export { createCompileOnlyDb, createDb, type DbConnectionOptions } from './client.js';

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
