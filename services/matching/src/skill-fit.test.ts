/**
 * Skill Fit's arithmetic, exactly.
 *
 * `docs/database/entities/match.md`: *"A test asserting a range on this output would hide
 * non-determinism, so exact assertions are the rule."* Every number below is asserted to the value,
 * not to a band.
 *
 * The tests that matter most are the two `unknown` cases. They are the difference between our gap
 * and the posting's silence, and collapsing them is the failure ADR-0036 and ADR-0037 both exist to
 * prevent.
 */

import { describe, expect, it } from 'vitest';

import { SCORER_VERSION, scoreSkillFit, type SkillFitInput } from './skill-fit.ts';

const K8S = 'skill-kubernetes';
const TERRAFORM = 'skill-terraform';
const DOCKER = 'skill-docker';

function requirement(skillId: string, label: string, weight: number, isRequired = true) {
  return { skillId, label, weight, isRequired, sourceSpan: `${label} required` };
}

function input(overrides: Partial<SkillFitInput> = {}): SkillFitInput {
  return {
    requirements: [requirement(K8S, 'Kubernetes', 0.6), requirement(TERRAFORM, 'Terraform', 0.4)],
    held: [],
    edges: [],
    extractedVersion: 'alias-scan@1.0.0',
    ...overrides,
  };
}

describe('the two unknowns, which are opposite failures', () => {
  it('is unknown when the posting has never been read', () => {
    const result = scoreSkillFit(input({ requirements: [], extractedVersion: null }));

    expect(result.status).toBe('unknown');
    expect(result.score).toBeNull();
    expect(result.missing).toEqual(['skill extraction has not run for this posting']);
    // ck_matches__evidence_present: an unknown row still says what it determined.
    expect(result.evidence).toHaveLength(1);
  });

  it('is unknown when the posting was read and asks for nothing curated', () => {
    const result = scoreSkillFit(input({ requirements: [] }));

    expect(result.status).toBe('unknown');
    expect(result.score).toBeNull();
    expect(result.missing).toEqual(['the posting states no requirement matching a curated skill']);
  });

  it('distinguishes the two by their missing text, not only by their status', () => {
    const unread = scoreSkillFit(input({ requirements: [], extractedVersion: null }));
    const empty = scoreSkillFit(input({ requirements: [] }));

    expect(unread.status).toBe(empty.status);
    // Same status, different cause. One asks us to run extraction; the other asks nothing of us.
    expect(unread.missing).not.toEqual(empty.missing);
  });

  it('never returns 1.0 for a posting that asks for nothing', () => {
    // The least informative posting in the database must not be the best match in it.
    expect(scoreSkillFit(input({ requirements: [] })).score).not.toBe(1);
  });

  it('is unknown when every requirement carries zero weight', () => {
    const result = scoreSkillFit(
      input({ requirements: [requirement(K8S, 'Kubernetes', 0), requirement(TERRAFORM, 'Terraform', 0)] }),
    );

    expect(result.status).toBe('unknown');
    expect(result.missing).toEqual(['the posting states no requirement carrying any weight']);
  });
});

describe('what a hold is worth', () => {
  it('gives an evidenced hold full credit for its share', () => {
    const result = scoreSkillFit(
      input({ held: [{ skillId: K8S, label: 'Kubernetes', status: 'evidenced', verified: true }] }),
    );

    // 0.6 of 1.0 total weight, covered fully.
    expect(result.score).toBe(0.6);
    expect(result.status).toBe('scored');
  });

  it('gives a claimed hold less, because a claim is not a demonstration', () => {
    const result = scoreSkillFit(
      input({ held: [{ skillId: K8S, label: 'Kubernetes', status: 'claimed', verified: false }] }),
    );

    // 0.6 share × 0.6 cover.
    expect(result.score).toBe(0.36);
  });

  it('scores zero when nothing is held, and says what is missing', () => {
    const result = scoreSkillFit(input());

    expect(result.status).toBe('scored');
    expect(result.score).toBe(0);
    expect(result.evidence.map((entry) => entry.kind)).toEqual(['skill_missing', 'skill_missing']);
    expect(result.evidence.map((entry) => entry.label)).toEqual(['Kubernetes', 'Terraform']);
  });

  it('scores 1 only when everything asked for is held and evidenced', () => {
    const result = scoreSkillFit(
      input({
        held: [
          { skillId: K8S, label: 'Kubernetes', status: 'evidenced', verified: true },
          { skillId: TERRAFORM, label: 'Terraform', status: 'evidenced', verified: false },
        ],
      }),
    );

    expect(result.score).toBe(1);
  });
});

describe('transfer', () => {
  const dockerHeld = { skillId: DOCKER, label: 'Docker', status: 'evidenced' as const, verified: false };

  it('credits the best edge into the requirement', () => {
    const result = scoreSkillFit(
      input({
        held: [dockerHeld],
        edges: [{ id: 'edge-1', fromSkillId: DOCKER, toSkillId: K8S, weight: 0.8 }],
      }),
    );

    // 0.6 share × 0.8 edge × 1.0 evidenced.
    expect(result.score).toBe(0.48);
    const transfer = result.evidence.find((entry) => entry.kind === 'skill_transfer');
    expect(transfer?.edgeId).toBe('edge-1');
  });

  it('takes the best transfer, never the sum of several', () => {
    // Holding three things that each partly carry into Kubernetes is not knowing Kubernetes.
    const result = scoreSkillFit(
      input({
        held: [dockerHeld, { skillId: 'skill-linux', label: 'Linux', status: 'evidenced', verified: false }],
        edges: [
          { id: 'edge-1', fromSkillId: DOCKER, toSkillId: K8S, weight: 0.5 },
          { id: 'edge-2', fromSkillId: 'skill-linux', toSkillId: K8S, weight: 0.3 },
        ],
      }),
    );

    // 0.6 × 0.5, not 0.6 × 0.8.
    expect(result.score).toBe(0.3);
  });

  it('prefers a direct hold over any transfer', () => {
    const result = scoreSkillFit(
      input({
        held: [dockerHeld, { skillId: K8S, label: 'Kubernetes', status: 'evidenced', verified: false }],
        edges: [{ id: 'edge-1', fromSkillId: DOCKER, toSkillId: K8S, weight: 0.8 }],
      }),
    );

    expect(result.score).toBe(0.6);
    expect(result.evidence.find((entry) => entry.label === 'Kubernetes')?.kind).toBe('skill_match');
  });

  it('ignores an edge whose source the person does not hold', () => {
    const result = scoreSkillFit(
      input({ edges: [{ id: 'edge-1', fromSkillId: DOCKER, toSkillId: K8S, weight: 0.8 }] }),
    );

    expect(result.score).toBe(0);
  });
});

describe('the evidence contract', () => {
  const held = [{ skillId: K8S, label: 'Kubernetes', status: 'evidenced' as const, verified: true }];

  it('reconciles: positives sum to the score', () => {
    const result = scoreSkillFit(input({ held }));
    const positives = result.evidence
      .filter((entry) => entry.kind !== 'skill_missing')
      .reduce((sum, entry) => sum + entry.weight, 0);

    expect(Number(positives.toFixed(4))).toBe(result.score);
  });

  it('reconciles: positives plus what was lost sum to 1', () => {
    const result = scoreSkillFit(input({ held }));
    const total = result.evidence.reduce((sum, entry) => sum + entry.weight, 0);

    expect(Number(total.toFixed(4))).toBe(1);
  });

  it('names every negative rather than hiding it', () => {
    const result = scoreSkillFit(input({ held }));
    const missing = result.evidence.find((entry) => entry.kind === 'skill_missing');

    expect(missing?.label).toBe('Terraform');
    expect(missing?.detail).toBe('required by the posting, not held');
  });

  it('says "mentioned" rather than "required" for a skill the posting only mentioned', () => {
    const result = scoreSkillFit(
      input({ requirements: [requirement(K8S, 'Kubernetes', 0.6, false)], held: [] }),
    );

    expect(result.evidence[0]?.detail).toBe('mentioned by the posting, not held');
  });

  it('orders evidence heaviest first, so the top of the list is what moved the number', () => {
    const result = scoreSkillFit(input({ held }));

    expect(result.evidence.map((entry) => entry.label)).toEqual(['Kubernetes', 'Terraform']);
  });
});

describe('confidence falls to the weakest input', () => {
  it('is low when the posting states fewer than three requirements', () => {
    const result = scoreSkillFit(
      input({
        held: [
          { skillId: K8S, label: 'Kubernetes', status: 'evidenced', verified: true },
          { skillId: TERRAFORM, label: 'Terraform', status: 'evidenced', verified: true },
        ],
      }),
    );

    // A perfect score on a two-item posting is a coin toss dressed as certainty.
    expect(result.score).toBe(1);
    expect(result.confidence).toBe('low');
  });

  it('is medium when a substantial share of a fuller requirement set is covered', () => {
    const result = scoreSkillFit(
      input({
        requirements: [
          requirement(K8S, 'Kubernetes', 0.4),
          requirement(TERRAFORM, 'Terraform', 0.3),
          requirement(DOCKER, 'Docker', 0.3),
        ],
        held: [
          { skillId: K8S, label: 'Kubernetes', status: 'evidenced', verified: true },
          { skillId: DOCKER, label: 'Docker', status: 'evidenced', verified: true },
        ],
      }),
    );

    expect(result.confidence).toBe('medium');
  });
});

describe('reproducibility', () => {
  it('stamps the scorer version on every result, scored or not', () => {
    expect(scoreSkillFit(input()).scorerVersion).toBe(SCORER_VERSION);
    expect(scoreSkillFit(input({ extractedVersion: null })).scorerVersion).toBe(SCORER_VERSION);
  });

  it('is not a Job Match Score, and says so in its version', () => {
    // The name is the limitation (ADR-0037). If this ever reads job-match-*, the decision was undone.
    expect(SCORER_VERSION).toBe('skill-fit-v1');
    expect(SCORER_VERSION.startsWith('job-match')).toBe(false);
  });

  it('yields the identical number for identical inputs', () => {
    const held = [{ skillId: K8S, label: 'Kubernetes', status: 'claimed' as const, verified: false }];

    expect(scoreSkillFit(input({ held }))).toEqual(scoreSkillFit(input({ held })));
  });
});
