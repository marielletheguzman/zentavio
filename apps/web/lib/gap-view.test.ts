/**
 * Every state the gap surface can be in, asserted rather than clicked.
 *
 * The two that matter most are the ones a component test would never reach by accident: `no_gap`
 * must not degrade into an empty list, and `unknown` must not degrade into a gap of zero. Both look
 * identical on screen if the mapping is wrong, and both are the exact failure the product exists to
 * avoid.
 */

import { describe, expect, it } from 'vitest';
import type { GapItemWire, GapResponseWire } from '@zentavio/types';
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
