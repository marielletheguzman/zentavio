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

export { uuidv7, uuidv7Timestamp } from './uuid.ts';

export {
  applySeed,
  loadSeedFile,
  normalizeAlias,
  seedsDirectory,
  validateSeed,
  type SeedCareer,
  type SeedFile,
  type SeedPlan,
  type SeedSkill,
} from './seed.ts';

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

export {
  ProfileInvariantError,
  applyCorrection,
  createProfileVersion,
  currentProfile,
  profileSkills,
  validateProfileSkill,
  type Correction,
  type CreateProfileVersionOptions,
  type NewProfile,
  type NewProfileSkill,
  type ProfileSkillInput,
  type ProfileVersion,
} from './repositories/profiles.ts';

export { eraseUser, hasPersonalData, type ErasureReport } from './repositories/erasure.ts';

export {
  careerBySlug,
  careerRequirements,
  heldSkills,
  licenceScopeForUser,
  primaryTarget,
  setTarget,
  skillGraph,
  type EdgeRow,
  type HeldSkillRow,
  type LicenceScope,
  type RequirementRow,
  type SetTargetOptions,
  type UserTarget,
} from './repositories/targets.ts';

export type {
  Database,
  EvaluationColumn,
  ImmigrationPathwaysTable,
  ImposedByColumn,
  RequirementDomainColumn,
  RequirementKindColumn,
  RequirementSourceRole,
  RequirementSourcesTable,
  RequirementsTable,
  SchemaMigrationsTable,
  UserStatusColumn,
  UsersTable,
} from './schema.ts';

export {
  UnknownApplicationError,
  applicationOutcomes,
  recordApplication,
  recordOutcome,
  userApplications,
  type ApplicationRow,
  type OutcomeRow,
  type PredictionAtApply,
  type RecordApplicationOptions,
  type RecordOutcomeOptions,
} from './repositories/applications.ts';

export {
  InvalidFactValueError,
  UnknownFactKindError,
  currentFacts,
  factKinds,
  recordFact,
  type NewPersonFact,
  type PersonFactRow,
  type RecordFactOptions,
} from './repositories/person-facts.ts';

export { activePathways, pathwayById, type PathwayRow } from './repositories/pathways.ts';
export {
  AssessmentInvariantError,
  attemptsForUser,
  promoteFromAttempt,
  publishedAssessmentsForSkill,
  startAttempt,
  submitAttempt,
  type AssessmentAttemptRow,
  type NewSkillAssessment,
  type SkillAssessmentRow,
} from './repositories/assessments.ts';
export {
  CompletionInvariantError,
  completionsForUser,
  recordCompletion,
  resourcesForSkill,
  usableResources,
  type LearningCompletionRow,
  type LearningResourceRow,
  type NewLearningResource,
  type RecordCompletionOptions,
} from './repositories/learning.ts';

export {
  DocumentConflictError,
  attachDocument,
  recordDocument,
  recordRequirementSources,
  requirementSources,
  unevidencedRequirements,
  unarchivedRequirements,
  type DocumentRow,
  type NewDocument,
  type NewRequirementSource,
  type RequirementSourceRow,
} from './repositories/documents.ts';
