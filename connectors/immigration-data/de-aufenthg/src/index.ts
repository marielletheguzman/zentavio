/**
 * `de-aufenthg` — § 18g AufenthG, the statute behind Germany's EU Blue Card.
 *
 * The other half of the two-source rule. `de-bundesanzeiger` reports the euro amounts BMI announces
 * each year; this reports the provisions the statute itself fixes — who qualifies, which
 * occupations attract the reduced threshold, and how long the job must last.
 *
 * ## Why this exists, stated plainly
 *
 * Until it did, eligibility checked the salary thresholds **and nothing else**, while the surface
 * said "every rule we checked". Someone with a qualifying offer and no recognised degree was told
 * they qualify. That is a false positive about a person's relocation, and it is the reason this
 * connector was prioritised over provenance and design work.
 *
 * ## Legal basis
 *
 * `gesetze-im-internet.de/robots.txt` is `Disallow:` — empty, permitting everything. The site is
 * operated by the Bundesamt für Justiz, and German statutes are amtliche Werke, uncopyrighted under
 * § 5 UrhG.
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
import type { SourcedRequirement } from '@zentavio/types';

import { parseStatute } from './parse.ts';

export interface StatuteRaw {
  /** Stable identifier for the provision, e.g. `AufenthG-18g`. */
  readonly documentId: string;
  readonly sourceUrl: string;
  /** ISO-8601 UTC, recorded at fetch time so `normalize` stays pure. */
  readonly fetchedAt: string;
  /** The page as served — ISO-8859-1 decoded, entities intact. */
  readonly html: string;
}

export const SOURCE_ID = 'de-aufenthg';

const AUTHORITY = 'Bundesamt für Justiz (Aufenthaltsgesetz)';
const PATHWAY_ID = 'de.eu-blue-card';

/**
 * When § 18g last changed.
 *
 * **Hardcoded, and that is a real limitation.** The page carries no machine-readable date for the
 * provision's own entry into force, only a site-wide "Stand" line covering the whole statute. Using
 * the fetch date would claim the rule began the day we read it, which is false and would corrupt
 * any as-of query. This date is the amendment that introduced the current § 18g, and it must be
 * updated by hand when the provision changes — `refresh_after` is what makes that visible.
 */
const EFFECTIVE_FROM = '2023-11-18';

export interface AufenthgDeps {
  readonly fetchDocument: (documentId: string) => Promise<StatuteRaw | null>;
  readonly knownDocuments: readonly string[];
}

export class AufenthgConnector implements Connector<StatuteRaw, readonly SourcedRequirement[]> {
  readonly meta: ConnectorMeta = {
    id: SOURCE_ID,
    version: '1.0.0',
    kind: 'immigration',
    regions: ['DE'],
    // A statute changes on legislative timelines. There is nothing to gain from going faster, and
    // a federal legal-information site deserves the same courtesy as any other.
    rateLimit: { requests: 30, windowMs: 60_000, minIntervalMs: 2000 },
    reliability: 0,
    termsUrl: 'https://www.gesetze-im-internet.de/impressum.html',
    displayName: 'Gesetze im Internet — AufenthG § 18g',
    sourceTier: 1,
    legalBasis:
      '`gesetze-im-internet.de/robots.txt` is `Disallow:` — empty, permitting everything. The site is ' +
      'operated by the Bundesamt für Justiz, and German statutes are amtliche Werke, uncopyrighted ' +
      'under § 5 UrhG.',
    // A statute changes rarely and without notice, so the window is long and the poll is frequent:
    // the cost of checking is one request, the cost of missing an amendment is a wrong verdict.
    refreshWindow: '180 days',
    schedule: '0 3 * * 1',
  };

  readonly #deps: AufenthgDeps;
  readonly #limiter: RateLimiter;

  constructor(deps: AufenthgDeps) {
    this.#deps = deps;
    this.#limiter = new RateLimiter(this.meta.rateLimit);
  }

  async search(query: SearchQuery): Promise<Page<StatuteRaw>> {
    if (query.regions !== undefined && !query.regions.includes('DE')) return { items: [] };

    const items: StatuteRaw[] = [];
    for (const id of this.#deps.knownDocuments.slice(0, query.limit ?? this.#deps.knownDocuments.length)) {
      const raw = await this.fetch(id);
      if (raw !== null) items.push(raw);
    }
    return { items };
  }

  async fetch(externalId: string): Promise<StatuteRaw | null> {
    await this.#limiter.acquire();
    return withRetry(() => this.#deps.fetchDocument(externalId));
  }

  /**
   * The provisions that are literal and self-contained on this page.
   *
   * Pure and total. A provision this cannot read produces **no row**, never a guessed one — an
   * eligibility answer that silently omits a rule is a false positive, and a fabricated rule is
   * worse than a missing one.
   */
  normalize(raw: StatuteRaw): readonly SourcedRequirement[] {
    const parsed = parseStatute(raw.html);
    const rows: SourcedRequirement[] = [];

    const base = {
      domain: 'immigration' as const,
      imposedBy: 'destination' as const,
      jurisdiction: 'DE',
      pathwayId: PATHWAY_ID,
      profession: null,
      sourceTier: 1 as const,
      sourceUrl: raw.sourceUrl,
      retrievedAt: raw.fetchedAt,
      authority: AUTHORITY,
      authorityUrl: 'https://www.gesetze-im-internet.de/aufenthg_2004/__18g.html',
      effectiveFrom: EFFECTIVE_FROM,
      // Open-ended, unlike the annual salary announcement: a statute applies until amended, and
      // nothing on the page says when that will be.
      effectiveTo: null,
      version: EFFECTIVE_FROM,
      contested: false,
      // A statute has no publication cadence to key off, so this is a review interval rather than
      // a deadline the source sets. Annual, because § 18g has been amended more than once.
      refreshAfter: '2027-01-01',
    };

    if (parsed.minimumEmploymentMonths !== null) {
      rows.push({
        ...base,
        requirementId: 'de.eu-blue-card.employment-duration',
        kind: 'condition',
        // `{ amount, unit }`, matching the monetary shape, because the evaluator compares
        // `value.amount` and refuses anything it cannot read as a number. Written as
        // `{ months: n }` this rule parsed, stored, and then evaluated `undetermined` forever —
        // a rule that is on file and can never be satisfied.
        value: { amount: parsed.minimumEmploymentMonths, unit: 'months' },
        // No route: § 18g Abs. 3 governs every way in, and a rule with no route is pathway-wide
        // (ADR-0024 rule 2).
        appliesTo: {},
        domainDetail: { legalBasis: 'AufenthG § 18g Abs. 3' },
        evaluation: 'numeric-gte',
        needsInput: ['employment_contract_months'],
      });
    }

    if (parsed.requiresAcademicQualification) {
      // **One condition, two routes, so two rows.** Abs. 1 S. 2 incorporates the qualification by
      // reference — *"Fachkräften mit akademischer Ausbildung"* — while Abs. 2 is precisely the
      // route that does **not** require it. A row carries one route, so the condition is stated
      // once per route it governs, with distinct ids. Pathway-wide would silently impose a degree
      // on the one population Abs. 2 exists to admit without one.
      const qualification = {
        kind: 'eligibility' as const,
        value: true,
        evaluation: 'boolean' as const,
        needsInput: ['has_recognised_academic_degree'],
        domainDetail: {
          legalBasis: 'AufenthG § 18g Abs. 1 S. 1',
          // § 18g Abs. 1 S. 5. Not its own rule — it widens what the question *means*, and asking
          // "do you hold a degree?" of someone with an equivalent tertiary qualification would
          // exclude a person the statute admits.
          ...(parsed.recognisesEquivalentTertiary
            ? {
                equivalentQualificationAccepted:
                  'A tertiary programme of at least three years at ISCED 2011 level 6 or EQF ' +
                  'level 6 counts (AufenthG § 18g Abs. 1 S. 5).',
              }
            : {}),
        },
      };

      rows.push({
        ...base,
        ...qualification,
        requirementId: 'de.eu-blue-card.qualification',
        appliesTo: { route: 'abs1-s1' },
      });

      rows.push({
        ...base,
        ...qualification,
        requirementId: 'de.eu-blue-card.qualification.abs1-s2',
        appliesTo: { route: 'abs1-s2' },
        domainDetail: {
          ...qualification.domainDetail,
          legalBasis: 'AufenthG § 18g Abs. 1 S. 2 (incorporating S. 1)',
        },
      });
    }

    if (parsed.recentGraduateYears !== null) {
      rows.push({
        ...base,
        requirementId: 'de.eu-blue-card.recent-graduate',
        // The **second** gate on the reduced route, independent of the first. § 18g Abs. 1 S. 2
        // reads "Nr. 1 *oder* Nr. 2", so either opens it — requiring both would deny every recent
        // graduate whose occupation is not on the list.
        kind: 'right',
        value: { amount: parsed.recentGraduateYears, unit: 'years' },
        appliesTo: { route: 'abs1-s2' },
        domainDetail: {
          legalBasis: 'AufenthG § 18g Abs. 1 S. 2 Nr. 2',
          requiresLabourMarketConsent: true,
        },
        evaluation: 'numeric-lte',
        needsInput: ['years_since_degree_awarded'],
      });
    }

    if (parsed.experienceRouteIscoGroups.length > 0) {
      rows.push({
        ...base,
        requirementId: 'de.eu-blue-card.experience-route-occupations',
        // The gate on Abs. 2 — a narrower list than Abs. 1 S. 2's, and the statute means the
        // difference: two groups, not ten.
        kind: 'right',
        value: parsed.experienceRouteIscoGroups,
        appliesTo: { route: 'abs2' },
        domainDetail: {
          legalBasis: 'AufenthG § 18g Abs. 2',
          requiresLabourMarketConsent: true,
        },
        evaluation: 'set-member',
        needsInput: ['isco_08_group'],
      });
    }

    if (parsed.experienceRequirement !== null) {
      rows.push({
        ...base,
        requirementId: 'de.eu-blue-card.professional-experience',
        kind: 'condition',
        value: { amount: parsed.experienceRequirement.years, unit: 'years' },
        appliesTo: { route: 'abs2' },
        domainDetail: {
          legalBasis: 'AufenthG § 18g Abs. 2 Nr. 3 a)',
          // The seven-year window is in the question, not in a second rule: three years earned a
          // decade ago does not qualify, and a bare total would quietly admit it.
          acquiredWithinYears: parsed.experienceRequirement.withinYears,
          requiresLabourMarketConsent: true,
        },
        evaluation: 'numeric-gte',
        needsInput: ['years_relevant_experience_last_seven'],
      });
    }

    if (parsed.reducedThresholdIscoGroups.length > 0) {
      rows.push({
        ...base,
        requirementId: 'de.eu-blue-card.reduced-threshold-occupations',
        // Not a hurdle — a route that *lowers* the salary threshold. `kind: 'right'` says so, and
        // the evaluator must never treat it as something a person can fail: it **gates its own
        // route** and never blocks the pathway, because `abs1-s1` remains open (ADR-0024 rule 6).
        kind: 'right',
        value: parsed.reducedThresholdIscoGroups,
        appliesTo: { route: 'abs1-s2' },
        domainDetail: { legalBasis: 'AufenthG § 18g Abs. 1 S. 2' },
        evaluation: 'set-member',
        needsInput: ['isco_08_group'],
      });
    }

    return rows;
  }

  validate(normalized: readonly SourcedRequirement[]): ValidationResult {
    const issues: ValidationIssue[] = [];
    const ids = new Set(normalized.map((row) => row.requirementId));

    if (normalized.length === 0) {
      issues.push({
        severity: 'error',
        code: 'no-provisions-parsed',
        message:
          'No provision could be read from § 18g. The page shape changed, or the ISO-8859-1 ' +
          'decoding failed — patterns anchored on umlauts fail silently.',
      });
    }

    if (!ids.has('de.eu-blue-card.employment-duration')) {
      issues.push({
        severity: 'warning',
        code: 'no-employment-duration',
        message: '§ 18g Abs. 3 states a minimum employment duration; none was parsed.',
      });
    }

    for (const row of normalized) {
      if (row.requirementId === 'de.eu-blue-card.employment-duration') {
        const months = (row.value as { amount: number }).amount;
        // A plausibility floor, in the shape the Bundesanzeiger connector taught: a number that
        // parses is not a number that is right.
        if (!(months >= 1 && months <= 60)) {
          issues.push({
            severity: 'error',
            code: 'duration-implausible',
            field: 'value.months',
            message: `${String(months)} months is outside any plausible minimum contract duration.`,
          });
        }
      }

    }

    return { issues };
  }

  /**
   * The page as served. **This is the original**: the statute is published as HTML, so archiving
   * these bytes archives the document itself rather than something derived from it.
   */
  archivable(raw: StatuteRaw): ArchivableSource {
    return {
      // Encoded back to bytes exactly as read. The page is ISO-8859-1, and the raw payload holds
      // it decoded — re-encoding as UTF-8 changes the bytes, so the archive records what we
      // *parsed* rather than the octets on the wire. Noted rather than silently accepted; keeping
      // the original octets means carrying them on the payload, which is follow-up.
      bytes: new TextEncoder().encode(raw.html),
      contentType: 'text/html; charset=utf-8',
      slug: raw.documentId,
      jurisdiction: 'DE',
      year: Number(EFFECTIVE_FROM.slice(0, 4)),
      extension: 'html',
      isOriginal: true,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    const [newest] = this.#deps.knownDocuments;
    if (newest === undefined) return { state: 'degraded', detail: 'No known documents configured.' };

    try {
      await this.#limiter.acquire();
      const raw = await this.#deps.fetchDocument(newest);
      if (raw === null) return { state: 'degraded', detail: `${newest} is no longer retrievable.` };
      return { state: 'healthy' };
    } catch (error) {
      return { state: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
