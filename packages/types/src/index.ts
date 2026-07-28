/**
 * `@zentavio/types` — shared contracts.
 *
 * The innermost layer: **imports nothing from this repository**, enforced by
 * `boundaries/element-types` in `eslint.config.mjs` (ADR-0001).
 *
 * Runtime exports are deliberate. Most of this package is types, but the predicates —
 * `evidenceReconciles`, `isValidProfileSkill`, `isUnavailable` — are the invariants stated once,
 * so a consumer cannot reimplement them slightly differently. A type cannot enforce that
 * evidence weights sum to a score; a function can, and can be tested.
 *
 * **Not yet JSON Schema.** ADR-0003 requires JSON Schema as the source of truth with generation
 * to TypeScript and Pydantic, so neither side hand-writes the other's shapes. That matters when a
 * Python service consumes a shape, and no `ai/` service exists yet. Generation tooling is a
 * dependency and needs its own ADR; until then these are hand-written TypeScript and the
 * conversion is tracked work rather than a silent gap.
 */

export {
  CONFIDENCE_LEVELS,
  EVIDENCE_KINDS,
  bindingConstraint,
  evidenceReconciles,
  isComputed,
  weakestConfidence,
  type ComputationProvenance,
  type Computed,
  type Confidence,
  type EvidenceEntry,
  type EvidenceKind,
  type Explained,
  type NamedConstraint,
  type Unknown,
} from './explained.js';

export {
  EVIDENCE_SOURCES,
  SKILL_EDGE_TYPES,
  SKILL_STATUSES,
  isOrderedGap,
  isValidProfileSkill,
  type EvidenceSource,
  type GapItem,
  type ProfileSkill,
  type SkillEdge,
  type SkillEdgeType,
  type SkillStatus,
} from './skill.js';

export {
  DOMAIN_EVALUATION_ORDER,
  REQUIREMENT_DOMAINS,
  REQUIREMENT_RESULTS,
  aggregateStatus,
  firstBindingDomain,
  requiresRecognitionData,
  type EligibilityStatus,
  type EligibilityVerdict,
  type EvaluatedRequirement,
  type ImposedBy,
  type RequirementDomain,
  type RequirementResult,
} from './requirement.js';

export {
  MIN_KNOWN_FACTORS,
  SPONSORSHIP_SOURCE_KINDS,
  SPONSORSHIP_STATUSES,
  isStated,
  isUnavailable,
  isValidEmployerScore,
  isValidSponsorshipFact,
  type EmployerMigrationScore,
  type SponsorshipFact,
  type SponsorshipSourceKind,
  type SponsorshipStatus,
} from './sponsorship.js';
