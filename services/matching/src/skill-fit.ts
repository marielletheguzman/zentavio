/**
 * Skill Fit: how much of what a posting asks for does a person hold, or hold something that
 * transfers (ADR-0037).
 *
 * **This is not the Job Match Score and must never be renamed into one.** The feature defines
 * thirteen signals; this computes one. Work authorization is a declared *hard constraint* and is
 * unevaluatable for every stored posting — `job_postings.country_code` is null by ADR-0033's design,
 * because mining a country out of `"Arlington, TX"` is exactly the confident wrong answer that rule
 * exists to prevent. A number that omits a constraint nobody consulted is not the Job Match Score
 * under a shorter name, and the name here is the limitation.
 *
 * ## Pure
 *
 * Requirements, held skills and edges in; a score and its evidence out. No database, no clock, no
 * randomness. The same inputs yield the identical number forever, which is what `scorer_version`
 * promises and what makes a stored match re-derivable.
 *
 * ## The arithmetic, in one sentence
 *
 * Each requirement contributes its own weight times how well it is covered, over the total weight
 * the posting asked for. Coverage is 1 for an evidenced hold, less for a claimed one, and an edge's
 * weight times that for a transfer.
 *
 * Deliberately coarse and readable on paper. A score a reviewer cannot follow by hand is a score we
 * cannot defend to the person it is about.
 */

import type { HeldSkill, PostingRequirement, TransferEdge } from '@zentavio/db';

/** Bumped when any number below changes, so a stored row says which arithmetic produced it. */
export const SCORER_VERSION = 'skill-fit-v1';

/**
 * What a hold is worth.
 *
 * **`claimed` is not half-credit for being unsure — it is what an unverified claim is worth.**
 * ADR-0030 decided an in-platform assessment is the only thing that promotes a skill to `evidenced`;
 * a résumé sentence saying "Kubernetes" is a claim about the past that nobody checked. Scoring the
 * two alike would make the assessment pointless.
 */
const COVER_EVIDENCED = 1;
const COVER_CLAIMED = 0.6;

export type EvidenceKind = 'skill_match' | 'skill_transfer' | 'skill_missing';

export interface SkillFitEvidence {
  readonly kind: EvidenceKind;
  readonly label: string;
  readonly skillId: string;
  /**
   * This factor's share of the whole. Positives sum to `score`; positives plus negatives sum to 1.
   * A negative entry carries what was **lost**, so a gap is as legible as a strength.
   */
  readonly weight: number;
  readonly detail: string;
  /** The `skill_edges` row that carried a transfer, so the credit is traceable to a sourced fact. */
  readonly edgeId?: string;
}

export type SkillFitStatus = 'scored' | 'unknown';

export interface SkillFitResult {
  readonly status: SkillFitStatus;
  /** Null whenever `status` is `unknown`. Never 0 standing in for "not computed". */
  readonly score: number | null;
  readonly confidence: 'high' | 'medium' | 'low';
  /** Never empty, including on an `unknown` result — `ck_matches__evidence_present`. */
  readonly evidence: readonly SkillFitEvidence[];
  readonly missing: readonly string[];
  readonly scorerVersion: string;
}

export interface SkillFitInput {
  readonly requirements: readonly PostingRequirement[];
  readonly held: readonly HeldSkill[];
  readonly edges: readonly TransferEdge[];
  /**
   * `job_postings.extracted_version`. Null means extraction has never read this posting (ADR-0036),
   * which is a different unknown from a posting that was read and asks for nothing.
   */
  readonly extractedVersion: string | null;
}

interface Cover {
  readonly cover: number;
  readonly kind: 'skill_match' | 'skill_transfer';
  readonly detail: string;
  readonly edgeId?: string;
}

function coverFor(
  requirement: PostingRequirement,
  heldById: ReadonlyMap<string, HeldSkill>,
  edgesInto: ReadonlyMap<string, readonly TransferEdge[]>,
): Cover | null {
  const direct = heldById.get(requirement.skillId);
  if (direct !== undefined) {
    const cover = direct.status === 'evidenced' ? COVER_EVIDENCED : COVER_CLAIMED;
    return {
      cover,
      kind: 'skill_match',
      detail: direct.verified
        ? `${direct.status}, verified by assessment`
        : `${direct.status} on the profile`,
    };
  }

  // No direct hold. The best transfer wins — not the sum: holding three things that each partly
  // carry into Kubernetes does not add up to knowing Kubernetes.
  let best: Cover | null = null;
  for (const edge of edgesInto.get(requirement.skillId) ?? []) {
    const from = heldById.get(edge.fromSkillId);
    if (from === undefined) continue;

    const cover = edge.weight * (from.status === 'evidenced' ? COVER_EVIDENCED : COVER_CLAIMED);
    if (best !== null && cover <= best.cover) continue;

    best = {
      cover,
      kind: 'skill_transfer',
      detail: `${from.label} transfers at ${edge.weight}, held ${from.status}`,
      edgeId: edge.id,
    };
  }
  return best;
}

/** Confidence falls to the weakest input, never to the average of them. */
function confidenceFor(requirements: readonly PostingRequirement[], covered: number): 'high' | 'medium' | 'low' {
  // Few requirements means a thin basis whatever the ratio: two matched out of two is a coin toss
  // dressed as certainty. The posting's own sparseness is the limiting factor, not the person's.
  if (requirements.length < 3) return 'low';
  const ratio = covered / requirements.length;
  if (ratio >= 0.5) return 'medium';
  return 'low';
}

/**
 * Score one person against one posting.
 *
 * Returns `unknown` in two cases that must not be collapsed, because they are opposite failures:
 *
 * - **We have not read the posting** (`extractedVersion === null`). Scoring here would present a
 *   confident number built on a requirement set nobody has looked for.
 * - **We read it and it asks for nothing curated** (extracted, no requirements). Weighted coverage
 *   over an empty set has no denominator, and inventing `1.0` would make the least informative
 *   posting in the database the best match in it.
 *
 * Both carry evidence saying which, because `missing` is what a person acts on and "we have not got
 * to it yet" and "this posting says nothing concrete" call for different actions.
 */
export function scoreSkillFit(input: SkillFitInput): SkillFitResult {
  const { requirements, held, edges, extractedVersion } = input;

  if (extractedVersion === null) {
    return {
      status: 'unknown',
      score: null,
      confidence: 'low',
      evidence: [
        {
          kind: 'skill_missing',
          label: 'requirements not extracted',
          skillId: '',
          weight: 1,
          detail: 'this posting has not been read for skills yet',
        },
      ],
      missing: ['skill extraction has not run for this posting'],
      scorerVersion: SCORER_VERSION,
    };
  }

  if (requirements.length === 0) {
    return {
      status: 'unknown',
      score: null,
      confidence: 'low',
      evidence: [
        {
          kind: 'skill_missing',
          label: 'no stated requirements',
          skillId: '',
          weight: 1,
          detail: `read at ${extractedVersion}; the posting names nothing in the skill graph`,
        },
      ],
      missing: ['the posting states no requirement matching a curated skill'],
      scorerVersion: SCORER_VERSION,
    };
  }

  const heldById = new Map(held.map((skill) => [skill.skillId, skill]));
  const edgesInto = new Map<string, TransferEdge[]>();
  for (const edge of edges) {
    const existing = edgesInto.get(edge.toSkillId);
    if (existing === undefined) edgesInto.set(edge.toSkillId, [edge]);
    else existing.push(edge);
  }

  const total = requirements.reduce((sum, requirement) => sum + requirement.weight, 0);
  if (total === 0) {
    // Every requirement weighted zero. Arithmetically the empty case, and reported as such rather
    // than as a division nobody would notice going wrong.
    return {
      status: 'unknown',
      score: null,
      confidence: 'low',
      evidence: [
        {
          kind: 'skill_missing',
          label: 'no weighted requirements',
          skillId: '',
          weight: 1,
          detail: 'every extracted requirement carries weight 0',
        },
      ],
      missing: ['the posting states no requirement carrying any weight'],
      scorerVersion: SCORER_VERSION,
    };
  }

  const evidence: SkillFitEvidence[] = [];
  let score = 0;
  let coveredCount = 0;

  for (const requirement of requirements) {
    const share = requirement.weight / total;
    const cover = coverFor(requirement, heldById, edgesInto);

    if (cover === null) {
      evidence.push({
        kind: 'skill_missing',
        label: requirement.label,
        skillId: requirement.skillId,
        weight: round(share),
        detail: requirement.isRequired
          ? 'required by the posting, not held'
          : 'mentioned by the posting, not held',
      });
      continue;
    }

    coveredCount += 1;
    // Rounded here and accumulated from the rounded value, not rounded at the end. Summing full
    // precision and rounding once would leave the evidence weights adding up to something the score
    // is not, and "weights reconcile to score" is asserted rather than hoped for.
    const contribution = round(share * cover.cover);
    score += contribution;
    evidence.push({
      kind: cover.kind,
      label: requirement.label,
      skillId: requirement.skillId,
      weight: contribution,
      detail: cover.detail,
      ...(cover.edgeId === undefined ? {} : { edgeId: cover.edgeId }),
    });
  }

  return {
    status: 'scored',
    // Rounded once more only to clear float addition error; the value is already at four decimals.
    score: round(score),
    confidence: confidenceFor(requirements, coveredCount),
    // Heaviest first, so the top of the list is what actually moved the number — positive or not.
    evidence: [...evidence].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label)),
    missing: [],
    scorerVersion: SCORER_VERSION,
  };
}

/**
 * Four decimals, matching `matches.score numeric(5,4)`.
 *
 * Rounded once at the boundary rather than per term: rounding inside the loop would let the evidence
 * weights drift away from the score they are supposed to reconcile to.
 */
function round(value: number): number {
  return Number(value.toFixed(4));
}
