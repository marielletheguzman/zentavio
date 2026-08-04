/**
 * Requirements across all six domains, and their evaluation result (ADR-0010).
 *
 * The type-level rules that matter here: `undetermined` is a first-class result that never
 * collapses to a yes or a no, and a licence-gated profession with no recognition requirement
 * yields `unknown` rather than a visa-only verdict.
 */

export const REQUIREMENT_DOMAINS = [
  'immigration',
  'recognition',
  'credential',
  'authentication',
  'language',
  'employment_clearance',
] as const;
export type RequirementDomain = (typeof REQUIREMENT_DOMAINS)[number];

export type ImposedBy = 'origin' | 'destination' | 'bilateral';

/**
 * Evaluation order, by what blocks what: an unrecognised qualification makes a visa
 * threshold moot, so recognition is reported before immigration (ADR-0010).
 */
export const DOMAIN_EVALUATION_ORDER: readonly RequirementDomain[] = [
  'authentication',
  'credential',
  'recognition',
  'immigration',
  'employment_clearance',
  'language',
] as const;

export const REQUIREMENT_RESULTS = ['met', 'not_met', 'undetermined'] as const;
export type RequirementResult = (typeof REQUIREMENT_RESULTS)[number];

export const REQUIREMENT_KINDS = [
  'eligibility',
  'threshold',
  'quota',
  'document',
  'timeline',
  'condition',
  'right',
  'assessment',
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const REQUIREMENT_EVALUATIONS = [
  'numeric-gte',
  'numeric-lte',
  'set-member',
  'boolean',
  'document-present',
  'manual',
] as const;
export type RequirementEvaluation = (typeof REQUIREMENT_EVALUATIONS)[number];

/** A money amount. Never a bare number — a threshold without its currency and period is unusable. */
export interface MonetaryValue {
  readonly amount: number;
  /** ISO-4217. */
  readonly currency: string;
  readonly period: 'year' | 'month';
  /** `gross` matters: a threshold compared against the wrong one is off by a third. */
  readonly basis: 'gross' | 'net';
}

/**
 * A requirement as a connector produces it, before it is stored.
 *
 * Mirrors the `requirements` table (`packages/db/migrations/20260729120100-create-requirements.sql`)
 * because a connector that emits a shape the schema cannot hold fails at insert time, where the
 * error names a column rather than the decision that produced it.
 *
 * **`retrievedAt` is carried on the raw payload, not read from a clock**, so `normalize` stays
 * pure — the connector records when it fetched, and normalize copies it through.
 */
export interface SourcedRequirement {
  /** Stable, namespaced, permanent: `de.eu-blue-card.salary-threshold.general`. */
  readonly requirementId: string;
  readonly domain: RequirementDomain;
  readonly imposedBy: ImposedBy;
  /** ISO-3166-1 alpha-2 of the imposing authority. */
  readonly jurisdiction: string;
  readonly subdivision?: string;
  /** Set for the `immigration` domain; null otherwise. Enforced by `ck_req__scope`. */
  readonly pathwayId: string | null;
  /** Set for `recognition` and `credential`; null otherwise. */
  readonly profession: string | null;
  readonly kind: RequirementKind;
  /** Typed by `kind`. A threshold carries a `MonetaryValue`, never a bare number. */
  readonly value: unknown;
  /** Occupation lists, qualification levels, age bands — explicit, never implied. */
  readonly appliesTo: Readonly<Record<string, unknown>>;
  readonly domainDetail: Readonly<Record<string, unknown>>;
  readonly evaluation: RequirementEvaluation;
  /** The person facts needed to evaluate this. Drives `needsFromUser`. */
  readonly needsInput: readonly string[];
  /** Always 1. `ck_req__tier_one` will not hold anything else, for any domain. */
  readonly sourceTier: 1;
  readonly sourceUrl: string;
  /**
   * The archived copy of the page, once object storage exists. `null` until then — and a null
   * here is a real gap, not a formality: a citation whose URL carries an opaque token is not
   * durable, and the document it points at is the evidence for a number people plan around.
   */
  readonly sourceDocument: string | null;
  /** ISO-8601 UTC, taken from the raw payload's fetch envelope. */
  readonly retrievedAt: string;
  /** The body that decides — answers "who do I contact?" */
  readonly authority: string;
  readonly authorityUrl?: string;
  readonly effectiveFrom: string;
  /** Null while current. A changed rule is a new row, never an update. */
  readonly effectiveTo: string | null;
  /** The source's own version where it has one, else our sequence. */
  readonly version: string;
  readonly contested: boolean;
  readonly contestedNote?: string;
  /** Past this date confidence drops and the UI says so. */
  readonly refreshAfter: string;
}

/** One evaluated requirement, always citing its source and the authority that decides. */
export interface EvaluatedRequirement {
  readonly requirementId: string;
  readonly domain: RequirementDomain;
  readonly imposedBy: ImposedBy;
  readonly result: RequirementResult;
  /** The body that decides — answers "who do I contact?" */
  readonly authority: string;
  readonly sourceUrl: string;
  readonly effectiveFrom: string;
  readonly basis?: string;
  /** Why it could not be determined, and what would settle it. */
  readonly reason?: string;
  readonly needsInput?: readonly string[];
}

export type EligibilityStatus = 'met' | 'not_met' | 'undetermined' | 'unknown';

export interface EligibilityVerdict {
  readonly pathwayId: string | null;
  readonly status: EligibilityStatus;
  readonly requirements: readonly EvaluatedRequirement[];
  readonly blockers: readonly string[];
  /** The single most useful thing the user could supply next. */
  readonly needsFromUser: readonly string[];
  readonly bindingDomain: RequirementDomain | null;
  readonly confidence: 'high' | 'medium' | 'low';
  /** Rules change; an answer without a date is unverifiable. */
  readonly asOf: string;
  /** Emitted verbatim. Never reworded, never shortened. */
  readonly disclaimer: string;
}

/**
 * `undetermined` dominates. One unknown requirement means the verdict is undetermined even if
 * everything else is met — it never rounds toward the friendlier answer.
 */
export function aggregateStatus(
  requirements: readonly EvaluatedRequirement[],
): 'met' | 'not_met' | 'undetermined' {
  if (requirements.some((r) => r.result === 'undetermined')) return 'undetermined';
  if (requirements.some((r) => r.result === 'not_met')) return 'not_met';
  return 'met';
}

/**
 * The first domain in evaluation order that is not met — what actually blocks this person.
 */
export function firstBindingDomain(
  requirements: readonly EvaluatedRequirement[],
): RequirementDomain | null {
  for (const domain of DOMAIN_EVALUATION_ORDER) {
    const failing = requirements.find((r) => r.domain === domain && r.result !== 'met');
    if (failing) return domain;
  }
  return null;
}

/**
 * A licence-gated profession with no recognition requirement cannot be answered. Returning a
 * visa-only verdict to a nurse whose licence does not transfer is the most harmful output this
 * product could produce, so the check is here at the contract rather than left to a caller.
 */
export function requiresRecognitionData(
  isLicenceGated: boolean,
  requirements: readonly EvaluatedRequirement[],
): boolean {
  return isLicenceGated && !requirements.some((r) => r.domain === 'recognition');
}
