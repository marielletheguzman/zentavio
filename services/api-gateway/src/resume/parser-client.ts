/**
 * The gateway's client for `ai/resume-parser` (ADR-0003).
 *
 * This is the seam between the TypeScript and Python halves, and the only place the gateway knows
 * the parser exists over HTTP. Everything above it receives a `ParserOutcome` — a discriminated
 * union — so a caller cannot forget that "the service was unreachable" and "the résumé was
 * unreadable" are different problems with different answers for the user.
 *
 * **No HTTP library.** `fetch` is in Node 22, which `engines` already requires (ADR-0014). Adding a
 * client library would be a stack change for something the runtime supplies.
 *
 * **Every response is validated, never cast.** `isParseResponse` is the boundary where TypeScript's
 * guarantees genuinely stop: `as ParseResponseWire` on a `fetch` result is a claim about a remote
 * process, and the failure it hides — a renamed wire field silently reading `undefined` — does not
 * throw. It just stores wrong data.
 */

import {
  isParseResponse,
  isServiceError,
  type ParseRequestWire,
  type ParseResponseWire,
} from '@zentavio/types';

/**
 * What the gateway does next, by case.
 *
 * `parsed` covers **every** parse outcome including `unknown` — a résumé that could not be read is
 * a result to show the user, not a failure to retry. `rejected` is the parser refusing the request.
 * `unavailable` is the parser not answering, which is the only retryable case.
 */
export type ParserOutcome =
  | { readonly kind: 'parsed'; readonly response: ParseResponseWire }
  | {
      readonly kind: 'rejected';
      readonly code: string;
      readonly message: string;
      readonly correlationId: string;
    }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly retryable: true };

export interface ParserClientOptions {
  readonly baseUrl: string;
  /**
   * A parse is CPU-bound and bounded — a document is size-capped before it gets here. A request
   * still hanging after this is a stuck service, and waiting longer only holds a user's browser
   * open while it happens.
   */
  readonly timeoutMs?: number;
  /** Injected so tests do not patch a global. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ParserClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: ParserClientOptions) {
    // Trailing slashes make `${base}/parse` produce `//parse`, which some proxies redirect and
    // others 404. Normalise once here rather than at every call site.
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  /**
   * Parse a document against a closed set of skills.
   *
   * The closed set is passed **per request** because the parser is stateless — it owns no registry,
   * so the caller supplies one and the service may only return slugs from it.
   *
   * Never throws for an expected condition. A thrown error from here means a genuine defect, not a
   * bad résumé or a service restart.
   */
  async parse(request: ParseRequestWire): Promise<ParserOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/parse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (cause) {
      // Network failure or timeout. The message deliberately says nothing about the document —
      // this string may reach a log, and the document is a stranger's résumé.
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
      // A 200 that is not JSON means something between us and the parser rewrote the response —
      // a proxy error page, typically. Treating it as retryable is right; treating it as a parse
      // result would be a fabricated profile.
      return { kind: 'unavailable', reason: 'malformed response', retryable: true };
    }

    if (response.ok) {
      if (!isParseResponse(body)) {
        // The contract broke. Not retryable: the same request will produce the same shape, and
        // pretending otherwise turns a deploy mismatch into a retry storm.
        return { kind: 'unavailable', reason: 'response did not match the contract', retryable: true };
      }
      return { kind: 'parsed', response: body };
    }

    if (isServiceError(body)) {
      return {
        kind: 'rejected',
        code: body.error.code,
        message: body.error.message,
        correlationId: body.error.correlationId,
      };
    }

    // A non-2xx that is not the shared envelope is infrastructure, not the parser — a gateway
    // timeout page, a load balancer 503.
    return { kind: 'unavailable', reason: `upstream returned ${String(response.status)}`, retryable: true };
  }
}
