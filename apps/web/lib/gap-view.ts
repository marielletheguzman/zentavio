/**
 * Turning a gap response into what the screen must show.
 *
 * Pure and separate from the component, for the same reason as `parse-view.ts`: every async surface
 * must have **all** its states designed before the success state is styled
 * (`.claude/context/ui-guidelines.md`), and states living inside JSX get tested by clicking. These
 * get tested by asserting.
 *
 * Two rules this file exists to hold:
 *
 * 1. **`no_gap` is not an empty list.** Rendering "you meet every requirement" as zero rows reads
 *    as a loading bug, and `docs/features/skill-gap-analysis.md` is explicit that a bare "you're a
 *    great fit!" is a failure. It gets its own state and its own sentence.
 * 2. **Every item says why it is a gap and why it sits where it does.** A gap the user cannot
 *    interpret is a gap they will not close.
 */

import type { GapItemWire, GapResponseWire, ReadinessWire } from '@zentavio/types';

export type GapViewState =
  /** No track chosen yet. Not an error — they have not answered the question. */
  | { readonly kind: 'no-target'; readonly reason: string }
  /** No parsed profile. Every requirement would read as missing, which is true and useless. */
  | { readonly kind: 'no-profile'; readonly reason: string }
  /** In flight. A skeleton matching the final list, never a spinner in a void. */
  | { readonly kind: 'loading' }
  /** The request failed — not the answer. `retryable` comes from the contract, never guessed. */
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean }
  /** Nobody has modelled this target. Named, never a generic empty gap. */
  | { readonly kind: 'unknown'; readonly reason: string; readonly missing: readonly string[] }
  /** Every modelled requirement is met. Said plainly, with what was checked. */
  | {
      readonly kind: 'no-gap';
      readonly reason: string;
      readonly held: readonly string[];
      readonly confidence: ConfidenceView;
    }
  /** The gap, in dependency order. */
  | {
      readonly kind: 'gap';
      readonly readiness: ReadinessView;
      readonly items: readonly GapItemView[];
      readonly confidence: ConfidenceView;
      readonly missing: readonly string[];
      readonly unweighted: readonly string[];
      readonly summary: string;
      readonly scorerVersion: string;
    };

/**
 * The readiness number, or an honest refusal to give one.
 *
 * `percent` is `null` whenever the score is — and the surface must render the refusal rather than
 * a `0%`, because "we cannot tell" and "you are not ready" are opposite statements that look
 * identical as an empty progress bar.
 */
export interface ReadinessView {
  readonly known: boolean;
  /** 0..100, rounded. Null when the score is unknown. */
  readonly percent: number | null;
  /**
   * The floor and ceiling as whole percents, and the sentence that explains them.
   *
   * `null` when the band has no width — every held skill was evidenced, so nothing is being
   * estimated and a range would imply doubt that does not exist.
   */
  readonly band: ReadinessBandView | null;
  /** Per cluster, strongest driver of the number first. */
  readonly clusters: readonly ClusterView[];
  readonly confidence: ConfidenceView;
  /** Why there is no number, when there is none. */
  readonly reason: string | null;
  /** What the number does not account for. Shown beside it, never buried. */
  readonly caveats: readonly string[];
  /** Why there is no timeline. Never an invented one. */
  readonly timeBasis: string;
  /** How many requirements are still open — the remainder, in one word. */
  readonly remainingCount: number;
  readonly scorerVersion: string;
}

export interface ReadinessBandView {
  readonly lowPercent: number;
  readonly highPercent: number;
  readonly label: string;
}

export interface ClusterView {
  readonly cluster: string;
  readonly label: string;
  readonly percent: number;
  /** How much of the whole number this cluster accounts for. */
  readonly sharePercent: number;
  readonly requirementCount: number;
}

export interface ConfidenceView {
  readonly level: 'high' | 'medium' | 'low';
  /**
   * Words, not only a colour or a tint.
   *
   * `.claude/context/ui-guidelines.md`: low confidence must look **visibly different**, and nothing
   * may be conveyed by colour alone.
   */
  readonly label: string;
}

export interface GapItemView {
  readonly skillId: string;
  readonly label: string;
  readonly position: number;
  readonly cluster: GapItemWire['cluster'];
  /** Why this matters, in words. Never a bare number the user must interpret. */
  readonly importance: string;
  /**
   * Why it sits here. Empty when nothing blocks it, which is itself worth saying — "you can start
   * this now" is the most actionable sentence on the screen.
   */
  readonly blockedBy: readonly string[];
  /** Partial credit, when a held skill carries over. Never closes the gap. */
  readonly partial: PartialView | null;
  /** True when the requirement is known but its weight is not. Listed, never defaulted. */
  readonly unweighted: boolean;
}

export interface PartialView {
  readonly fraction: number;
  readonly from: string;
  /** "Docker carries about 80% of the way here" — the claim and its source, checkable. */
  readonly label: string;
}

const CONFIDENCE_LABEL: Record<ConfidenceView['level'], string> = {
  high: 'Confident',
  medium: 'Fairly confident',
  low: 'Low confidence',
};

/**
 * Words for a weight, because a bare 0.92 is not a sentence.
 *
 * Bands rather than percentages: the weight is an importance from knowledge, not a probability, and
 * showing "92%" invites reading it as one. The cluster is the honest vocabulary — it is what the
 * knowledge actually records.
 */
const CLUSTER_LABEL: Record<GapItemWire['cluster'], string> = {
  core: 'Core to this track',
  supporting: 'Supporting skill',
  differentiating: 'Sets candidates apart',
  peripheral: 'Occasionally asked for',
};

export function confidenceView(level: ConfidenceView['level']): ConfidenceView {
  return { level, label: CONFIDENCE_LABEL[level] };
}

const CLUSTER_HEADING: Record<string, string> = {
  core: 'Core',
  supporting: 'Supporting',
  differentiating: 'Differentiating',
  peripheral: 'Peripheral',
};

function bandView(readiness: ReadinessWire): ReadinessBandView | null {
  const { score_low: low, score_high: high } = readiness;
  if (low === null || high === null) return null;

  const lowPercent = Math.round(low * 100);
  const highPercent = Math.round(high * 100);
  // No width means nothing is being estimated — every held skill was evidenced. Showing "62% to
  // 62%" would imply a doubt that does not exist.
  if (lowPercent === highPercent) return null;

  return {
    lowPercent,
    highPercent,
    label: `between ${String(lowPercent)}% and ${String(highPercent)}%, depending on whether your listed and transferred skills hold up`,
  };
}

export function readinessView(readiness: ReadinessWire): ReadinessView {
  return {
    band: bandView(readiness),
    clusters: readiness.by_cluster.map((entry) => ({
      cluster: entry.cluster,
      label: CLUSTER_HEADING[entry.cluster] ?? entry.cluster,
      percent: Math.round(entry.score * 100),
      sharePercent: Math.round(entry.weight_share * 100),
      requirementCount: entry.requirement_count,
    })),
    known: readiness.status === 'ok' && readiness.score !== null,
    // Rounded to a whole percent on purpose. `0.6187` implies a precision the inputs do not have —
    // the weights behind it are curated at tier 3.
    percent: readiness.score === null ? null : Math.round(readiness.score * 100),
    confidence: confidenceView(readiness.confidence),
    reason: readiness.reason,
    caveats: readiness.missing,
    timeBasis: readiness.time_to_ready_basis,
    remainingCount: readiness.remaining.length,
    scorerVersion: readiness.scorer_version,
  };
}

function partialView(item: GapItemWire): PartialView | null {
  if (item.partial === null || item.partial_from === null) return null;
  const percent = Math.round(item.partial * 100);
  return {
    fraction: item.partial,
    from: item.partial_from,
    // Deliberately hedged — "about", and "some of the way". The edge weight says how much
    // competence transfers in general, not how much transferred for this person, and stating it as
    // a precise personal fact would be a claim the graph cannot support.
    label: `${item.partial_from} covers some of this — about ${String(percent)}%`,
  };
}

function toItemView(item: GapItemWire): GapItemView {
  return {
    skillId: item.skill_id,
    // Slugs are stable identifiers, not display text. Until the API returns a display name the slug
    // is shown as-is — inventing "Ci Cd" from `ci-cd` would be worse than showing `ci-cd`.
    label: item.skill_id,
    position: item.position,
    cluster: item.cluster,
    importance: CLUSTER_LABEL[item.cluster],
    blockedBy: item.prerequisites,
    partial: partialView(item),
    unweighted: item.weight === null,
  };
}

/**
 * The sentence under the heading.
 *
 * Never a bare count. "27 gaps" reads as a verdict on a person, which
 * `.claude/context/career-philosophy.md` rejects — how many can be started *now* is the useful
 * number, because it is the one they can act on today.
 */
export function summaryFor(items: readonly GapItemView[]): string {
  if (items.length === 0) return 'Nothing is missing.';

  const startable = items.filter((item) => item.blockedBy.length === 0).length;
  const core = items.filter((item) => item.cluster === 'core').length;

  const parts = [`${String(startable)} you can start now`];
  if (core > 0) parts.push(`${String(core)} core to the track`);
  return parts.join(', ');
}

/** The gateway's `GET /v1/gap` body. */
export type GapBody =
  | { readonly status: 'gap'; readonly gap: GapResponseWire }
  | { readonly status: 'no-target'; readonly reason: string }
  | { readonly status: 'no-profile'; readonly reason: string };

export function gapViewStateFor(body: GapBody): GapViewState {
  if (body.status === 'no-target') {
    return { kind: 'no-target', reason: body.reason };
  }
  if (body.status === 'no-profile') {
    return { kind: 'no-profile', reason: body.reason };
  }

  const gap = body.gap;

  if (gap.status === 'unknown') {
    return {
      kind: 'unknown',
      // The contract guard rejects a non-ok status with no reason, so the fallback exists only so a
      // contract break degrades to a vague message rather than an empty panel.
      reason: gap.reason ?? 'This track has not been modelled yet.',
      missing: gap.missing,
    };
  }

  if (gap.status === 'no_gap') {
    return {
      kind: 'no-gap',
      reason: gap.reason ?? 'You already meet every modelled requirement for this track.',
      held: gap.held.map((entry) => entry.skill_id),
      confidence: confidenceView(gap.confidence),
    };
  }

  const items = gap.items.map(toItemView);
  return {
    kind: 'gap',
    readiness: readinessView(gap.readiness),
    items,
    confidence: confidenceView(gap.confidence),
    missing: gap.missing,
    unweighted: gap.unweighted,
    summary: summaryFor(items),
    // Shown, not hidden: a number whose scorer is unknown cannot be re-examined after a bug, and
    // the person looking at it is entitled to know what produced it.
    scorerVersion: gap.scorer_version,
  };
}
