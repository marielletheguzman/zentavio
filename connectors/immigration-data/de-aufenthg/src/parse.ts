/**
 * Pure parsing of § 18g AufenthG.
 *
 * Everything here is a pure function over a string, so `normalize` can call it and stay pure.
 *
 * ## What this deliberately does *not* try to do
 *
 * The Bundesanzeiger announcement is two sentences of near-fixed shape. This is **statute** —
 * nested conditions, cross-references to § 18, § 18b and § 19f, and provisions whose meaning
 * depends on text that is not on this page. Trying to model all of it mechanically would produce
 * rules that look authoritative and are subtly wrong, which is the worst outcome available for
 * immigration data.
 *
 * So this extracts only the provisions that are **literal and self-contained** on this page:
 *
 * | Provision | Why it is extractable |
 * |---|---|
 * | § 18g Abs. 3 — minimum employment duration | one number, one unit, no cross-reference |
 * | § 18g Abs. 1 — the ISCO-08 groups attracting the reduced threshold | an explicit list of codes |
 * | § 18g Abs. 1 S. 1 — academic qualification required | a single stated condition |
 *
 * Everything else — § 19f's rejection grounds, § 18g Abs. 2's experience alternative, the
 * dependent and residence provisions — is **left unmodelled on purpose**. An eligibility answer
 * that silently omits a rule is a false positive, so the connector's README and the pathway record
 * say what is not covered rather than letting the omission look like coverage.
 */

/** The statute writes small numbers as words. A closed map, because a guess here is a wrong rule. */
const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['einem', 1],
  ['zwei', 2],
  ['drei', 3],
  ['vier', 4],
  ['fünf', 5],
  ['sechs', 6],
  ['sieben', 7],
  ['acht', 8],
  ['neun', 9],
  ['zehn', 10],
  ['zwölf', 12],
]);

/**
 * Strip tags and decode entities.
 *
 * The page is served as **ISO-8859-1** and entity-encodes umlauts (`&#228;`), so the bytes must be
 * decoded before anything matches. Getting this wrong is silent: patterns anchored on `ä` simply
 * never fire, and the connector reports no rules rather than failing.
 */
export function toPlainText(html: string): string {
  const withoutTags = html.replace(/<[^>]+>/g, ' ');
  const decoded = withoutTags.replace(/&#(\d+);/g, (_, code: string) =>
    String.fromCharCode(Number(code)),
  );
  return decoded
    .replace(/&auml;/g, 'ä')
    .replace(/&ouml;/g, 'ö')
    .replace(/&uuml;/g, 'ü')
    .replace(/&szlig;/g, 'ß')
    .replace(/&sect;/g, '§')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * § 18g Abs. 3: the offer must provide for employment of at least six months.
 *
 * Anchored on `Beschäftigungsdauer von mindestens` and accepts either a digit or a number word —
 * the statute currently writes "sechs", and a future amendment might write "6".
 */
export function parseMinimumEmploymentMonths(text: string): number | null {
  const match = /Besch[äa]ftigungsdauer von mindestens (\S+) Monaten/.exec(text);
  const token = match?.[1]?.toLowerCase();
  if (token === undefined) return null;

  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS.get(token) ?? null;
}

/**
 * § 18g Abs. 1: the ISCO-08 groups whose occupations attract the reduced salary threshold.
 *
 * The statute lists them literally — `132, 133, 134, 21, 221, 222, 225, 226, 23 oder 25` — which is
 * why this is extractable at all. Anchored on the sentence that introduces the list rather than on
 * bare digits, because the page is full of numbers that are section references and dates.
 */
export function parseReducedThresholdIscoGroups(text: string): readonly string[] {
  const match = /zu den Gruppen ((?:\d+(?:,\s*|\s+oder\s+))+\d+) nach der Empfehlung/.exec(text);
  const list = match?.[1];
  if (list === undefined) return [];

  return list
    .split(/,|\s+oder\s+/)
    .map((code) => code.trim())
    .filter((code) => /^\d+$/.test(code));
}

/**
 * § 18g Abs. 1 S. 1 addresses a `Fachkraft mit akademischer Ausbildung`.
 *
 * A boolean presence check, not an attempt to model what counts as one — that is decided by
 * recognition rules this connector does not read.
 */
export function requiresAcademicQualification(text: string): boolean {
  return /Fachkraft mit akademischer Ausbildung/.test(text);
}

export interface ParsedStatute {
  readonly minimumEmploymentMonths: number | null;
  readonly reducedThresholdIscoGroups: readonly string[];
  readonly requiresAcademicQualification: boolean;
}

export function parseStatute(html: string): ParsedStatute {
  const text = toPlainText(html);
  return {
    minimumEmploymentMonths: parseMinimumEmploymentMonths(text),
    reducedThresholdIscoGroups: parseReducedThresholdIscoGroups(text),
    requiresAcademicQualification: requiresAcademicQualification(text),
  };
}
