/**
 * Pure parsing of Luxembourg's Blue Card salary instruments.
 *
 * Everything here is a pure function over a string, so `normalize` can call it and stay pure.
 *
 * ## Two documents, because no single one states a threshold
 *
 * The règlement grand-ducal states the **formula** — a multiple of the average gross annual salary,
 * and a lower multiple for listed occupations. An annual règlement ministériel states the
 * **average** itself. Neither states their product, which is why ADR-0025 exists and why this file
 * parses two documents rather than one.
 *
 * ## The traps, both of which fail to a plausible wrong number
 *
 * **The multiplier is written in words and split by amendment markers.** Legilux renders a
 * consolidation with the amending act's boundaries inline, so *"une fois et demie"* arrives as
 * `une fois 1 > et demie 1 <`. A pattern anchored on the intact phrase never fires and the
 * connector reports no rule; a pattern that ignores the markers reads the digit `1` as the
 * multiplier and produces a threshold two thirds too low.
 *
 * **The average uses a dot as the thousands separator.** French formatting writes sixty-five
 * thousand as `65.652`, which `Number()` reads as sixty-five point six five two. That is the same
 * failure shape as the German €700 defect: **not an error, a plausible wrong answer**, and one
 * almost everybody would appear to clear.
 */

/** Amendment markers Legilux injects into consolidated text: `1 >`, `2 <`, `12 >`. */
const AMENDMENT_MARKER = /\s*\d+\s*[<>]\s*/g;

/**
 * Strip tags, decode the entities Legilux emits, and remove consolidation markers.
 *
 * The markers are removed **before** any pattern runs, because every phrase in these instruments
 * can be interrupted by one and no pattern should have to know that.
 */
export function toPlainText(html: string): string {
  const withoutTags = html.replace(/<[^>]+>/g, ' ');
  const decoded = withoutTags
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');

  return decoded
    .replace(/​/g, '')
    .replace(AMENDMENT_MARKER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The multipliers the RGD sets, written as the instrument writes them.
 *
 * The general one is words — *"un seuil salarial égal à une fois et demie le salaire annuel brut
 * moyen"*. The derogation is digits with a French decimal comma — *"à 1,2 fois le salaire annuel
 * brut moyen"*. A closed map, because a guessed multiplier is a wrong threshold for everybody.
 */
const MULTIPLIER_WORDS: ReadonlyMap<string, number> = new Map([
  ['une fois et demie', 1.5],
  ['une fois et demi', 1.5],
  ['deux fois', 2],
  ['une fois', 1],
]);

/** The general threshold's multiplier, or `null` when the sentence cannot be read. */
export function parseGeneralMultiplier(text: string): number | null {
  const match = /seuil salarial égal à ([^.]{0,40}?) le salaire annuel brut moyen/.exec(text);
  const phrase = match?.[1]?.trim().toLowerCase();
  if (phrase === undefined) return null;

  const digits = /^(\d+(?:,\d+)?) fois$/.exec(phrase);
  if (digits?.[1] !== undefined) return Number(digits[1].replace(',', '.'));

  return MULTIPLIER_WORDS.get(phrase) ?? null;
}

/**
 * The derogation's multiplier — the reduced threshold for the listed occupation groups.
 *
 * Anchored on *"par dérogation"* rather than on the number, because the document states more than
 * one multiple and matching the first digit run would pick up whichever the amendment history
 * happened to leave earliest.
 */
export function parseReducedMultiplier(text: string): number | null {
  const match =
    /par dérogation à l’alinéa qui précède, à (\d+(?:,\d+)?) fois le salaire annuel brut moyen/.exec(
      text,
    );
  const raw = match?.[1];
  return raw === undefined ? null : Number(raw.replace(',', '.'));
}

/**
 * The CITP (ISCO) groups the reduced threshold is open to.
 *
 * The RGD names them as *"les groupes 1 et 2 de la CITP"* and then enumerates the occupations
 * beneath each. Only the group codes are extracted: the enumeration is prose, and turning prose
 * into an occupation list is the kind of interpretation that produces a rule nobody wrote.
 */
export function parseReducedGroups(text: string): readonly string[] {
  const match = /professions appartenant aux groupes ((?:\d+(?: et |, ))*\d+) de la CITP/.exec(text);
  const list = match?.[1];
  if (list === undefined) return [];

  return list
    .split(/,| et /)
    .map((code) => code.trim())
    .filter((code) => /^\d+$/.test(code));
}

/**
 * The average gross annual salary, and the year it describes.
 *
 * **The dot is a thousands separator, not a decimal point.** `65.652` is sixty-five thousand,
 * and `Number('65.652')` is sixty-five. Both parse; only one is a salary. The year is captured
 * with it because the instrument states a figure *for a year*, and which year applies is a
 * question the threshold's `effective_from` has to answer honestly.
 */
export function parseAverageSalary(
  text: string,
): { readonly amount: number; readonly year: number } | null {
  const match =
    /le salaire annuel brut moyen est de ([\d. ]+(?:,\d+)?) euros pour l’année (\d{4})/.exec(text);
  const raw = match?.[1];
  const year = match?.[2];
  if (raw === undefined || year === undefined) return null;

  // Thousands separators out, decimal comma to a point. Order matters: stripping `.` after
  // converting `,` would destroy the decimal.
  const normalised = raw.replace(/[. ]/g, '').replace(',', '.');
  const amount = Number(normalised);
  if (!Number.isFinite(amount)) return null;

  return { amount, year: Number(year) };
}

export interface ParsedFormula {
  readonly generalMultiplier: number | null;
  readonly reducedMultiplier: number | null;
  readonly reducedGroups: readonly string[];
}

export function parseFormula(html: string): ParsedFormula {
  const text = toPlainText(html);
  return {
    generalMultiplier: parseGeneralMultiplier(text),
    reducedMultiplier: parseReducedMultiplier(text),
    reducedGroups: parseReducedGroups(text),
  };
}

export function parseOperand(html: string): { readonly amount: number; readonly year: number } | null {
  return parseAverageSalary(toPlainText(html));
}

/**
 * The threshold, to the cent.
 *
 * **This is the multiplication ADR-0025 places in the connector**, and it is the only arithmetic
 * this codebase performs on a legal value. Rounded to two decimals because a salary threshold is
 * an amount of money and neither instrument states more precision; the operands are recorded in
 * `domainDetail.derivedFrom` so the result can be re-derived and disagreed with.
 */
export function computeThreshold(multiplier: number, average: number): number {
  return Math.round(multiplier * average * 100) / 100;
}

/**
 * The qualification limbs of Art. 45 — the statute, not the règlement.
 *
 * **Art. 45 (1) 2. states one condition**: the applicant holds *"les qualifications
 * professionnelles élevées"*. Art. 45 (2) d) then defines those as sanctioned **either** by a
 * higher-education diploma **or** by *"compétences professionnelles élevées"*, and (2) f) gives
 * that second limb two forms — an ICT one and a general one.
 *
 * Three alternatives, one condition. They become an `anyOf` group (ADR-0024 rule 10) rather than
 * three routes, because they reach the same permit under the same salary rule, and rather than
 * gates, because failing all three is `not_met` and not `not_applicable`.
 */
export interface ParsedQualification {
  /** CITP-08 groups the ICT limb is open to — `133` and `25` as the statute lists them. */
  readonly ictGroups: readonly string[];
  /** Years of relevant experience the ICT limb requires. */
  readonly ictYears: number | null;
  /** The window those years must fall within. Part of the question, not a second rule. */
  readonly ictWithinYears: number | null;
  /** Years the general limb requires, for *"les autres professions"*. */
  readonly otherYears: number | null;
}

/** French number words the statute uses for durations. A closed map — a guess here is a wrong rule. */
const DURATION_WORDS: ReadonlyMap<string, number> = new Map([
  ['trois', 3],
  ['quatre', 4],
  ['cinq', 5],
  ['six', 6],
  ['sept', 7],
  ['huit', 8],
]);

function duration(word: string | undefined): number | null {
  if (word === undefined) return null;
  return DURATION_WORDS.get(word.trim().toLowerCase()) ?? null;
}

/**
 * The CITP groups and durations of Art. 45 (2) f).
 *
 * Anchored on the statute's own phrases and never on position. The consolidated text carries
 * amendment markers mid-phrase and enumerates the groups with their full French labels, so the
 * codes are taken from the quoted group names — *«133 Managers, technologies …»* — rather than by
 * scanning for digit runs, which would collect the article numbers around them.
 */
export function parseQualification(text: string): ParsedQualification {
  const ictYears = duration(
    /qui ont acquis au moins ([a-zà-ÿ]+) ans d’expérience professionnelle pertinente/.exec(text)?.[1],
  );
  const ictWithinYears = duration(
    /au cours des ([a-zà-ÿ]+) années précédant la demande/.exec(text)?.[1],
  );
  const otherYears = duration(
    /en ce qui concerne les autres professions[\s\S]{0,120}?au moins ([a-zà-ÿ]+) ans/.exec(text)?.[1],
  );

  // The groups as the statute quotes them, each opening with its code.
  const ictGroups = [...text.matchAll(/«\s*(\d+)\s+[^»]*technologies de l’information/g)]
    .map((match) => match[1])
    .filter((code): code is string => code !== undefined);

  return {
    ictGroups: [...new Set(ictGroups)],
    ictYears,
    ictWithinYears,
    otherYears,
  };
}
