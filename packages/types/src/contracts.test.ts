import { describe, expect, it } from 'vitest';
import {
  DOMAIN_EVALUATION_ORDER,
  MIN_KNOWN_FACTORS,
  aggregateStatus,
  bindingConstraint,
  evidenceReconciles,
  firstBindingDomain,
  isComputed,
  isOrderedGap,
  isStated,
  isUnavailable,
  isValidEmployerScore,
  isValidProfileSkill,
  isValidSponsorshipFact,
  requiresRecognitionData,
  weakestConfidence,
  type EmployerMigrationScore,
  type EvaluatedRequirement,
  type Explained,
  type GapItem,
} from './index.ts';

// These tests assert the product invariants, not the type system. A type cannot enforce that
// evidence weights sum to a score, or that `undetermined` never rounds to `met`.

describe('confidence', () => {
  it('degrades to the weakest input', () => {
    // One low-confidence fact makes the whole result low, however strong the rest is.
    expect(weakestConfidence(['high', 'high', 'low'])).toBe('low');
    expect(weakestConfidence(['high', 'medium'])).toBe('medium');
    expect(weakestConfidence(['high', 'high'])).toBe('high');
  });

  it('is high only when nothing weaker is present', () => {
    expect(weakestConfidence([])).toBe('high');
  });
});

describe('evidence reconciliation', () => {
  const entry = (weight: number | null) =>
    ({ kind: 'skill_match', label: 'x', weight }) as const;

  it('accepts weights that sum to the score', () => {
    expect(evidenceReconciles(0.3, [entry(0.18), entry(0.12)])).toBe(true);
  });

  it('rejects weights that do not', () => {
    // The failure this guards: a score displayed alongside evidence that cannot produce it.
    expect(evidenceReconciles(0.72, [entry(0.18), entry(0.12)])).toBe(false);
  });

  it('counts a negative contribution', () => {
    expect(evidenceReconciles(0.1, [entry(0.2), entry(-0.1)])).toBe(true);
  });

  it('treats a null weight as zero rather than throwing', () => {
    expect(evidenceReconciles(0.2, [entry(0.2), entry(null)])).toBe(true);
  });
});

describe('Explained', () => {
  it('narrows a computed result to a non-null value', () => {
    const result: Explained<number> = {
      status: 'computed',
      value: 0.72,
      confidence: 'medium',
      evidence: [{ kind: 'skill_match', label: 'Kubernetes', weight: 0.72 }],
      provenance: {
        scorerVersion: 'job-match-v3',
        knowledgeAsOf: '2026-07-28T00:00:00Z',
        computedAt: '2026-07-28T09:14:02Z',
      },
    };

    expect(isComputed(result)).toBe(true);
    if (isComputed(result)) expect(result.value).toBe(0.72);
  });

  it('an unknown result carries no value and states what is missing', () => {
    const result: Explained<number> = {
      status: 'unknown',
      value: null,
      confidence: 'low',
      evidence: [{ kind: 'skill_match', label: 'Docker', weight: null }],
      missing: ['salary band unknown for this market'],
      provenance: {
        scorerVersion: 'job-match-v3',
        knowledgeAsOf: '2026-07-28T00:00:00Z',
        computedAt: '2026-07-28T09:14:02Z',
      },
    };

    expect(isComputed(result)).toBe(false);
    expect(result.value).toBeNull();
    // Not 0: a zero reads as "bad fit" rather than "not computed".
    expect(result.value).not.toBe(0);
  });
});

describe('named constraints', () => {
  it('finds the binding one', () => {
    const binding = bindingConstraint([
      { kind: 'language', label: 'German B2', result: 'not_met', binding: false },
      { kind: 'eligibility', label: 'work authorization', result: 'undetermined', binding: true },
    ]);

    expect(binding?.kind).toBe('eligibility');
  });

  it('returns null when nothing binds', () => {
    expect(bindingConstraint([])).toBeNull();
  });
});

describe('profile skills', () => {
  it('rejects an evidenced skill with no evidence source', () => {
    // The same rule as ck_profile_skills__evidence, enforced at the boundary too.
    expect(
      isValidProfileSkill({ skillId: 'kubernetes', status: 'evidenced', confidence: 'high' }),
    ).toBe(false);
  });

  it('accepts an evidenced skill that names its evidence', () => {
    expect(
      isValidProfileSkill({
        skillId: 'kubernetes',
        status: 'evidenced',
        evidenceSource: 'role',
        confidence: 'high',
      }),
    ).toBe(true);
  });

  it('accepts a claimed skill with no evidence source', () => {
    expect(
      isValidProfileSkill({ skillId: 'terraform', status: 'claimed', confidence: 'low' }),
    ).toBe(true);
  });
});

describe('gap ordering', () => {
  const item = (skillId: string, position: number, prerequisites: string[] = []): GapItem => ({
    skillId,
    weight: 0.1,
    position,
    partial: null,
    reason: 'required',
    prerequisites,
  });

  it('accepts prerequisites ordered before their dependents', () => {
    expect(
      isOrderedGap([item('containers-docker', 1), item('kubernetes', 2, ['containers-docker'])]),
    ).toBe(true);
  });

  it('rejects a dependent placed before its prerequisite', () => {
    // Kubernetes before Docker: the ordering failure a learner would actually hit.
    expect(
      isOrderedGap([item('kubernetes', 1, ['containers-docker']), item('containers-docker', 2)]),
    ).toBe(false);
  });

  it('ignores a prerequisite that is not in the gap', () => {
    // Not in the gap means already held, so it imposes no ordering.
    expect(isOrderedGap([item('kubernetes', 1, ['linux-fundamentals'])])).toBe(true);
  });

  it('rejects duplicate positions', () => {
    expect(isOrderedGap([item('a', 1), item('b', 1)])).toBe(false);
  });
});

describe('requirement aggregation', () => {
  const req = (
    domain: EvaluatedRequirement['domain'],
    result: EvaluatedRequirement['result'],
  ): EvaluatedRequirement => ({
    requirementId: `${domain}.x`,
    domain,
    imposedBy: 'destination',
    result,
    authority: 'authority',
    sourceUrl: 'https://example.invalid/rule',
    effectiveFrom: '2026-01-01',
  });

  it('undetermined dominates a met requirement', () => {
    expect(aggregateStatus([req('immigration', 'met'), req('language', 'undetermined')])).toBe(
      'undetermined',
    );
  });

  it('undetermined dominates even a not_met requirement', () => {
    // It never rounds toward a definite answer in either direction.
    expect(aggregateStatus([req('immigration', 'not_met'), req('language', 'undetermined')])).toBe(
      'undetermined',
    );
  });

  it('is met only when every requirement is met', () => {
    expect(aggregateStatus([req('immigration', 'met'), req('language', 'met')])).toBe('met');
  });

  it('reports recognition as binding before immigration', () => {
    // An unrecognised qualification makes a visa threshold moot, so recognition is reported
    // first even though immigration also fails.
    const binding = firstBindingDomain([
      req('immigration', 'not_met'),
      req('recognition', 'not_met'),
    ]);

    expect(binding).toBe('recognition');
  });

  it('returns null when nothing is blocking', () => {
    expect(firstBindingDomain([req('immigration', 'met')])).toBeNull();
  });

  it('orders authentication before credential before recognition', () => {
    const order = [...DOMAIN_EVALUATION_ORDER];
    expect(order.indexOf('authentication')).toBeLessThan(order.indexOf('credential'));
    expect(order.indexOf('credential')).toBeLessThan(order.indexOf('recognition'));
    expect(order.indexOf('recognition')).toBeLessThan(order.indexOf('immigration'));
  });

  it('flags a licence-gated profession with no recognition requirement', () => {
    // The most harmful possible output: a visa-only verdict to a nurse whose licence does not
    // transfer. Must be unanswerable rather than optimistic.
    expect(requiresRecognitionData(true, [req('immigration', 'met')])).toBe(true);
  });

  it('does not flag a licence-gated profession once recognition is present', () => {
    expect(
      requiresRecognitionData(true, [req('immigration', 'met'), req('recognition', 'met')]),
    ).toBe(false);
  });

  it('does not flag an unregulated profession', () => {
    // Cloud/platform engineering, the MVP track.
    expect(requiresRecognitionData(false, [req('immigration', 'met')])).toBe(false);
  });
});

describe('sponsorship', () => {
  it('does not treat unknown as unavailable', () => {
    // The single most important predicate here: silence is not refusal.
    expect(isUnavailable('unknown')).toBe(false);
    expect(isUnavailable('stated_unavailable')).toBe(true);
  });

  it('distinguishes stated from inferred and unknown', () => {
    expect(isStated('stated_available')).toBe(true);
    expect(isStated('inferred_likely')).toBe(false);
    expect(isStated('unknown')).toBe(false);
  });

  it('requires a source url for a stated claim', () => {
    expect(
      isValidSponsorshipFact({
        status: 'stated_available',
        sourceKind: 'posting_text',
        retrievedAt: '2026-07-14T00:00:00Z',
      }),
    ).toBe(false);
  });

  it('requires support and a window for an inference', () => {
    expect(
      isValidSponsorshipFact({
        status: 'inferred_likely',
        sourceKind: 'observed_outcome',
        retrievedAt: '2026-07-14T00:00:00Z',
      }),
    ).toBe(false);

    expect(
      isValidSponsorshipFact({
        status: 'inferred_likely',
        sourceKind: 'observed_outcome',
        supportCount: 12,
        supportWindow: '18 months',
        retrievedAt: '2026-07-14T00:00:00Z',
      }),
    ).toBe(true);
  });

  it('allows unknown with no source, since nobody said anything', () => {
    expect(
      isValidSponsorshipFact({
        status: 'unknown',
        sourceKind: 'posting_text',
        retrievedAt: '2026-07-14T00:00:00Z',
      }),
    ).toBe(true);
  });
});

describe('employer migration score', () => {
  const score = (over: Partial<EmployerMigrationScore>): EmployerMigrationScore => ({
    companyId: 'c1',
    jurisdiction: 'DE',
    score: 0.62,
    status: 'scored',
    factorsKnown: 3,
    factorsTotal: 6,
    confidence: 'low',
    ...over,
  });

  it('rejects a score built from too few known factors', () => {
    // 87/100 from two known factors is a fabrication with a decimal point.
    expect(isValidEmployerScore(score({ factorsKnown: 2 }))).toBe(false);
  });

  it('accepts a score at the floor', () => {
    expect(isValidEmployerScore(score({ factorsKnown: MIN_KNOWN_FACTORS }))).toBe(true);
  });

  it('requires insufficient_data to carry no number', () => {
    expect(isValidEmployerScore(score({ status: 'insufficient_data' }))).toBe(false);
    expect(
      isValidEmployerScore(score({ status: 'insufficient_data', score: null, factorsKnown: 1 })),
    ).toBe(true);
  });

  it('rejects more known factors than total', () => {
    expect(isValidEmployerScore(score({ factorsKnown: 7, factorsTotal: 6 }))).toBe(false);
  });
});
