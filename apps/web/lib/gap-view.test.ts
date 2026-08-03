/**
 * Every state the gap surface can be in, asserted rather than clicked.
 *
 * The two that matter most are the ones a component test would never reach by accident: `no_gap`
 * must not degrade into an empty list, and `unknown` must not degrade into a gap of zero. Both look
 * identical on screen if the mapping is wrong, and both are the exact failure the product exists to
 * avoid.
 */

import { describe, expect, it } from 'vitest';
import type { GapItemWire, GapResponseWire, ReadinessWire } from '@zentavio/types';
import { gapViewStateFor, summaryFor, type GapBody } from './gap-view.ts';

function item(overrides: Partial<GapItemWire> = {}): GapItemWire {
  return {
    skill_id: 'kubernetes',
    weight: 0.95,
    cluster: 'core',
    position: 1,
    partial: null,
    partial_from: null,
    prerequisites: [],
    basis: 'curated',
    support: null,
    ...overrides,
  };
}

function readiness(overrides: Partial<ReadinessWire> = {}): ReadinessWire {
  return {
    status: 'ok',
    score: 0.62,
    score_low: 0.5,
    score_high: 0.8,
    by_cluster: [
      { cluster: 'core', score: 0.7, weight_share: 0.6, requirement_count: 4 },
      { cluster: 'supporting', score: 0.5, weight_share: 0.4, requirement_count: 3 },
    ],
    confidence: 'medium',
    remaining: [
      {
        skill_id: 'kubernetes',
        weight: 0.95,
        partial: null,
        partial_from: null,
        cluster: 'core',
        position: 1,
        typical_time_to_competence: null,
      },
    ],
    terms: [
      {
        skill_id: 'kubernetes',
        weight: 0.95,
        credit: 0,
        basis: 'missing',
        source: null,
        contribution: 0,
      },
    ],
    estimated_time_to_ready: null,
    time_to_ready_basis: 'not estimated: no time-to-competence data exists yet.',
    binding_constraint: null,
    missing: [],
    reason: null,
    scorer_version: 'readiness/2026-08-03',
    ...overrides,
  };
}

function gap(overrides: Partial<GapResponseWire> = {}): GapBody {
  return {
    status: 'gap',
    gap: {
      status: 'ok',
      target_id: 'cloud-platform-engineer',
      target_kind: 'career',
      items: [item()],
      held: [],
      confidence: 'high',
      missing: [],
      unweighted: [],
      reason: null,
      scorer_version: 'skill-gap/2026-08-03',
      knowledge_as_of: '2026-08-03T00:00:00Z',
      readiness: readiness(),
      ...overrides,
    },
  };
}

describe('the states that are not a gap', () => {
  it('treats no-target as a question, not an error', () => {
    const state = gapViewStateFor({ status: 'no-target', reason: 'Choose a track.' });
    expect(state.kind).toBe('no-target');
  });

  it('treats no-profile as its own state rather than a gap of everything', () => {
    const state = gapViewStateFor({ status: 'no-profile', reason: 'Upload a résumé first.' });
    expect(state.kind).toBe('no-profile');
  });

  it('never renders no_gap as an empty list', () => {
    // An empty list reads as a loading bug. "You meet every requirement" is a real answer and
    // deserves a sentence, not a blank panel.
    const state = gapViewStateFor(
      gap({ status: 'no_gap', items: [], reason: 'You meet every requirement.', held: [{ skill_id: 'docker', status: 'evidenced' }] }),
    );
    expect(state.kind).toBe('no-gap');
    if (state.kind !== 'no-gap') throw new Error('unreachable');
    expect(state.reason).toContain('every requirement');
    expect(state.held).toEqual(['docker']);
  });

  it('never renders unknown as a gap of zero', () => {
    const state = gapViewStateFor(
      gap({
        status: 'unknown',
        items: [],
        reason: 'This track has not been modelled yet.',
        missing: ['no requirements are modelled for career x'],
      }),
    );
    expect(state.kind).toBe('unknown');
    if (state.kind !== 'unknown') throw new Error('unreachable');
    expect(state.missing).toHaveLength(1);
  });

  it('degrades to a sentence rather than an empty panel if a reason is ever missing', () => {
    // The contract guard rejects a non-ok status with no reason, so this only fires on a contract
    // break — and a vague sentence beats a blank box.
    const state = gapViewStateFor(gap({ status: 'unknown', items: [], reason: null }));
    if (state.kind !== 'unknown') throw new Error('unreachable');
    expect(state.reason.length).toBeGreaterThan(0);
  });
});

describe('the gap itself', () => {
  it('says why each item matters in words rather than a bare weight', () => {
    // A raw 0.95 is not a sentence, and showing it as "95%" invites reading an importance as a
    // probability.
    const state = gapViewStateFor(gap());
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.items[0]?.importance).toBe('Core to this track');
  });

  it('carries what blocks an item, so its position is explicable', () => {
    const state = gapViewStateFor(
      gap({ items: [item({ prerequisites: ['containers'], position: 1 })] }),
    );
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.items[0]?.blockedBy).toEqual(['containers']);
  });

  it('states partial credit with its source, and hedges the claim', () => {
    // The edge says how much competence transfers in general, not how much transferred for this
    // person. Stating it as a precise personal fact would exceed what the graph supports.
    const state = gapViewStateFor(
      gap({ items: [item({ skill_id: 'azure', partial: 0.65, partial_from: 'aws' })] }),
    );
    if (state.kind !== 'gap') throw new Error('unreachable');
    const partial = state.items[0]?.partial;
    expect(partial?.from).toBe('aws');
    expect(partial?.label).toContain('about 65%');
    expect(partial?.label).toContain('some of this');
  });

  it('marks an unweighted requirement rather than showing a default', () => {
    const state = gapViewStateFor(gap({ items: [item({ weight: null })], unweighted: ['kubernetes'] }));
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.items[0]?.unweighted).toBe(true);
    expect(state.unweighted).toEqual(['kubernetes']);
  });

  it('surfaces confidence as words, not only a level', () => {
    const state = gapViewStateFor(gap({ confidence: 'low' }));
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.confidence.label).toBe('Low confidence');
  });

  it('carries what the answer did not know', () => {
    const state = gapViewStateFor(gap({ missing: ['2 requirements have no weight available'] }));
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.missing).toHaveLength(1);
  });

  it('shows which scorer produced the answer', () => {
    // A number whose scorer is unknown cannot be re-examined after a bug.
    const state = gapViewStateFor(gap());
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.scorerVersion).toBe('skill-gap/2026-08-03');
  });
});

describe('summaryFor', () => {
  it('leads with what can be started now rather than a count of failures', () => {
    // "27 gaps" reads as a verdict on a person. How many they can start today is the number they
    // can act on.
    const state = gapViewStateFor(
      gap({
        items: [
          item({ skill_id: 'containers', position: 1 }),
          item({ skill_id: 'kubernetes', position: 2, prerequisites: ['containers'] }),
        ],
      }),
    );
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.summary).toContain('1 you can start now');
  });

  it('says nothing is missing rather than reporting zero of anything', () => {
    expect(summaryFor([])).toBe('Nothing is missing.');
  });
});

describe('readiness', () => {
  it('renders a number with its remainder, never bare', () => {
    const state = gapViewStateFor(gap());
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.readiness.percent).toBe(62);
    expect(state.readiness.remainingCount).toBeGreaterThan(0);
    expect(state.readiness.confidence.label).toBe('Fairly confident');
  });

  it('rounds to a whole percent, because the inputs are not precise', () => {
    // 0.6187 implies a precision curated tier-3 weights do not have.
    const state = gapViewStateFor(gap({ readiness: readiness({ score: 0.6187 }) }));
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.readiness.percent).toBe(62);
  });

  it('refuses to show a number it does not have, rather than showing zero', () => {
    // "We cannot tell" and "you are not ready" are opposite statements that look identical as an
    // empty progress bar. This is the distinction the whole surface turns on.
    const state = gapViewStateFor(
      gap({
        readiness: readiness({
          status: 'unknown',
          score: null,
          reason: 'There is no parsed profile to measure.',
        }),
      }),
    );
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.readiness.known).toBe(false);
    expect(state.readiness.percent).toBeNull();
    expect(state.readiness.reason).toContain('no parsed profile');
  });

  it('carries what the number does not account for', () => {
    const state = gapViewStateFor(
      gap({
        readiness: readiness({
          missing: ['market demand is not modelled yet'],
        }),
      }),
    );
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.readiness.caveats).toContain('market demand is not modelled yet');
  });

  it('explains why there is no timeline rather than inventing one', () => {
    const state = gapViewStateFor(gap());
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.readiness.timeBasis).toContain('not estimated');
  });

  it('shows which scorer produced the number', () => {
    const state = gapViewStateFor(gap());
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.readiness.scorerVersion).toBe('readiness/2026-08-03');
  });
});

describe('the readiness band', () => {
  it('shows the floor and ceiling around the point estimate', () => {
    const state = gapViewStateFor(gap());
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.readiness.band?.lowPercent).toBe(50);
    expect(state.readiness.band?.highPercent).toBe(80);
    expect(state.readiness.band?.label).toContain('hold up');
  });

  it('shows no band when nothing is being estimated', () => {
    // Every held skill evidenced means there is no assertion to be wrong about. "62% to 62%" would
    // imply a doubt that does not exist.
    const state = gapViewStateFor(
      gap({ readiness: readiness({ score: 0.62, score_low: 0.62, score_high: 0.62 }) }),
    );
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.readiness.band).toBeNull();
  });

  it('breaks the number down by cluster, strongest driver first', () => {
    const state = gapViewStateFor(gap());
    if (state.kind !== 'gap') throw new Error('unreachable');
    expect(state.readiness.clusters.map((c) => c.label)).toEqual(['Core', 'Supporting']);
    expect(state.readiness.clusters[0]?.percent).toBe(70);
    // The share matters as much as the score: 70% of a cluster worth 6% of the track is not a
    // strong position, and the number alone cannot say that.
    expect(state.readiness.clusters[0]?.sharePercent).toBe(60);
  });
});
