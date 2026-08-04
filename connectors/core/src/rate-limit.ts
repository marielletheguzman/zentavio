/**
 * Client-side rate limiting from `meta.rateLimit`.
 *
 * The platform stays inside a source's limit **even when the source would not stop us**
 * (`docs/architecture/connectors.md`). Two independent constraints, because either alone
 * leaves a hole:
 *
 * - a **window budget** (N requests per window) alone permits spending the entire allowance
 *   in one burst, which is exactly the shape that trips a source's protection;
 * - a **minimum interval** alone permits a sustained rate the source never agreed to.
 *
 * The window is a sliding one rather than fixed buckets. Fixed buckets allow 2N requests
 * across a boundary — N at the end of one window and N at the start of the next — which is
 * the burst the budget was meant to prevent.
 */

import type { RateLimitSpec } from './contract.ts';

export interface LimiterDeps {
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

export const realLimiterDeps: LimiterDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * A per-source limiter. One instance per connector — sharing one across sources would make
 * a slow source throttle a fast one.
 *
 * Not thread-safe in any meaningful sense and does not need to be: Node runs this on one
 * thread, and `acquire` awaits sequentially by construction.
 */
export class RateLimiter {
  readonly #spec: RateLimitSpec;
  readonly #deps: LimiterDeps;
  /** Timestamps of requests still inside the window, oldest first. */
  #recent: number[] = [];
  #lastRequestAt: number | undefined;

  constructor(spec: RateLimitSpec, deps: LimiterDeps = realLimiterDeps) {
    this.#spec = spec;
    this.#deps = deps;
  }

  /**
   * Block until another request is permitted, then record it.
   *
   * Records the *post-wait* time, so a caller that was made to wait does not immediately
   * appear to have been idle.
   */
  async acquire(): Promise<void> {
    const waitMs = this.#waitFor(this.#deps.now());
    if (waitMs > 0) await this.#deps.sleep(waitMs);

    const at = this.#deps.now();
    this.#prune(at);
    this.#recent.push(at);
    this.#lastRequestAt = at;
  }

  /**
   * How long a request issued at `at` must wait. Private on purpose — tests drive this through
   * `acquire` with an injected clock, so what is asserted is the behaviour a connector gets
   * rather than an internal that could pass while `acquire` misuses it.
   */
  #waitFor(at: number): number {
    this.#prune(at);

    const sinceLast = this.#lastRequestAt === undefined ? Infinity : at - this.#lastRequestAt;
    const intervalWait = this.#spec.minIntervalMs === undefined
      ? 0
      : Math.max(0, this.#spec.minIntervalMs - sinceLast);

    // Budget is spent: wait until the oldest request leaves the window.
    const budgetWait = this.#recent.length < this.#spec.requests
      ? 0
      : Math.max(0, (this.#recent[0] ?? at) + this.#spec.windowMs - at);

    return Math.max(intervalWait, budgetWait);
  }

  #prune(at: number): void {
    const cutoff = at - this.#spec.windowMs;
    // Timestamps are appended in order, so dropping the leading expired run is sufficient.
    let firstLive = 0;
    while (firstLive < this.#recent.length && (this.#recent[firstLive] ?? 0) <= cutoff) firstLive += 1;
    if (firstLive > 0) this.#recent = this.#recent.slice(firstLive);
  }
}
