/**
 * `de-bayingg` — the protected title `Ingenieur` in Bavaria, for a qualification earned abroad.
 *
 * ## Why this is the recognition slice, and why it is narrow
 *
 * Software and IT work in Germany is **not a regulated profession**: BIBB's federal recognition
 * portal says recognition is not required to work in one, and returns IT occupations as *nicht
 * reglementiert* (`de.md`). For a cloud or platform engineer the honest recognition answer is
 * therefore *"this does not apply to you"*, and it costs no rule to give.
 *
 * The narrow exception — and the one that touches computer and electronics engineers — is the
 * **title**. `Ingenieurin` / `Ingenieur` is protected, per Land, and using it without permission is
 * not allowed. Bavaria's BayIngG is the instrument this connector reads.
 *
 * **It gates the title, not the activity.** Someone with a Philippine computer-engineering degree
 * may do engineering work in Bavaria; what they may not do is call themselves `Ingenieur` until the
 * Genehmigung is granted. Every row here says so in its `domainDetail`, because a surface that
 * renders this as "you cannot work" would be false about a person's life.
 *
 * ## Legal basis for reading these documents
 *
 * `gesetze-bayern.de/robots.txt` is `User-agent: * / Allow: /`. The portal is the Free State of
 * Bavaria's official legal-information service (BAYERN.RECHT), and German statutes are amtliche
 * Werke, uncopyrighted under § 5 UrhG.
 *
 * ## What this deliberately does not model
 *
 * Art. 3 Abs. 1's equivalence assessment runs through the BayBQFG, whose text is on another page;
 * Abs. 2's one-year practice rule applies only where the profession is unregulated in a member or
 * contracting state; Abs. 3 equates Directive 2005/36/EC programmes. None is self-contained here,
 * so none becomes a row. The README says so rather than letting the omission look like coverage.
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

import { articleText, parseBayIngG, toPlainText } from './parse.ts';

/** One article's bytes, as the archive stores them. */
function toArchivable(article: ArticleRaw): ArchivableSource {
  return {
    bytes: new TextEncoder().encode(article.html),
    contentType: 'text/html; charset=utf-8',
    slug: article.documentId,
    jurisdiction: 'DE',
    year: 2016,
    extension: 'html',
    isOriginal: true,
  };
}

/** One article page as fetched. */
export interface ArticleRaw {
  /** Stable identifier for the article, e.g. `BayIngG2016-2`. */
  readonly documentId: string;
  readonly sourceUrl: string;
  /** ISO-8601 UTC, recorded at fetch time so `normalize` stays pure. */
  readonly fetchedAt: string;
  readonly html: string;
}

/**
 * Both articles, fetched together.
 *
 * **They travel as one payload on purpose**, for the reason `lu-legilux` carries two instruments:
 * neither is a rule alone. Art. 2 states numbers about a German degree; only Art. 3 Abs. 4 makes
 * them the test a qualification earned outside the EU/EEA is measured against. Fetched apart, a
 * rule could be written from one page while the other said something that changed its meaning.
 */
export interface BayIngGRaw {
  /** Art. 2 — the protected title and what a qualifying degree looks like. */
  readonly title: ArticleRaw;
  /** Art. 3 — permission after training abroad, and the third-country sentence. */
  readonly foreignQualification: ArticleRaw;
}

/** The article ids this connector reads. `fetch` composes a payload from both. */
export const ARTICLE_IDS = {
  title: 'BayIngG2016-2',
  foreignQualification: 'BayIngG2016-3',
} as const;

export const SOURCE_ID = 'de-bayingg';

const AUTHORITY = 'Bayerisches Staatsministerium für Wirtschaft, Landesentwicklung und Energie';
const AUTHORITY_URL = 'https://www.gesetze-bayern.de/Content/Document/BayIngG2016';

/**
 * The profession these rules scope to.
 *
 * **The protected title, not an occupation.** `careers.profession` for an engineering track that
 * wants the title would carry this slug; a software or platform engineering track must not, because
 * nothing about that work is regulated and setting it would make a licence-gated verdict out of an
 * unregulated career.
 */
const PROFESSION = 'ingenieur-protected-title';

/** Bavaria. The rule is a Land rule and says so — another Land's Ingenieurgesetz is another row. */
const SUBDIVISION = 'BY';

/**
 * The origins these rows are written for.
 *
 * Art. 3 Abs. 4 addresses evidence from outside the EU/EEA — a **class**, not a list. ADR-0029
 * models a class one member at a time, with distinct `requirement_id`s per origin, because the
 * scope key is an inclusion test and "every country except twenty-eight" is not expressible as one.
 * The Philippines is the first member modelled; a second origin is a second row, not an edit.
 */
const ORIGIN_JURISDICTIONS = ['PH'] as const;

/**
 * When the law took effect.
 *
 * **Hardcoded, and that is a real limitation** — the same one `de-aufenthg` carries. The page
 * carries the promulgation date (12 July 2016, GVBl. S. 156) but no machine-readable date for the
 * article's own current wording. Using the fetch date would claim the rule began the day we read
 * it, which would corrupt every as-of query. Updated by hand when the law changes; `refreshAfter`
 * is what makes that visible.
 */
const EFFECTIVE_FROM = '2016-08-01';

export interface BayIngGDeps {
  readonly fetchDocument: (documentId: string) => Promise<ArticleRaw | null>;
}

export class BayIngGConnector implements Connector<BayIngGRaw, readonly SourcedRequirement[]> {
  readonly meta: ConnectorMeta = {
    id: SOURCE_ID,
    version: '1.0.0',
    kind: 'immigration',
    regions: ['DE'],
    // A Land statute changes on legislative timelines. Nothing is gained by going faster.
    rateLimit: { requests: 30, windowMs: 60_000, minIntervalMs: 2000 },
    reliability: 0,
    termsUrl: 'https://www.gesetze-bayern.de/Home/Impressum',
    displayName: 'BAYERN.RECHT — BayIngG Art. 2 and Art. 3',
    sourceTier: 1,
    legalBasis:
      '`gesetze-bayern.de/robots.txt` is `User-agent: *` / `Allow: /`, read 2026-08-21. BAYERN.RECHT ' +
      "is the Free State of Bavaria's official legal-information portal, and German statutes are " +
      'amtliche Werke, uncopyrighted under § 5 UrhG.',
    refreshWindow: '180 days',
    schedule: '0 3 * * 1',
  };

  readonly #deps: BayIngGDeps;
  readonly #limiter: RateLimiter;

  constructor(deps: BayIngGDeps) {
    this.#deps = deps;
    this.#limiter = new RateLimiter(this.meta.rateLimit);
  }

  async search(query: SearchQuery): Promise<Page<BayIngGRaw>> {
    if (query.regions !== undefined && !query.regions.includes('DE')) return { items: [] };

    const raw = await this.fetch(ARTICLE_IDS.title);
    return { items: raw === null ? [] : [raw] };
  }

  /**
   * One payload: both articles.
   *
   * `externalId` names the *title* article, because that is the rule's anchor. The companion is
   * fetched alongside it and never separately — a payload holding one article would let a rule be
   * written from half the law.
   */
  async fetch(externalId: string): Promise<BayIngGRaw | null> {
    if (externalId !== ARTICLE_IDS.title) return null;

    await this.#limiter.acquire();
    const title = await withRetry(() => this.#deps.fetchDocument(ARTICLE_IDS.title));
    if (title === null) return null;

    await this.#limiter.acquire();
    const foreignQualification = await withRetry(() =>
      this.#deps.fetchDocument(ARTICLE_IDS.foreignQualification),
    );
    // Art. 3 missing is not a partial answer. Without it nothing here applies to a foreign
    // qualification at all, and writing the numeric rules anyway would state them of everybody.
    if (foreignQualification === null) return null;

    return { title, foreignQualification };
  }

  /**
   * The provisions that are literal and self-contained.
   *
   * Pure and total. A provision this cannot read produces **no row**, never a guessed one.
   */
  normalize(raw: BayIngGRaw): readonly SourcedRequirement[] {
    const parsed = parseBayIngG(raw.title.html, raw.foreignQualification.html);
    const rows: SourcedRequirement[] = [];

    const base = {
      domain: 'recognition' as const,
      imposedBy: 'destination' as const,
      jurisdiction: 'DE',
      subdivision: SUBDIVISION,
      // A recognition row carries a profession and no pathway — `ck_req__scope`. It is also why no
      // pathway-scoped query ever returned one before retrieval learned to gather by profession.
      pathwayId: null,
      profession: PROFESSION,
      sourceTier: 1 as const,
      // The title article is what a row cites; both instruments are archived and bound to the row
      // through `requirement_sources` (ADR-0025), so the pair is recoverable.
      sourceUrl: raw.title.sourceUrl,
      retrievedAt: raw.title.fetchedAt,
      authority: AUTHORITY,
      authorityUrl: AUTHORITY_URL,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      version: EFFECTIVE_FROM,
      contested: false,
      // A review interval rather than a deadline the source sets: the Land legislature publishes no
      // cadence, and an Ingenieurgesetz is amended more often than a constitution.
      refreshAfter: '2027-01-01',
    };

    // The two numeric conditions only reach a third-country applicant through Art. 3 Abs. 4, which
    // is what makes them rules *about this person* rather than rules about German degrees. Without
    // that sentence on the page, they are not written.
    if (parsed.thirdCountryEvidenceMustMatchArt2) {
      if (parsed.minimumSemesters !== null) {
        rows.push({
          ...base,
          requirementId: 'de.ingenieur-title.by.study-duration.ph',
          kind: 'condition',
          // `{ amount, unit }`, the shape the evaluator compares. Written `{ semesters: n }` it
          // would parse, store, and evaluate `undetermined` forever.
          value: { amount: parsed.minimumSemesters, unit: 'semesters' },
          appliesTo: { origin_jurisdiction: [...ORIGIN_JURISDICTIONS] },
          domainDetail: {
            legalBasis: 'BayIngG Art. 2 Abs. 1 Nr. 1 b), via Art. 3 Abs. 4',
            gatesTitleNotActivity: true,
            decidedBy: 'the competent Bavarian authority, on application',
          },
          evaluation: 'numeric-gte',
          needsInput: ['degree_standard_duration_semesters'],
        });
      }

      if (parsed.minimumEctsCredits !== null) {
        rows.push({
          ...base,
          requirementId: 'de.ingenieur-title.by.ects-credits.ph',
          kind: 'condition',
          value: { amount: parsed.minimumEctsCredits, unit: 'ects' },
          appliesTo: { origin_jurisdiction: [...ORIGIN_JURISDICTIONS] },
          domainDetail: {
            legalBasis: 'BayIngG Art. 2 Abs. 1 Nr. 1 b), via Art. 3 Abs. 4',
            gatesTitleNotActivity: true,
            // Art. 2 Abs. 1 Nr. 1 c) also requires that mathematics, computer science, natural
            // sciences and technology predominate. Carried as detail rather than as a rule: nothing
            // the person can answer decides it — the authority reads the subject catalogue.
            subjectAreasMustPredominate: 'Mathematik, Informatik, Naturwissenschaften und Technik',
          },
          evaluation: 'numeric-gte',
          needsInput: ['degree_ects_credits'],
        });
      }
    }

    if (parsed.requiresPermissionAfterForeignTraining) {
      rows.push({
        ...base,
        requirementId: 'de.ingenieur-title.by.permission.ph',
        // A document an authority issues. `document-present` is deliberately undecidable here — the
        // evaluator returns `undetermined` with a reason rather than asserting a permission exists,
        // because only the authority knows.
        kind: 'document',
        value: { document: 'Genehmigung zum Führen der Berufsbezeichnung' },
        appliesTo: { origin_jurisdiction: [...ORIGIN_JURISDICTIONS] },
        domainDetail: {
          legalBasis: 'BayIngG Art. 2 Abs. 1 Nr. 2, Art. 3 Abs. 1',
          gatesTitleNotActivity: true,
          // Art. 3 Abs. 1 routes the equivalence test through the BayBQFG, which is not on this
          // page. Named so a reader knows where the rest of the test lives.
          equivalenceAssessedUnder: 'BayBQFG',
        },
        evaluation: 'document-present',
        needsInput: [],
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
          'No provision could be read from BayIngG. The page shape changed, or the article ' +
          'anchors failed — patterns keyed on "Art. 2" and on umlauts fail silently.',
      });
    }

    if (!ids.has('de.ingenieur-title.by.permission.ph')) {
      issues.push({
        severity: 'warning',
        code: 'no-permission-rule',
        message:
          'Art. 2 Abs. 1 Nr. 2 states that a foreign-trained applicant needs permission; none was ' +
          'parsed. Without it the set describes a degree and not the thing that is actually gated.',
      });
    }

    for (const row of normalized) {
      if (row.domain !== 'recognition') {
        issues.push({
          severity: 'error',
          code: 'wrong-domain',
          message: `${row.requirementId} is not a recognition row; BayIngG produces nothing else.`,
        });
      }

      if (row.profession === null) {
        issues.push({
          severity: 'error',
          code: 'missing-profession',
          message: `${row.requirementId} carries no profession, which ck_req__scope refuses.`,
        });
      }

      // The scope key is not `CHECK`-enforceable (ADR-0029), so a typo is caught here or nowhere.
      const origins = (row.appliesTo as { origin_jurisdiction?: unknown }).origin_jurisdiction;
      if (!Array.isArray(origins) || origins.length === 0) {
        issues.push({
          severity: 'error',
          code: 'missing-origin-scope',
          message:
            `${row.requirementId} declares no origin scope. Art. 3 Abs. 4 is about evidence from ` +
            'outside the EU/EEA, and an unscoped row would apply this to every applicant.',
        });
      }
    }

    return { issues };
  }

  /**
   * The article a row cites, as served.
   *
   * **This is the original**: the statute is published as HTML, so these bytes are the document
   * rather than something derived from it.
   */
  archivable(raw: BayIngGRaw): ArchivableSource {
    return toArchivable(raw.title);
  }

  /**
   * Both articles (ADR-0025).
   *
   * Two `primary` instruments rather than a formula and an operand: neither computes anything, and
   * both *state* the rule — Art. 2 the requirement, Art. 3 the sentence that applies it to a
   * qualification earned outside the EU/EEA. A row citing only Art. 2 would pass ADR-0021's archival
   * check while being unreadable as the rule it actually is.
   */
  archivableSources(raw: BayIngGRaw): readonly DerivedSource[] {
    return [raw.title, raw.foreignQualification].map((article) => ({
      source: toArchivable(article),
      role: 'primary' as const,
      instrumentId: article.documentId,
      sourceUrl: article.sourceUrl,
      retrievedAt: article.fetchedAt,
    }));
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      await this.#limiter.acquire();
      const article = await this.#deps.fetchDocument(ARTICLE_IDS.title);
      if (article === null) {
        return { state: 'degraded', detail: `${ARTICLE_IDS.title} is no longer retrievable.` };
      }

      // Fetching is not reading. A 200 that parses to nothing is the failure this connector is most
      // likely to hit, because the portal serves each article inside an application shell.
      if (articleText(toPlainText(article.html), 2).length < 200) {
        return { state: 'degraded', detail: 'Article 2 fetched but its text could not be found.' };
      }
      return { state: 'healthy' };
    } catch (error) {
      return { state: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
