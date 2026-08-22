/**
 * The real fetcher: `LeverDeps` backed by HTTP.
 *
 * **This is the first real network I/O in the repository.** Every connector until now has had its
 * `fetch*` dependency injected by a test, which is why `normalize` could be golden-file tested and
 * why the runner's failure paths are exercisable. That property is preserved here rather than
 * abandoned: `fetch` is a parameter, so this module is testable without a network and a caller can
 * point it at a recorded response.
 *
 * ## What it refuses to do
 *
 * **Discover boards.** The slugs come from configuration. Nothing here enumerates Lever's customers
 * or guesses an organisation name, and a board nobody configured is not fetched
 * (`LeverConnector.fetch` refuses it too — this is the second lock on the same door).
 *
 * **Retry, rate limit, or open a circuit.** Those come from `connectors/core` and are applied by the
 * connector around this call. A fetcher that retried on its own would retry inside a retry
 * (`docs/development/connector-guide.md` Step 6).
 */

import { ConnectorError, kindForStatus } from '@zentavio/connectors-core';

import type { BoardRaw, LeverDeps } from './index.ts';
import type { LeverPosting } from './parse.ts';

export interface HttpLeverOptions {
  /** Board slugs somebody configured. Empty is valid and reads nothing. */
  readonly boards: readonly string[];
  /** Base URL of the Postings API. Overridable so a local run can point at a recorded stub. */
  readonly apiBase?: string;
  /** Injected so this is testable without a network, and so a caller can add timeouts or tracing. */
  readonly fetchImpl?: typeof globalThis.fetch;
  /** Injected so `fetchedAt` is not read from a global clock inside the pipeline. */
  readonly now?: () => Date;
}

const DEFAULT_API_BASE = 'https://api.lever.co';

/** The endpoint, built from the configured base and the board slug. Never from a posting's content. */
export function boardUrl(board: string, apiBase: string = DEFAULT_API_BASE): string {
  return `${apiBase.replace(/\/+$/, '')}/v0/postings/${encodeURIComponent(board)}?mode=json`;
}

/**
 * `LeverDeps` that actually calls Lever.
 *
 * A `404` is a board that is gone, which is data: it returns `null`, and the connector reports
 * `degraded` rather than throwing. Every other non-OK status is a failure with a kind attached, so
 * `withRetry` can tell a rate limit from a bad request — retrying a `403` would hide a legal problem
 * behind a delay.
 */
export function httpLeverDeps(options: HttpLeverOptions): LeverDeps {
  const apiBase = options.apiBase ?? DEFAULT_API_BASE;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  return {
    configuredBoards: options.boards,

    async fetchBoard(board: string): Promise<BoardRaw | null> {
      const sourceUrl = boardUrl(board, apiBase);
      const response = await doFetch(sourceUrl, {
        headers: { accept: 'application/json' },
      });

      // Gone is not broken. A board that was configured and no longer exists is a fact about the
      // world, and the connector's health check is where it becomes visible.
      if (response.status === 404) return null;

      if (!response.ok) {
        throw new ConnectorError(`lever: ${board} returned ${response.status}`, {
          kind: kindForStatus(response.status),
          sourceId: 'lever',
          status: response.status,
        });
      }

      const payload: unknown = await response.json();

      // The API returns a bare array. Anything else is a shape we do not recognise, and guessing at
      // it would produce postings nobody published.
      if (!Array.isArray(payload)) {
        throw new ConnectorError(`lever: ${board} did not return a posting array`, {
          kind: 'malformed',
          sourceId: 'lever',
        });
      }

      return {
        board,
        sourceUrl,
        // Recorded at fetch time so `normalize` stays pure and a stored posting can say when it was
        // read rather than when it was written.
        fetchedAt: now().toISOString(),
        postings: payload as readonly LeverPosting[],
      };
    },
  };
}
