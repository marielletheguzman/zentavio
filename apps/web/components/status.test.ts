/**
 * The rule `packages/ui`'s README calls a **correctness bug** when it is broken, asserted rather
 * than reviewed.
 *
 * `.claude/context/ui-guidelines.md`: *"Never encode meaning in hue alone."* The two states this
 * exists for are `unmodelled` and `not_applicable` — both are quiet, both are grey-adjacent, and
 * they mean opposite things (ADR-0026). If they ever come to differ only in colour, or only in
 * border style, the distinction is gone for one class of reader and the comparison surface starts
 * telling people the wrong thing about a destination.
 *
 * These assertions are about the *shape of the mapping*, not about specific hex values. A token
 * value changing is a design decision; two states collapsing into the same treatment is a defect.
 */

import { describe, expect, it } from 'vitest';

import { ALL_TONES, toneEdge, toneMeaning, type StatusTone } from './status-tones.ts';

/** Read from the table rather than restated, so a seventh state cannot be added untested. */
const TONES: readonly StatusTone[] = ALL_TONES;

/** The border-style keyword in an edge class string — `solid`, `dashed` or `dotted`. */
function borderStyle(edge: string): string {
  const match = /border-(solid|dashed|dotted)/.exec(edge);
  return match?.[1] ?? 'none';
}

/** The colour token an edge points at, e.g. `positive` from `border-l-positive`. */
function edgeColour(edge: string): string {
  const match = /border-l-([a-z-]+)/.exec(edge.replace('border-l-4', ''));
  return match?.[1] ?? 'none';
}

describe('no two states are told apart by colour alone', () => {
  it.each(TONES)('%s has an edge with both a colour and a style', (tone) => {
    const edge = toneEdge(tone);
    expect(edgeColour(edge)).not.toBe('none');
    expect(borderStyle(edge)).not.toBe('none');
  });

  /**
   * The pair the whole thing exists for.
   *
   * `unmodelled` is a statement about Zentavio; `not_applicable` is a statement about the
   * destination. They must differ in colour **and** in border style, so that losing either signal
   * still leaves them distinguishable.
   */
  it('unmodelled and not_applicable differ in colour and in shape', () => {
    const gap = toneEdge('unmodelled');
    const na = toneEdge('not_applicable');

    expect(edgeColour(gap)).not.toBe(edgeColour(na));
    expect(borderStyle(gap)).not.toBe(borderStyle(na));
  });

  /**
   * Uncertainty is a different shape, never a paler tint.
   *
   * Both states that mean "we are not sure" are dashed, and both states that mean "this is decided"
   * are solid. A dashed `met` or a solid `undetermined` would be the tint bug wearing a border.
   */
  it('uncertain states are dashed and decided states are not', () => {
    expect(borderStyle(toneEdge('undetermined'))).toBe('dashed');
    expect(borderStyle(toneEdge('low_confidence'))).toBe('dashed');
    expect(borderStyle(toneEdge('met'))).toBe('solid');
    expect(borderStyle(toneEdge('not_met'))).toBe('solid');
  });

  it('unmodelled is dotted, which no other state is', () => {
    const dotted = TONES.filter((tone) => borderStyle(toneEdge(tone)) === 'dotted');
    expect(dotted).toEqual(['unmodelled']);
  });
});

describe('every state says what it means in words', () => {
  it.each(TONES)('%s has a meaning a screen reader can announce', (tone) => {
    expect(toneMeaning(tone).length).toBeGreaterThan(0);
  });

  it('no two states share a wording', () => {
    const meanings = TONES.map(toneMeaning);
    expect(new Set(meanings).size).toBe(TONES.length);
  });
});
