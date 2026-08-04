/**
 * The connector error taxonomy.
 *
 * The only question that matters operationally is **retryable or terminal**, and getting it
 * wrong is expensive in both directions: retrying a `401` hides a broken credential behind
 * what looks like a slow source, and giving up on a `503` throws away a run that would have
 * succeeded a second later.
 *
 * `docs/architecture/connectors.md`: retry network errors, `429`, `502`, `503`, `504`. Never
 * retry `400`, `401`, `403`, `422` — those are bugs or auth problems, and retrying hides them.
 */

export type FailureKind =
  /** The source could not be reached at all — DNS, TCP, TLS, timeout. */
  | 'network'
  /** The source asked us to slow down. */
  | 'rate-limited'
  /** The source is up but failing: 5xx. */
  | 'upstream'
  /** We sent something wrong: 4xx other than 429. Our defect, not theirs. */
  | 'request'
  /** The response arrived but could not be read as what it claims to be. */
  | 'malformed';

/** HTTP statuses worth trying again. Anything else is a decision, not a hiccup. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

export interface ConnectorErrorOptions {
  readonly kind: FailureKind;
  readonly sourceId: string;
  readonly status?: number;
  /** Seconds the source asked us to wait, parsed from `Retry-After`. */
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}

export class ConnectorError extends Error {
  readonly kind: FailureKind;
  readonly sourceId: string;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: ConnectorErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ConnectorError';
    this.kind = options.kind;
    this.sourceId = options.sourceId;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }

  /**
   * Whether another attempt could plausibly succeed.
   *
   * `malformed` is deliberately terminal even though it can look transient: a response we cannot
   * parse usually means the source changed its shape, and hammering it will not change that.
   */
  get retryable(): boolean {
    if (this.kind === 'network' || this.kind === 'rate-limited') return true;
    if (this.kind === 'upstream') return this.status === undefined || RETRYABLE_STATUSES.has(this.status);
    return false;
  }
}

/**
 * Classify an HTTP status into the taxonomy.
 *
 * Exported because a connector should never decide this for itself — a hand-rolled
 * `if (status === 500) retry` in one connector and not another is how retry policy drifts.
 */
export function kindForStatus(status: number): FailureKind {
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'upstream';
  return 'request';
}

/**
 * Parse `Retry-After`, which the RFC permits in two forms: delta-seconds, or an HTTP date.
 * Returns `undefined` for an absent or unparseable header rather than guessing a delay —
 * a guessed backoff is indistinguishable from a respected one until it is too short.
 *
 * `now` is injected so this stays testable without freezing the clock globally.
 */
export function parseRetryAfter(header: string | null | undefined, now: Date = new Date()): number | undefined {
  if (header === null || header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed === '') return undefined;

  // delta-seconds. Guard against a negative or absurd value rather than trusting the source.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  const delta = at - now.getTime();
  // A date already in the past means "you may retry now", not "retry in the past".
  return delta > 0 ? delta : 0;
}
