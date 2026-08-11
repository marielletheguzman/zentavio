/**
 * Composing per-destination verdicts into a comparison (ADR-0026, ADR-0028).
 *
 * **Pure, and it computes nothing new.** Every value here comes from a verdict that already exists:
 * the eligibility result, the readiness band, the binding constraint ADR-0022 already names. This
 * module rearranges; it does not decide. If a number ever appears in it that was not in an input,
 * something has gone wrong.
 *
 * ## What it must not do, restated where the mistake would be made
 *
 * **No score, no rank, no ordering key.** Grouping is by binding constraint, in a fixed order that
 * says *what stands in the way* rather than *which is better*. Within a group the order is
 * alphabetical, arbitrary, and declared as arbitrary on the wire — a reader assumes a list is
 * ranked unless told otherwise.
 *
 * **No collapsing of states.** `unmodelled` is about Zentavio; `not_applicable` is about the
 * destination; `undetermined` is about a question nobody has answered. They look alike in a table
 * and mean different things, and a destination is never positioned worse for any of them.
 */

import type {
  BindingConstraint,
  ComparisonCell,
  ComparisonGroup,
  ComparisonQuota,
  ComparisonWire,
  DestinationClass,
  DestinationComparison,
  EligibilityResponseWire,
} from '@zentavio/types';
import { GROUP_LABELS, GROUP_ORDER, ORDERING_NOTE } from '@zentavio/types';

/** One destination's inputs, as the gateway has already computed them. */
export interface DestinationInput {
  readonly destination: string;
  readonly name: string;
  readonly class: DestinationClass;
  readonly pathwayId: string | null;
  /** Absent for `REMOTE`, which has no pathway to evaluate (ADR-0028). */
  readonly eligibility: EligibilityResponseWire | null;
  readonly binding: BindingConstraint;
  readonly bindingReason: string;
  /** The readiness half, shared across destinations — it has no jurisdiction in it. */
  readonly employability: EmployabilityInput;
  readonly quota: ComparisonQuota | null;
  /** Dimensions this destination declares but nobody has sourced, with the reason why. */
  readonly unsourced?: readonly { readonly dimension: string; readonly reason: string }[];
}

export interface EmployabilityInput {
  readonly status: 'ok' | 'no_gap' | 'unknown';
  readonly missingCount: number;
  readonly reason: string | null;
}

/**
 * The eligibility cell for one destination.
 *
 * **`REMOTE` is `not_applicable`, and that is a fact about `REMOTE`** (ADR-0028) — never `unknown`
 * or `unmodelled`, which would claim we failed to source something that does not exist. A country
 * with no ingested rules is `unmodelled`, which is a claim about us. The two must not be produced
 * by the same branch, so they are not.
 */
function eligibilityCell(input: DestinationInput): ComparisonCell {
  if (input.class === 'remote') {
    return {
      dimension: 'eligibility',
      state: 'not_applicable',
      detail:
        'Remote work has no immigration pathway, so there is nothing here to be eligible for. ' +
        'This is a property of remote work rather than a gap in what we have sourced.',
      requirementIds: [],
      needsFromUser: [],
    };
  }

  const verdict = input.eligibility;
  if (verdict === null || verdict.requirements.length === 0) {
    return {
      dimension: 'eligibility',
      state: 'unmodelled',
      detail: 'We have not ingested any rule for this destination yet.',
      requirementIds: [],
      needsFromUser: [],
    };
  }

  return {
    dimension: 'eligibility',
    // Passed through, never recomputed. `unknown` at the pathway level means nothing is on file,
    // which is the same statement `unmodelled` makes about a cell.
    state: verdict.status === 'unknown' ? 'unmodelled' : verdict.status,
    detail: verdict.notes[0] ?? null,
    requirementIds: verdict.requirements.map((requirement) => requirement.requirement_id),
    needsFromUser: verdict.status === 'undetermined' ? verdict.needs_from_user : [],
  };
}

/**
 * The employability cell.
 *
 * **Identical for every destination, including `REMOTE`** — readiness against a career track has no
 * jurisdiction in it. For a person with no profile it is `unmodelled` everywhere at once, which is
 * honest: the gap is ours, and it is the same gap five times.
 */
function employabilityCell(input: DestinationInput): ComparisonCell {
  const { status, missingCount, reason } = input.employability;

  if (status === 'unknown') {
    return {
      dimension: 'employability',
      state: 'unmodelled',
      detail: reason ?? 'Readiness could not be computed.',
      requirementIds: [],
      needsFromUser: [],
    };
  }

  return {
    dimension: 'employability',
    state: status === 'no_gap' ? 'met' : 'not_met',
    detail:
      status === 'no_gap'
        ? 'Nothing on this track is missing from your profile.'
        : `${String(missingCount)} requirement(s) still stand between you and the work.`,
    requirementIds: [],
    needsFromUser: [],
  };
}

/**
 * Dimensions a destination declares and nobody has sourced.
 *
 * They carry **why**, because *"nobody publishes this because there is no authority"* and *"we have
 * not got to it yet"* are different sentences, and only the second is a to-do.
 */
function unsourcedCells(input: DestinationInput): readonly ComparisonCell[] {
  return (input.unsourced ?? []).map((dimension) => ({
    dimension: dimension.dimension,
    state: 'unmodelled' as const,
    detail: dimension.reason,
    requirementIds: [],
    needsFromUser: [],
  }));
}

function toDestination(input: DestinationInput): DestinationComparison {
  return {
    destination: input.destination,
    name: input.name,
    class: input.class,
    pathwayId: input.pathwayId,
    binding: input.binding,
    bindingReason: input.bindingReason,
    cells: [eligibilityCell(input), employabilityCell(input), ...unsourcedCells(input)],
    quota: input.quota,
  };
}

/**
 * Group the destinations, and order nothing within a group.
 *
 * `asOf` is required and shared: a comparison whose destinations were evaluated on different dates
 * compares nothing, and the responsibility for supplying one date belongs to the caller that
 * computed them.
 */
export function composeComparison(
  inputs: readonly DestinationInput[],
  asOf: string,
  disclaimer: string,
): ComparisonWire {
  const byBinding = new Map<BindingConstraint, DestinationComparison[]>();

  for (const input of inputs) {
    const destination = toDestination(input);
    const existing = byBinding.get(input.binding);
    if (existing === undefined) byBinding.set(input.binding, [destination]);
    else existing.push(destination);
  }

  const groups: ComparisonGroup[] = [];
  for (const binding of GROUP_ORDER) {
    const destinations = byBinding.get(binding);
    if (destinations === undefined || destinations.length === 0) continue;

    groups.push({
      binding,
      label: GROUP_LABELS[binding],
      // **Alphabetical, and that is the whole ordering rule.** Sorting by anything derived — how
      // many cells are `met`, how much is known — would be a ranking arrived at sideways, and
      // "more known data" is a fact about our coverage rather than about the destination.
      destinations: [...destinations].sort((left, right) =>
        left.destination.localeCompare(right.destination),
      ),
    });
  }

  return { groups, asOf, disclaimer, orderingNote: ORDERING_NOTE };
}
