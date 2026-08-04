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
 * **Not yet JSON Schema, and the condition that made that comfortable is gone.** ADR-0003 requires
 * JSON Schema as the source of truth with generation to TypeScript and Pydantic. This file used to
 * say that mattered only "when a Python service consumes a shape, and no `ai/` service exists yet".
 * As of 2026-08-01 one does: `ai/resume-parser` produces a shape TypeScript consumes.
 *
 * Generation tooling is a dependency and needs its own ADR. Until it lands, `resume-parser.ts` is
 * hand-written **and pinned to the real service** by golden fixtures the Python side generates —
 * see `tests/unit/contracts/resume-parser-contract.test.ts`. That is weaker than generation: it
 * proves the shapes agree today, not that they cannot diverge tomorrow.
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
} from './explained.ts';

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
} from './skill.ts';

export {
  DOMAIN_EVALUATION_ORDER,
  REQUIREMENT_DOMAINS,
  REQUIREMENT_EVALUATIONS,
  REQUIREMENT_KINDS,
  REQUIREMENT_RESULTS,
  aggregateStatus,
  firstBindingDomain,
  requiresRecognitionData,
  type EligibilityStatus,
  type EligibilityVerdict,
  type EvaluatedRequirement,
  type ImposedBy,
  type MonetaryValue,
  type RequirementDomain,
  type RequirementEvaluation,
  type RequirementKind,
  type RequirementResult,
  type SourcedRequirement,
} from './requirement.ts';

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
} from './sponsorship.ts';

export {
  isGapResponse,
  type GapCluster,
  type GapHeldWire,
  type GapItemWire,
  type GapRequestWire,
  type GapResponseWire,
  type GapStatus,
  type CalibrationWire,
  type ClusterScoreWire,
  type ReadinessBasis,
  type ReadinessTermWire,
  type ReadinessWire,
  type RemainingWire,
} from './skill-gap.ts';

export {
  isParseResponse,
  isServiceError,
  type EnrichmentStatus,
  type ParseRequestWire,
  type ParseResponseWire,
  type ParseStatus,
  type ParsedSkillWire,
  type ProfileEvidenceKind,
  type ServiceErrorWire,
} from './resume-parser.ts';
