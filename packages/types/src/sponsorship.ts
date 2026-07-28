/**
 * Sponsorship status, and the distinction the whole migration filter rests on:
 * **employers sponsor, governments grant** (`docs/GLOSSARY.md`).
 *
 * The four-valued status exists because most postings never mention sponsorship. `unknown` is
 * the default state of the world and is never the same as `stated_unavailable` — treating
 * silence as refusal would hide most of the viable market
 * (`docs/features/migration-friendly-jobs.md`).
 */

export const SPONSORSHIP_STATUSES = [
  'stated_available',
  'stated_unavailable',
  'inferred_likely',
  'unknown',
] as const;
export type SponsorshipStatus = (typeof SPONSORSHIP_STATUSES)[number];

/** No `third_party_listing`: aggregator "we think they sponsor" pages are not used. */
export const SPONSORSHIP_SOURCE_KINDS = [
  'official_register',
  'employer_statement',
  'posting_text',
  'observed_outcome',
] as const;
export type SponsorshipSourceKind = (typeof SPONSORSHIP_SOURCE_KINDS)[number];

export interface SponsorshipFact {
  readonly status: SponsorshipStatus;
  readonly sourceKind: SponsorshipSourceKind;
  /** Required for a stated value — a sponsorship claim must point at where it was stated. */
  readonly sourceUrl?: string;
  /** The verbatim sentence, when stated in a posting. */
  readonly sourceSpan?: string;
  /** Required for an inference: "probably sponsors" from one outcome and from forty differ. */
  readonly supportCount?: number;
  readonly supportWindow?: string;
  readonly retrievedAt: string;
}

/** Silence is not refusal. The single most important predicate in this module. */
export function isUnavailable(status: SponsorshipStatus): boolean {
  return status === 'stated_unavailable';
}

/** Ranked below stated sponsorship, but shown — never filtered out silently. */
export function isStated(status: SponsorshipStatus): boolean {
  return status === 'stated_available' || status === 'stated_unavailable';
}

export function isValidSponsorshipFact(fact: SponsorshipFact): boolean {
  if (isStated(fact.status) && !fact.sourceUrl) return false;
  if (fact.status === 'inferred_likely') {
    return fact.supportCount !== undefined && fact.supportWindow !== undefined;
  }
  return true;
}

/**
 * The employer score, which must disclose how much of itself is known.
 *
 * `score` is `null` below the floor: a composite built from one or two known factors is a
 * fabrication with a decimal point. Unknown factors are omitted, never zeroed — a zero asserts
 * the employer does *not* offer something.
 */
export const MIN_KNOWN_FACTORS = 3;

export interface EmployerMigrationScore {
  readonly companyId: string;
  readonly jurisdiction: string;
  readonly score: number | null;
  readonly status: 'scored' | 'insufficient_data';
  readonly factorsKnown: number;
  readonly factorsTotal: number;
  readonly confidence: 'high' | 'medium' | 'low';
}

export function isValidEmployerScore(score: EmployerMigrationScore): boolean {
  const scoredMatchesValue = (score.status === 'scored') === (score.score !== null);
  const meetsFloor = score.status !== 'scored' || score.factorsKnown >= MIN_KNOWN_FACTORS;
  const countsSane = score.factorsKnown >= 0 && score.factorsKnown <= score.factorsTotal;
  return scoredMatchesValue && meetsFloor && countsSane;
}
