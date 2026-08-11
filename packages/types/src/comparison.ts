/**
 * Four destinations and a fifth thing, compared honestly (ADR-0026, ADR-0028).
 *
 * ## What is deliberately absent
 *
 * **There is no score field, and adding one means changing an ADR first.** ADR-0026 rejected a
 * composite outright and forbade its return as a default, a temporary implementation, or a fallback
 * — because a composite would rank a destination lower for having a rule we have not ingested yet,
 * which measures our coverage and presents it as the world.
 *
 * There is also no rank, no position, and no ordering key. Destinations are **grouped** by the
 * binding constraint ADR-0022 already computes, and **within a group nothing is ordered by
 * anything** — the order is alphabetical and the surface says so. An arbitrary order that admits it
 * is honest; a plausible order nobody can explain is not.
 *
 * ## The four states a cell can be in, and why they cannot collapse
 *
 * | State | Means | Says something about |
 * |---|---|---|
 * | `met` / `not_met` | evaluated against this person's facts | the person |
 * | `undetermined` | the rule needs an answer or a judgement nobody has made yet | the question |
 * | `unmodelled` | nothing is ingested for this destination | **Zentavio** |
 * | `not_applicable` | the dimension does not apply here | **the destination** |
 *
 * The last two look identical in a table and mean opposite things. Switzerland produces a great
 * deal of `undetermined` because most of its conditions are an authority's judgement; `REMOTE`
 * produces `not_applicable` because it has no immigration rules to satisfy. **Neither is a
 * failure, and neither may become a number or a worse position.**
 */

import type { BindingConstraint } from './requirement.ts';

/**
 * Whether this destination is a country.
 *
 * `REMOTE` is **not** one (ADR-0028) — no jurisdiction, no pathway, and never a `remote.*` row in
 * `immigration_pathways`. Carried explicitly so a surface can tell the difference without inferring
 * it from a missing pathway, which is how a missing thing gets mistaken for an absent one.
 */
export type DestinationClass = 'country' | 'remote';

/** ADR-0026's closed set. A sixth member is a type error rather than a string nobody notices. */
export type ComparisonCellState =
  | 'met'
  | 'not_met'
  | 'undetermined'
  | 'unmodelled'
  | 'not_applicable';

export interface ComparisonCell {
  /** What is being compared — `eligibility`, `employability`, `time-zone-overlap`. */
  readonly dimension: string;
  readonly state: ComparisonCellState;
  /**
   * Why the cell is in that state, in a sentence.
   *
   * **Required for `unmodelled` and `not_applicable`**, because those are the two that look alike
   * and mean opposite things: *"we have ingested nothing for New Zealand's cost of living"* against
   * *"remote work has no visa"*. A surface rendering both as blank has said the same thing twice
   * about two different situations.
   */
  readonly detail: string | null;
  /** The rules behind this cell, so the comparison is explainable factor by factor. */
  readonly requirementIds: readonly string[];
  /** What answering would move it. Empty unless the state is `undetermined`. */
  readonly needsFromUser: readonly string[];
}

/**
 * A cap on the destination, where one exists (ADR-0027).
 *
 * **Not a cell.** A quota is a property of the pathway, not a dimension a person is evaluated on,
 * so it sits beside the cells rather than among them — otherwise the surface would have to give it
 * a state, and no state is true of it.
 */
export interface ComparisonQuota {
  readonly allocatedBy: string;
  readonly period: string;
  /** `null` means **capped and unsourced** — never uncapped. The surface must say which. */
  readonly places: number | null;
  readonly unsourcedReason: string | null;
}

export interface DestinationComparison {
  /** `DE`, `LU`, `NZ`, `CH`, `REMOTE`. */
  readonly destination: string;
  readonly name: string;
  readonly class: DestinationClass;
  /** Null for `REMOTE`, which has no pathway and never gains one. */
  readonly pathwayId: string | null;
  /**
   * Which axis stands in the way, from ADR-0022's closed set.
   *
   * `REMOTE` draws from a **subset**: `employability` or `none` can bind; `eligibility` and
   * `unmodelled` never can, because there are no rules to fail and none to be missing.
   */
  readonly binding: BindingConstraint;
  readonly bindingReason: string;
  readonly cells: readonly ComparisonCell[];
  /** Present only where the destination is capped. */
  readonly quota: ComparisonQuota | null;
}

/**
 * Destinations sharing a binding constraint.
 *
 * **The group order is a statement about what stands in the way, not about which destination is
 * better** — `none` first because nothing blocks it, `unmodelled` last because we have nothing to
 * say. It is not a ranking and the surface must not present it as one.
 */
export interface ComparisonGroup {
  readonly binding: BindingConstraint;
  /** What this group means, in words. Never a bare constraint name. */
  readonly label: string;
  /** **Alphabetical by destination code, and arbitrary.** See `orderingNote`. */
  readonly destinations: readonly DestinationComparison[];
}

export interface ComparisonWire {
  readonly groups: readonly ComparisonGroup[];
  /** Shared by every destination. A comparison mixing dates compares nothing. */
  readonly asOf: string;
  /** Emitted verbatim, as every eligibility answer is. */
  readonly disclaimer: string;
  /**
   * Stated on the wire rather than left to the surface to remember.
   *
   * The one sentence that keeps an arbitrary order honest — a reader assumes a list is ranked
   * unless told otherwise, and telling them is cheaper than a ranking we cannot justify.
   */
  readonly orderingNote: string;
}

/**
 * The order groups appear in.
 *
 * Fixed here rather than derived, so it cannot drift into something that looks like a score. Read
 * it as *what stands in the way*, in the order a person can act on: nothing, then the gap that is
 * theirs to close, then the rules, then what needs somebody else, then what we have not modelled.
 */
export const GROUP_ORDER: readonly BindingConstraint[] = [
  'none',
  'employability',
  'eligibility',
  'recognition',
  'unmodelled',
];

/** What each group says, in words a person can read. Never a bare constraint name. */
export const GROUP_LABELS: Readonly<Record<BindingConstraint, string>> = {
  none: 'Nothing we can check stands in the way',
  employability: 'You qualify — the distance is to the work itself',
  eligibility: 'The rules are what stand in the way',
  recognition: 'Your profession’s recognition rules decide this, and we have not sourced them',
  unmodelled: 'We have not modelled this destination yet',
};

/**
 * The sentence that keeps the ordering honest.
 *
 * Exported as a constant so one wording is used everywhere and a reviewer can grep for it.
 */
export const ORDERING_NOTE =
  'Destinations within a group are listed alphabetically. That order carries no meaning — nothing ' +
  'here ranks one destination above another, because the comparison has no basis for it.';
