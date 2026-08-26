/**
 * The status chip: the one place a state becomes something visible.
 *
 * Six states, and the reason there are six rather than three is the product itself. A comparison
 * cell that is grey can mean **we have not sourced this** or **there is nothing here to satisfy**,
 * and those are opposite claims — one is a statement about Zentavio, the other about the
 * destination. ADR-0026 and ADR-0028 exist because collapsing them is the failure mode.
 *
 * The mapping itself lives in `status-tones.ts`, with no JSX in it, so the rule it encodes is
 * testable without rendering — see that file and `status.test.ts`.
 *
 * The icons are drawn here rather than installed. `.claude/context/ui-guidelines.md` asks for one
 * line-icon set at one stroke weight, and no icon package is approved — a dependency for six glyphs
 * would be the kind of stack growth ADR-0023 warns arrives one small package at a time. They are
 * `aria-hidden` because the label beside them already says it.
 */

import { cx } from './cx.ts';
import { toneChip, toneIcon, toneMeaning, type StatusTone, type ToneIcon } from './status-tones.ts';

export { toneEdge, toneMeaning, type StatusTone } from './status-tones.ts';

/** Stroke 2, heavier than navigation's 1.75: a status is a claim, navigation is chrome. */
function Glyph({ icon }: { icon: ToneIcon }) {
  const shared = {
    'aria-hidden': true as const,
    className: 'size-4 shrink-0',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    viewBox: '0 0 24 24',
    xmlns: 'http://www.w3.org/2000/svg',
  };

  switch (icon) {
    case 'check':
      return (
        <svg {...shared}>
          <path d="M4 12.5 9 17.5 20 6.5" />
        </svg>
      );
    case 'cross':
      return (
        <svg {...shared}>
          <path d="M6 6 18 18M18 6 6 18" />
        </svg>
      );
    case 'question':
      return (
        <svg {...shared}>
          <path d="M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .9-1 1.7v.5" />
          <path d="M12 17.5v.5" />
        </svg>
      );
    case 'gap':
      // An open circle: the shape of something absent, matched to the dotted border it sits in.
      return (
        <svg {...shared} strokeDasharray="3 3">
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case 'dash':
      return (
        <svg {...shared}>
          <path d="M6 12h12" />
        </svg>
      );
    case 'tilde':
      return (
        <svg {...shared}>
          <path d="M4 14c2.5-4 5-4 8 0s5.5 4 8 0" />
        </svg>
      );
  }
}

/**
 * A status chip.
 *
 * `label` is required and has no default, on purpose: a default would let a caller ship a chip
 * whose only content is a colour, which is the thing this component exists to prevent.
 */
export function StatusBadge({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label: string;
  className?: string | undefined;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-pill border px-3 py-1 text-sm font-medium',
        toneChip(tone),
        className,
      )}
    >
      <Glyph icon={toneIcon(tone)} />
      {label}
      {/* The meaning a sighted reader gets from the colour and the shape, in words. */}
      <span className="sr-only"> — {toneMeaning(tone)}</span>
    </span>
  );
}
