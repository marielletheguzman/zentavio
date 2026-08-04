/**
 * `de-bundesanzeiger` — the BMI Bekanntmachung to § 18g AufenthG.
 *
 * Germany's EU Blue Card salary minimum is a **two-source rule**, and this connector owns one
 * half. The statute (§ 18g AufenthG) fixes the *percentage* of the Beitragsbemessungsgrenze and
 * which category each percentage applies to; it never states a euro figure. § 18g Absatz 7
 * obliges the Bundesministerium des Innern to announce the concrete minimum gross salaries in the
 * Bundesanzeiger **by 31 December of the preceding year**. That announcement is this source.
 *
 * Neither half alone is a usable requirement: a percentage cannot be compared against an offer,
 * and a euro amount with no percentage cannot be re-derived when the Beitragsbemessungsgrenze
 * moves. Combining them is the knowledge engine's job, not a connector's.
 *
 * ## Legal basis
 *
 * `bundesanzeiger.de/robots.txt` disallows only `/nlp` and `/construction_page.html` for `*`, and
 * bans AhrefsBot and MJ12bot by name; the publication path this connector reads is permitted.
 * The documents are amtliche Bekanntmachungen of a federal ministry.
 *
 * **`make-it-in-germany.com` is deliberately not integrated.** It restates the same figures more
 * conveniently and its `robots.txt` says `Allow: /`, but the site answers with a Radware
 * bot-protection challenge. Working around that is bypassing a protection control, which
 * `docs/architecture/connectors.md` forbids outright: "If a source disallows automated access,
 * the answer is that we do not integrate it."
 */

import {
  RateLimiter,
  withRetry,
  type Connector,
  type ConnectorMeta,
  type HealthStatus,
  type Page,
  type SearchQuery,
  type ValidationIssue,
  type ArchivableSource,
  type ValidationResult,
} from '@zentavio/connectors-core';
import type { MonetaryValue, SourcedRequirement } from '@zentavio/types';

import { parseBekanntmachung } from './parse.ts';

/**
 * One fetched announcement. `fetchedAt` rides on the raw payload rather than being read from a
 * clock inside `normalize`, which is what keeps normalization pure and golden-file testable.
 */
export interface BekanntmachungRaw {
  /** The Bundesanzeiger's own citation, e.g. `BAnz AT 18.12.2025 B3`. Used as the external id. */
  readonly publicationId: string;
  readonly sourceUrl: string;
  /** ISO-8601 UTC, recorded at fetch time. */
  readonly fetchedAt: string;
  /** Text extracted from the published PDF, verbatim including its extraction defects. */
  readonly documentText: string;
}

export const SOURCE_ID = 'de-bundesanzeiger';

/**
 * The two categories § 18g creates. The percentage decides which one an announced amount is:
 * 50 % is the general minimum, 45.3 % the reduced one for shortage occupations and recent
 * graduates. Matching on the percentage rather than on document order means a year in which BMI
 * reorders the paragraphs does not silently swap the two thresholds.
 */
const CATEGORY_BY_PERCENT: ReadonlyMap<number, { readonly suffix: string; readonly legalBasis: string; readonly appliesTo: Readonly<Record<string, unknown>> }> =
  new Map([
    [
      50,
      {
        suffix: 'general',
        legalBasis: 'AufenthG § 18g Abs. 1 S. 1',
        appliesTo: { category: 'general' },
      },
    ],
    [
      45.3,
      {
        suffix: 'reduced',
        legalBasis: 'AufenthG § 18g Abs. 1 S. 2, § 18g Abs. 2',
        // The ISCO-08 groups and the recent-graduate window live in the statute, not in this
        // announcement. Naming them here would be this connector inventing them.
        appliesTo: { category: 'reduced', groupsDefinedIn: 'AufenthG § 18g' },
      },
    ],
  ]);

export interface BundesanzeigerDeps {
  /** Injected so tests never touch the network. */
  readonly fetchDocument: (publicationId: string) => Promise<BekanntmachungRaw | null>;
  /** Announcements known to this connector, newest first. */
  readonly knownPublications: readonly string[];
}

export class BundesanzeigerConnector implements Connector<BekanntmachungRaw, readonly SourcedRequirement[]> {
  readonly meta: ConnectorMeta = {
    id: SOURCE_ID,
    version: '1.0.0',
    kind: 'immigration',
    regions: ['DE'],
    // One request every two seconds, well under anything a federal publication portal would
    // object to. There is nothing to gain from going faster: this source changes once a year.
    rateLimit: { requests: 30, windowMs: 60_000, minIntervalMs: 2000 },
    // Observed, and nothing has been observed yet. A connector shipping at 1 asserts a track
    // record it does not have.
    reliability: 0,
    termsUrl: 'https://www.bundesanzeiger.de/pub/de/impressum',
  };

  readonly #deps: BundesanzeigerDeps;
  readonly #limiter: RateLimiter;

  constructor(deps: BundesanzeigerDeps) {
    this.#deps = deps;
    this.#limiter = new RateLimiter(this.meta.rateLimit);
  }

  /**
   * Discovery is a known list rather than a crawl.
   *
   * The Bundesanzeiger's search is not a stable machine interface, and this source publishes one
   * relevant document a year on a date fixed by statute. A curated list of citations is more
   * honest than a scraper that appears to discover and actually guesses.
   */
  async search(query: SearchQuery): Promise<Page<BekanntmachungRaw>> {
    if (query.regions !== undefined && !query.regions.includes('DE')) return { items: [] };

    const limit = query.limit ?? this.#deps.knownPublications.length;
    const items: BekanntmachungRaw[] = [];

    for (const publicationId of this.#deps.knownPublications.slice(0, limit)) {
      const raw = await this.fetch(publicationId);
      if (raw === null) continue;
      if (query.since !== undefined && new Date(raw.fetchedAt) < query.since) continue;
      items.push(raw);
    }

    return { items };
  }

  async fetch(externalId: string): Promise<BekanntmachungRaw | null> {
    await this.#limiter.acquire();
    return withRetry(() => this.#deps.fetchDocument(externalId));
  }

  /**
   * One announcement becomes one requirement row per threshold it states.
   *
   * Pure and total: every payload maps to rows or to an empty array that `validate` then rejects
   * with a reason. Nothing here reads a clock — `retrievedAt` and the validity window are derived
   * from the payload's own `fetchedAt` and the year the document names.
   */
  normalize(raw: BekanntmachungRaw): readonly SourcedRequirement[] {
    const parsed = parseBekanntmachung(raw.documentText);
    if (parsed === null) return [];

    const { year } = parsed;
    const rows: SourcedRequirement[] = [];

    for (const threshold of parsed.thresholds) {
      const category = CATEGORY_BY_PERCENT.get(threshold.percent);
      // An unrecognised percentage means the statute changed its categories. Emitting the row
      // under a guessed id would attach a real amount to the wrong category, so it is dropped
      // and surfaced by `validate` instead.
      if (category === undefined) continue;

      const value: MonetaryValue = {
        amount: threshold.amount,
        currency: 'EUR',
        period: 'year',
        basis: 'gross',
      };

      rows.push({
        requirementId: `de.eu-blue-card.salary-threshold.${category.suffix}`,
        domain: 'immigration',
        imposedBy: 'destination',
        jurisdiction: 'DE',
        pathwayId: 'de.eu-blue-card',
        profession: null,
        kind: 'threshold',
        value,
        appliesTo: category.appliesTo,
        domainDetail: {
          legalBasis: category.legalBasis,
          percentOfBeitragsbemessungsgrenze: threshold.percent,
          announcedIn: raw.publicationId,
        },
        evaluation: 'numeric-gte',
        needsInput: ['expected_gross_annual_salary_eur'],
        sourceTier: 1,
        sourceUrl: raw.sourceUrl,
        retrievedAt: raw.fetchedAt,
        authority: 'Bundesministerium des Innern',
        authorityUrl: 'https://www.bmi.bund.de',
        effectiveFrom: `${String(year)}-01-01`,
        effectiveTo: `${String(year)}-12-31`,
        version: String(year),
        contested: false,
        // § 18g Abs. 7 obliges BMI to publish the following year's minimums by 31 December of
        // the preceding year, so the refresh window is written by the statute rather than chosen.
        refreshAfter: `${String(year - 1)}-12-31`,
      });
    }

    return rows;
  }

  /**
   * Returns issues; never throws.
   *
   * The two errors below are the ones that matter. A year that announces no threshold means the
   * document shape changed, and a threshold of zero or a wildly implausible magnitude means the
   * numeric spacing defect got through — both must reject rather than store.
   */
  validate(normalized: readonly SourcedRequirement[]): ValidationResult {
    const issues: ValidationIssue[] = [];

    if (normalized.length === 0) {
      issues.push({
        severity: 'error',
        code: 'no-thresholds-parsed',
        message:
          'The announcement yielded no threshold rows. Either the document shape changed or the ' +
          'percentages no longer match § 18g’s categories.',
      });
    }

    if (normalized.length === 1) {
      issues.push({
        severity: 'warning',
        code: 'single-threshold',
        message: '§ 18g has announced two thresholds every year so far; only one was parsed.',
      });
    }

    for (const row of normalized) {
      const value = row.value as MonetaryValue;

      // A plausibility floor, not a correctness check. The PDF extraction defect turns 50 700
      // into 700, which is a number that looks like money and would be stored without complaint.
      if (!(value.amount > 10_000)) {
        issues.push({
          severity: 'error',
          code: 'threshold-implausible',
          field: 'value.amount',
          message:
            `${row.requirementId}: ${String(value.amount)} EUR/year is below any plausible Blue Card ` +
            'minimum. The published PDF splits digits with spaces, so this is most likely a parse defect.',
        });
      }

    }

    return { issues };
  }

  /**
   * What we read, which is **not** the published document.
   *
   * The Bundesanzeiger publishes a PDF; the raw payload carries text extracted from it, because
   * that is what the parser needs. Archiving the extraction is honest about what was parsed, but
   * it is **weaker evidence than the PDF**: the extraction is exactly where this source's known
   * defect lives — digits split by spaces, turning 50 700 into 700 — and a re-reader of the
   * archive cannot see a defect that happened before the archive.
   *
   * `isOriginal: false` records that gap so it is countable. Closing it means carrying the PDF
   * bytes on the raw payload, which is follow-up work and not this phase.
   */
  archivable(raw: BekanntmachungRaw): ArchivableSource {
    const year = parseBekanntmachung(raw.documentText)?.year ?? new Date(raw.fetchedAt).getUTCFullYear();

    return {
      bytes: new TextEncoder().encode(raw.documentText),
      contentType: 'text/plain; charset=utf-8',
      slug: raw.publicationId,
      jurisdiction: 'DE',
      year,
      extension: 'txt',
      isOriginal: false,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    const [newest] = this.#deps.knownPublications;
    if (newest === undefined) {
      return { state: 'degraded', detail: 'No known publications configured.' };
    }

    try {
      await this.#limiter.acquire();
      const raw = await this.#deps.fetchDocument(newest);
      if (raw === null) return { state: 'degraded', detail: `${newest} is no longer retrievable.` };
      return { state: 'healthy' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { state: 'unreachable', detail };
    }
  }
}
