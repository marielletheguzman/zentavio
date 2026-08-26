/**
 * The state → treatment table, kept in a `.ts` file with no JSX in it.
 *
 * Same split `apps/web/lib/README.md` describes and for the same reason: *"that is what makes the
 * state machine assertable instead of clickable."* The mapping below is the part that carries a
 * product rule — that `unmodelled` and `not_applicable` never become distinguishable by hue alone —
 * so it lives where a test can read it without rendering anything.
 *
 * ## Three signals, never one
 *
 * `.claude/context/ui-guidelines.md` requires that nothing rest on hue, and `packages/ui`'s README
 * calls the paler-tint version of low confidence a **correctness bug** rather than a styling
 * preference. Every state below differs from every other in all three of:
 *
 * | signal | why it is not enough alone |
 * |---|---|
 * | **colour** | invisible to a colour-blind reader, and gone in a printout |
 * | **border style** | invisible to a screen reader |
 * | **word** | the one that survives both, which is why `meaning` is not optional |
 */

/**
 * The vocabulary. These are the wire's own state names, not display categories — a view model maps
 * a response onto them and nothing invents a seventh.
 */
export type StatusTone =
  | 'met'
  | 'not_met'
  | 'undetermined'
  | 'unmodelled'
  | 'not_applicable'
  | 'low_confidence';

export type ToneIcon = 'check' | 'cross' | 'question' | 'gap' | 'dash' | 'tilde';

type ToneSpec = {
  /** Border colour, text colour, and the border *style* that carries the same meaning again. */
  readonly chip: string;
  /** The left edge a card or list row takes to show the same state at a glance. */
  readonly edge: string;
  readonly icon: ToneIcon;
  /** Read by a screen reader in place of the icon, where the label alone would be ambiguous. */
  readonly meaning: string;
};

const TONES: Record<StatusTone, ToneSpec> = {
  met: {
    chip: 'border-solid border-positive text-positive',
    edge: 'border-l-4 border-l-positive border-solid',
    icon: 'check',
    meaning: 'satisfied',
  },
  not_met: {
    chip: 'border-solid border-negative text-negative',
    edge: 'border-l-4 border-l-negative border-solid',
    icon: 'cross',
    meaning: 'not satisfied',
  },
  /*
   * Dashed everywhere in this product, and never a paler solid. "We have not established this" is
   * a different claim from "this is decided", not a quieter version of one.
   */
  undetermined: {
    chip: 'border-dashed border-caution text-caution',
    edge: 'border-l-4 border-l-caution border-dashed',
    icon: 'question',
    meaning: 'waiting on an answer from you',
  },
  /*
   * Dotted, and the only state with a colour of its own added in this pass. It is a statement about
   * **us** — the card is what is incomplete, not the place it describes — so it is marked
   * differently from anything describing the person or the destination.
   */
  unmodelled: {
    chip: 'border-dotted border-product-gap text-product-gap',
    edge: 'border-l-4 border-l-product-gap border-dotted',
    icon: 'gap',
    meaning: 'Zentavio has not sourced this yet',
  },
  /*
   * No accent at all, and deliberately not the dotted treatment above: that one says we owe you
   * data, and this one says there is none to owe. Nothing is missing here.
   */
  not_applicable: {
    chip: 'border-solid border-border text-ink-muted',
    edge: 'border-l-4 border-l-border border-solid',
    icon: 'dash',
    meaning: 'does not apply here',
  },
  low_confidence: {
    chip: 'border-dashed border-caution text-caution',
    edge: 'border-l-4 border-l-caution border-dashed',
    icon: 'tilde',
    meaning: 'we are less sure this is true',
  },
};

export const ALL_TONES: readonly StatusTone[] = Object.keys(TONES) as StatusTone[];

/** Border and text classes for a chip. */
export function toneChip(tone: StatusTone): string {
  return TONES[tone].chip;
}

/** The same state as a left edge, for a row or card that carries its status structurally. */
export function toneEdge(tone: StatusTone): string {
  return TONES[tone].edge;
}

export function toneIcon(tone: StatusTone): ToneIcon {
  return TONES[tone].icon;
}

/** What the tone means, in words — for callers writing their own prose around a state. */
export function toneMeaning(tone: StatusTone): string {
  return TONES[tone].meaning;
}
