/**
 * Skills, and the distinction that keeps every downstream score honest.
 *
 * `evidenced` means the skill appears in a described role or project; `claimed` means it
 * appears only in a list. They carry different weights everywhere, and without the split
 * anyone who pads a skills section inflates their own readiness
 * (`docs/features/resume-parsing.md`).
 */

export const SKILL_STATUSES = ['evidenced', 'claimed'] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

/** Only assessed routes promote a skill to `evidenced`. A completion claim does not. */
export const EVIDENCE_SOURCES = [
  'role',
  'project',
  'certification',
  'assessment',
  'artifact',
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/** A skill a person holds, with how we know. */
export interface ProfileSkill {
  readonly skillId: string;
  readonly status: SkillStatus;
  /** Required when `status` is `evidenced` — see `isValidProfileSkill`. */
  readonly evidenceSource?: EvidenceSource;
  /** The verbatim sentence it came from, so the profile can show its own working. */
  readonly sourceSpan?: string;
  readonly confidence: 'high' | 'medium' | 'low';
}

/**
 * An evidenced skill must say what evidences it. The database enforces this with
 * `ck_profile_skills__evidence`; this is the same rule at the boundary, so a malformed
 * profile is rejected before it reaches a repository.
 */
export function isValidProfileSkill(skill: ProfileSkill): boolean {
  return skill.status !== 'evidenced' || skill.evidenceSource !== undefined;
}

export const SKILL_EDGE_TYPES = [
  'requires',
  'adjacent_to',
  'transfers_to',
  'subsumes',
  'tooling_of',
] as const;
export type SkillEdgeType = (typeof SKILL_EDGE_TYPES)[number];

/** A graph edge, with how it was derived. An edge with no basis is not storable. */
export interface SkillEdge {
  readonly fromSkillId: string;
  readonly toSkillId: string;
  readonly type: SkillEdgeType;
  readonly weight: number;
  readonly basis: 'posting-cooccurrence' | 'official-curriculum' | 'outcome-derived' | 'curated';
  /** Observations behind the weight. Required for derived edges. */
  readonly support?: number;
}

/** One item of a gap: weighted, dependency-ordered, and explained. */
export interface GapItem {
  readonly skillId: string;
  readonly weight: number;
  /** Dependency order, from `requires` edges. Not difficulty, not popularity. */
  readonly position: number;
  /** Partial credit from a `transfers_to` edge — `null` when there is none. */
  readonly partial: number | null;
  /** Why this is a gap, shown to the user. A gap they cannot interpret is one they will not close. */
  readonly reason: string;
  readonly prerequisites: readonly string[];
}

/**
 * A gap is ordered by prerequisite, then by weight. This is the ordering contract, so a
 * consumer never has to re-sort and cannot accidentally present a dependent step first.
 */
export function isOrderedGap(items: readonly GapItem[]): boolean {
  const positions = items.map((item) => item.position);
  const seen = new Set(positions);
  if (seen.size !== positions.length) return false;

  const byPosition = new Map(items.map((item) => [item.skillId, item.position]));
  return items.every((item) =>
    item.prerequisites.every((prerequisite) => {
      const at = byPosition.get(prerequisite);
      // A prerequisite outside the gap is already held, so it imposes no ordering.
      return at === undefined || at < item.position;
    }),
  );
}
