/**
 * Turning a comparison into what the screen must show (ADR-0026, ADR-0027, ADR-0028).
 *
 * Pure and separate from the component, like every other view file here — but this one carries the
 * distinction the whole milestone rests on, and it is a distinction that dies in markup:
 *
 * **Five cell states, and four of them are statements about different subjects.**
 *
 * | State | The sentence it makes | About |
 * |---|---|---|
 * | `met` / `not_met` | you satisfy this, or you do not | **you** |
 * | `undetermined` | nobody has answered this yet | **the question** |
 * | `unmodelled` | we have not sourced this | **Zentavio** |
 * | `not_applicable` | this does not apply here | **the destination** |
 *
 * The last two look identical in a table — both are empty-ish — and they mean opposite things. So
 * every cell carries an explicit `attribution`, and the label says whose gap it is in words. Two
 * cells that differ only in colour have said the same thing twice.
 *
 * **Nothing here ranks.** No score, no position, no "best". The wire has no such field and this
 * file adds none; groups are rendered in the order they arrive, and the wire's own sentence saying
 * the within-group order is arbitrary is rendered rather than paraphrased.
 */

import type {
  ComparisonCell,
  ComparisonCellState,
  ComparisonGroup,
  ComparisonQuota,
  ComparisonWire,
  DestinationComparison,
} from '@zentavio/types';

/**
 * Who a cell's state is a statement about.
 *
 * Carried explicitly rather than inferred from the state, because inference is what collapses
 * `unmodelled` and `not_applicable` back together the first time somebody writes
 * `state === 'met' ? … : …`.
 */
export type CellAttribution = 'you' | 'the question' | 'Zentavio' | 'the destination';

export interface CellView {
  readonly dimension: string;
  /** What the dimension is called on screen. Falls back to the raw key rather than inventing one. */
  readonly heading: string;
  readonly state: ComparisonCellState;
  /** What the screen says. **Never a bare status word**, and never the same words twice. */
  readonly label: string;
  readonly attribution: CellAttribution;
  readonly detail: string | null;
  readonly questions: readonly string[];
  readonly requirementIds: readonly string[];
}

export interface QuotaView {
  /** The heading. Always says the pathway is capped — that part is never in doubt. */
  readonly headline: string;
  /**
   * The number, or the sentence that it could not be read.
   *
   * **`null` places never render as "no cap"** (ADR-0027). A capped pathway whose figure we could
   * not source is still capped, and telling somebody it is open is the one wrong answer here.
   */
  readonly places: string;
  readonly allocatedBy: string;
  readonly period: string;
  /** Why the figure is missing, when it is. Absent when the figure is known. */
  readonly unsourcedReason: string | null;
}

export interface DestinationView {
  readonly destination: string;
  readonly name: string;
  /** `true` for `REMOTE`, so the surface can mark it as a different kind of thing (ADR-0028). */
  readonly isRemote: boolean;
  readonly bindingReason: string;
  readonly cells: readonly CellView[];
  readonly quota: QuotaView | null;
}

export interface GroupView {
  readonly binding: string;
  readonly label: string;
  readonly destinations: readonly DestinationView[];
}

export type ComparisonViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  /** The request failed — not an answer about any destination. */
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean }
  /**
   * No track chosen, or no profile.
   *
   * Its own state rather than an error, because every destination would otherwise render the same
   * empty readiness and the screen would look like five separate gaps instead of one.
   */
  | { readonly kind: 'no-employability'; readonly headline: string; readonly explanation: string }
  | {
      readonly kind: 'comparison';
      readonly groups: readonly GroupView[];
      readonly asOf: string;
      readonly disclaimer: string;
      /** Rendered verbatim from the wire. Not paraphrased, not summarised, not omitted. */
      readonly orderingNote: string;
    };

/**
 * Dimension headings.
 *
 * A dimension the surface has no name for renders as its key rather than as a guess — the same rule
 * the eligibility panel follows for route ids. An unknown key is a data question, and a plausible
 * heading would hide it.
 */
const DIMENSION_HEADINGS: Readonly<Record<string, string>> = {
  eligibility: 'The rules',
  employability: 'Your readiness',
  'employer-policy': 'Whether the role can be remote',
  'time-zone-overlap': 'Time-zone overlap',
  'contracting-and-tax': 'Contracting and tax',
  'payment-mechanics': 'Getting paid',
};

/**
 * What each state says, in words, and whose statement it is.
 *
 * **`unmodelled` and `not_applicable` differ in every field**, not only in tone: different label,
 * different attribution, and each detail sentence comes from the wire. ADR-0028 requires the view
 * layer to prove this, and the test asserting it is the proof.
 */
function describe(
  state: ComparisonCellState,
  isRemote: boolean,
): { readonly label: string; readonly attribution: CellAttribution } {
  switch (state) {
    case 'met':
      return { label: 'Met', attribution: 'you' };

    case 'not_met':
      return { label: 'Not met', attribution: 'you' };

    case 'undetermined':
      // Never "failed" and never "no". A question nobody has answered is not an answer.
      return { label: 'Not answered yet', attribution: 'the question' };

    case 'not_applicable':
      // A fact about the destination. For `REMOTE` this is the *normal* state of the immigration
      // row, so it must not read as an apology or a gap.
      return {
        label: isRemote ? 'Does not apply to remote work' : 'Does not apply here',
        attribution: 'the destination',
      };

    default:
      // Our gap, said as ours. "Unknown" alone would let a reader hear "unknowable", and
      // "not available" would let them hear "the destination has none".
      return { label: 'We have not sourced this', attribution: 'Zentavio' };
  }
}

function toCellView(cell: ComparisonCell, isRemote: boolean): CellView {
  const { label, attribution } = describe(cell.state, isRemote);

  return {
    dimension: cell.dimension,
    heading: DIMENSION_HEADINGS[cell.dimension] ?? cell.dimension,
    state: cell.state,
    label,
    attribution,
    detail: cell.detail,
    questions: cell.needsFromUser,
    requirementIds: cell.requirementIds,
  };
}

/**
 * The cap, where one exists.
 *
 * A **null quota renders nothing at all** rather than "no cap": the column being empty means the
 * pathway was seeded without one, which is weaker than a sourced statement that the pathway is
 * uncapped. Asserting the stronger sentence from the weaker fact is the kind of quiet upgrade this
 * repository exists to avoid.
 */
export function toQuotaView(quota: ComparisonQuota | null): QuotaView | null {
  if (quota === null) return null;

  return {
    headline: 'This pathway is capped',
    places:
      quota.places === null
        ? 'The number of places is not readable from a source we are permitted to use'
        : `${quota.places.toLocaleString('en-GB')} places`,
    allocatedBy: quota.allocatedBy,
    period: quota.period,
    unsourcedReason: quota.unsourcedReason,
  };
}

function toDestinationView(destination: DestinationComparison): DestinationView {
  const isRemote = destination.class === 'remote';

  return {
    destination: destination.destination,
    name: destination.name,
    isRemote,
    bindingReason: destination.bindingReason,
    cells: destination.cells.map((cell) => toCellView(cell, isRemote)),
    quota: toQuotaView(destination.quota),
  };
}

function toGroupView(group: ComparisonGroup): GroupView {
  return {
    binding: group.binding,
    label: group.label,
    // **Rendered in the order received.** No re-sort here, deliberately: the wire's order is
    // alphabetical and declared arbitrary, and any sort added in the view would be a ranking
    // arrived at sideways.
    destinations: group.destinations.map(toDestinationView),
  };
}

export function toComparisonView(wire: ComparisonWire): ComparisonViewState {
  return {
    kind: 'comparison',
    groups: wire.groups.map(toGroupView),
    asOf: wire.asOf,
    disclaimer: wire.disclaimer,
    orderingNote: wire.orderingNote,
  };
}

/**
 * What to say when there is no readiness to compare on.
 *
 * Two different reasons, two different sentences, and neither is an error: one is a choice nobody
 * has made, the other is a file nobody has uploaded.
 */
export function toNoEmployabilityView(reason: string): ComparisonViewState {
  if (reason === 'no-target') {
    return {
      kind: 'no-employability',
      headline: 'Choose a track first',
      explanation:
        'Every destination is compared on the same two things: the rules, and how ready you are ' +
        'for the work. Readiness is measured against a track, so the comparison needs one before ' +
        'it can say anything a destination does not already say by itself.',
    };
  }

  return {
    kind: 'no-employability',
    headline: 'Upload a résumé first',
    explanation:
      'Without a profile, every destination would report the same empty readiness — which would ' +
      'look like five gaps rather than one missing file.',
  };
}
