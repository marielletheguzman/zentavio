/**
 * The `Database` interface Kysely types queries against (ADR-0012).
 *
 * **Derived from `docs/database/entities/*.md`, which is the schema specification.** This file is
 * hand-maintained, and ADR-0012 names that as its one real weakness: it can drift from the
 * migrations. The mitigation is a schema-drift integration test comparing this against the live
 * schema — not yet written, because no database is reachable. Until it exists, a reviewer comparing
 * this file against the entity documents is the only thing holding them together, and that is worth
 * knowing rather than assuming.
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
  | 'quota'
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
  source_document: string | null;
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
  schema_migrations: SchemaMigrationsTable;
}

export type { Numeric };
