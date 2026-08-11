/**
 * `nz-inz` — New Zealand's Accredited Employer Work Visa.
 *
 * ## Why this connector reads instructions rather than a statute
 *
 * New Zealand's Immigration Act 2009 **empowers**; the operative eligibility rules are the
 * **Immigration Instructions** certified under it and published by INZ. A connector pointed at the
 * Act would find no rule to ingest. That distinction is what makes the country available at all,
 * because `legislation.govt.nz` answers every path with an AWS WAF challenge and may not be worked
 * around — and does not need to be.
 *
 * The Operational Manual's ExtJS shell is a **viewer**: `toc.htm` is the published index and each
 * section is flat HTML at a stable numeric id, on paths INZ's `robots.txt` permits.
 *
 * ## Two publishers, one rule
 *
 * The instruction says remuneration must reach the adult minimum wage. **MBIE** says what that wage
 * is. Neither states the other's part, so this is an ADR-0025 derived requirement — but a simpler
 * one than Luxembourg's: **nothing is multiplied.** The instruction is the `primary` instrument and
 * MBIE's rate is the `operand`; there is no `formula` row because there is no arithmetic.
 *
 * And the figure is **hourly**, as `WA3.25` assesses remuneration, so there is no annualisation
 * step for either side to get wrong.
 *
 * ## What this deliberately does not decide
 *
 * *"Not less than the market rate for that occupation"* is an immigration officer's assessment. It
 * is stored as a rule with `evaluation: 'manual'`, which the evaluator reports and refuses to
 * decide. A number here would be a threshold nobody wrote.
 */

import {
  RateLimiter,
  withRetry,
  type ArchivableSource,
  type Connector,
  type ConnectorMeta,
  type DerivedSource,
  type HealthStatus,
  type Page,
  type SearchQuery,
  type ValidationIssue,
  type ValidationResult,
} from '@zentavio/connectors-core';
import type { SourcedRequirement } from '@zentavio/types';

import {
  parseAdultMinimumWage,
  parseEffectiveFrom,
  parseWageEffectiveFrom,
  requiresJobCheck,
  requiresMarketRate,
  requiresMinimumWage,
  toPlainText,
} from './parse.ts';

/** One instruction section as served. */
export interface InstructionRaw {
  /** The section code a person cites — `WA3.15`. */
  readonly section: string;
  /** The manual's own stable id, which is what fetches it — `77177`. */
  readonly documentId: string;
  readonly sourceUrl: string;
  readonly html: string;
}

export interface MinimumWageRaw {
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly html: string;
}

/**
 * The instructions and the wage, fetched together.
 *
 * One payload, for the reason Luxembourg's is: a rule assembled from a threshold read today and a
 * figure read last month describes no moment.
 */
export interface InzRaw {
  readonly instructions: readonly InstructionRaw[];
  /** ISO-8601 UTC, recorded at fetch time so `normalize` stays pure. */
  readonly fetchedAt: string;
  readonly minimumWage: MinimumWageRaw;
}

export const SOURCE_ID = 'nz-inz';

const AUTHORITY = 'Immigration New Zealand';
const WAGE_AUTHORITY = 'Ministry of Business, Innovation and Employment (Employment New Zealand)';
const PATHWAY_ID = 'nz.aewv';

export interface InzDeps {
  readonly fetchInstructions: () => Promise<InzRaw | null>;
}

export class InzConnector implements Connector<InzRaw, readonly SourcedRequirement[]> {
  readonly meta: ConnectorMeta = {
    id: SOURCE_ID,
    version: '1.0.0',
    kind: 'immigration',
    regions: ['NZ'],
    // Immigration instructions change on policy timelines, and `employment.govt.nz` asks Bingbot
    // for five seconds. The same courtesy, more conservatively.
    rateLimit: { requests: 30, windowMs: 60_000, minIntervalMs: 2000 },
    reliability: 0,
    termsUrl: 'https://www.immigration.govt.nz/about-us/policy-and-law',
  };

  readonly #deps: InzDeps;
  readonly #limiter: RateLimiter;

  constructor(deps: InzDeps) {
    this.#deps = deps;
    this.#limiter = new RateLimiter(this.meta.rateLimit);
  }

  async search(query: SearchQuery): Promise<Page<InzRaw>> {
    if (query.regions !== undefined && !query.regions.includes('NZ')) return { items: [] };

    const raw = await this.fetch();
    return { items: raw === null ? [] : [raw] };
  }

  /** Takes no external id: one pathway, assembled from several documents. */
  async fetch(): Promise<InzRaw | null> {
    await this.#limiter.acquire();
    return withRetry(() => this.#deps.fetchInstructions());
  }

  /**
   * The AEWV rules that are literal in these instructions.
   *
   * Pure and total. **A missing wage figure produces no remuneration rule**, never one computed
   * from a default — a rule that compares against nothing is worse than an absent one, because it
   * evaluates.
   *
   * **No routes.** As read, the AEWV creates one way in: no alternative thresholds, no occupation
   * derogation. It is therefore a routeless pathway, which ADR-0024 says behaves exactly as
   * pathways did before routes existed.
   */
  normalize(raw: InzRaw): readonly SourcedRequirement[] {
    const wageText = toPlainText(raw.minimumWage.html);
    const wage = parseAdultMinimumWage(wageText);
    const wageFrom = parseWageEffectiveFrom(wageText);

    const rows: SourcedRequirement[] = [];

    for (const instruction of raw.instructions) {
      const text = toPlainText(instruction.html);
      // Read from the instrument, never hardcoded — every section carries its own date, which is
      // the thing `de-aufenthg` has to do without.
      const effectiveFrom = parseEffectiveFrom(text);
      if (effectiveFrom === null) continue;

      const base = {
        domain: 'immigration' as const,
        imposedBy: 'destination' as const,
        jurisdiction: 'NZ',
        pathwayId: PATHWAY_ID,
        profession: null,
        sourceTier: 1 as const,
        sourceUrl: instruction.sourceUrl,
        retrievedAt: raw.fetchedAt,
        authority: AUTHORITY,
        authorityUrl: instruction.sourceUrl,
        effectiveFrom,
        effectiveTo: null,
        version: `${instruction.section}@${effectiveFrom}`,
        contested: false,
        // Instructions change on policy timelines and the wage changes every 1 April, so the
        // earliest window belongs to the wage (ADR-0025) — reviewed the April after it was read.
        refreshAfter: `${String(Number(raw.fetchedAt.slice(0, 4)) + 1)}-04-01`,
        // `appliesTo` empty: one way in. A routeless pathway keeps pre-ADR-0024 behaviour exactly.
        appliesTo: {},
      };

      if (requiresMinimumWage(text) && wage !== null) {
        rows.push({
          ...base,
          requirementId: 'nz.aewv.remuneration',
          kind: 'threshold',
          // **Hourly, as the instruction assesses it.** `WA3.25` calculates remuneration as
          // guaranteed payment per hour, and MBIE publishes an hourly rate, so no conversion
          // happens anywhere — which is one fewer place to be wrong than either European rule.
          value: { amount: wage, currency: 'NZD', period: 'hour', basis: 'gross' },
          domainDetail: {
            legalBasis: `Immigration Instructions ${instruction.section}`,
            // ADR-0025. Two instruments, no arithmetic: the instruction states the rule, MBIE
            // states the figure. There is no `formula` entry because nothing is multiplied.
            derivedFrom: [
              {
                role: 'primary',
                instrument: `INZ Operational Manual ${instruction.section}`,
                statedAs: 'remuneration at or above the New Zealand adult minimum wage',
              },
              {
                role: 'operand',
                instrument: 'MBIE adult minimum wage',
                // **A different authority from the rule's.** `requirements.authority` names INZ,
                // because INZ imposes the requirement — but the figure is MBIE's, and a reader
                // asking "who set this number?" deserves the right answer rather than the
                // convenient one.
                authority: WAGE_AUTHORITY,
                statedAs: 'adult minimum wage, per hour',
                amount: wage,
                currency: 'NZD',
                period: 'hour',
                ...(wageFrom === null ? {} : { effectiveFrom: wageFrom }),
              },
            ],
          },
          evaluation: 'numeric-gte',
          needsInput: ['expected_gross_hourly_pay_nzd'],
        });
      }

      if (requiresMarketRate(text)) {
        rows.push({
          ...base,
          requirementId: 'nz.aewv.market-rate',
          kind: 'condition',
          // No value. There is nothing to compare against — an immigration officer decides whether
          // the rate is the market one, and this connector must not invent a number for it.
          value: null,
          domainDetail: {
            legalBasis: `Immigration Instructions ${instruction.section}`,
            decidedBy: 'immigration officer',
          },
          // The evaluator reports this and refuses to decide it. That refusal is the honest
          // outcome, and it is why `manual` exists.
          evaluation: 'manual',
          needsInput: [],
        });
      }

      if (requiresJobCheck(text)) {
        rows.push({
          ...base,
          requirementId: 'nz.aewv.approved-job-offer',
          kind: 'eligibility',
          value: true,
          domainDetail: {
            legalBasis: `Immigration Instructions ${instruction.section}`,
            // **The subject of this rule is the employer and the job, not the applicant** — WA2 is
            // employer accreditation and WA3 is the Job Check. The person can still answer it,
            // which is why it is an ordinary fact rather than a new shape.
            aboutTheEmployer: true,
          },
          evaluation: 'boolean',
          needsInput: ['has_offer_from_accredited_employer'],
        });
      }
    }

    return rows;
  }

  validate(normalized: readonly SourcedRequirement[]): ValidationResult {
    const issues: ValidationIssue[] = [];

    if (normalized.length === 0) {
      issues.push({
        severity: 'error',
        code: 'no-provisions-parsed',
        message:
          'No instruction yielded a rule. Either the manual changed shape, or `Effective` dates ' +
          'are missing — a section with no date cannot be stored against a period.',
      });
    }

    for (const row of normalized) {
      if (row.requirementId !== 'nz.aewv.remuneration') continue;
      const amount = (row.value as { amount: number }).amount;

      // A plausibility band for an **hourly** rate, which is a different order of magnitude from
      // the annual thresholds the German and Luxembourgish connectors guard. A page-wide dollar
      // match would find navigation figures and fail inside this band unnoticed without it.
      if (!(amount >= 10 && amount <= 200)) {
        issues.push({
          severity: 'error',
          code: 'wage-implausible',
          field: 'value.amount',
          message:
            `${String(amount)} NZD/hour is outside any plausible adult minimum wage. A figure ` +
            'taken from elsewhere on the page produces exactly this.',
        });
      }

      const derived = (row.domainDetail as { derivedFrom?: readonly unknown[] }).derivedFrom;
      if (derived === undefined || derived.length < 2) {
        issues.push({
          severity: 'error',
          code: 'derivation-not-recorded',
          field: 'domainDetail.derivedFrom',
          message:
            'A rule assembled from an instruction and a separately-published figure must record ' +
            'both (ADR-0025), or the threshold cannot be traced to what set it.',
        });
      }
    }

    return { issues };
  }

  /** The first instruction section — what `requirements.source_url` names. */
  archivable(raw: InzRaw): ArchivableSource | null {
    const first = raw.instructions[0];
    return first === undefined ? null : instructionSource(first);
  }

  /**
   * Every instrument behind these rules (ADR-0025): each instruction section, and MBIE's rate.
   *
   * The wage page is archived as an **operand** even though nothing multiplies it. The role
   * describes what it contributed, and a threshold whose figure came from a page nobody kept is
   * unrecomputable whether or not arithmetic was involved.
   */
  archivableSources(raw: InzRaw): readonly DerivedSource[] {
    const instructions = raw.instructions.map((instruction) => ({
      source: instructionSource(instruction),
      role: 'primary' as const,
      instrumentId: `inz-opsmanual-${instruction.documentId}`,
      sourceUrl: instruction.sourceUrl,
      retrievedAt: raw.fetchedAt,
    }));

    return [
      ...instructions,
      {
        source: {
          bytes: new TextEncoder().encode(raw.minimumWage.html),
          contentType: 'text/html; charset=utf-8',
          slug: 'mbie-adult-minimum-wage',
          jurisdiction: 'NZ',
          year: Number(raw.minimumWage.fetchedAt.slice(0, 4)),
          extension: 'html',
          isOriginal: true,
        },
        role: 'operand',
        instrumentId: 'mbie-adult-minimum-wage',
        sourceUrl: raw.minimumWage.sourceUrl,
        retrievedAt: raw.minimumWage.fetchedAt,
      },
    ];
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      await this.#limiter.acquire();
      const raw = await this.#deps.fetchInstructions();
      if (raw === null) return { state: 'degraded', detail: 'The instructions are not retrievable.' };
      return { state: 'healthy' };
    } catch (error) {
      return { state: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** One instruction section as served. HTML is how INZ publishes it, so these bytes are it. */
function instructionSource(instruction: InstructionRaw): ArchivableSource {
  return {
    bytes: new TextEncoder().encode(instruction.html),
    contentType: 'text/html; charset=utf-8',
    // The manual's id, not the section code: the code is what a person cites and can be reworded
    // by an amendment, while the id is the stable thing that fetches the document.
    slug: `inz-opsmanual-${instruction.documentId}`,
    jurisdiction: 'NZ',
    year: 2026,
    extension: 'html',
    isOriginal: true,
  };
}
