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
