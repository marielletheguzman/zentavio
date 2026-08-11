/**
 * Pure parsing of New Zealand's AEWV instruments.
 *
 * Everything here is a pure function over a string, so `normalize` can call it and stay pure.
 *
 * ## Two publishers, and only one of them is INZ
 *
 * The **Immigration Instructions** state the rules — that remuneration must reach the adult minimum
 * wage, that the market rate must be met, that the employer must be accredited. **MBIE** states the
 * minimum wage itself. Neither states the other's part, which is why this parses two shapes of
 * document and why ADR-0025's provenance applies.
 *
 * ## The traps
 *
 * **Dates are `DD/MM/YYYY`.** `09/10/2023` is 9 October, not 10 September. Read the American way it
 * produces a **valid date in the wrong month** — a rule that takes effect eleven months early, with
 * no error anywhere. Same failure class as the German font map and the French thousands separator.
 *
 * **The instruction pages carry their viewer's JavaScript inline.** A naive text extraction picks up
 * `function printWindow()` and `location.href` before it reaches a word of law, so anything matching
 * on position rather than on an anchor phrase reads the script.
 *
 * **The minimum-wage page is a whole government website**, ~545 KB of navigation around one table.
 * The rate must be anchored on the table's own row, not on the first dollar figure on the page.
 */

/** Strip tags and decode the entities these two sites emit. */
export function toPlainText(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');

  return withoutScripts
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/​/g, '')
    .replace(/﻿/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The `Effective DD/MM/YYYY` an instruction section carries, as an ISO date.
 *
 * **Day first.** New Zealand writes `09/10/2023` for 9 October 2023. Parsed the other way it is a
 * real date in September, and every as-of query against it answers about the wrong month.
 */
export function parseEffectiveFrom(text: string): string | null {
  const match = /Effective (\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  const [, day, month, year] = match ?? [];
  if (day === undefined || month === undefined || year === undefined) return null;

  const asDate = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (Number.isNaN(asDate.getTime())) return null;
  // Round-tripped, because `2026-02-31` constructs a Date and is not a day.
  return asDate.toISOString().slice(0, 10) === `${year}-${month}-${day}`
    ? `${year}-${month}-${day}`
    : null;
}

/**
 * Whether the section requires remuneration at or above the adult minimum wage.
 *
 * A presence check on the instruction's own words, not an attempt to model the sentence. What the
 * *figure* is comes from MBIE; what the *rule* is comes from here.
 */
export function requiresMinimumWage(text: string): boolean {
  return /remuneration for the proposed employment must be at or above the New Zealand adult minimum wage/i.test(
    text,
  );
}

/**
 * Whether the section imposes the market-rate test.
 *
 * Extracted so it can be stored as a rule this evaluator **refuses to decide**. *"Not less than the
 * market rate for that occupation"* is an immigration officer's assessment; turning it into a
 * number would be inventing a threshold nobody wrote.
 */
export function requiresMarketRate(text: string): boolean {
  return /not less than the market rate for that occupation/i.test(text);
}

/** Whether the visa instruction requires an accredited employer's offer via a Job Check. */
export function requiresJobCheck(text: string): boolean {
  return /holds an offer of employment that meets the requirements/i.test(text);
}

/**
 * The adult minimum wage, per hour.
 *
 * **Anchored on the table row**, because the page is a whole website: navigation, footers and
 * unrelated guidance all carry dollar figures, and the first one is not the rate. The row reads
 * `Adult $23.95 $191.60 $958 $1,916` — hourly, then 8-hour day, then week, then fortnight — so the
 * first figure after the label is the one the instruction compares against.
 */
export function parseAdultMinimumWage(text: string): number | null {
  const match = /\bAdult\s+\$([\d,]+(?:\.\d{1,2})?)\s+\$/.exec(text);
  const raw = match?.[1];
  if (raw === undefined) return null;

  const amount = Number(raw.replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

/**
 * The date the published rates take effect.
 *
 * Stated as prose — *"effective from 1 April 2026"* — rather than in the numeric form the
 * instructions use, so it needs its own reader. New Zealand's minimum wage changes on 1 April; the
 * year is what varies.
 */
export function parseWageEffectiveFrom(text: string): string | null {
  const match = /wage rates shown below are effective from (\d{1,2}) (\w+) (\d{4})/i.exec(text);
  const [, day, monthName, year] = match ?? [];
  if (day === undefined || monthName === undefined || year === undefined) return null;

  const month = MONTHS.indexOf(monthName.toLowerCase()) + 1;
  if (month === 0) return null;

  return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

const MONTHS: readonly string[] = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
