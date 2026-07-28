/**
 * The output contract every score, match, and recommendation carries.
 *
 * This is the type-level form of principle 2: a number with no provenance is a bug
 * (`.claude/skills/ai-matching/SKILL.md`). The shape makes the two failure modes hard to
 * express: evidence is non-optional, and a score is `null` when it was not computed rather
 * than `0`, because a zero reads to a user as "bad" instead of "not calculated".
 */

/** Derived from source tier and completeness — never a model's sense of its own fluency. */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Confidence degrades to the weakest input. */
export function weakestConfidence(levels: readonly Confidence[]): Confidence {
  if (levels.includes('low')) return 'low';
  if (levels.includes('medium')) return 'medium';
  return 'high';
}

export const EVIDENCE_KINDS = [
  'skill_match',
  'skill_missing',
  'skill_transfer',
  'seniority',
  'sponsorship',
  'requirement',
  'memory',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * One contributing factor. `weight` is signed: a negative contribution is stated, never
 * hidden, because a concealed penalty makes a score unexplainable.
 */
export interface EvidenceEntry {
  readonly kind: EvidenceKind;
  readonly label: string;
  readonly weight: number | null;
  readonly detail?: string;
  /** Knowledge rows this factor came from, so evidence is traceable to sourced facts. */
  readonly factIds?: readonly string[];
}

/**
 * A hard constraint, always named. Never applied as a silent multiplier — a job someone
 * cannot legally take is not quietly down-ranked.
 */
export interface NamedConstraint {
  readonly kind: 'eligibility' | 'recognition' | 'language' | 'location' | 'sponsorship' | 'cost';
  readonly label: string;
  readonly result: 'met' | 'not_met' | 'undetermined';
  readonly binding: boolean;
  readonly detail?: string;
}

/** Versions that make a result reproducible. Same inputs plus same versions, same answer. */
export interface ComputationProvenance {
  readonly scorerVersion: string;
  /** Absent when no model was involved. */
  readonly promptVersion?: string;
  readonly knowledgeAsOf: string;
  readonly computedAt: string;
}

interface ExplainedBase<T> {
  readonly value: T;
  readonly confidence: Confidence;
  readonly evidence: readonly EvidenceEntry[];
  readonly constraints?: readonly NamedConstraint[];
  /** What would improve or complete this. A product feature, not an apology. */
  readonly missing?: readonly string[];
  readonly provenance: ComputationProvenance;
}

/** Computed: a value is present. */
export interface Computed<T> extends ExplainedBase<T> {
  readonly status: 'computed';
}

/**
 * Not computable from what is known. `value` is `null` — never a default, never `0`.
 * `missing` is required here: an unknown that does not say what is missing is unactionable.
 */
export interface Unknown extends ExplainedBase<null> {
  readonly status: 'unknown';
  readonly missing: readonly string[];
}

export type Explained<T> = Computed<T> | Unknown;

export function isComputed<T>(result: Explained<T>): result is Computed<T> {
  return result.status === 'computed';
}

/**
 * Evidence weights must reconcile to the score. Asserted generically across every scorer
 * rather than per feature (`docs/development/testing.md`).
 */
export function evidenceReconciles(
  score: number,
  evidence: readonly EvidenceEntry[],
  tolerance = 1e-6,
): boolean {
  const sum = evidence.reduce((total, entry) => total + (entry.weight ?? 0), 0);
  return Math.abs(sum - score) <= tolerance;
}

/** The one constraint that decides the outcome, if any. */
export function bindingConstraint(
  constraints: readonly NamedConstraint[] = [],
): NamedConstraint | null {
  return constraints.find((c) => c.binding) ?? null;
}
