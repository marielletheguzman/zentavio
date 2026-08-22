/**
 * `git-scm` — the official Git reference documentation, as learning resources.
 *
 * The first connector under `learning-resources/`, and the one that gives `learning_resources` its
 * first rows. Until it existed the table was real and empty, so a completion had nothing to be
 * recorded against.
 *
 * ## What it stores, and what it deliberately does not
 *
 * **A title, a URL, and metadata.** Not the documentation itself. The manual pages are the Git
 * project's own prose; linking to them and describing them is a catalogue, copying them would be a
 * mirror, and a mirror goes stale in a way that misinforms somebody trying to learn.
 *
 * The `description` on a row is **ours**, one sentence, saying what the page is for. It is not the
 * page's NAME line and it is not a summary of the content: an ingested paraphrase of documentation
 * is exactly the invented detail `.claude/skills/learning-paths/SKILL.md` refuses.
 *
 * ## Legal basis
 *
 * `git-scm.com` serves **no `robots.txt`** — 404 on 2026-08-22, which states no restriction rather
 * than granting one, so the courtesy rate limit below is the operative constraint. The reference
 * pages are the Git project's documentation, distributed with Git under GPLv2. Nothing here
 * reproduces them.
 *
 * ## Why these pages
 *
 * The ten commands `git-fundamentals` asks about, and no others. An assessment that cites a page and
 * a catalogue that offers a different page would be two opinions about where to learn something;
 * this way the thing you are sent to read is the thing the questions were written from.
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

import { parseDocPage } from './parse.ts';

export interface DocPageRaw {
  /** The command slug as the site uses it — `git-stash`. */
  readonly documentId: string;
  readonly sourceUrl: string;
  /** ISO-8601 UTC, recorded at fetch time so `normalize` stays pure. */
  readonly fetchedAt: string;
  readonly html: string;
}

/** One catalogue row, in the shape `learning_resources` stores. */
export interface LearningResourceRecord {
  readonly provider: string;
  readonly externalId: string;
  readonly title: string;
  readonly url: string;
  readonly format: 'documentation';
  readonly level: 'beginner' | 'intermediate' | 'advanced' | null;
  readonly language: string;
  readonly costBand: 'free';
  readonly isCertification: false;
  /**
   * Always `false`. Reading a manual page is not evidence of anything, and ADR-0030 leaves the
   * question of what a `grants_evidence` resource would even be for a later decision.
   */
  readonly grantsEvidence: false;
  readonly sourceId: string;
  readonly sourceTier: 1;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  /** The skill this page teaches, by slug. Resolved to an id at ingest. */
  readonly skillSlug: string;
  readonly coverage: 'primary' | 'partial' | 'mentioned';
}

export const SOURCE_ID = 'git-scm';

/**
 * The registration row this connector needs in `connector_sources`.
 *
 * Exposed as data rather than written here: a connector returns what it is, and persistence belongs
 * to `services/ingestion`. `legal_basis` is a sentence rather than a URL because "we checked" is not
 * a record.
 */
export const REGISTRATION = {
  id: SOURCE_ID,
  kind: 'learning' as const,
  displayName: 'Git reference documentation (git-scm.com)',
  sourceTier: 1,
  termsUrl: 'https://git-scm.com/about',
  legalBasis:
    'No robots.txt is served (404, checked 2026-08-22), so nothing is disallowed; the reference ' +
    'pages are the Git project documentation distributed under GPLv2, and only titles, URLs and ' +
    'metadata are stored — never the prose.',
  refreshWindow: '90 days',
  schedule: '0 4 1 * *',
} as const;

/**
 * The ten pages the Git assessment cites.
 *
 * A closed list rather than a crawl. Crawling a documentation site produces a catalogue nobody chose
 * — every page equally weighted, most of them irrelevant to any skill we model — and the point of a
 * learning resource is that somebody decided it was worth reading for something.
 */
export const KNOWN_PAGES: readonly string[] = [
  'git-checkout',
  'git-cherry-pick',
  'git-commit',
  'git-fetch',
  'git-merge',
  'git-rebase',
  'git-reset',
  'git-revert',
  'git-stash',
  'gitignore',
];

/**
 * What each page is for, in our own words.
 *
 * **Written here rather than extracted**, because the alternative is storing a paraphrase of the
 * project's prose and calling it metadata. One sentence, saying why somebody would open it.
 */
const PURPOSE: Readonly<Record<string, string>> = {
  'git-checkout': 'Switching branches and restoring files, including what a detached HEAD is.',
  'git-cherry-pick': 'Applying the changes from an existing commit as a new commit.',
  'git-commit': 'Recording changes, and what amending an existing commit actually does.',
  'git-fetch': 'Downloading refs and objects from a remote without changing the current branch.',
  'git-merge': 'Joining histories, and the conditions under which a merge fast-forwards.',
  'git-rebase': 'Replaying commits onto a new base, and why that rewrites history.',
  'git-reset': 'Moving the branch pointer, and what --soft, --mixed and --hard each touch.',
  'git-revert': 'Undoing a commit by recording a new one, safe on shared history.',
  'git-stash': 'Setting uncommitted changes aside without putting them on a branch.',
  gitignore: 'Which files Git ignores, and why it does not affect files already tracked.',
};

export interface GitScmDeps {
  readonly fetchPage: (documentId: string) => Promise<DocPageRaw | null>;
}

export class GitScmConnector implements Connector<DocPageRaw, readonly LearningResourceRecord[]> {
  readonly meta: ConnectorMeta = {
    id: SOURCE_ID,
    version: '1.0.0',
    kind: 'learning',
    regions: [],
    // Documentation changes on release timelines. There is nothing to gain from going faster, and a
    // volunteer-run project site deserves the same courtesy as any other.
    rateLimit: { requests: 20, windowMs: 60_000, minIntervalMs: 3000 },
    reliability: 0,
    termsUrl: REGISTRATION.termsUrl,
  };

  readonly #deps: GitScmDeps;
  readonly #limiter: RateLimiter;

  constructor(deps: GitScmDeps) {
    this.#deps = deps;
    this.#limiter = new RateLimiter(this.meta.rateLimit);
  }

  async search(query: SearchQuery): Promise<Page<DocPageRaw>> {
    const items: DocPageRaw[] = [];
    for (const id of KNOWN_PAGES.slice(0, query.limit ?? KNOWN_PAGES.length)) {
      const raw = await this.fetch(id);
      if (raw !== null) items.push(raw);
    }
    return { items };
  }

  async fetch(externalId: string): Promise<DocPageRaw | null> {
    if (!KNOWN_PAGES.includes(externalId)) return null;
    await this.#limiter.acquire();
    return withRetry(() => this.#deps.fetchPage(externalId));
  }

  /**
   * One catalogue row per page.
   *
   * Pure and total. A page whose title cannot be read produces **no row** — a resource with a
   * fabricated title sends somebody to a page that is not what we said it was.
   */
  normalize(raw: DocPageRaw): readonly LearningResourceRecord[] {
    const parsed = parseDocPage(raw.html);
    if (parsed.title === null) return [];

    const purpose = PURPOSE[raw.documentId];
    if (purpose === undefined) return [];

    return [
      {
        provider: 'git-scm.com',
        externalId: raw.documentId,
        title: parsed.title,
        url: raw.sourceUrl,
        format: 'documentation',
        // Reference documentation is not graded for difficulty, and assigning one would be our
        // opinion wearing the provider's clothes.
        level: null,
        language: 'en',
        costBand: 'free',
        isCertification: false,
        grantsEvidence: false,
        sourceId: SOURCE_ID,
        sourceTier: 1,
        sourceUrl: raw.sourceUrl,
        retrievedAt: raw.fetchedAt,
        skillSlug: 'git',
        // `primary`: these pages are the definition of the behaviour, not a mention of it.
        coverage: 'primary',
      },
    ];
  }

  validate(normalized: readonly LearningResourceRecord[]): ValidationResult {
    const issues: ValidationIssue[] = [];

    for (const row of normalized) {
      if (!row.url.startsWith('https://git-scm.com/docs/')) {
        issues.push({
          severity: 'error',
          code: 'off-site-url',
          message: `${row.externalId} points at ${row.url}, which is not a git-scm.com docs page.`,
        });
      }

      // A title that is only the site's name means the page shape changed and the parse fell back
      // to something useless — a link somebody would not recognise.
      if (row.title.trim().length < 5) {
        issues.push({
          severity: 'error',
          code: 'title-too-short',
          message: `${row.externalId} produced the title '${row.title}', which names nothing.`,
        });
      }

      if (row.grantsEvidence) {
        issues.push({
          severity: 'error',
          code: 'documentation-cannot-grant-evidence',
          message:
            `${row.externalId} claims to grant evidence. Reading a manual page is not a ` +
            'demonstration of anything (ADR-0030).',
        });
      }
    }

    return { issues };
  }

  /** The page as served. Archived so a catalogue row can be shown what it was written from. */
  archivable(raw: DocPageRaw): ArchivableSource {
    return {
      bytes: new TextEncoder().encode(raw.html),
      contentType: 'text/html; charset=utf-8',
      slug: raw.documentId,
      jurisdiction: 'XX',
      year: Number(raw.fetchedAt.slice(0, 4)),
      extension: 'html',
      isOriginal: true,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      await this.#limiter.acquire();
      const raw = await this.#deps.fetchPage(KNOWN_PAGES[0] ?? 'git-stash');
      if (raw === null) return { state: 'degraded', detail: 'the probe page is no longer served' };

      // Fetching is not reading. A 200 whose title cannot be found is the failure this connector is
      // most likely to hit, and it would otherwise report zero rows and look like a quiet day.
      return parseDocPage(raw.html).title === null
        ? { state: 'degraded', detail: 'page fetched but its title could not be read' }
        : { state: 'healthy' };
    } catch (error) {
      return { state: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** What a caller stores alongside the row: our sentence about why the page is worth opening. */
export function purposeOf(documentId: string): string | undefined {
  return PURPOSE[documentId];
}
