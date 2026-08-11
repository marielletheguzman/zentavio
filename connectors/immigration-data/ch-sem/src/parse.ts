/**
 * Pure parsing of SEM's Weisungen AIG, Kapitel 4.
 *
 * Everything here is a pure function over a string, so `normalize` can call it and stay pure.
 *
 * ## What this file is looking for, and what it is not
 *
 * **Switzerland has almost no numbers.** Germany, Luxembourg and New Zealand all pivot on a salary
 * figure; Kapitel 4 pivots on judgements an authority makes — *is the job in the wider economic
 * interest*, *was priority given to domestic workers*, *is the pay customary for this place,
 * profession and sector*. There is no national minimum wage to compare against.
 *
 * So this parser mostly answers **"does the directive impose this condition?"** rather than *"what
 * is the threshold?"*. A connector that finds no number in a 167-page chapter has not failed —
 * that is the chapter.
 *
 * ## The traps
 *
 * **The table of contents repeats every heading.** Anchoring on a section title matches the
 * contents page first, hundreds of pages before the rule, and the surrounding text there is dot
 * leaders rather than law. Every pattern here is anchored on **operative wording**, never on a
 * heading.
 *
 * **PDF extraction breaks words across line ends**, so `Zulassungsvo raussetzungen` and
 * `A rbeitslosigkeit` appear mid-sentence — and there is no knowing in advance which words break.
 * Phrase matching therefore runs against `compactText`, with every space removed on both sides.
 *
 * **Dates are `DD.MM.YYYY`** — the third format across four countries. `06.07.2026` is 6 July.
 */

/**
 * Collapse whitespace. Nothing more.
 *
 * Used for reading dates, which need their spacing intact.
 */
export function normaliseText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * The text with **every** space removed, for phrase matching.
 *
 * PDF extraction breaks words at line ends — `Zulassungsvo raussetzungen`, `A rbeitslosigkeit` —
 * and there is no way to know in advance which words it will break. **Rejoining by heuristic was
 * tried and was worse**: a rule that joins a lower-case letter to a long following word also joins
 * *"vorhandener persönlicher"*, destroying phrases that were never broken. It failed silently, by
 * making patterns stop matching text that was perfectly intact.
 *
 * Removing every space instead is lossless for this purpose. A phrase match does not need word
 * boundaries, and a pattern written space-free matches regardless of where the extractor put its
 * breaks.
 */
export function compactText(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/**
 * The document's own `Stand` date, as an ISO date.
 *
 * **Taken from the document, not from the page that links it.** The landing page states a date
 * beside each link, and for this chapter the two differ — the page's date belongs to a *different*
 * PDF in the same list. A document is authoritative about itself.
 */
export function parseStandDate(text: string): string | null {
  const match = /\(Stand (\d{2})\.(\d{2})\.(\d{4})\)/.exec(text);
  const [, day, month, year] = match ?? [];
  if (day === undefined || month === undefined || year === undefined) return null;

  const asDate = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (Number.isNaN(asDate.getTime())) return null;
  return asDate.toISOString().slice(0, 10) === `${year}-${month}-${day}`
    ? `${year}-${month}-${day}`
    : null;
}

/**
 * Whether the directive imposes a condition, matched on its operative sentence.
 *
 * Each entry is the wording the rule is actually stated in — not its heading, which the table of
 * contents repeats verbatim hundreds of pages earlier.
 */
export interface DirectiveConditions {
  readonly economicInterest: boolean;
  readonly priority: boolean;
  readonly vacancyReporting: boolean;
  readonly customaryPay: boolean;
  readonly personalQualification: boolean;
  readonly quotaExists: boolean;
}

const OPERATIVE: ReadonlyMap<keyof DirectiveConditions, RegExp> = new Map([
  // Art. 18 Bst. a AIG — the admission must serve the wider economic interest.
  ['economicInterest', /imgesamtwirtschaftlichenInteresse/],
  // Art. 21 AIG — priority for domestic workers and those from free-movement states.
  ['priority', /VorrangderinländischenArbeitnehmerinnenundArbeitnehmer/],
  // Art. 21a AIG — the vacancy-reporting duty, in occupations above a stated unemployment level.
  ['vacancyReporting', /StellenmeldepflichtnachArtikel21a/],
  // Art. 22 AIG — pay and conditions customary for the place, profession and sector.
  ['customaryPay', /orts-,berufs-undbranchenüblichenLohn-undArbeitsbedingungen/],
  // Art. 23 AIG — the personal requirements: qualified workers, specialists, executives.
  ['personalQualification', /ErfordernisvorhandenerpersönlicherVoraussetzungen/],
  // Art. 20 AIG — that the pathway is capped at all. **Not a requirement** (ADR-0027); this only
  // establishes that the pathway has a quota to record against it.
  ['quotaExists', /Höchstzahlen\(Art\.20AIG/],
]);

/** Patterns are space-free, so callers pass raw text and this compacts it. */
export function parseConditions(text: string): DirectiveConditions {
  const compact = compactText(text);
  const found = (key: keyof DirectiveConditions) => OPERATIVE.get(key)?.test(compact) ?? false;

  return {
    economicInterest: found('economicInterest'),
    priority: found('priority'),
    vacancyReporting: found('vacancyReporting'),
    customaryPay: found('customaryPay'),
    personalQualification: found('personalQualification'),
    quotaExists: found('quotaExists'),
  };
}

/**
 * The quota's allocation basis, where the directive names it.
 *
 * Recorded for the **pathway**, never as a requirement (ADR-0027). The figures themselves are in
 * VZAE Anhang 1 und 2, on a host whose `robots.txt` disallows the documents — so this establishes
 * *that* there is a cap and *what allocates it*, and the value stays unsourced.
 */
export function parseQuotaBasis(text: string): string | null {
  return /FestlegungderHöchstzahlen\(Anhang1und2VZAE\)/.test(compactText(text))
    ? 'VZAE Anhang 1 und 2 — set by the Federal Council, allocated to the cantons'
    : null;
}
