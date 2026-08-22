/**
 * `lever` — published postings from **configured** employer boards.
 *
 * The first connector under `job-boards/`, and the first job data this product has had at all.
 *
 * ## Legal basis, quoted rather than inferred
 *
 * Lever's own Postings API documentation states: *"all job postings in the `published` state are
 * publicly viewable. These jobs may be scraped by third parties. All other jobs are completely
 * hidden from the jobs API."* That is an explicit permission from the source, which is a stronger
 * footing than "the endpoint answered" — the basis most connectors have to settle for.
 *
 * It also settles the scope question structurally: **the API cannot return an unpublished posting**,
 * so "published only" is enforced by the source rather than by us remembering.
 *
 * `api.lever.co/robots.txt` is `Allow: /` with `Crawl-delay: 1`, read 2026-08-22. The documented
 * `429` applies to application *POST* requests, not to reads, so nothing states a GET rate limit —
 * the crawl delay is what this connector honours, and it is a courtesy floor rather than a published
 * ceiling.
 *
 * ## Configured boards, not discovery
 *
 * A board is read because somebody put it in the configuration. **Nothing here discovers boards**,
 * guesses organisation slugs, or enumerates Lever's customers. That keeps coverage curated and
 * honest about what it is: this is not a global search index, and Lever does not offer one — the API
 * exposes one company's published postings at a time.
 *
 * ## What it refuses to infer
 *
 * **Salary.** Lever publishes no structured pay, so every row carries `salaryIsStated: false` and
 * null amounts. A number parsed out of a description would be a guess with a currency attached.
 *
 * **Remote scope.** `workplaceType` says whether a role is remote; nothing says whether that means
 * worldwide, a country, or a region. The scope stays null rather than becoming a plausible guess,
 * because "remote (worldwide)" is the single most consequential thing to be wrong about for somebody
 * choosing where to live.
 */

import {
  RateLimiter,
  withRetry,
  type ArchivableSource,
  type Connector,
  type ConnectorMeta,
  type HealthStatus,
  type Page,
  type SearchQuery,
  type ValidationIssue,
  type ValidationResult,
} from '@zentavio/connectors-core';

import type { JobPosting } from '@zentavio/types';

import { toPosting, type LeverPosting } from './parse.ts';

/** One configured board, as fetched. */
export interface BoardRaw {
  /** The organisation's Lever slug, exactly as configured. */
  readonly board: string;
  readonly sourceUrl: string;
  /** ISO-8601 UTC, recorded at fetch time so `normalize` stays pure. */
  readonly fetchedAt: string;
  readonly postings: readonly LeverPosting[];
}

/**
 * One posting, in the shape ingestion stores.
 *
 * `@zentavio/types`' shared shape, not this package's own: a runner that iterates the registry
 * cannot turn a connector's output into rows without one, and a per-source adapter would be a source
 * named where ADR-0002 forbids it.
 */
export type JobPostingRecord = JobPosting;

export const SOURCE_ID = 'lever';

/**
 * The registration row this connector needs in `connector_sources`.
 *
 * Tier 2, not tier 1: the employer wrote the posting, but Lever hosts and renders it, so this is the
 * platform's rendering of the employer's words rather than the employer's own page.
 */
export const REGISTRATION = {
  id: SOURCE_ID,
  kind: 'job-board' as const,
  displayName: 'Lever (configured employer boards)',
  sourceTier: 2,
  termsUrl: 'https://github.com/lever/postings-api',
  legalBasis:
    'Lever documents that postings in the `published` state "are publicly viewable" and "may be ' +
    'scraped by third parties", and that unpublished jobs are hidden from the API entirely (read ' +
    '2026-08-22). robots.txt is `Allow: /` with `Crawl-delay: 1`. Only boards configured by ' +
    'Zentavio are read; nothing discovers or enumerates boards.',
  refreshWindow: '1 day',
  schedule: '0 */6 * * *',
} as const;

export interface LeverDeps {
  /** Fetch one configured board. `null` when the board is gone — never an invented empty board. */
  readonly fetchBoard: (board: string) => Promise<BoardRaw | null>;
  /** The boards somebody configured. Not discovered, not guessed. */
  readonly configuredBoards: readonly string[];
}

export class LeverConnector implements Connector<BoardRaw, readonly JobPosting[]> {
  readonly meta: ConnectorMeta = {
    id: SOURCE_ID,
    version: '1.0.0',
    kind: 'job-board',
    regions: [],
    // `Crawl-delay: 1` from robots.txt, taken as the floor. Nothing documents a GET rate limit, so
    // this is courtesy rather than a published ceiling — and a job board changes daily at most.
    rateLimit: { requests: 60, windowMs: 60_000, minIntervalMs: 1000 },
    reliability: 0,
    termsUrl: REGISTRATION.termsUrl,
    // The API returns every posting in the `published` state, so a board read completely is a
    // complete list and a disappearance means the posting is gone (ADR-0034). It says nothing about
    // whether a given run finished — that is the run's report, and expiry needs both.
    listing: 'exhaustive',
  };

  readonly #deps: LeverDeps;
  readonly #limiter: RateLimiter;

  constructor(deps: LeverDeps) {
    this.#deps = deps;
    this.#limiter = new RateLimiter(this.meta.rateLimit);
  }

  async search(query: SearchQuery): Promise<Page<BoardRaw>> {
    const boards = this.#deps.configuredBoards.slice(0, query.limit ?? this.#deps.configuredBoards.length);

    const items: BoardRaw[] = [];
    for (const board of boards) {
      const raw = await this.fetch(board);
      if (raw !== null) items.push(raw);
    }
    return { items };
  }

  /** One configured board. A board nobody configured is not fetched, whatever the caller asks. */
  async fetch(externalId: string): Promise<BoardRaw | null> {
    if (!this.#deps.configuredBoards.includes(externalId)) return null;

    await this.#limiter.acquire();
    return withRetry(() => this.#deps.fetchBoard(externalId));
  }

  /**
   * Postings, in storage shape.
   *
   * Pure and total. A posting missing an id, a title or its hosted URL produces **no row**: a job we
   * cannot link to is a job somebody cannot apply for, and listing it would waste the one thing this
   * feature is supposed to save them.
   */
  normalize(raw: BoardRaw): readonly JobPosting[] {
    return raw.postings
      .map((posting) => toPosting(posting, { board: raw.board, fetchedAt: raw.fetchedAt, sourceId: SOURCE_ID }))
      .filter((record): record is JobPosting => record !== null);
  }

  validate(normalized: readonly JobPosting[]): ValidationResult {
    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();

    for (const row of normalized) {
      if (seen.has(row.externalId)) {
        issues.push({
          severity: 'error',
          code: 'duplicate-external-id',
          message: `${row.externalId} appears twice; a posting id identifies one posting in this board.`,
        });
      }
      seen.add(row.externalId);

      if (!row.url.startsWith('https://')) {
        issues.push({
          severity: 'error',
          code: 'unusable-url',
          message: `${row.externalId} has no usable apply URL, so nobody could act on it.`,
        });
      }

      // The guard against the failure this connector is most likely to grow: somebody adding a
      // description parser and calling the result a salary.
      if (row.salaryIsStated) {
        issues.push({
          severity: 'error',
          code: 'salary-invented',
          message:
            `${row.externalId} claims a stated salary. Lever publishes no structured pay, so this ` +
            'can only have come from parsing prose — which is a guess with a currency attached.',
        });
      }

      if (row.remoteScope !== null) {
        issues.push({
          severity: 'error',
          code: 'remote-scope-invented',
          message:
            `${row.externalId} claims a remote scope. \`workplaceType\` says remote and nothing ` +
            'says worldwide, country or region.',
        });
      }
    }

    return { issues };
  }

  /** The board as served. Archived so a stored posting can be shown what it was read from. */
  archivable(raw: BoardRaw): ArchivableSource {
    return {
      bytes: new TextEncoder().encode(JSON.stringify(raw.postings)),
      contentType: 'application/json; charset=utf-8',
      slug: `lever-${raw.board}`,
      jurisdiction: 'XX',
      year: Number(raw.fetchedAt.slice(0, 4)),
      extension: 'json',
      isOriginal: true,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    const [first] = this.#deps.configuredBoards;
    if (first === undefined) return { state: 'degraded', detail: 'no boards are configured' };

    try {
      await this.#limiter.acquire();
      const raw = await this.#deps.fetchBoard(first);
      if (raw === null) return { state: 'degraded', detail: `${first} is no longer served` };

      // **An empty board is healthy.** A company with nothing open is a real state, and treating it
      // as a fault would make every quiet employer look like a broken integration.
      return { state: 'healthy' };
    } catch (error) {
      return { state: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
