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

/**
 * What evaluating one rule against a person's facts can conclude.
 *
 * `not_applicable` is a rule on a route this person cannot use (ADR-0024) — Germany's experience
 * route to someone who holds a degree. **A surface must never render it as a failure.** They were
 * never on that route, and "you failed the experience route" is a false statement about a person.
 */
export const REQUIREMENT_RESULTS = ['met', 'not_met', 'undetermined', 'not_applicable'] as const;
export type RequirementResult = (typeof REQUIREMENT_RESULTS)[number];

/**
 * What kind of requirement this is.
 *
 * **`quota` is deliberately absent** (ADR-0027). A cap on a destination is not something a person
 * satisfies or fails, so it is a property of the pathway rather than a requirement — storing one
 * here would either freeze a verdict at `undetermined` or tell somebody they failed a capacity
 * limit.
 */
export const REQUIREMENT_KINDS = [
  'eligibility',
  'threshold',
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
 * The eligibility service's wire shape.
 *
 * `snake_case` because that is what `ai/career-roadmap` emits, and renaming across the boundary
 * would mean two names for one field with a translation nobody tests. The gateway validates rather
 * than casts: `as EligibilityResponseWire` is a claim about a remote process, and a renamed field
 * reads `undefined` and renders a wrong verdict without ever throwing.
 */
export interface EvaluatedRequirementWire {
  readonly requirement_id: string;
  readonly domain: string;
  readonly imposed_by: string;
  readonly result: RequirementResult;
  readonly authority: string;
  readonly source_url: string;
  readonly effective_from: string;
  readonly basis?: string | null;
  readonly reason?: string | null;
  readonly needs_input: readonly string[];
}

/** One way into a pathway, reported whether or not it is the one that applies (ADR-0024). */
export interface RouteOutcomeWire {
  readonly route: string;
  readonly status: RequirementResult;
  readonly blockers: readonly string[];
  readonly needs_from_user: readonly string[];
  readonly requirement_ids: readonly string[];
  /** Why the route is closed. Null whenever it is open. */
  readonly reason?: string | null;
}

export interface EligibilityResponseWire {
  readonly pathway_id: string | null;
  readonly status: EligibilityStatus;
  readonly requirements: readonly EvaluatedRequirementWire[];
  readonly blockers: readonly string[];
  readonly needs_from_user: readonly string[];
  readonly binding_domain: string | null;
  readonly confidence: string;
  readonly as_of: string;
  readonly disclaimer: string;
  readonly notes: readonly string[];
  readonly evaluator_version: string;
  /** The route this verdict is about. Null for a pathway whose rules declare none. */
  readonly route?: string | null;
  /** Every route. Empty for a pathway with no routes, which is how every pathway starts. */
  readonly routes?: readonly RouteOutcomeWire[];
}

const ELIGIBILITY_STATUSES: readonly string[] = ['met', 'not_met', 'undetermined', 'unknown'];

/**
 * Validate a response from the eligibility service.
 *
 * Checks the fields a verdict is *rendered* from, not every field — the ones whose absence would
 * silently produce a wrong screen rather than an error. `status` and `disclaimer` are the two that
 * must never be missing: one decides what the user is told, the other is what keeps this
 * information rather than advice.
 */
export function isEligibilityResponse(value: unknown): value is EligibilityResponseWire {
  if (typeof value !== 'object' || value === null) return false;
  const wire = value as Record<string, unknown>;

  if (typeof wire['status'] !== 'string' || !ELIGIBILITY_STATUSES.includes(wire['status'])) return false;
  if (typeof wire['as_of'] !== 'string' || wire['as_of'] === '') return false;
  if (typeof wire['disclaimer'] !== 'string' || wire['disclaimer'] === '') return false;
  if (typeof wire['confidence'] !== 'string') return false;
  if (!Array.isArray(wire['requirements'])) return false;
  if (!Array.isArray(wire['needs_from_user'])) return false;
  if (!Array.isArray(wire['blockers'])) return false;

  return true;
}

/** The two axes and the one that binds (ADR-0022). **Deliberately has no score field.** */
export interface ViabilityResponseWire {
  readonly pathway_id: string | null;
  readonly eligibility: EligibilityResponseWire;
  readonly employability: Readonly<Record<string, unknown>>;
  readonly binding: 'eligibility' | 'employability' | 'recognition' | 'unmodelled' | 'none';
  readonly binding_reason: string;
  readonly as_of: string;
  readonly disclaimer: string;
  readonly evaluator_version: string;
}

const BINDING_CONSTRAINTS: readonly string[] = [
  'eligibility',
  'employability',
  'recognition',
  'unmodelled',
  'none',
];

/**
 * Validate a viability response.
 *
 * Checks the binding constraint against the closed set, because an unrecognised value would render
 * as a verdict nobody designed a sentence for — and checks that no composite score field appeared,
 * since ADR-0022 forbids one and a service that started emitting it should fail loudly here.
 */
export function isViabilityResponse(value: unknown): value is ViabilityResponseWire {
  if (typeof value !== 'object' || value === null) return false;
  const wire = value as Record<string, unknown>;

  if (typeof wire['binding'] !== 'string' || !BINDING_CONSTRAINTS.includes(wire['binding'])) return false;
  if (typeof wire['binding_reason'] !== 'string' || wire['binding_reason'] === '') return false;
  if (typeof wire['as_of'] !== 'string' || wire['as_of'] === '') return false;
  if (typeof wire['disclaimer'] !== 'string' || wire['disclaimer'] === '') return false;
  if (!isEligibilityResponse(wire['eligibility'])) return false;

  // ADR-0022: no composite score, anywhere.
  for (const forbidden of ['score', 'viability_score', 'composite', 'rating']) {
    if (forbidden in wire) return false;
  }

  return true;
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
