/**
 * The gateway's client for `ai/skill-gap` (ADR-0003).
 *
 * Deliberately the same shape as `ParserClient` — a discriminated outcome, `fetch` rather than an
 * HTTP library, and every response validated instead of cast. The failure it prevents is the same
 * one: `as GapResponseWire` is a claim about a remote process, and a renamed wire field reads
 * `undefined` and stores a wrong number without ever throwing.
 *
 * The difference worth noting is what `computed` covers. Every *gap* outcome is a success here,
 * `unknown` included, because "nobody has modelled this track" is an answer the user must be shown
 * rather than a failure to retry.
 */

import { isGapResponse, isServiceError, type GapRequestWire, type GapResponseWire } from '@zentavio/types';

export type GapOutcome =
  | { readonly kind: 'computed'; readonly response: GapResponseWire }
  | {
      readonly kind: 'rejected';
      readonly code: string;
      readonly message: string;
      readonly correlationId: string;
    }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly retryable: true };

export interface GapClientOptions {
  readonly baseUrl: string;
  /**
   * Shorter than the parser's. A gap is arithmetic over a few hundred rows with no document
   * parsing and no model call, so anything still running after this is stuck rather than slow.
   */
  readonly timeoutMs?: number;
  /** Injected so tests do not patch a global. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class GapClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: GapClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  /**
   * Compute one gap.
   *
   * Requirements, profile and graph all travel in the request because the service is stateless. It
   * makes the payload larger than a handle would, and it is what makes the result reproducible from
   * the request alone.
   */
  async compute(request: GapRequestWire): Promise<GapOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/gap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (cause) {
      return {
        kind: 'unavailable',
        reason: cause instanceof Error && cause.name === 'AbortError' ? 'timed out' : 'unreachable',
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: 'unavailable', reason: 'malformed response', retryable: true };
    }

    if (response.ok) {
      if (!isGapResponse(body)) {
        return {
          kind: 'unavailable',
          reason: 'response did not match the contract',
          retryable: true,
        };
      }
      return { kind: 'computed', response: body };
    }

    if (isServiceError(body)) {
      return {
        kind: 'rejected',
        code: body.error.code,
        message: body.error.message,
        correlationId: body.error.correlationId,
      };
    }

    return {
      kind: 'unavailable',
      reason: `upstream returned ${String(response.status)}`,
      retryable: true,
    };
  }
}
