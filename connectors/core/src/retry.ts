/**
 * Retry with exponential backoff and **full** jitter (`docs/architecture/connectors.md`).
 *
 * Full jitter — a delay drawn uniformly from `[0, backoff]` rather than `backoff ± noise` —
 * because the failure mode this exists to prevent is synchronised retries. Every client that
 * backed off from the same outage returns at the same moment and reproduces it. Halving the
 * mean delay is the price; de-correlating the herd is the point.
 *
 * Retry is not hand-rolled per connector, deliberately: a policy that differs by source is a
 * policy nobody can reason about during an incident.
 */

import { ConnectorError } from './errors.ts';

export interface RetryPolicy {
  /** Total attempts including the first. `3` means one try and two retries. */
  readonly maxAttempts: number;
  /** Backoff for the first retry, doubled each subsequent attempt. */
  readonly baseDelayMs: number;
  /** Ceiling on a single delay, before jitter. */
  readonly maxDelayMs: number;
  /**
   * Ceiling on the whole operation. Without this, `maxAttempts × maxDelayMs` can exceed any
   * run window a caller had in mind, and a stalled connector stalls the run it belongs to.
   */
  readonly maxTotalMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  maxTotalMs: 120_000,
};

export interface RetryDeps {
  /** Injected so tests do not sleep and do not depend on wall-clock timing. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Injected for the same reason: jitter must be reproducible under test. */
  readonly random: () => number;
  readonly now: () => number;
}

export const realRetryDeps: RetryDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  now: () => Date.now(),
};

/**
 * The delay before attempt `attempt` (1-based; attempt 1 never sleeps).
 *
 * A source's own `Retry-After` wins over our computed backoff whenever it is longer. Honouring
 * it is not politeness — a source that told us when to come back and was ignored is a source
 * that starts blocking us.
 */
export function backoffMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number,
  retryAfterMs?: number,
): number {
  const exponential = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  const jittered = Math.floor(random() * exponential);
  return retryAfterMs === undefined ? jittered : Math.max(jittered, retryAfterMs);
}

/**
 * Run `operation`, retrying only what `ConnectorError.retryable` permits.
 *
 * An error that is not a `ConnectorError` is rethrown untouched on the first occurrence. A
 * `TypeError` from our own code is a bug, and retrying a bug turns a stack trace into a
 * timeout — the single most expensive way to hide a defect in an ingestion run.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  deps: RetryDeps = realRetryDeps,
  onRetry?: (error: ConnectorError, attempt: number, delayMs: number) => void,
): Promise<T> {
  const startedAt = deps.now();
  let lastError: ConnectorError | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!(error instanceof ConnectorError) || !error.retryable) throw error;
      lastError = error;

      if (attempt === policy.maxAttempts) break;

      const delayMs = backoffMs(attempt, policy, deps.random, error.retryAfterMs);

      // Check the total budget against the delay we are about to incur, not merely the time
      // already spent. Sleeping past the deadline and then giving up wastes the whole delay.
      if (deps.now() - startedAt + delayMs > policy.maxTotalMs) break;

      onRetry?.(error, attempt, delayMs);
      await deps.sleep(delayMs);
    }
  }

  // Unreachable with a well-formed policy, but `maxAttempts: 0` would land here and an
  // undefined throw is worse than a named one.
  throw lastError ?? new Error('withRetry exhausted without attempting the operation');
}
