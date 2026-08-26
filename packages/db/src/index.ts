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
  InterviewStageKindColumn,
  ImmigrationPathwaysTable,
  ImposedByColumn,
  RequirementDomainColumn,
  RequirementKindColumn,
  RequirementSourceRole,
  RequirementSourcesTable,
  RequirementsTable,
  SchemaMigrationsTable,
  SponsorshipStatusColumn,
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
  MAX_THEMES,
  rolePreparation,
  type PreparationTheme,
  type RolePreparation,
} from './repositories/role-preparation.ts';
export {
  anonymizeInterviewReports,
  correctInterviewReport,
  InterviewReportInvariantError,
  reportForPairing,
  reportsByUser,
  withdrawInterviewReport,
  PAIRING_SUPPORT_FLOOR,
  processForPairing,
  recordInterviewReport,
  STAGE_SUPPORT_FLOOR,
  SUPPORT_WINDOW_MONTHS,
  type InterviewReportRow,
  type ProcessSupport,
  type StagePattern,
} from './repositories/interview-reports.ts';
export {
  AssessmentInvariantError,
  attemptsForUser,
  gradeAttempt,
  itemsToAnswer,
  itemsWithClaims,
  promoteFromAttempt,
  publishAssessment,
  publishedAssessmentsForSkill,
  startAttempt,
  type AssessmentAttemptRow,
  type NewSkillAssessment,
  type SkillAssessmentRow,
} from './repositories/assessments.ts';
export {
  CompletionInvariantError,
  completionsForUser,
  registerConnectorSource,
  upsertLearningResource,
  type ConnectorRegistration,
  recordCompletion,
  resourcesForSkill,
  usableResources,
  type LearningCompletionRow,
  type LearningResourceRow,
  type NewLearningResource,
  type RecordCompletionOptions,
} from './repositories/learning.ts';

export {
  dedupKeyFor,
  expireBecauseNotFetched,
  expireMissing,
  livePostings,
  sourcesForPosting,
  upsertPostingFromSource,
  type ExpiryResult,
  type ExpirySweep,
  type JobPostingRow,
  type PostingFields,
  type SourceIdentity,
  type SourceObservation,
  type UpsertAction,
  type UpsertResult,
} from './repositories/jobs.ts';

export {
  backfillPostingEmployer,
  bindBoardToCompany,
  createCompany,
  employerForBoard,
  liveBoardBindings,
  resolveCompany,
  type BoardBindingInput,
  type CompanyIdentityInput,
  type CompanyResolution,
  type CompanyResolutionBasis,
  type CompanyRow,
  type CreateCompanyInput,
  type JobBoardEmployerRow,
} from './repositories/companies.ts';

export {
  dueSources,
  recordRunFailure,
  recordRunSuccess,
  type DueSource,
} from './repositories/connector-runs.ts';

export {
  heldSkillsForUser,
  matchesForUser,
  postingScoringState,
  recordMatch,
  requirementsForPosting,
  transferEdgesInto,
  type HeldSkill,
  type MatchRow,
  type NewMatch,
  type PostingRequirement,
  type PostingScoringState,
  type TransferEdge,
} from './repositories/matches.ts';

export {
  postingsDueForSponsorship,
  recordSponsorship,
  sponsorshipForPosting,
  type BenefitOutcome,
  type PostingDueForSponsorship,
  type SponsorshipOutcome,
} from './repositories/posting-sponsorship.ts';

export {
  aliasIndex,
  postingsDueForExtraction,
  postingsForSkill,
  recordExtraction,
  skillsForPosting,
  type AliasEntry,
  type JobPostingSkillRow,
  type NewPostingSkill,
  type PostingDueForExtraction,
} from './repositories/posting-skills.ts';

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
