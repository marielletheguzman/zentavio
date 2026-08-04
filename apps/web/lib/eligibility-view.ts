/**
 * Turning an eligibility verdict into what the screen must show.
 *
 * Pure and separate from the component, for the same reason as `gap-view.ts`: every state must be
 * designed before the success state is styled, and states living inside JSX get tested by clicking.
 * These get tested by asserting.
 *
 * Three rules this file exists to hold, and each is a place a shortcut would mislead someone about
 * their own relocation:
 *
 * 1. **`undetermined` is never rendered as a no.** It is a question we have not asked yet, and the
 *    screen leads with the question rather than with the absence of an answer.
 * 2. **`unknown` is never rendered as a yes or a no.** "Nobody has modelled this" and "your licence
 *    may not transfer and we cannot say" are different sentences from either verdict.
 * 3. **Nothing is shown without its date and its disclaimer.** An eligibility answer with no `asOf`
 *    is unverifiable, and one with no disclaimer is advice.
 */

import type { EligibilityResponseWire, EvaluatedRequirementWire } from '@zentavio/types';

export interface AnswerableQuestion {
  /** The catalogue key to POST back. */
  readonly key: string;
  /** What to ask, in words. Falls back to the key only when the catalogue has no prompt. */
  readonly prompt: string;
}

export interface RequirementView {
  readonly requirementId: string;
  readonly result: 'met' | 'not_met' | 'undetermined';
  /** What the screen says about it. Never a bare status word. */
  readonly label: string;
  readonly detail: string | null;
  readonly authority: string;
  readonly sourceUrl: string;
  readonly effectiveFrom: string;
}

export type EligibilityViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  /** The request failed — not the answer. */
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean }
  | {
      readonly kind: 'verdict';
      readonly headline: string;
      readonly explanation: string;
      readonly status: 'met' | 'not_met' | 'undetermined' | 'unknown';
      readonly requirements: readonly RequirementView[];
      /** Present only when `undetermined`. What the user can answer to resolve it. */
      readonly questions: readonly AnswerableQuestion[];
      readonly blockers: readonly string[];
      readonly notes: readonly string[];
      readonly confidence: string;
      readonly asOf: string;
      readonly disclaimer: string;
    };

/** Prompts from the catalogue, so a question reads as a question rather than as a column name. */
export type PromptLookup = Readonly<Record<string, string>>;

function requirementLabel(requirement: EvaluatedRequirementWire): string {
  switch (requirement.result) {
    case 'met':
      return 'Met';
    case 'not_met':
      return 'Not met';
    default:
      // Deliberately not "Failed" or "Missing". The rule is fine; we have not asked the question.
      return 'Not answered yet';
  }
}

function toRequirementView(requirement: EvaluatedRequirementWire): RequirementView {
  return {
    requirementId: requirement.requirement_id,
    result: requirement.result,
    label: requirementLabel(requirement),
    // `basis` explains a decided rule; `reason` explains an undecided one. Exactly one is set.
    detail: requirement.basis ?? requirement.reason ?? null,
    authority: requirement.authority,
    sourceUrl: requirement.source_url,
    effectiveFrom: requirement.effective_from,
  };
}

function headlineFor(verdict: EligibilityResponseWire): { headline: string; explanation: string } {
  switch (verdict.status) {
    case 'met':
      return {
        headline: 'You meet the requirements we can check',
        explanation:
          'Every rule on file for this pathway is satisfied by what you have told us. This is what ' +
          'the published rules say, not a decision by the authority.',
      };

    case 'not_met':
      return {
        headline: 'One requirement is not met',
        explanation:
          'The rules below are satisfied except where marked. What blocks you is named, so you can ' +
          'see whether it is something that can change.',
      };

    case 'undetermined':
      // Leads with the question, not the absence of an answer. An `undetermined` rendered as a
      // failure tells someone they are ineligible when they simply have not answered.
      return {
        headline: 'One more answer and we can tell you',
        explanation:
          'Nothing here says no. There is a rule we cannot check without something only you know.',
      };

    default:
      return {
        headline: 'We cannot answer this yet',
        explanation:
          'This is a gap in what we have sourced, not a judgement about you. The reason is below.',
      };
  }
}

export function toEligibilityView(
  verdict: EligibilityResponseWire,
  prompts: PromptLookup = {},
): EligibilityViewState {
  const { headline, explanation } = headlineFor(verdict);

  return {
    kind: 'verdict',
    headline,
    explanation,
    status: verdict.status,
    requirements: verdict.requirements.map(toRequirementView),
    // Only `undetermined` produces questions. A `not_met` verdict is not resolved by answering
    // something — offering a question there would imply the answer could change the outcome.
    questions:
      verdict.status === 'undetermined'
        ? verdict.needs_from_user.map((key) => ({ key, prompt: prompts[key] ?? key }))
        : [],
    blockers: verdict.blockers,
    notes: verdict.notes,
    confidence: verdict.confidence,
    asOf: verdict.as_of,
    disclaimer: verdict.disclaimer,
  };
}

/**
 * How the answer should be shaped before it is sent.
 *
 * A monetary kind must carry its currency and period or the evaluator refuses to compare it —
 * correctly, since 60 000 of an unstated currency against a EUR threshold is a confident wrong
 * answer. The UI knows the unit from the catalogue; it must not send a bare number and hope.
 */
export function toFactValue(
  key: string,
  raw: string,
  unit: string | null,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, message: 'Enter a value.' };

  if (unit === null) return { ok: true, value: trimmed };

  const [currency, period] = unit.split('/');
  const amount = Number(trimmed.replace(/[\s,]/g, ''));
  if (!Number.isFinite(amount)) return { ok: false, message: 'Enter a number.' };
  if (amount <= 0) return { ok: false, message: 'Enter an amount greater than zero.' };

  if (currency === undefined || period === undefined) {
    return { ok: true, value: amount };
  }

  return {
    ok: true,
    value: { amount, currency, period, basis: 'gross' },
  };
}
