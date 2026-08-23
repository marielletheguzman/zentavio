/**
 * The `Database` interface Kysely types queries against (ADR-0012).
 *
 * **Derived from `docs/database/entities/*.md`, which is the schema specification.** This file is
 * hand-maintained, and ADR-0012 names that as its one real weakness: it can drift from the
 * migrations, and a drifted interface typechecks perfectly and then fails at runtime.
 *
 * `tests/integration/db/schema-drift.test.ts` is the mitigation the ADR asked for. It **parses this
 * file** and compares it against the live schema — table names, column names, nullability, and
 * whether the database supplies a default. It does not compare SQL types, which are not knowable
 * from `string`.
 *
 * Only the tables the MVP path needs are declared. A table declared here without a migration would
 * typecheck and then fail at runtime, so absence is deliberate.
 */

import type { ColumnType, Generated } from 'kysely';

/** `timestamptz`, always UTC. Selected as a Date, inserted as either. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;
/**
 * `date` — a calendar day, kept as an ISO `YYYY-MM-DD` **string** in both directions.
 *
 * Deliberately not a `Date`. `effective_from` is a day a rule took effect, not an instant: parsing
 * it into a Date lands it at UTC midnight, and formatting that in a negative-offset timezone shows
 * the previous day. For a rule whose validity window decides an eligibility verdict, an off-by-one
 * day is a wrong answer. `createDb` configures `pg` to return DATE unparsed for this reason.
 */
type DateOnly = ColumnType<string, string, string>;
/** `numeric` comes back as a string from pg: precision must not be silently lost to a float. */
type Numeric = ColumnType<string, string | number, string | number>;

// ── requirements (entities/requirement.md, ADR-0010) ─────────────────────────

export type RequirementDomainColumn =
  | 'immigration'
  | 'recognition'
  | 'credential'
  | 'authentication'
  | 'language'
  | 'employment_clearance';

export type ImposedByColumn = 'origin' | 'destination' | 'bilateral';

export type RequirementKindColumn =
  | 'eligibility'
  | 'threshold'
  | 'document'
  | 'timeline'
  | 'condition'
  | 'right'
  | 'assessment';

export type EvaluationColumn =
  | 'numeric-gte'
  | 'numeric-lte'
  | 'set-member'
  | 'boolean'
  | 'document-present'
  | 'manual';

export interface RequirementsTable {
  id: string;
  requirement_id: string;

  domain: RequirementDomainColumn;
  imposed_by: ImposedByColumn;
  jurisdiction: string;
  subdivision: string | null;

  /** Immigration rows carry a pathway; recognition and credential rows carry a profession. */
  pathway_id: string | null;
  profession: string | null;

  kind: RequirementKindColumn;
  value: unknown;
  applies_to: Generated<unknown>;
  domain_detail: Generated<unknown>;
  evaluation: EvaluationColumn;
  needs_input: Generated<string[]>;

  /** Tier 1 only, in every domain — `ck_req__tier_one`. */
  source_tier: number;
  source_url: string;
  retrieved_at: Timestamp;
  /** The body that decides. `NOT NULL`, because "who do I contact?" must be answerable. */
  authority: string;
  authority_url: string | null;

  effective_from: DateOnly;
  effective_to: DateOnly | null;
  version: string;
  supersedes: string | null;

  contested: Generated<boolean>;
  contested_note: string | null;
  refresh_after: DateOnly;
  /** Null until archived. Made non-null by ADR-0021's enforcement phase, after backfill. */
  document_id: string | null;

  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ImmigrationPathwaysTable {
  id: string;
  pathway_id: string;
  jurisdiction: string;
  name: string;
  description: string | null;
  stages: Generated<unknown>;
  dependent_rights: unknown | null;
  permanent_residency: unknown | null;
  citizenship: unknown | null;
  quota: unknown | null;
  official_sources: unknown;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// ── users (entities/user.md, ADR-0013) ───────────────────────────────────────

export type UserStatusColumn = 'active' | 'suspended' | 'erased';

export interface UsersTable {
  id: string;
  /**
   * `text`, not `citext` (ADR-0013). Stored as entered; `uq_users__email` is a unique index on
   * `lower(email)`, so **every lookup must filter `lower(email) = lower($1)`**. Comparing this
   * column directly is a defect: it will miss a differently-cased row.
   */
  email: string;
  email_verified_at: Timestamp | null;
  auth_provider: string;
  auth_subject: string | null;
  locale: Generated<string>;
  timezone: string | null;
  status: Generated<UserStatusColumn>;
  last_seen_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

// ── careers (entities/career.md) ─────────────────────────────────────────────

export type CareerFamilyColumn =
  | 'software-it'
  | 'healthcare'
  | 'engineering'
  | 'education'
  | 'trades'
  | 'other';

export type FactBasisColumn = 'official-taxonomy' | 'posting-derived' | 'curated';

export interface CareersTable {
  id: string;
  /** Permanent. Prompts supply these as a closed set; renaming one breaks extraction silently. */
  slug: string;
  name: string;
  family: CareerFamilyColumn;
  description: string | null;
  /** Matches `requirements.profession`. NULL means not licence-gated. */
  profession: string | null;
  licence_gated: Generated<boolean>;
  source_tier: number;
  source_url: string | null;
  basis: FactBasisColumn;
  retrieved_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

// ── skills (entities/skill.md) ───────────────────────────────────────────────

export type SkillKindColumn = 'technology' | 'tool' | 'practice' | 'domain' | 'language' | 'soft';

export interface SkillsTable {
  id: string;
  slug: string;
  name: string;
  /** `language` is human languages — programming languages are `technology`. */
  kind: SkillKindColumn;
  description: string | null;
  source_tier: number;
  source_url: string | null;
  basis: FactBasisColumn;
  retrieved_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface SkillAliasesTable {
  id: string;
  skill_id: string;
  alias: string;
  /**
   * Casefolded, punctuation stripped, and **unique across the whole table** — one alias resolves to
   * exactly one skill. Resolution goes through this column, never string equality on `skills.name`.
   */
  normalized: string;
  source_tier: number;
  created_at: Generated<Timestamp>;
}

// ── parsed profiles (entities/user.md) ───────────────────────────────────────

export type ParsedFromColumn = 'resume-upload' | 'manual' | 'import';

export interface UserProfilesTable {
  id: string;
  user_id: string;
  version: number;
  is_current: Generated<boolean>;
  headline: string | null;
  /** A signal, never a seniority determinant (`.claude/context/career-philosophy.md`). */
  years_experience: Numeric | null;
  current_career_id: string | null;
  seniority: string | null;
  languages: Generated<unknown>;
  parsed_from: ParsedFromColumn | null;
  parser_version: string | null;
  parsed_at: Timestamp | null;
  /** 0..1, drives confidence downstream. */
  completeness: Numeric | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export type ProfileSkillStatusColumn = 'evidenced' | 'claimed';
export type EvidenceKindColumn = 'role' | 'project' | 'certification' | 'assessment' | 'artifact';
export type ConfidenceColumn = 'high' | 'medium' | 'low';

export interface ProfileSkillsTable {
  id: string;
  user_profile_id: string;
  skill_id: string;
  status: ProfileSkillStatusColumn;
  /** Required when `status` is `evidenced` — enforced by `ck_profile_skills__evidence`. */
  evidence_kind: EvidenceKindColumn | null;
  /** The verbatim sentence the claim came from. What makes the profile correctable. */
  source_span: string | null;
  confidence: ConfidenceColumn;
  /** A user correction outweighs an inference. */
  self_reported: Generated<boolean>;
  /** Set only by in-platform verification — never by the parser, never by the user saying so. */
  verified_at: Timestamp | null;
  /**
   * The attempt that promoted this skill (ADR-0030).
   *
   * `verified_at` says *when*; this says *what*, so a surface can show the basis and a reader can
   * tell a résumé-derived `evidenced` from an assessed one. Null together with `verified_at` —
   * `ck_profile_skills__attempt_verified`.
   */
  verified_attempt_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// ── interview reports (ADR-0031) ─────────────────────────────────────────────

/** One value today. A published process is tier 1, lives elsewhere, and outranks every report. */
export type InterviewReportBasisColumn = 'self_reported';

/**
 * One person's account of one process, at one company, for one role family.
 *
 * **Tier 4.** A single report is never a fact about a company; support is counted per
 * `(company_id, role_family)` and the floors live in the repository, because a `CHECK` cannot count
 * rows in another table.
 */
export interface InterviewReportsTable {
  id: string;
  /** Null once erased — moves in step with `anonymized_at` (`ck_ir__anonymized`). */
  user_id: string | null;
  company_id: string;
  /** Matches `careers.family`. The unit of support (ADR-0031). */
  role_family: string;
  /** When they interviewed, not when they told us. Recency is part of support. */
  interviewed_on: string;
  basis: Generated<InterviewReportBasisColumn>;
  notes: string | null;
  anonymized_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/**
 * A closed vocabulary, deliberately.
 *
 * Free text makes aggregation impossible: "sys design", "system design round" and "architecture
 * chat" are one stage described three ways, and a floor counted across them counts nothing.
 */
export type InterviewStageKindColumn =
  | 'recruiter-screen'
  | 'technical-screen'
  | 'coding'
  | 'system-design'
  | 'take-home'
  | 'behavioural'
  | 'hiring-manager'
  | 'panel'
  | 'final';

export interface InterviewReportStagesTable {
  id: string;
  report_id: string;
  position: number;
  kind: InterviewStageKindColumn;
  created_at: Generated<Timestamp>;
}

// ── assessments (ADR-0030) ───────────────────────────────────────────────────

export type AssessmentStatusColumn = 'draft' | 'published' | 'retired';

/**
 * One **version** of an instrument.
 *
 * A version is not a column on a mutable row: items change, and a pass has to keep citing what it
 * was actually earned against.
 */
export interface SkillAssessmentsTable {
  id: string;
  /** Stable across versions. `kubernetes-fundamentals` v1 and v2 are one instrument at two times. */
  slug: string;
  version: number;
  /** What passing this evidences. One skill, so a pass can say which one it was about. */
  skill_id: string;
  title: string;
  description: string | null;
  item_count: number;
  /** Stated on the instrument, never decided per attempt after seeing the scores. */
  pass_threshold: number;
  /** `draft` cannot be taken; `retired` keeps existing passes citable while accepting no new ones. */
  status: Generated<AssessmentStatusColumn>;
  /**
   * How long after an attempt before the same person may start another.
   *
   * Slows key extraction by repetition — ten items of four options, attempted without limit, gives
   * up the whole key in a handful of sittings. It does not prevent it, and nothing about a pass
   * claims more because of it.
   */
  retry_interval: Generated<string>;
  /**
   * What passing this deliberately does **not** show.
   *
   * Not derivable from the items — it is a judgement about the distance between recall and
   * competence. Required before publishing, because publishing without it is the broader claim
   * ADR-0030 refuses.
   */
  does_not_evidence: string | null;
  published_at: Timestamp | null;
  retired_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/**
 * One item of one version.
 *
 * Carries more than a question and a key: `evidences` is what a pass may say this item showed, and
 * `source_url` is where the answer comes from. Both are columns rather than review conventions,
 * because a convention is not checkable.
 */
export interface AssessmentItemsTable {
  id: string;
  assessment_id: string;
  position: number;
  stem: string;
  /** `[{ key, text }, …]`. One document: an option is never read apart from its item. */
  options: unknown;
  correct_option: string;
  /** The narrow capability this item supports, in the words the surface will use. */
  evidences: string;
  /** Official documentation the correct answer follows from. */
  source_url: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type AttemptOutcomeColumn = 'in_progress' | 'passed' | 'failed' | 'abandoned';

/**
 * Every attempt, kept.
 *
 * Append-only history rather than a current-state row: a failed attempt is a fact about what
 * happened, and keeping only the best result would make the record flatter than the truth.
 */
export interface AssessmentAttemptsTable {
  id: string;
  user_id: string;
  /** The **version**, which is what makes "passed v1" survive v2 being written. */
  assessment_id: string;
  started_at: Generated<Timestamp>;
  submitted_at: Timestamp | null;
  /** Correct answers. Null while open and for an abandoned attempt — 0 would record a real failure. */
  score: number | null;
  outcome: Generated<AttemptOutcomeColumn>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// ── learning (entities/learning-resource.md, entities/connector-source.md) ───

export type ConnectorKindColumn =
  | 'job-board'
  | 'salary'
  | 'company'
  | 'immigration'
  | 'learning'
  | 'market';

export type BreakerStateColumn = 'closed' | 'open' | 'half-open';

/**
 * One registered connector.
 *
 * **The immigration connectors do not have rows here yet.** They predate this table and carry
 * provenance on the requirement itself; adding rows would claim an integration that does not exist.
 */
export interface ConnectorSourcesTable {
  /** The connector's own `meta.id` — kebab-case, permanent, never reused. */
  id: string;
  kind: ConnectorKindColumn;
  display_name: string;
  connector_version: string;
  source_tier: number;
  regions: Generated<string[]>;
  terms_url: string;
  /** Why we are permitted to fetch this at all. */
  legal_basis: string;
  rate_limit: unknown;
  /** How long a fact from here stays current. Copied onto facts as their staleness horizon. */
  refresh_window: string;
  schedule: string;
  is_enabled: Generated<boolean>;
  /** Observed, never declared. The tier bounds the ceiling; observation sets the value. */
  reliability: Generated<Numeric>;
  breaker_state: Generated<BreakerStateColumn>;
  breaker_opened_at: Timestamp | null;
  last_success_at: Timestamp | null;
  last_failure_at: Timestamp | null;
  last_failure_kind: string | null;
  consecutive_failures: Generated<number>;
  /** Resumable position. `| null` because the column is, and the drift test reads this literally. */
  cursor: unknown | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export type LearningFormatColumn =
  | 'course'
  | 'documentation'
  | 'book'
  | 'lab'
  | 'certification'
  | 'video'
  | 'tutorial';

export type LearningLevelColumn = 'beginner' | 'intermediate' | 'advanced';
export type CostBandColumn = 'free' | 'low' | 'mid' | 'high' | 'unknown';
export type LinkStatusColumn = 'ok' | 'redirected' | 'dead';
export type DurationBasisColumn = 'published' | 'observed';

export interface LearningResourcesTable {
  id: string;
  provider: string;
  external_id: string;
  title: string;
  url: string;
  format: LearningFormatColumn;
  level: LearningLevelColumn | null;
  language: string;
  typical_duration: string | null;
  /** Whether the duration is what the provider published or what we observed. */
  duration_basis: DurationBasisColumn | null;
  cost_amount: Numeric | null;
  cost_currency: string | null;
  cost_band: CostBandColumn;
  is_certification: Generated<boolean>;
  cert_authority: string | null;
  /**
   * Whether completing this *could* promote a skill to `evidenced`.
   *
   * **Read by nothing today.** Which verification path may promote, and how, is its own decision.
   */
  grants_evidence: Generated<boolean>;
  source_id: string;
  source_tier: number;
  source_url: string;
  retrieved_at: Timestamp;
  last_verified_at: Timestamp;
  link_status: Generated<LinkStatusColumn>;
  retired_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export type CoverageColumn = 'primary' | 'partial' | 'mentioned';
export type CoverageBasisColumn = 'provider-stated' | 'syllabus-extraction' | 'curated';

export interface LearningResourceSkillsTable {
  id: string;
  resource_id: string;
  skill_id: string;
  /** A course that merely *mentions* a skill does not close a gap in it. */
  coverage: CoverageColumn;
  basis: CoverageBasisColumn;
  created_at: Generated<Timestamp>;
}

/** The only basis we can actually observe today: the person tells us. */
export type CompletionBasisColumn = 'self_reported';

/**
 * What a person says they finished.
 *
 * **A claim about a resource, never about a skill.** Nothing here writes `profile_skills`, and
 * `ai/skill-gap` credits only `evidenced` skills — so recording a completion does not move
 * readiness, which is the property M6 exists to hold.
 */
export interface LearningCompletionsTable {
  id: string;
  user_id: string;
  resource_id: string;
  /** When they say they finished, not when they told us — `created_at` is the second fact. */
  completed_at: Timestamp;
  basis: Generated<CompletionBasisColumn>;
  /** Stored, never trusted. Nothing reads it: a link is not a verification. */
  evidence_url: string | null;
  note: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

// ── the skill graph and what a track requires (entities/skill.md) ────────────

export type SkillEdgeTypeColumn =
  | 'requires'
  | 'adjacent_to'
  | 'transfers_to'
  | 'subsumes'
  | 'tooling_of';

export type SkillEdgeBasisColumn =
  | 'posting-cooccurrence'
  | 'official-curriculum'
  | 'outcome-derived'
  | 'curated';

export interface SkillEdgesTable {
  id: string;
  from_skill_id: string;
  to_skill_id: string;
  edge_type: SkillEdgeTypeColumn;
  /** 0..1. How much competence carries, or how hard the prerequisite is. */
  weight: Numeric;
  basis: SkillEdgeBasisColumn;
  /** Observations behind the weight. Required when `basis` is `posting-cooccurrence`. */
  support: number | null;
  compute_version: string | null;
  /** Bounded 1..4: tier 5 is a model's opinion and this is a fact table. */
  source_tier: number;
  source_url: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export type CareerSkillClusterColumn = 'core' | 'supporting' | 'differentiating' | 'peripheral';
export type CareerSkillBasisColumn = 'posting-frequency' | 'official-curriculum' | 'curated';

export interface CareerSkillsTable {
  id: string;
  career_id: string;
  skill_id: string;
  /** Importance for this career. Weights live here, never as a constant in code. */
  weight: Numeric;
  cluster: CareerSkillClusterColumn;
  basis: CareerSkillBasisColumn;
  support: number | null;
  /** `null` is global. A market-specific row wins over a global one during evaluation. */
  market_scope: string | null;
  source_tier: number;
  source_url: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export type UserTargetStatusColumn = 'active' | 'achieved' | 'abandoned';

export type ApplicationStatusColumn =
  | 'saved'
  | 'applied'
  | 'screening'
  | 'interviewing'
  | 'offered'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'expired';

export type OutcomeKindColumn =
  | 'applied'
  | 'screened'
  | 'interviewed'
  | 'offered'
  | 'rejected'
  | 'withdrawn'
  | 'accepted'
  | 'started'
  | 'relocated'
  | 'course_completed'
  | 'assessment_passed';

export type OutcomeSourceColumn = 'user-reported' | 'inferred' | 'platform-observed';

export interface ApplicationsTable {
  id: string;
  user_id: string;
  /**
   * Still no foreign key, though `job_postings` now exists. Pointing a live table at a new one is a
   * change with its own `ON DELETE` decision — recorded as follow-up in ADR-0034 rather than
   * smuggled into the table's creation.
   */
  job_posting_id: string | null;
  /** No foreign key — `matches` is M4. */
  match_id: string | null;
  company_id: string | null;
  external_role: string | null;
  status: ApplicationStatusColumn;
  /** What `outcomes.elapsed_days` measures from. */
  applied_at: Timestamp | null;
  closed_at: Timestamp | null;
  predicted_score: Numeric | null;
  scorer_version: string | null;
  required_sponsorship: Generated<boolean>;
  sponsorship_status_at_apply: string | null;
  country_code: string | null;
  source: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

/**
 * What happened, and what we had predicted when it did.
 *
 * The only table that survives erasure by **detachment**: `user_id` is nulled and the row kept,
 * because the contribution is no longer personal and destroying it destroys the calibration the
 * platform's honesty depends on.
 */
export interface OutcomesTable {
  id: string;
  /** Nulled on erasure. Everything else survives as an anonymous contribution. */
  user_id: string | null;
  application_id: string | null;
  kind: OutcomeKindColumn;
  occurred_at: Timestamp;
  /** Month-truncated `occurred_at`; what aggregation reads. */
  occurred_month: DateOnly;
  career_id: string | null;
  target_career_id: string | null;
  company_id: string | null;
  country_code: string | null;
  seniority: string | null;
  was_relocation: Generated<boolean>;
  was_career_change: Generated<boolean>;
  /** What we said before we learned what happened. Without it there is nothing to calibrate. */
  predicted_score: Numeric | null;
  predicted_kind: string | null;
  scorer_version: string | null;
  knowledge_as_of: Timestamp | null;
  elapsed_days: number | null;
  /** `[{skillId, status}]` — ids only, never text. */
  skill_snapshot: Generated<unknown>;
  source: OutcomeSourceColumn;
  confidence: string;
  /** Set exactly when `user_id` is nulled — `ck_outcomes__anonymized` enforces the pairing. */
  anonymized_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// ── job postings (entities/job.md, ADR-0034) ─────────────────────────────────

/** Which derivation produced `dedup_key`, and therefore what a match across sources would mean. */
export type DedupBasisColumn = 'employer-title-location' | 'source-identity';

/** `source-delisted` is the source's statement; `source-not-fetched` is our failure. */
export type ExpiryReasonColumn = 'source-delisted' | 'source-not-fetched';

/**
 * One opening, as reconciled from every source that described it.
 *
 * A **world fact**: provenance required, retained indefinitely, not personal data. Deduplication is
 * persistence's, never a connector's (ADR-0034) — a connector sees one source and cannot make a
 * claim about two.
 */
export interface JobPostingsTable {
  id: string;
  /** Derived at write time. Unique among live rows; that uniqueness is what makes a merge a merge. */
  dedup_key: string;
  dedup_basis: DedupBasisColumn;
  title: string;
  /** Where a person applies. `job_posting_sources.source_url` is provenance, not a destination. */
  url: string;
  company_id: string | null;
  /** What the source said, kept permanently as the evidence for a later resolution. */
  company_name_raw: string | null;
  /** The posting's own prose. Stored so extraction has an input; never read for facts (ADR-0033). */
  description: string | null;
  /** The source's requirement lists as plain text — where a posting states what it wants. */
  requirements_text: string | null;
  /**
   * When extraction last completed for this posting. Null means never (ADR-0036).
   *
   * Set with **no** `job_posting_skills` rows means extracted and this posting asks for nothing the
   * graph curates — a real answer. Without this, that state and "never read" are the same row.
   */
  extracted_at: Timestamp | null;
  /** The `EXTRACTOR_VERSION` that completed it. Paired with `extracted_at` by CHECK. */
  extracted_version: string | null;
  /** Carried verbatim for display and never mined for a country (ADR-0033). */
  location_raw: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  /** Null means the source did not say — never false. A silent source is not an on-site job. */
  is_remote: boolean | null;
  /** Null unless a source states the scope. Nothing infers worldwide from `remote`. */
  remote_scope: string | null;
  employment_type: string | null;
  seniority: string | null;
  /** The source's own vocabulary, unmapped: Lever's "Regular Full Time (Salary)". */
  commitment_raw: string | null;
  department_raw: string | null;
  team_raw: string | null;
  salary_min: Numeric | null;
  salary_max: Numeric | null;
  currency: string | null;
  salary_period: string | null;
  /** "The source published none" is not "we failed to parse one". */
  salary_is_stated: Generated<boolean>;
  posted_at: Timestamp | null;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  source_expires_at: Timestamp | null;
  /** `retrieved_at` plus the writing source's refresh window. */
  stale_after: Timestamp;
  expired_at: Timestamp | null;
  expiry_reason: ExpiryReasonColumn | null;
  /** Tier of the source that last wrote these fields. A worse-tier update is refused. */
  authority_tier: number;
  confidence: string;
  contested: Generated<boolean>;
  /** `dedup-collision-unmerged` when a recomputed key would have collided and the merge was refused. */
  flags: Generated<string[]>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

/** Which field a span was found in. Only a requirement list may mark a row required (ADR-0035). */
export type PostingSectionColumn = 'requirements' | 'description' | 'structured';

/**
 * What a posting asks for, and how we came to think so (ADR-0035).
 *
 * A row read out of prose is `description-extraction` carrying the sentence it came from.
 * `stated-requirement` is reserved for a source that states requirements structurally; nothing does
 * yet, and writing it early would collapse the distinction the column exists for.
 */
export interface JobPostingSkillsTable {
  id: string;
  job_posting_id: string;
  skill_id: string;
  /** Computed by code from section and repetition. Never returned by a model. */
  weight: Numeric;
  basis: string;
  is_required: Generated<boolean>;
  section: PostingSectionColumn;
  /** The sentence as published. Required for anything extracted. */
  source_span: string | null;
  extractor_version: string;
  /** Null when no model was involved — the whole of the alias-scan path. */
  prompt_version: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type MatchStatusColumn = 'scored' | 'unknown';

/**
 * One person against one posting, with the evidence and versions that produced it.
 *
 * **Read `scorer_version` before `score`.** This table holds more than one kind of score and today
 * holds exactly one — `skill-fit-v1`, weighted coverage of what a posting asks for. No Job Match
 * Score exists: work authorization is a hard constraint and is unevaluatable while
 * `job_postings.country_code` is null (ADR-0037, ADR-0033).
 *
 * `status = 'unknown'` never means a bad fit. It means no number exists, and `missing` says which
 * absence it was — ours (not extracted yet) or the posting's (asks for nothing curated).
 */
export interface MatchesTable {
  id: string;
  user_id: string;
  job_posting_id: string;
  /** Null unless `status` is `scored` — `ck_matches__score_iff_scored`. Never 0.0 for "unknown". */
  score: Numeric | null;
  status: MatchStatusColumn;
  confidence: ConfidenceColumn;
  /**
   * Contributing factors with their actual weights, negatives included.
   *
   * **Not `Generated`, and the column has no DEFAULT.** Every other jsonb here defaults to `[]`;
   * this one may not, because a writer that forgets it should fail rather than store an empty
   * explanation. `ck_matches__evidence_present` refuses `[]` anyway — the missing default is what
   * makes the omission a type error before it is a constraint violation.
   */
  evidence: unknown;
  /** What would be needed to do better. A product surface, not an apology. */
  missing: Generated<unknown>;
  /** Hard constraints, named rather than silently multiplied. Empty until eligibility is evaluated. */
  constraints: Generated<unknown>;
  scorer_version: string;
  /** Null when no model was involved — the whole of the `skill-fit-v1` path. */
  prompt_version: string | null;
  knowledge_as_of: Timestamp;
  computed_at: Timestamp;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

/**
 * One source's claim on one posting, under that source's own identifier.
 *
 * Identity is the triple `(source_id, source_scope, external_id)`. The scope is a namespace — a
 * Lever board slug, an ATS tenant — and **is not an employer**: nothing may resolve it to a company.
 */
export interface JobPostingSourcesTable {
  id: string;
  job_posting_id: string;
  source_id: string;
  /** Empty string when the source has one global namespace. Never null, so uniqueness needs no coalescing. */
  source_scope: Generated<string>;
  external_id: string;
  source_tier: number;
  source_url: string;
  retrieved_at: Timestamp;
  connector_version: string;
  run_id: string;
  /** The archived board payload (ADR-0021) — many postings per document, never this posting's bytes. */
  document_id: string | null;
  /** Consecutive exhaustive runs of this scope that did not list `external_id`. */
  missed_runs: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/**
 * An archived source document (ADR-0021).
 *
 * **Metadata only** — the bytes live in object storage behind the `DocumentStore` port. `sha256` is
 * the recorded expectation `DocumentStore.get` verifies against, which is why it is here rather
 * than trusted from the provider.
 */
export interface DocumentsTable {
  id: string;
  /** Deterministic and recomputable from the record: `<category>/<jurisdiction>/<year>/<slug>.<ext>`. */
  object_key: string;
  /** Which provider holds the bytes, per row — a migration between providers must tell them apart. */
  provider: string;
  bucket: string;
  mime_type: string;
  size_bytes: string;
  /** Hex SHA-256, lower case, over the bytes as stored. */
  sha256: string;
  source_url: string;
  /** The connector obtained the bytes. */
  retrieved_at: Timestamp;
  /** The bytes reached storage. Separate on purpose: a gap between the two is a failure to see. */
  archived_at: Generated<Timestamp>;
  version: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** What an instrument contributed to a derived requirement (ADR-0025). */
export type RequirementSourceRole = 'primary' | 'formula' | 'operand';

/**
 * Every instrument a requirement was derived from.
 *
 * **Additive.** `requirements.document_id` still means the primary instrument, so a rule with one
 * source may have no rows here. What this holds is the thing `domain_detail` cannot: a foreign key
 * to an archived document per operand, so each one's evidence is as retrievable as any other
 * rule's — the half-evidenced state ADR-0025 exists to prevent.
 */
export interface RequirementSourcesTable {
  id: string;
  requirement_id: string;
  /** NOT NULL by design: an operand with no retrievable evidence is the failure being prevented. */
  document_id: string;
  role: RequirementSourceRole;
  /** Which legal act the archived bytes are — an ELI where the jurisdiction publishes one. */
  instrument_id: string;
  source_url: string;
  retrieved_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export type CompanyStatusColumn = 'active' | 'defunct' | 'merged';

/**
 * Employer identity. **Identity only** — sponsorship, scores, and interview process each live in
 * their own table (`docs/database/entities/company.md`).
 */
export interface CompaniesTable {
  id: string;
  slug: string;
  /** As the company writes it. Display only, never a matching key. */
  canonical_name: string;
  legal_name: string | null;
  /** Host only — `google.com`, never a URL and never `www.`-prefixed. */
  primary_domain: string | null;
  country_code: string | null;
  status: Generated<CompanyStatusColumn>;
  /** Set when `status` is `merged`. The row is kept and points forward, never rewritten. */
  merged_into: string | null;
  source_tier: number;
  source_url: string | null;
  retrieved_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface CompanyAliasesTable {
  id: string;
  company_id: string;
  /** As written by the source. */
  alias: string;
  /** Produced by `normalizeCompanyAlias` and by nothing else. */
  normalized: string;
  source_tier: number;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export type PersonFactValueType =
  | 'monetary'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'string'
  | 'enum'
  | 'date';

/** How we know a fact. `self_reported` is the honest default and is never presented as verified. */
export type PersonFactBasis = 'self_reported' | 'derived' | 'verified';

/**
 * The closed catalogue of facts a requirement may ask for. A key here matches a
 * `requirements.needs_input` element exactly — a rule asking for a key this table does not define
 * produces a `needsFromUser` nobody can answer.
 */
export interface PersonFactKindsTable {
  key: string;
  value_type: PersonFactValueType;
  unit: string | null;
  /** What to ask the person. `needsFromUser` renders this, never the key. */
  prompt: string;
  /** Why we are asking — shown alongside, so the question does not read as data collection. */
  rationale: string;
  sensitive: Generated<boolean>;
  allowed_values: Generated<string[]>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/**
 * What a person answered. Versioned rather than updated in place, so a verdict computed against
 * an earlier answer stays reproducible.
 */
export interface PersonFactsTable {
  id: string;
  user_id: string;
  kind_key: string;
  version: number;
  is_current: Generated<boolean>;
  /** Typed by the kind's `value_type`. Monetary values carry currency and period. */
  value: unknown;
  basis: Generated<PersonFactBasis>;
  basis_detail: string | null;
  verified_at: Timestamp | null;
  stated_at: Generated<Timestamp>;
  /** Facts expire. Null means no known expiry. */
  valid_until: DateOnly | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface UserTargetsTable {
  id: string;
  user_id: string;
  career_id: string;
  /** 1 is the primary target. Unique among active rows only. */
  rank: number;
  market_scope: string | null;
  status: Generated<UserTargetStatusColumn>;
  decided_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

// ── the runner's own bookkeeping ─────────────────────────────────────────────

export interface SchemaMigrationsTable {
  id: string;
  checksum: string;
  applied_at: Generated<Timestamp>;
}

export interface Database {
  requirements: RequirementsTable;
  immigration_pathways: ImmigrationPathwaysTable;
  users: UsersTable;
  careers: CareersTable;
  skills: SkillsTable;
  skill_aliases: SkillAliasesTable;
  user_profiles: UserProfilesTable;
  profile_skills: ProfileSkillsTable;
  skill_edges: SkillEdgesTable;
  career_skills: CareerSkillsTable;
  user_targets: UserTargetsTable;
  documents: DocumentsTable;
  requirement_sources: RequirementSourcesTable;
  companies: CompaniesTable;
  company_aliases: CompanyAliasesTable;
  applications: ApplicationsTable;
  outcomes: OutcomesTable;
  connector_sources: ConnectorSourcesTable;
  job_postings: JobPostingsTable;
  job_posting_sources: JobPostingSourcesTable;
  job_posting_skills: JobPostingSkillsTable;
  matches: MatchesTable;
  interview_reports: InterviewReportsTable;
  interview_report_stages: InterviewReportStagesTable;
  skill_assessments: SkillAssessmentsTable;
  assessment_attempts: AssessmentAttemptsTable;
  assessment_items: AssessmentItemsTable;
  learning_resources: LearningResourcesTable;
  learning_resource_skills: LearningResourceSkillsTable;
  learning_completions: LearningCompletionsTable;
  person_fact_kinds: PersonFactKindsTable;
  person_facts: PersonFactsTable;
  schema_migrations: SchemaMigrationsTable;
}

export type { Numeric };
