/**
 * Pure parsing of the BMI Bekanntmachung to § 18g AufenthG.
 *
 * Everything here is a pure function over a string, so `normalize` can call it and stay pure.
 * No I/O, no clock, no randomness.
 *
 * ## Why this is not a two-line regex
 *
 * The Bundesanzeiger publishes this as a PDF whose font map does not round-trip. Extracted text
 * arrives with two defects that a naive pattern silently gets wrong:
 *
 * 1. **Umlauts and the section sign are lost** — `Mindestgehälter` extracts as `Mindestgeh?lter`
 *    and `§ 18g` as `? 18g`. So nothing here may anchor on a non-ASCII character.
 * 2. **Spaces appear inside numbers** — the real 2026 document extracts `45,3` as `4 5,3` and
 *    `45 934,20` as `45 934 ,20`. A pattern matching `\d+,\d+` against `4 5,3` happily returns
 *    **5,3**, which is a plausible-looking percentage and off by a factor of eight.
 *
 * The second one is the dangerous one: it fails to a wrong number rather than to no number, and
 * the wrong number is a salary threshold people plan a relocation around.
 */

/**
 * Rejoin digit runs the PDF extractor split.
 *
 * `4 5,3` → `45,3`; `45 934 ,20` → `45934,20`; `50 700` → `50700`. A space is closed only
 * between two digits, or between a digit and a decimal comma, so `Satz 1 und 2` and
 * `18 g Absatz 1` are left alone — there is a letter in the way.
 */
export function healNumericSpacing(text: string): string {
  let previous = text;
  // Applied to a fixed point because the pattern consumes the character it needs to look at
  // next: one pass over `4 5 6` closes the first gap only.
  for (let i = 0; i < 8; i += 1) {
    const next = previous.replace(/(\d) +(?=[\d,])/g, '$1');
    if (next === previous) return next;
    previous = next;
  }
  return previous;
}

/** German decimal notation: `.` groups thousands, `,` is the decimal point. */
export function parseGermanDecimal(literal: string): number | null {
  const cleaned = literal.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export interface AnnouncedThreshold {
  /** The percentage of the Beitragsbemessungsgrenze this amount derives from. */
  readonly percent: number;
  /** Euro per year, gross. */
  readonly amount: number;
}

export interface ParsedBekanntmachung {
  /** The calendar year the amounts apply to. */
  readonly year: number;
  /** Every (percentage, amount) pair the document announces, in document order. */
  readonly thresholds: readonly AnnouncedThreshold[];
}

/**
 * `für das Jahr 2026 bekannt` — the year these amounts apply to, **not** the year of publication.
 * The 2026 rates were published on 18 December 2025, so keying off the publication date would be
 * wrong by one year every time.
 *
 * Anchored on `das Jahr` rather than `für das Jahr` because the `ü` does not survive extraction.
 */
export function parseYear(healed: string): number | null {
  const match = /das Jahr (\d{4})/.exec(healed);
  const captured = match?.[1];
  if (captured === undefined) return null;
  const year = Number(captured);
  return Number.isInteger(year) ? year : null;
}

/**
 * Every percentage/amount pair the document states.
 *
 * The document's structure is stable across years: each threshold is one sentence naming a
 * percentage of the Beitragsbemessungsgrenze, followed by a sentence giving the euro amount it
 * yields. Pairing them by order is what the document itself does.
 *
 * Both halves are required. A percentage with no amount is not a usable threshold, and an amount
 * with no percentage cannot be checked against the Beitragsbemessungsgrenze next year — so an
 * unpaired one is dropped here and reported as a validation error rather than half-ingested.
 */
export function parseThresholds(healed: string): readonly AnnouncedThreshold[] {
  const percents = [...healed.matchAll(/(\d+(?:,\d+)?) Prozent/g)]
    .map((m) => parseGermanDecimal(m[1] ?? ''))
    .filter((value): value is number => value !== null);

  const amounts = [...healed.matchAll(/(\d+(?:,\d+)?) Euro/g)]
    .map((m) => parseGermanDecimal(m[1] ?? ''))
    .filter((value): value is number => value !== null);

  const pairs: AnnouncedThreshold[] = [];
  for (let i = 0; i < Math.min(percents.length, amounts.length); i += 1) {
    const percent = percents[i];
    const amount = amounts[i];
    if (percent === undefined || amount === undefined) continue;
    pairs.push({ percent, amount });
  }
  return pairs;
}

export function parseBekanntmachung(documentText: string): ParsedBekanntmachung | null {
  const healed = healNumericSpacing(documentText);
  const year = parseYear(healed);
  if (year === null) return null;
  return { year, thresholds: parseThresholds(healed) };
}
