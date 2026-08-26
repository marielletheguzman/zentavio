/**
 * Progress, which in this product is almost never a single number.
 *
 * `.claude/context/career-philosophy.md` calls a readiness score without its remainder a vanity
 * metric, and `ui-guidelines.md` requires every score to carry its confidence. So `ReadinessBand`
 * renders a **range** and refuses to render anything at all when there is no number — an empty bar
 * says "you are at zero" while meaning "we cannot tell", and those are opposite claims.
 *
 * `SupportMeter` is the other shape: a count against a floor. It is not a percentage of the person,
 * it is how much evidence exists — 1 report of the 5 that ADR-0031 requires before a company's
 * interview process may be described at all.
 */

import { cx } from './cx.ts';

/**
 * A readiness range.
 *
 * The width of the filled section is how much of the number rests on estimates rather than on
 * listed claims, so a wide band is information and not a rendering artefact. `aria-valuetext`
 * carries the range in words, because `aria-valuenow` alone would announce a single figure and
 * re-introduce the exact false precision the band exists to avoid.
 */
export function ReadinessBand({
  low,
  high,
  label,
}: {
  low: number;
  high: number;
  label: string;
}) {
  const clampedLow = Math.max(0, Math.min(100, low));
  const clampedHigh = Math.max(clampedLow, Math.min(100, high));

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedLow}
      aria-valuetext={`between ${clampedLow}% and ${clampedHigh}%`}
      className="mt-3 h-2 w-full overflow-hidden rounded-pill border border-border bg-canvas"
    >
      <div
        className="h-full rounded-pill bg-accent"
        style={{
          marginInlineStart: `${clampedLow}%`,
          inlineSize: `${Math.max(clampedHigh - clampedLow, 1)}%`,
        }}
      />
    </div>
  );
}

/**
 * A count against a floor.
 *
 * `have` and `need` are shown as numbers beside the bar and not only as a proportion: "1 of 5" is
 * what a person can act on, and 20% is not.
 */
export function SupportMeter({
  have,
  need,
  label,
}: {
  have: number;
  need: number;
  label: string;
}) {
  const filled = need === 0 ? 0 : Math.min(100, Math.round((have / need) * 100));

  return (
    <div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={need}
        aria-valuenow={have}
        aria-valuetext={`${have} of ${need}`}
        className="h-2 w-full overflow-hidden rounded-pill border border-border bg-canvas"
      >
        <div
          className={cx('h-full rounded-pill', have >= need ? 'bg-positive' : 'bg-caution')}
          style={{ inlineSize: `${filled}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-ink-muted tabular-nums">
        {have} of {need}
      </p>
    </div>
  );
}
