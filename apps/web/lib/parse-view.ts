/**
 * Turning an upload response into what the screen must show.
 *
 * Pure, and separate from the component on purpose: `.claude/context/ui-guidelines.md` requires
 * every async surface to design **all** its states before the success state is styled, and states
 * that live inside a component's JSX get tested by clicking. These get tested by asserting.
 *
 * The rule this file exists to hold: **`unknown` is a first-class state, not an empty success.**
 * An empty cell or a zero where the honest answer is "we could not read this" is the failure the
 * whole product is built to avoid.
 */

import type { ParseResponseWire, ParseStatus } from '@zentavio/types';

export type ViewState =
  /** Nothing uploaded yet. Says why it is empty and offers the next action. */
  | { readonly kind: 'empty' }
  /** In flight. The UI shows a skeleton matching the final layout, never a spinner in a void. */
  | { readonly kind: 'loading' }
  /**
   * The request failed — not the document. Carries whether retrying is worth it, because
   * `retryable` is part of the error contract rather than a guess the UI makes.
   */
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean }
  /** The document was read and produced a profile. */
  | { readonly kind: 'success'; readonly skills: readonly SkillView[]; readonly stored: boolean }
  /**
   * Some of it was read. **The common case, not an edge case** — a résumé whose skills section
   * parsed and whose employment history did not is a normal Tuesday
   * (`docs/features/resume-parsing.md`).
   */
  | {
      readonly kind: 'partial';
      readonly skills: readonly SkillView[];
      readonly reason: string;
      readonly stored: boolean;
    }
  /** Nothing could be read. Names what is wrong and what to do instead. */
  | { readonly kind: 'unknown'; readonly reason: string };

export interface SkillView {
  readonly slug: string;
  readonly label: string;
  readonly evidenced: boolean;
  /** The verbatim sentence. Shown, not summarised — it is what makes the claim correctable. */
  readonly sourceSpan: string;
  readonly confidence: 'high' | 'medium' | 'low';
  /**
   * Rendered as words beside the badge.
   *
   * `.claude/context/ui-guidelines.md`: low confidence must look **visibly different**, not the
   * same badge in a lighter tint, and nothing may be conveyed by colour alone. So the difference
   * carries in text as well as style.
   */
  readonly confidenceLabel: string;
}

const CONFIDENCE_LABEL: Record<SkillView['confidence'], string> = {
  high: 'Confident',
  medium: 'Fairly confident',
  low: 'Low confidence',
};

function toSkillView(skill: ParseResponseWire['skills'][number]): SkillView {
  return {
    slug: skill.slug,
    // Slugs are stable identifiers, not display text. Until the API returns a display name, the
    // slug is shown as-is rather than title-cased — inventing "Ci Cd" from `ci-cd` would be worse.
    label: skill.slug,
    evidenced: skill.status === 'evidenced',
    sourceSpan: skill.source_span,
    confidence: skill.confidence,
    confidenceLabel: CONFIDENCE_LABEL[skill.confidence],
  };
}

/**
 * The upload endpoint's success body.
 *
 * `stored` is separate from the parse status because they answer different questions: the parse
 * succeeded, *and* whether anything was written. A readable résumé with no recognised skills is a
 * successful parse that stores nothing, and the user is owed both facts.
 */
export interface UploadBody {
  readonly stored: boolean;
  readonly parse: ParseResponseWire;
}

export function viewStateFor(body: UploadBody): ViewState {
  const status: ParseStatus = body.parse.status;

  if (status === 'unknown') {
    return {
      kind: 'unknown',
      // The service always supplies a reason for a non-ok status — the contract validator rejects
      // one that does not. The fallback exists so a contract break degrades to a vague message
      // rather than an empty panel.
      reason: body.parse.reason ?? 'This document could not be read.',
    };
  }

  const skills = body.parse.skills.map(toSkillView);

  if (status === 'partial') {
    return {
      kind: 'partial',
      skills,
      reason: body.parse.reason ?? 'Some of this document could not be read.',
      stored: body.stored,
    };
  }

  return { kind: 'success', skills, stored: body.stored };
}

/** How many of the shown claims are backed by described work rather than a list. */
export function evidencedCount(skills: readonly SkillView[]): number {
  return skills.filter((s) => s.evidenced).length;
}

/**
 * The sentence under the heading.
 *
 * Deliberately never a bare count. "12 skills" invites reading a résumé as a score, which
 * `.claude/context/career-philosophy.md` rejects — the evidenced/claimed split is the honest
 * summary because it says what the number is made of.
 */
export function summaryFor(skills: readonly SkillView[]): string {
  if (skills.length === 0) return 'No known skills were recognised. Nothing was invented to fill the gap.';

  const evidenced = evidencedCount(skills);
  const claimed = skills.length - evidenced;

  const parts: string[] = [];
  if (evidenced > 0) parts.push(`${String(evidenced)} used in described work`);
  if (claimed > 0) parts.push(`${String(claimed)} listed only`);
  return parts.join(', ');
}
