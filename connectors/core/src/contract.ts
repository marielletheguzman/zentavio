/**
 * The connector contract (ADR-0002, `docs/architecture/connectors.md`).
 *
 * Every external data source implements exactly this interface. Nothing under `services/` may
 * name a source: services iterate the registry, and the registry is the only module that
 * references a connector. `eslint.config.mjs` makes that a build error rather than a review
 * comment (ADR-0005).
 *
 * The interface is generic in its raw and normalized types because a source is not necessarily
 * a job board. An immigration source's raw payload is an official document and its normalized
 * output is a requirement row; a salary source's is neither.
 */

/**
 * What kind of source this is. Widening this union is a design decision, not a formality — a
 * new kind means a new normalized type and a new consumer in the knowledge engine.
 */
export type ConnectorKind = 'job-board' | 'salary' | 'company' | 'immigration' | 'learning' | 'market';

/**
 * Client-side rate limit, declared by the connector and honoured by `core` regardless of whether
 * the source would actually stop us. Being a good citizen is not conditional on being policed.
 */
export interface RateLimitSpec {
  /** Maximum requests permitted in each window. */
  readonly requests: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /**
   * Minimum spacing between two requests, in milliseconds. A window budget alone permits
   * spending the whole allowance in one burst, which is what actually trips a source's
   * protection.
   */
  readonly minIntervalMs?: number;
}

export interface ConnectorMeta {
  /**
   * Stable, kebab-case, never renamed and never reused — it is a foreign key in the database.
   * Renaming one silently orphans every row that cites it.
   */
  readonly id: string;
  /**
   * Semver of this connector's *behaviour*. Bump it when `normalize` produces different output
   * for the same input, so downstream can tell a source change from a connector change.
   */
  readonly version: string;
  readonly kind: ConnectorKind;
  /** ISO-3166-1 alpha-2 codes meaningfully covered, or `['*']`. */
  readonly regions: readonly string[];
  readonly rateLimit: RateLimitSpec;
  /**
   * 0..1, **observed** — derived from validation pass rate and outcome feedback, never declared
   * by the author. A connector shipping with `reliability: 1` is asserting a track record it
   * does not have; new connectors start at the floor and earn their way up.
   */
  readonly reliability: number;
  /**
   * The source's terms of service — checked *before* the connector was written. If a source
   * disallows automated access, the answer is that we do not integrate it
   * (`docs/architecture/connectors.md`, "Legal and ethical constraints").
   */
  readonly termsUrl: string;
  /**
   * How an operator reading `connector_sources` names this source. The source, not the connector:
   * *"Lever (configured employer boards)"*, never `lever`, which the `id` already says.
   */
  readonly displayName: string;
  /**
   * Knowledge tier, 1–4 (`.claude/context/knowledge-sources.md`). **Declared**, and it is a ceiling
   * rather than a score: immigration rules and salary thresholds may come from tier 1 and nowhere
   * else. `reliability` is the observed number that moves underneath it.
   */
  readonly sourceTier: 1 | 2 | 3 | 4;
  /**
   * Why we are permitted to fetch this at all — a sentence, because "we checked" is not a record.
   *
   * **Required, and that is the point of ADR-0041.** A source cannot be added without somebody
   * writing down what they read, and a default here would be the invented value the rule about
   * inventing values exists to prevent.
   */
  readonly legalBasis: string;
  /**
   * How long a fact from this source stays current, as a PostgreSQL interval. Copied onto stored
   * facts as their staleness horizon, so a tier-1 source past this window is treated as tier 2.
   */
  readonly refreshWindow: string;
  /**
   * Cron expression for how often a run becomes due. Read by the scheduler; the connector never
   * consults it. **Our polling policy, not a claim about the source** — unlike `legalBasis` and
   * `sourceTier`, nothing upstream states it.
   */
  readonly schedule: string;
  /**
   * Whether a complete run of this source lists **everything live** in a scope (ADR-0034).
   *
   * A Lever board is `exhaustive` by construction — the API returns every published posting, so a
   * disappearance means the posting is gone. A keyword search is `partial`: fewer results than last
   * time may mean a ranking change, a quota, or an outage.
   *
   * **This declares a capability, not an outcome.** It says what the source can do when a run
   * succeeds; whether a given run actually finished is the run's own report, and expiry requires
   * both. Absent means `partial`, so a connector that says nothing expires nothing — the safe
   * direction, because the failure being avoided is retiring a posting somebody is tracking.
   */
  readonly listing?: 'exhaustive' | 'partial';
}

/**
 * What to discover. Deliberately small: these are the fields the immigration kind needs, and
 * inventing a job board's `keywords`/`location` before a job-board connector exists would be
 * designing against an imagined source.
 *
 * **A connector kind that needs a field not here is an architecture conversation** — the same
 * rule the skill states for adding a field to a Zentavio type.
 */
export interface SearchQuery {
  /** ISO-3166-1 alpha-2 codes to cover. Absent means the connector's full declared coverage. */
  readonly regions?: readonly string[];
  /** Discover only what changed at or after this instant, for incremental runs. */
  readonly since?: Date;
  /** Upper bound on items returned across all pages. Absent means no bound. */
  readonly limit?: number;
}

/**
 * An opaque resumption point. Cursor-based in the contract even where the source paginates by
 * offset — the connector translates — because a cursor must survive a crash mid-run, and an
 * offset into a result set that has since changed does not.
 */
export type Cursor = string;

export interface Page<TRaw> {
  readonly items: readonly TRaw[];
  /** Absent when this is the last page. Present means call `search` again with it. */
  readonly nextCursor?: Cursor;
}

/**
 * One thing wrong with a normalized record.
 *
 * `error` rejects the record with a reason; `warning` ingests it and flags it. The distinction
 * is what keeps a partially-usable record from being thrown away and an unusable one from being
 * trusted.
 */
export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  /** Stable, machine-readable: `missing-source-url`, `threshold-not-numeric`. */
  readonly code: string;
  /** The field at fault, where one field is at fault. */
  readonly field?: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly issues: readonly ValidationIssue[];
}

export type HealthState = 'healthy' | 'degraded' | 'unreachable';

export interface HealthStatus {
  readonly state: HealthState;
  /** Round-trip of the liveness probe, where one was made. */
  readonly latencyMs?: number;
  /** Why, when the state is not `healthy`. Never an exception — health is data. */
  readonly detail?: string;
}

/**
 * The source document a raw payload came from, ready to archive (ADR-0021).
 *
 * A connector knows what its source *is* and what type it has; ingestion knows how to store it.
 * Splitting it that way keeps the rule that a connector persists nothing while still letting the
 * archive hold the actual document rather than our envelope around it.
 */
export interface ArchivableSource {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** Feeds the deterministic object key. Lower-cased and slugged by the caller. */
  readonly slug: string;
  readonly jurisdiction: string;
  readonly year: number;
  readonly extension: string;
  /**
   * True when these bytes are the document as published; false when they are something derived
   * from it — extracted text, a re-encoding.
   *
   * **A derived copy is weaker evidence**, because a parse defect in the extraction is invisible
   * to anyone re-reading the archive. Recorded rather than hidden so the gap is countable.
   */
  readonly isOriginal: boolean;
}

export interface Connector<TRaw, TNormalized> {
  readonly meta: ConnectorMeta;

  /** Cursor-paginated discovery. Returns raw payloads untouched — never normalizes, never persists. */
  search(query: SearchQuery, cursor?: Cursor): Promise<Page<TRaw>>;

  /** One item by the source's own id. `null` for gone; throws for broken. Never guesses. */
  fetch(externalId: string): Promise<TRaw | null>;

  /**
   * Raw shape → Zentavio type. **Pure and total**: no I/O, no clock, no randomness, and every
   * payload maps to a record or to a validation error rather than a thrown exception. This is
   * the only place a source's quirks are allowed, and its purity is what makes golden-file
   * testing possible.
   *
   * A field the source does not provide is `null`. Never a guess, never a default — an invented
   * value is inherited by every score derived from it.
   */
  normalize(raw: TRaw): TNormalized;

  /** Accept / flag / reject, with reasons. Returns issues; never throws. */
  validate(normalized: TNormalized): ValidationResult;

  /** Cheap upstream liveness. No credential burned, no full page fetched. */
  healthCheck(): Promise<HealthStatus>;

  /**
   * The bytes to archive for this payload, and what they are.
   *
   * Optional: a source with nothing archivable — a pure API returning JSON we already keep — omits
   * it, and ingestion records no document. **Still not persistence**: this returns the bytes, it
   * does not store them.
   */
  archivable?(raw: TRaw): ArchivableSource | null;

  /**
   * Every instrument a payload's rules were derived from, when there is more than one (ADR-0025).
   *
   * Luxembourg's Blue Card threshold is a product of two published instruments and no official act
   * states the result, so a connector computing it must be able to hand over **both** originals —
   * otherwise the stored rule cites one and is half-evidenced, which passes ADR-0021's check while
   * being unrecomputable.
   *
   * Optional and additive. A connector with one source implements `archivable` alone and nothing
   * about it changes. **Still not persistence**: this returns bytes, ingestion stores them.
   */
  archivableSources?(raw: TRaw): readonly DerivedSource[];
}

/** One instrument behind a derived rule, with the part it played (ADR-0025). */
export interface DerivedSource {
  readonly source: ArchivableSource;
  /**
   * `primary` states the rule, `formula` states the arithmetic, `operand` supplies a figure it
   * consumes. Matches `requirement_sources.role`.
   */
  readonly role: 'primary' | 'formula' | 'operand';
  /** The legal act these bytes are — an ELI where the jurisdiction publishes one. */
  readonly instrumentId: string;
  readonly sourceUrl: string;
  /** ISO-8601 UTC, recorded at fetch time so `normalize` stays pure. */
  readonly retrievedAt: string;
}

/** True when nothing in the result blocks ingestion. Warnings do not block. */
export function isIngestible(result: ValidationResult): boolean {
  return !result.issues.some((issue) => issue.severity === 'error');
}

/**
 * What `connector_sources` stores about a source, derived from `meta` (ADR-0041).
 *
 * **Structurally identical to `ConnectorRegistration` in `packages/db` and deliberately separate**:
 * `connectors/core` must not depend on the database package, so the two shapes are checked against
 * each other at the single call site in `services/ingestion` and by a test, rather than by sharing
 * a declaration. Two types is the honest cost of that boundary.
 *
 * Everything here is **declared** state. The observed columns — `reliability`, the breaker, the
 * failure counters, the cursor — are what running the connector produced, are absent from this
 * shape on purpose, and `registerConnectorSource` never overwrites them.
 */
export interface ConnectorRegistrationInput {
  readonly id: string;
  readonly kind: ConnectorKind;
  readonly displayName: string;
  readonly connectorVersion: string;
  readonly sourceTier: number;
  readonly termsUrl: string;
  readonly legalBasis: string;
  readonly rateLimit: RateLimitSpec;
  readonly refreshWindow: string;
  readonly schedule: string;
  readonly regions: readonly string[];
}

/**
 * Project a connector's `meta` onto its registration row.
 *
 * Pure, total, and the only place the mapping exists. Before ADR-0041 each caller assembled this
 * by hand from two objects plus literals, and the literals had already drifted — the stored rate
 * limit in `posting-runner.test.ts` omitted the `minIntervalMs` the Lever connector actually
 * enforces. A projection cannot drift from its own source.
 *
 * `connectorVersion` is `meta.version`: the semver of the connector's *behaviour*, so a stored row
 * says which normalization wrote the facts beneath it.
 */
export function toRegistration(meta: ConnectorMeta): ConnectorRegistrationInput {
  return {
    id: meta.id,
    kind: meta.kind,
    displayName: meta.displayName,
    connectorVersion: meta.version,
    sourceTier: meta.sourceTier,
    termsUrl: meta.termsUrl,
    legalBasis: meta.legalBasis,
    rateLimit: meta.rateLimit,
    refreshWindow: meta.refreshWindow,
    schedule: meta.schedule,
    regions: meta.regions,
  };
}
