/**
 * The gateway's client for `ai/career-roadmap` (ADR-0003).
 *
 * Same shape as `GapClient` and `ParserClient` — a discriminated outcome, `fetch` rather than an
 * HTTP library, and every response validated instead of cast. `as EligibilityResponseWire` is a
 * claim about a remote process, and a renamed wire field reads `undefined` and renders a wrong
 * verdict without ever throwing.
 *
 * **Every eligibility outcome is `evaluated`, `unknown` included.** "Nobody has modelled this
 * pathway" and "this profession is licence-gated and we have no recognition rule" are answers the
 * user must be shown, not failures to retry.
 */

import { isEligibilityResponse, type EligibilityResponseWire } from '@zentavio/types';

export interface EvaluateRequestWire {
  readonly pathway_id: string | null;
  readonly requirements: readonly unknown[];
  readonly facts: readonly unknown[];
  readonly as_of: string;
  readonly licence_gated: boolean;
}

export type EligibilityOutcome =
  | { readonly kind: 'evaluated'; readonly response: EligibilityResponseWire }
  | {
      /** The service refused the request. Our defect, not the user's. */
      readonly kind: 'rejected';
      readonly code: string;
      readonly message: string;
    }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly retryable: true };

export interface EligibilityClientOptions {
  readonly baseUrl: string;
  /**
   * Short, because eligibility is comparison over a handful of rows with no model call and no
   * document parsing. Anything still running after this is stuck rather than slow.
   */
  readonly timeoutMs?: number;
  /** Injected so tests do not patch a global. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class EligibilityClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: EligibilityClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async evaluate(request: EvaluateRequestWire): Promise<EligibilityOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);

    try {
      const response = await this.#fetch(`${this.#baseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        // A 4xx from this service means the gateway sent something wrong — the service's own
        // contract reserves 4xx for exactly that. Reported as `rejected` so it is logged as our
        // defect rather than surfaced to the user as an eligibility outcome.
        const body: unknown = await response.json().catch(() => null);
        const detail = body as { code?: string; message?: string } | null;
        return {
          kind: 'rejected',
          code: detail?.code ?? `HTTP_${String(response.status)}`,
          message: detail?.message ?? `the eligibility service returned ${String(response.status)}`,
        };
      }

      const body: unknown = await response.json();
      if (!isEligibilityResponse(body)) {
        // Shape drift is unavailable rather than rejected: the request was fine, the contract
        // moved. Rendering a partial verdict would be worse than saying we cannot answer.
        return {
          kind: 'unavailable',
          reason: 'the eligibility service returned a response that does not match the contract',
          retryable: true,
        };
      }

      return { kind: 'evaluated', response: body };
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? 'timed out'
          : 'unreachable';
      return { kind: 'unavailable', reason, retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }
}
