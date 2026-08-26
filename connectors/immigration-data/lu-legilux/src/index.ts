/**
 * `lu-legilux` — Luxembourg's EU Blue Card salary threshold.
 *
 * ## Why this connector computes, and no other one does
 *
 * Nobody publishes Luxembourg's threshold. The *loi du 29 août 2008* delegates and names no amount;
 * a **règlement grand-ducal** states a multiple of the average gross annual salary, and a lower
 * multiple for listed occupations; an annual **règlement ministériel** states the average itself.
 * The product exists in no official act.
 *
 * ADR-0025 puts the multiplication here, on the reasoning that applying a formula one instrument
 * states to a figure another instrument states is arithmetic rather than interpretation — and pairs
 * it with the obligation that **every contributing instrument is archived and cited**. A number
 * derived from two sources that names one is not evidence; it is a figure that looks audited.
 *
 * Germany reads published euro amounts and needs none of this. `de-bundesanzeiger` is the shape to
 * copy for a country whose state does its own arithmetic.
 *
 * ## Legal basis for reading these documents
 *
 * `legilux.public.lu` serves an application rather than the documents; the machine channel is
 * `data.legilux.public.lu`, published as a **CC-BY** dataset on the national open-data portal, with
 * a SPARQL endpoint for discovery and a `303` from each manifestation to the file itself.
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
  computeThreshold,
  parseFormula,
  parseOperand,
  parseQualification,
  toPlainText,
} from './parse.ts';

/** One instrument as fetched: the bytes, and which legal act they are. */
export interface InstrumentRaw {
  /** The ELI, without the host — `eli/etat/leg/rgd/2008/09/26/n3/consolide/20240701`. */
  readonly eli: string;
  readonly sourceUrl: string;
  /** ISO-8601 UTC, recorded at fetch time so `normalize` stays pure. */
  readonly fetchedAt: string;
  readonly html: string;
}

/**
 * Both instruments, fetched together.
 *
 * **They travel as one payload on purpose.** A threshold computed from a formula fetched today and
 * an average fetched last month is a number describing no moment, and separating them would make
 * that possible.
 */
export interface LegiluxRaw extends Omit<InstrumentRaw, 'html'> {
  /** The règlement grand-ducal — the formula. */
  readonly formulaHtml: string;
  /** The règlement ministériel — the average the formula multiplies. */
  readonly operand: InstrumentRaw;
  /**
   * The loi itself — Art. 45, which states the qualification condition.
   *
   * A third instrument, because the thresholds and the qualification live in different acts: the
   * règlement sets the salary, the statute says who may hold the card at all.
   */
  readonly statute: InstrumentRaw;
}

export const SOURCE_ID = 'lu-legilux';

const AUTHORITY = 'Grand-Duché de Luxembourg (Journal officiel)';
const PATHWAY_ID = 'lu.eu-blue-card';
const HOST = 'https://data.legilux.public.lu';

/**
 * When the current formula took effect.
 *
 * **Hardcoded, like `de-aufenthg`'s, and for a better reason than Germany's.** The consolidation's
 * own ELI carries its date — `…/consolide/20240701` — so this is read from the identifier the
 * source itself assigns rather than guessed. It is stated here as a constant because the fixture
 * pins one consolidation; a scheduled run takes it from the ELI it discovered.
 */
const FORMULA_EFFECTIVE_FROM = '2024-07-01';

export interface LegiluxDeps {
  readonly fetchInstruments: () => Promise<LegiluxRaw | null>;
}

export class LegiluxConnector implements Connector<LegiluxRaw, readonly SourcedRequirement[]> {
  readonly meta: ConnectorMeta = {
    id: SOURCE_ID,
    version: '1.0.0',
    kind: 'immigration',
    regions: ['LU'],
    // A national legal-information service, on legislative timelines. Nothing is gained by going
    // faster, and the same courtesy the German sources get.
    rateLimit: { requests: 30, windowMs: 60_000, minIntervalMs: 2000 },
    reliability: 0,
    termsUrl: 'https://legilux.public.lu/editorial/use-conditions',
    displayName: 'Legilux — Luxembourg official journal (data.legilux.public.lu)',
    sourceTier: 1,
    legalBasis:
      '`legilux.public.lu` serves an application, not documents. The machine channel is ' +
      '`data.legilux.public.lu`, published as a CC-BY dataset on the national open-data portal: a ' +
      'SPARQL endpoint for discovery, and a `303` from each manifestation to the file.',
    // The règlement ministériel stating the average salary is annual, and the threshold is derived
    // from it, so a derived figure is current for a year (ADR-0025).
    refreshWindow: '365 days',
    schedule: '0 3 1 * *',
  };

  readonly #deps: LegiluxDeps;
  readonly #limiter: RateLimiter;

  constructor(deps: LegiluxDeps) {
    this.#deps = deps;
    this.#limiter = new RateLimiter(this.meta.rateLimit);
  }

  async search(query: SearchQuery): Promise<Page<LegiluxRaw>> {
    if (query.regions !== undefined && !query.regions.includes('LU')) return { items: [] };

    const raw = await this.fetch();
    return { items: raw === null ? [] : [raw] };
  }

  /**
   * The instruments, as one payload.
   *
   * **Takes no external id**, unlike every other connector here. There is one rule and it is
   * assembled from two documents, so "fetch this id" has no meaning — asking for the formula alone
   * would return something that cannot become a requirement.
   */
  async fetch(): Promise<LegiluxRaw | null> {
    await this.#limiter.acquire();
    return withRetry(() => this.#deps.fetchInstruments());
  }

  /**
   * The two thresholds, and the occupation list that opens the lower one.
   *
   * Pure and total. **A missing operand produces no rows at all**, never a threshold computed from
   * a default: a multiplier with nothing to multiply is not a partially-known rule, it is an
   * unknown one, and emitting a number for it would be inventing the figure this connector exists
   * to derive honestly.
   */
  normalize(raw: LegiluxRaw): readonly SourcedRequirement[] {
    const formula = parseFormula(raw.formulaHtml);
    const average = parseOperand(raw.operand.html);
    if (average === null) return [];

    const base = {
      domain: 'immigration' as const,
      imposedBy: 'destination' as const,
      jurisdiction: 'LU',
      pathwayId: PATHWAY_ID,
      profession: null,
      sourceTier: 1 as const,
      // The instrument that states the rule. Every contributing instrument is carried separately
      // through `archivableSources` (ADR-0025) — this column names the primary one.
      sourceUrl: raw.sourceUrl,
      retrievedAt: raw.fetchedAt,
      authority: AUTHORITY,
      authorityUrl: `${HOST}/${raw.eli}`,
      effectiveFrom: FORMULA_EFFECTIVE_FROM,
      // Open-ended: a règlement applies until amended. The **operand** is what expires, and its
      // refresh window is what `refreshAfter` carries below.
      effectiveTo: null,
      version: `${FORMULA_EFFECTIVE_FROM}+${String(average.year)}`,
      contested: false,
      // ADR-0025: the earliest of the contributing instruments' windows. The average is republished
      // annually, so it is always the soonest to go stale — a rule is stale as soon as its
      // fastest-moving input is.
      refreshAfter: `${String(average.year + 2)}-06-30`,
    };

    /** What the number was computed from, so it can be re-derived without re-fetching. */
    const derivedFrom = (multiplier: number) => [
      {
        role: 'formula',
        instrument: raw.eli,
        statedAs: 'multiple of the average gross annual salary',
        multiplier,
      },
      {
        role: 'operand',
        instrument: raw.operand.eli,
        statedAs: 'average gross annual salary',
        amount: average.amount,
        currency: 'EUR',
        forYear: average.year,
      },
    ];

    const rows: SourcedRequirement[] = [];

    if (formula.generalMultiplier !== null) {
      rows.push({
        ...base,
        requirementId: 'lu.eu-blue-card.salary-threshold.general',
        kind: 'threshold',
        value: {
          amount: computeThreshold(formula.generalMultiplier, average.amount),
          currency: 'EUR',
          period: 'year',
          basis: 'gross',
        },
        appliesTo: { route: 'general' },
        domainDetail: {
          legalBasis: 'Loi du 29 août 2008, art. 45, par. (1), point 3 ; RGD du 26 septembre 2008, art. 1er',
          derivedFrom: derivedFrom(formula.generalMultiplier),
        },
        evaluation: 'numeric-gte',
        needsInput: ['expected_gross_annual_salary_eur'],
      });
    }

    if (formula.reducedMultiplier !== null) {
      rows.push({
        ...base,
        requirementId: 'lu.eu-blue-card.salary-threshold.reduced',
        kind: 'threshold',
        value: {
          amount: computeThreshold(formula.reducedMultiplier, average.amount),
          currency: 'EUR',
          period: 'year',
          basis: 'gross',
        },
        appliesTo: { route: 'citp-1-2' },
        domainDetail: {
          legalBasis: 'RGD du 26 septembre 2008, art. 1er, dérogation',
          derivedFrom: derivedFrom(formula.reducedMultiplier),
        },
        evaluation: 'numeric-gte',
        needsInput: ['expected_gross_annual_salary_eur'],
      });
    }

    if (formula.reducedGroups.length > 0) {
      rows.push({
        ...base,
        requirementId: 'lu.eu-blue-card.reduced-threshold-occupations',
        // A gate, not a hurdle — it *lowers* the bar (ADR-0024). Treated as something a person can
        // fail, it would reject exactly the people the derogation is generous to.
        kind: 'right',
        value: formula.reducedGroups,
        appliesTo: { route: 'citp-1-2' },
        domainDetail: {
          legalBasis: 'RGD du 26 septembre 2008, art. 1er, dérogation',
          // Recorded rather than modelled: the derogation applies to listed occupations "pour
          // lesquelles un besoin particulier … est constaté par le Gouvernement". Whether that
          // finding is a separate act is not read, so the qualification travels as a note.
          governmentFindingRequired: true,
          classification: 'CITP (ISCO-08)',
        },
        evaluation: 'set-member',
        needsInput: ['isco_08_group'],
      });
    }

    // **The qualification condition — one condition, three ways to satisfy it (ADR-0024 rule 10).**
    //
    // Art. 45 (1) 2. asks for *"les qualifications professionnelles élevées"*; (2) d) says those
    // are sanctioned by a diploma **or** by high professional skills; (2) f) gives that second
    // limb an ICT form and a general one. All three reach the same permit under the same salary
    // rule, so they are **not routes** — and failing all three is a failed requirement rather than
    // a closed door, so they are **not gates**. They share one `anyOf` group.
    //
    // **No route.** Rule 2 makes a routeless requirement pathway-wide, evaluated as part of every
    // route — which is exactly right: the qualification is required whichever salary threshold
    // applies. The existing salary rows keep their routes untouched.
    const qualification = parseQualification(toPlainText(raw.statute.html));

    const statuteBase = {
      ...base,
      sourceUrl: raw.statute.sourceUrl,
      retrievedAt: raw.statute.fetchedAt,
      authorityUrl: `${HOST}/${raw.statute.eli}`,
      appliesTo: { anyOf: 'qualification' },
    };

    rows.push({
      ...statuteBase,
      requirementId: 'lu.eu-blue-card.qualification.diploma',
      kind: 'eligibility',
      value: true,
      domainDetail: {
        legalBasis: 'Loi du 29 août 2008, art. 45, par. (2), points d) et e)',
        // (2) e) defers recognition to the awarding institution's own state and sets a level floor.
        // Carried as detail rather than modelled: it changes what the question *means*, and no
        // per-origin rule follows from it — the same reading `de.md` records for Germany.
        recognisedBy: 'l’État dans lequel l’établissement se situe',
        minimumFrameworkLevel: 6,
        minimumProgrammeYears: 3,
      },
      evaluation: 'boolean',
      needsInput: ['has_recognised_academic_degree'],
    });

    if (qualification.ictGroups.length > 0 && qualification.ictYears !== null) {
      rows.push({
        ...statuteBase,
        requirementId: 'lu.eu-blue-card.qualification.ict-experience',
        kind: 'condition',
        value: { amount: qualification.ictYears, unit: 'years' },
        domainDetail: {
          legalBasis: 'Loi du 29 août 2008, art. 45, par. (2), point f), tiret i)',
          // The window is in the question, not a second rule: three years earned a decade ago does
          // not qualify, and a bare total would quietly admit it.
          acquiredWithinYears: qualification.ictWithinYears,
          // Recorded, not modelled as a gate. A gate would close this alternative for everyone
          // outside the two groups, and a closed alternative reads as `not_applicable` — which is
          // right for a route and wrong here, because the person can still be told they failed the
          // qualification condition overall. The occupation test belongs in the question's wording.
          citpGroups: qualification.ictGroups,
          classification: 'CITP (ISCO-08)',
        },
        evaluation: 'numeric-gte',
        needsInput: ['years_relevant_experience_last_seven'],
      });
    }

    if (qualification.otherYears !== null) {
      rows.push({
        ...statuteBase,
        requirementId: 'lu.eu-blue-card.qualification.other-experience',
        kind: 'condition',
        value: { amount: qualification.otherYears, unit: 'years' },
        domainDetail: {
          legalBasis: 'Loi du 29 août 2008, art. 45, par. (2), point f), tiret ii)',
          // **Luxembourg goes further than Germany here.** § 18g has no general experience route;
          // this one admits any profession at five years.
          appliesToProfessions: 'les autres professions',
        },
        evaluation: 'numeric-gte',
        needsInput: ['years_relevant_experience'],
      });
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
          'Neither instrument yielded a rule. Either the consolidation markup changed, or the ' +
          'règlement ministériel did not state an average — a multiplier with nothing to multiply.',
      });
    }

    for (const row of normalized) {
      if (row.kind !== 'threshold') continue;
      const amount = (row.value as { amount: number }).amount;

      // The plausibility floor `de-bundesanzeiger` taught, and it matters more here: this number
      // was computed rather than read. The French thousands separator makes a five-figure salary
      // parse as a two-figure one, which fails to a threshold almost anybody clears.
      if (!(amount >= 20_000 && amount <= 500_000)) {
        issues.push({
          severity: 'error',
          code: 'threshold-implausible',
          field: 'value.amount',
          message:
            `${row.requirementId}: ${String(amount)} EUR/year is outside any plausible Blue Card ` +
            'threshold. A dot read as a decimal point produces exactly this.',
        });
      }

      const derived = (row.domainDetail as { derivedFrom?: readonly unknown[] }).derivedFrom;
      if (derived === undefined || derived.length < 2) {
        issues.push({
          severity: 'error',
          code: 'derivation-not-recorded',
          field: 'domainDetail.derivedFrom',
          message:
            `${row.requirementId}: a computed threshold must record every instrument it came ` +
            'from (ADR-0025), or the number cannot be re-derived.',
        });
      }
    }

    return { issues };
  }

  /**
   * The primary instrument — the one `requirements.source_url` and `document_id` name.
   *
   * Kept alongside `archivableSources` rather than replaced by it, so a caller that knows nothing
   * about derived rules still archives the document the rule's own row cites.
   */
  archivable(raw: LegiluxRaw): ArchivableSource {
    return formulaSource(raw);
  }

  /**
   * **Both** instruments (ADR-0025).
   *
   * The threshold is a product, so the evidence is two documents. Archiving only the formula would
   * leave the average unretrievable and the number unrecomputable — a rule that passes ADR-0021's
   * check while being half-evidenced.
   */
  archivableSources(raw: LegiluxRaw): readonly DerivedSource[] {
    return [
      {
        source: formulaSource(raw),
        role: 'formula',
        instrumentId: raw.eli,
        sourceUrl: raw.sourceUrl,
        retrievedAt: raw.fetchedAt,
      },
      {
        source: {
          bytes: new TextEncoder().encode(raw.operand.html),
          contentType: 'text/html; charset=utf-8',
          slug: slugFor(raw.operand.eli),
          jurisdiction: 'LU',
          year: yearFrom(raw.operand.eli),
          extension: 'html',
          isOriginal: true,
        },
        role: 'operand',
        instrumentId: raw.operand.eli,
        sourceUrl: raw.operand.sourceUrl,
        retrievedAt: raw.operand.fetchedAt,
      },
      {
        // The statute. Not part of the threshold's derivation — it is the instrument the
        // qualification rows cite, and ADR-0021 will not accept a rule whose original was never
        // archived. Adding a row that names a document nobody stored is exactly the half-evidenced
        // state the paragraph above refuses for the average.
        source: {
          bytes: new TextEncoder().encode(raw.statute.html),
          contentType: 'text/html; charset=utf-8',
          slug: slugFor(raw.statute.eli),
          jurisdiction: 'LU',
          year: yearFrom(raw.statute.eli),
          extension: 'html',
          isOriginal: true,
        },
        // `primary` — the closed vocabulary's word for *the instrument imposing the requirement*
        // (ADR-0025). That is exactly what the statute is for the qualification rows, so no new
        // role and no migration: widening a closed set to describe something it already covers is
        // how a vocabulary stops meaning anything.
        role: 'primary',
        instrumentId: raw.statute.eli,
        sourceUrl: raw.statute.sourceUrl,
        retrievedAt: raw.statute.fetchedAt,
      },
    ];
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      await this.#limiter.acquire();
      const raw = await this.#deps.fetchInstruments();
      if (raw === null) {
        return { state: 'degraded', detail: 'The instruments are no longer retrievable.' };
      }
      return { state: 'healthy' };
    } catch (error) {
      return { state: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** The RGD as served. HTML is how Legilux publishes it, so these bytes are the document. */
function formulaSource(raw: LegiluxRaw): ArchivableSource {
  return {
    bytes: new TextEncoder().encode(raw.formulaHtml),
    contentType: 'text/html; charset=utf-8',
    slug: slugFor(raw.eli),
    jurisdiction: 'LU',
    year: yearFrom(raw.eli),
    extension: 'html',
    isOriginal: true,
  };
}

/** An ELI as an object-key slug. Deterministic, so re-archiving is idempotent. */
function slugFor(eli: string): string {
  return eli.replace(/^eli\//, '').replace(/\//g, '-');
}

/**
 * The year an ELI's document belongs to, for the object key.
 *
 * A consolidation's date is the **last** four-digit run in its ELI (`…/consolide/20240701`); an
 * unconsolidated act's is the first. Taking the last handles both, because an unconsolidated ELI
 * has only one.
 */
function yearFrom(eli: string): number {
  const years = [...eli.matchAll(/\/(\d{4})/g)].map((match) => Number(match[1]));
  return years.at(-1) ?? new Date().getUTCFullYear();
}
