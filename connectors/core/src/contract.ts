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
}

/** True when nothing in the result blocks ingestion. Warnings do not block. */
export function isIngestible(result: ValidationResult): boolean {
  return !result.issues.some((issue) => issue.severity === 'error');
}
