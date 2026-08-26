/**
 * `ch-sem` — Switzerland's third-country work admission, from SEM's directives.
 *
 * ## Why the directives and not the law
 *
 * `fedlex.data.admin.ch` publishes the AIG and the VZAE on the **same JOLux ontology and Casemates
 * platform as Legilux**, so `lu-legilux`'s SPARQL walk works unchanged — right up to
 * `isExemplifiedBy`, which points into `/filestore/`, which its `robots.txt` disallows. The
 * metadata is permitted and the document bytes are not. ADR-0021 needs the original archived
 * before a rule is accepted, so that route is closed.
 *
 * **SEM's Weisungen are the way in and are the operative layer anyway** — they bind the cantonal
 * authorities who actually decide Swiss permits. The New Zealand lesson, twice.
 *
 * ## Switzerland has almost no numbers, and that is the country
 *
 * Every other connector here reads a threshold. Kapitel 4's conditions are judgements: *wider
 * economic interest*, *priority for domestic workers*, *pay customary for the place, profession
 * and sector*. Switzerland has no national minimum wage. So this emits mostly
 * `evaluation: 'manual'` rules, and a Swiss verdict is largely `undetermined` with its reasons
 * named — which is the true answer for a third-country national, because a cantonal authority
 * decides.
 *
 * ## The quota is not emitted, on purpose
 *
 * Höchstzahlen are a cap on a canton, not a condition a person satisfies. **ADR-0027** puts them on
 * `immigration_pathways.quota`, and `requirements.kind` no longer permits `'quota'` — so a row for
 * one is a database error rather than a review comment. This connector records that a cap exists
 * through `parseQuotaBasis` for the pathway's benefit and emits no requirement for it.
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
import type { SourcedRequirement } from '@zentavio/types';

import { normaliseText, parseConditions, parseQuotaBasis, parseStandDate } from './parse.ts';

export interface WeisungenRaw {
  /** Stable identifier for the chapter — `weisungen-aig-kap4`. */
  readonly documentId: string;
  readonly sourceUrl: string;
  /** ISO-8601 UTC, recorded at fetch time so `normalize` stays pure. */
  readonly fetchedAt: string;
  /** The PDF as published. **This is the original**, and what gets archived. */
  readonly documentBytes: Uint8Array;
  readonly documentMimeType: string;
  /**
   * Text extracted from those bytes.
   *
   * Extraction happens **before** `normalize`, in the fetch half, because `normalize` must stay
   * pure and a PDF reader is I/O-shaped. The bytes travel with it so the archive holds the
   * document rather than our reading of it (ADR-0021).
   */
  readonly documentText: string;
}

export const SOURCE_ID = 'ch-sem';

const AUTHORITY = 'Staatssekretariat für Migration (SEM)';
const PATHWAY_ID = 'ch.third-country-worker';

export interface SemDeps {
  readonly fetchDirective: () => Promise<WeisungenRaw | null>;
}

export class SemConnector implements Connector<WeisungenRaw, readonly SourcedRequirement[]> {
  readonly meta: ConnectorMeta = {
    id: SOURCE_ID,
    version: '1.0.0',
    kind: 'immigration',
    regions: ['CH'],
    // `sem.admin.ch` declares no `robots.txt` at all — a 404, not a challenge. **Absence of a
    // stated restriction is not permission to hammer it**, so this is the most conservative rate
    // limit of any connector here, and the chapter is one fetch per refresh rather than one per
    // rule.
    rateLimit: { requests: 10, windowMs: 60_000, minIntervalMs: 5000 },
    reliability: 0,
    termsUrl: 'https://www.sem.admin.ch/sem/de/home/publiservice/weisungen-kreisschreiben.html',
    displayName: 'SEM Weisungen AIG, Kapitel 4',
    sourceTier: 1,
    legalBasis:
      '`sem.admin.ch` declares no `robots.txt` at all — a 404, not a challenge. Absence of a stated ' +
      'restriction is not permission, so this connector carries the most conservative rate limit ' +
      'here and treats the 167-page chapter as one fetch per refresh.',
    refreshWindow: '180 days',
    schedule: '0 3 1 * *',
  };

  readonly #deps: SemDeps;
  readonly #limiter: RateLimiter;

  constructor(deps: SemDeps) {
    this.#deps = deps;
    this.#limiter = new RateLimiter(this.meta.rateLimit);
  }

  async search(query: SearchQuery): Promise<Page<WeisungenRaw>> {
    if (query.regions !== undefined && !query.regions.includes('CH')) return { items: [] };

    const raw = await this.fetch();
    return { items: raw === null ? [] : [raw] };
  }

  async fetch(): Promise<WeisungenRaw | null> {
    await this.#limiter.acquire();
    return withRetry(() => this.#deps.fetchDirective());
  }

  /**
   * The admission conditions Kapitel 4 imposes.
   *
   * Pure and total. **A chapter with no `Stand` date produces no rows** — every rule in this
   * document shares one date, so without it nothing can be stored against a period.
   *
   * **No routes.** Kapitel 4 creates one way in for third-country nationals; the exemptions at
   * § 4.2.2 are exemptions from the *quota*, which is not a requirement here at all.
   */
  normalize(raw: WeisungenRaw): readonly SourcedRequirement[] {
    const text = normaliseText(raw.documentText);
    const effectiveFrom = parseStandDate(text);
    if (effectiveFrom === null) return [];

    const conditions = parseConditions(text);

    const base = {
      domain: 'immigration' as const,
      imposedBy: 'destination' as const,
      jurisdiction: 'CH',
      pathwayId: PATHWAY_ID,
      profession: null,
      sourceTier: 1 as const,
      sourceUrl: raw.sourceUrl,
      retrievedAt: raw.fetchedAt,
      authority: AUTHORITY,
      authorityUrl: 'https://www.sem.admin.ch/sem/de/home/publiservice/weisungen-kreisschreiben/auslaenderbereich.html',
      effectiveFrom,
      effectiveTo: null,
      // **One version for the whole chapter.** Unlike New Zealand's per-section `Effective` lines,
      // this document carries a single `Stand`, so a revision re-dates every rule at once and
      // `supersedes` chains a chapter rather than a rule. Recorded here so the version string says
      // which edition a row came from.
      version: `kap4@${effectiveFrom}`,
      contested: false,
      // A directive is revised on policy timelines with no published cadence. Annual review, like
      // the German statute's.
      refreshAfter: `${String(Number(effectiveFrom.slice(0, 4)) + 1)}-06-30`,
      // No routes: one way in.
      appliesTo: {},
    };

    /**
     * A condition an authority decides.
     *
     * **`evaluation: 'manual'` with no value.** There is nothing for a person to be compared
     * against — an officer weighs it — and inventing a number would be manufacturing a threshold
     * nobody wrote. The evaluator reports these and refuses to decide them, which is why a Swiss
     * verdict is honestly `undetermined`.
     */
    const judgement = (
      requirementId: string,
      legalBasis: string,
      decidedOn: string,
    ): SourcedRequirement => ({
      ...base,
      requirementId,
      kind: 'condition',
      value: null,
      domainDetail: { legalBasis, decidedBy: 'cantonal authority or SEM', decidedOn },
      evaluation: 'manual',
      needsInput: [],
    });

    const rows: SourcedRequirement[] = [];

    if (conditions.economicInterest) {
      rows.push(
        judgement(
          'ch.third-country-worker.economic-interest',
          'AIG Art. 18 Bst. a; Weisungen AIG Ziff. 4.3.1',
          'whether admitting this worker serves the wider economic interest',
        ),
      );
    }

    if (conditions.priority) {
      rows.push(
        judgement(
          'ch.third-country-worker.priority',
          'AIG Art. 21; Weisungen AIG Ziff. 4.3.2',
          'whether no suitable worker was found in Switzerland or a free-movement state',
        ),
      );
    }

    if (conditions.customaryPay) {
      rows.push(
        judgement(
          'ch.third-country-worker.customary-pay',
          'AIG Art. 22; Weisungen AIG Ziff. 4.3.4',
          'whether pay and conditions are customary for the place, profession and sector',
        ),
      );
    }

    if (conditions.vacancyReporting) {
      rows.push({
        ...base,
        requirementId: 'ch.third-country-worker.vacancy-reporting',
        kind: 'condition',
        value: true,
        domainDetail: {
          legalBasis: 'AIG Art. 21a; Weisungen AIG Ziff. 4.3.3',
          // The duty applies only in occupations above a stated national unemployment level, and
          // that list is published separately. Recorded as a note rather than modelled, because a
          // rule that silently applied to everybody would be wrong for most people.
          appliesByOccupation: true,
        },
        evaluation: 'boolean',
        needsInput: ['vacancy_reported_to_public_employment_service'],
      });
    }

    if (conditions.personalQualification) {
      rows.push({
        ...base,
        requirementId: 'ch.third-country-worker.personal-qualification',
        kind: 'eligibility',
        value: true,
        domainDetail: {
          legalBasis: 'AIG Art. 23; Weisungen AIG Ziff. 4.3.5',
          // The directive accepts qualification at several levels — university degree, higher
          // vocational training, several years of relevant experience — and which one suffices is
          // judged per occupation. Asked as a single question, decided in context.
          qualificationLevelsVary: true,
        },
        evaluation: 'boolean',
        needsInput: ['has_recognised_professional_qualification'],
      });
    }

    return rows;
  }

  /**
   * What the pathway should record about the cap (ADR-0027).
   *
   * **Not a requirement, and deliberately not part of `normalize`'s output.** A quota is a capacity
   * limit on a canton; `requirements.kind` no longer permits one, so this is offered separately for
   * the pathway record rather than smuggled into the rule set.
   */
  quotaBasis(raw: WeisungenRaw): string | null {
    return parseQuotaBasis(normaliseText(raw.documentText));
  }

  validate(normalized: readonly SourcedRequirement[]): ValidationResult {
    const issues: ValidationIssue[] = [];

    if (normalized.length === 0) {
      issues.push({
        severity: 'error',
        code: 'no-provisions-parsed',
        message:
          'Kapitel 4 yielded no condition. Either the document shape changed, or the `Stand` date ' +
          'is missing — every rule here shares one date and cannot be stored without it.',
      });
    }

    for (const row of normalized) {
      // **A quota must never appear here** (ADR-0027). The database would refuse it, and this says
      // so at the connector boundary where the mistake would be made.
      if ((row.kind as string) === 'quota') {
        issues.push({
          severity: 'error',
          code: 'quota-as-requirement',
          field: 'kind',
          message:
            `${row.requirementId}: a quota is a property of the pathway, not a requirement a ` +
            'person can fail (ADR-0027).',
        });
      }

      if (row.evaluation === 'manual' && row.value !== null) {
        issues.push({
          severity: 'error',
          code: 'manual-with-value',
          field: 'value',
          message:
            `${row.requirementId}: a rule an authority decides has nothing to compare against. A ` +
            'value here would be a threshold nobody wrote.',
        });
      }
    }

    return { issues };
  }

  /**
   * The PDF as published.
   *
   * **The original, not the extraction.** A parse defect in our text is invisible in an archive of
   * our text — the reason `de-bundesanzeiger` archives its PDF rather than what it read from it.
   */
  archivable(raw: WeisungenRaw): ArchivableSource {
    return {
      bytes: raw.documentBytes,
      contentType: raw.documentMimeType,
      slug: raw.documentId,
      jurisdiction: 'CH',
      year: Number(raw.fetchedAt.slice(0, 4)),
      extension: 'pdf',
      isOriginal: true,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      await this.#limiter.acquire();
      const raw = await this.#deps.fetchDirective();
      if (raw === null) return { state: 'degraded', detail: 'Kapitel 4 is no longer retrievable.' };
      return { state: 'healthy' };
    } catch (error) {
      return { state: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
