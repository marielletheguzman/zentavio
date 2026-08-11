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

import {
  validatePersonFactValue,
  type EligibilityResponseWire,
  type EvaluatedRequirementWire,
  type PersonFactKindWire,
  type RouteOutcomeWire,
} from '@zentavio/types';

export interface AnswerableQuestion {
  /** The catalogue key to POST back. */
  readonly key: string;
  /** What to ask, in words. Falls back to the key only when the catalogue has no entry. */
  readonly prompt: string;
  /**
   * The catalogue entry, which decides the control and the shape of the answer.
   *
   * **Null when the catalogue does not define this key**, and that is a state the surface must
   * render as unanswerable rather than as a text box. A rule asking for a fact the product cannot
   * accept is a `needsFromUser` nobody can act on; guessing a control for it would let a wrongly
   * shaped answer through, which is the defect this whole path was rebuilt to close.
   */
  readonly kind: PersonFactKindWire | null;
}

export interface RequirementView {
  readonly requirementId: string;
  /**
   * `not_applicable` is a rule on a route this person cannot use (ADR-0024).
   *
   * It must never be styled as a failure. Someone holding a degree was never on Germany's
   * experience route, and rendering "not met" against a rule that never applied to them is a false
   * statement about them, not a cosmetic issue.
   */
  readonly result: 'met' | 'not_met' | 'undetermined' | 'not_applicable';
  /** What the screen says about it. Never a bare status word. */
  readonly label: string;
  readonly detail: string | null;
  readonly authority: string;
  readonly sourceUrl: string;
  readonly effectiveFrom: string;
}

/**
 * One way into the pathway, kept as its own thing on the screen (ADR-0024).
 *
 * A pathway with routes is not a flat list of rules, and flattening it loses the two sentences the
 * model exists to separate: *this way in is not open to you* and *this rule is not satisfied*. A
 * degree holder was never on Germany's experience route, so the rules on it must read as belonging
 * to a route that is not theirs rather than as things they failed.
 */
export interface RouteView {
  /**
   * The route's id, verbatim.
   *
   * **Deliberately not translated into a description here.** A route id is opaque data; deciding
   * that `abs1-s2` means "the reduced salary threshold" would put a reading of German law in a
   * React file, which is exactly what ADR-0024 rule 8 keeps out of the evaluator. When routes need
   * human names, the name comes from the pathway record with the rest of the sourced knowledge.
   */
  readonly route: string;
  readonly status: 'met' | 'not_met' | 'undetermined' | 'not_applicable';
  /** What the screen says about the route. Never a bare status word. */
  readonly label: string;
  /** Why it is closed, when it is closed. Null whenever it is open. */
  readonly detail: string | null;
  /** The rules evaluated as part of this route, pathway-wide ones included. */
  readonly requirementIds: readonly string[];
  /** What answering would move *this* route, whether or not it is the one being asked about. */
  readonly questions: readonly AnswerableQuestion[];
  /** The route the verdict above is about — the met one, else the nearest open one. */
  readonly used: boolean;
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
      /**
       * Every way in, or empty for a pathway whose rules declare none.
       *
       * Empty is the normal case and renders nothing: a pathway with one implicit way in has no
       * route structure to show, and inventing a "default route" heading for it would be the
       * screen asserting a model the data does not have.
       */
      readonly routes: readonly RouteView[];
      /** The route the verdict is about. Null when the pathway declares none. */
      readonly usedRoute: string | null;
      /** Present only when `undetermined`. What the user can answer to resolve it. */
      readonly questions: readonly AnswerableQuestion[];
      readonly blockers: readonly string[];
      readonly notes: readonly string[];
      readonly confidence: string;
      readonly asOf: string;
      readonly disclaimer: string;
    };

/**
 * The catalogue, keyed by fact key.
 *
 * Served by the gateway from `person_fact_kinds`. A surface holds no opinion about what a question
 * says, what unit it is in, or what values it permits — all three are properties of the question,
 * and a component that restates them is a copy that goes stale silently.
 */
export type FactCatalogue = Readonly<Record<string, PersonFactKindWire>>;

/** One question, resolved against the catalogue. */
function toQuestion(key: string, catalogue: FactCatalogue): AnswerableQuestion {
  const kind = catalogue[key];
  return { key, prompt: kind?.prompt ?? key, kind: kind ?? null };
}

function requirementLabel(requirement: EvaluatedRequirementWire): string {
  switch (requirement.result) {
    case 'met':
      return 'Met';
    case 'not_met':
      return 'Not met';
    case 'not_applicable':
      // Not a failure and not a gap. This rule belongs to a way in that is not this person's, and
      // the wording has to make that unmistakable — "not met" here would be untrue.
      return 'Does not apply to you';
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

function routeLabel(status: RouteOutcomeWire['status']): string {
  switch (status) {
    case 'met':
      return 'Open to you';
    case 'not_met':
      // The route exists for this person; something on it is not satisfied. Different sentence
      // from the one below, and the difference is the whole reason routes are rendered.
      return 'Open to you, but a rule on it is not met';
    case 'not_applicable':
      // Never "failed" and never "closed to you" — nothing here is a judgement about the person.
      // They were not on this way in, which is a fact about the rules.
      return 'Not a way in for you';
    default:
      return 'Still open — something is unanswered';
  }
}

function toRouteView(
  outcome: RouteOutcomeWire,
  usedRoute: string | null,
  catalogue: FactCatalogue,
): RouteView {
  return {
    route: outcome.route,
    status: outcome.status,
    label: routeLabel(outcome.status),
    detail: outcome.reason ?? null,
    requirementIds: outcome.requirement_ids,
    // Carried for every open route, not only the one being asked about. The product leads with the
    // shortest set of questions (ADR-0024 rule 5); it does not get to hide that another way in
    // exists and has its own.
    questions: outcome.needs_from_user.map((key) => toQuestion(key, catalogue)),
    used: outcome.route === usedRoute,
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
  catalogue: FactCatalogue = {},
): EligibilityViewState {
  const { headline, explanation } = headlineFor(verdict);

  return {
    kind: 'verdict',
    headline,
    explanation,
    status: verdict.status,
    requirements: verdict.requirements.map(toRequirementView),
    routes: (verdict.routes ?? []).map((outcome) =>
      toRouteView(outcome, verdict.route ?? null, catalogue),
    ),
    usedRoute: verdict.route ?? null,
    // Only `undetermined` produces questions. A `not_met` verdict is not resolved by answering
    // something — offering a question there would imply the answer could change the outcome.
    questions:
      verdict.status === 'undetermined'
        ? verdict.needs_from_user.map((key) => toQuestion(key, catalogue))
        : [],
    blockers: verdict.blockers,
    notes: verdict.notes,
    confidence: verdict.confidence,
    asOf: verdict.as_of,
    disclaimer: verdict.disclaimer,
  };
}

/**
 * Turn what a control produced into the domain value its kind requires.
 *
 * **The kind comes from the catalogue, never from a map in this file.** A local table of units and
 * prompts is a second source of truth, and it drifted the moment § 18g added five questions: every
 * one of them rendered as its raw key in a free-text box, and a boolean answered "no" was sent as
 * the string `'no'`.
 *
 * The shaped value is checked with `validatePersonFactValue` — **the same function the write
 * boundary enforces**. Not because the client's check protects anything (it does not; the server
 * is authoritative and refuses the same values), but because a message at the keyboard beats a 400
 * after a round trip, and one implementation cannot disagree with itself.
 */
export function toFactValue(
  kind: PersonFactKindWire,
  raw: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, message: 'Enter a value.' };

  const value = shapeForKind(kind, trimmed);
  if (value === UNSHAPEABLE) {
    return { ok: false, message: `Enter a valid ${kind.valueType === 'monetary' ? 'amount' : kind.valueType}.` };
  }

  const check = validatePersonFactValue(kind, value);
  return check.ok ? { ok: true, value } : { ok: false, message: check.message };
}

/** Distinct from `null` and `undefined`, either of which could be a legitimate shaped value. */
const UNSHAPEABLE = Symbol('unshapeable');

function shapeForKind(kind: PersonFactKindWire, trimmed: string): unknown {
  switch (kind.valueType) {
    case 'boolean':
      // Only the two strings the control itself emits. **Not** a yes/no/1/0 parser: the moment
      // this file starts interpreting words, it is deciding what "no" means, which is exactly the
      // interpretation that produced the defect.
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
      return UNSHAPEABLE;

    case 'integer':
    case 'decimal': {
      const parsed = Number(trimmed.replace(/[\s,]/g, ''));
      return Number.isFinite(parsed) ? parsed : UNSHAPEABLE;
    }

    case 'monetary': {
      const amount = Number(trimmed.replace(/[\s,]/g, ''));
      if (!Number.isFinite(amount)) return UNSHAPEABLE;
      const [currency, period] = (kind.unit ?? '/').split('/');
      // `basis: 'gross'` because the prompt asks for gross pay and the thresholds are gross. It is
      // stated rather than left off so the evaluator's unit check has something to compare.
      return { amount, currency, period, basis: 'gross' };
    }

    case 'string':
    case 'enum':
      return trimmed;

    case 'date':
      return trimmed;

    default:
      // A kind this build does not know how to shape. Refused rather than sent as text and hoped
      // over — the server would refuse it too, and saying so here is the honest order.
      return UNSHAPEABLE;
  }
}

/**
 * The viability half (ADR-0022).
 *
 * **The headline is driven by the binding constraint, not by the eligibility status.** That is the
 * whole point: `met` with 13% readiness and `met` with 91% readiness are the same eligibility
 * verdict and completely different situations, and leading with "you meet the requirements" for
 * both is the misleading output the ADR was written to remove.
 */

export type BindingConstraint =
  | 'eligibility'
  | 'employability'
  | 'recognition'
  | 'unmodelled'
  | 'none';

export interface ReadinessView {
  /** The band, as a percentage range. Never a single figure — the width is the point. */
  readonly low: number;
  readonly high: number;
  /** How many requirements still stand between the person and the work. */
  readonly missing: number;
}

export type ViabilityViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean }
  /**
   * Readiness could not be computed, so no pair exists. Deliberately its own state rather than
   * falling back to eligibility alone — that fallback is exactly what ADR-0022 removed.
   */
  | { readonly kind: 'no-employability'; readonly reason: string }
  | {
      readonly kind: 'viability';
      readonly headline: string;
      /** What currently stops this being worth pursuing, in the service's own words. */
      readonly bindingReason: string;
      readonly binding: BindingConstraint;
      readonly eligibility: EligibilityViewState & { readonly kind: 'verdict' };
      /** Absent when readiness could not be scored. */
      readonly readiness: ReadinessView | null;
      readonly questions: readonly AnswerableQuestion[];
      readonly asOf: string;
      readonly disclaimer: string;
    };

/**
 * The headline for each binding constraint.
 *
 * Every one of these is a different sentence on purpose. Collapsing them would put the reader back
 * where they started: unable to tell "we have not asked you something" from "you are not ready"
 * from "we have no rules for this".
 */
function headlineForBinding(binding: BindingConstraint): string {
  switch (binding) {
    case 'none':
      return 'This looks worth pursuing';
    case 'employability':
      // Not "you are not eligible" and not "you are unqualified". The requirements are met; the
      // distance is to the work itself.
      return 'You qualify — the gap is readiness, not the rules';
    case 'eligibility':
      return 'The rules are what stand in the way right now';
    case 'recognition':
      return 'We cannot answer this without your profession’s recognition rules';
    default:
      return 'We have not sourced the rules for this route yet';
  }
}

export interface ViabilityWire {
  readonly binding: BindingConstraint;
  readonly binding_reason: string;
  readonly eligibility: EligibilityResponseWire;
  readonly employability: {
    readonly score_low: number | null;
    readonly score_high: number | null;
    readonly missing_count: number;
  };
  readonly as_of: string;
  readonly disclaimer: string;
}

export function toViabilityView(
  wire: ViabilityWire,
  catalogue: FactCatalogue = {},
): ViabilityViewState {
  const eligibility = toEligibilityView(wire.eligibility, catalogue);
  // `toEligibilityView` only ever returns a verdict; the narrowing keeps the union honest.
  if (eligibility.kind !== 'verdict') return { kind: 'error', message: 'Unreadable verdict.', retryable: false };

  const { score_low: low, score_high: high, missing_count: missing } = wire.employability;

  return {
    kind: 'viability',
    headline: headlineForBinding(wire.binding),
    bindingReason: wire.binding_reason,
    binding: wire.binding,
    eligibility,
    readiness:
      low === null || high === null
        ? null
        : { low: Math.round(low * 100), high: Math.round(high * 100), missing },
    // Questions still come from the eligibility half — those are the inputs that move a verdict.
    questions: eligibility.questions,
    asOf: wire.as_of,
    disclaimer: wire.disclaimer,
  };
}
