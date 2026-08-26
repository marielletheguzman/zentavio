/**
 * A card is a claim.
 *
 * That is `.claude/context/ui-guidelines.md`'s wording and it is the constraint, not a metaphor:
 * if a box on the screen is not asserting something the platform believes, it should not be a card.
 * The consequence is that cards do not nest. A claim inside a claim is either two claims that
 * should sit side by side, or one claim with a section in it.
 *
 * **Borders over shadows.** One elevation level exists in the token layer and it is reserved for
 * things that genuinely float — a menu, a dialog. Shadow is not a hierarchy tool, so `Card` has
 * none and offers no prop to add one.
 */

import { cx } from './cx.ts';
import { toneEdge, type StatusTone } from './status-tones.ts';

export function Card({
  children,
  className,
  tone,
  as: Element = 'section',
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  /**
   * Marks the whole card with a state, structurally.
   *
   * The edge is never the only signal — a card that takes a tone still says the state in words
   * inside it, usually through a `StatusBadge`. This is the third signal, not the first.
   */
  tone?: StatusTone;
  as?: 'section' | 'article' | 'div' | 'li';
}) {
  return (
    <Element
      className={cx(
        'rounded-lg border border-border bg-surface p-6',
        tone !== undefined && toneEdge(tone),
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
}

/**
 * The card's own heading row.
 *
 * `title` is a node rather than a string because several surfaces need a name and a code beside it
 * — "Germany DE", "Platform Engineer · Kaufland Digital" — and forcing those through a string prop
 * produces markup that reads as one thing to a screen reader.
 */
export function CardHeader({
  title,
  description,
  action,
  headingLevel: Heading = 'h3',
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The card's own control, if it has one. Right-aligned on wide screens, stacked below on narrow. */
  action?: React.ReactNode;
  headingLevel?: 'h2' | 'h3' | 'h4';
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <Heading id={id} className="text-lg font-semibold text-ink">
          {title}
        </Heading>
        {description !== undefined && (
          <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * A labelled section inside a card — "Where you stand", "The ways in", "Every rule we checked".
 *
 * Uppercase and muted, which is the one place this design uses letter-spacing: it marks a
 * structural label as something other than prose, so it is skipped when reading and found when
 * scanning.
 */
export function CardSection({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('mt-6', className)}>
      <h4 className="text-sm font-medium tracking-wide text-ink-muted uppercase">{label}</h4>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Provenance, at the foot of the claim it belongs to.
 *
 * Separated by a rule rather than by whitespace, because it is a different kind of statement from
 * everything above it: what produced this, and as of when. `ui-guidelines.md` requires a reachable
 * "why" for every score — this is where the answer ends up when it is one line rather than a panel.
 */
export function CardFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 border-t border-border pt-4 text-sm text-ink-muted">{children}</div>
  );
}
