/**
 * Three levels of button, and a rule about how many of the first one a screen may have.
 *
 * `.claude/context/ui-guidelines.md` requires every page to end in a next action, and the redesign
 * brief adds the constraint that makes that useful: **one primary action per screen.** Giving every
 * control the same weight is the same failure as giving none of them any — the reader has to read
 * all of them to find out which one matters.
 *
 * | variant | for | example |
 * |---|---|---|
 * | `primary` | the one action the screen exists for | Upload résumé · Answer question |
 * | `secondary` | a real alternative to it | Change track · Cancel |
 * | `tertiary` | reaching the evidence behind something | Why? · View source |
 *
 * **44px minimum height.** That is the touch-target floor, and it applies to the mouse too — the
 * brief's "do not use tiny buttons" and the accessibility floor are the same requirement seen from
 * two directions.
 */

import { cx } from './cx.ts';

type ButtonVariant = 'primary' | 'secondary' | 'tertiary';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast border-transparent hover:brightness-110',
  secondary: 'bg-transparent text-ink border-border-strong hover:border-accent hover:text-accent',
  // No border and no fill: it is a link that happens to be a button, and it should read as one.
  tertiary: 'bg-transparent text-accent border-transparent underline underline-offset-4 px-2',
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ variant = 'secondary', className, type, ...rest }: ButtonProps) {
  return (
    <button
      /*
       * Defaulted, because the HTML default is `submit` and a button inside a form that was meant
       * to do something else will silently submit it instead. A caller that wants a submit says so.
       */
      type={type ?? 'button'}
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-md border px-4 text-base font-medium',
        'cursor-pointer transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

/**
 * A link styled as a button.
 *
 * Separate from `Button` rather than a `as` prop, because the distinction is semantic and matters
 * for the keyboard: a link navigates and appears in the tab order as a link, a button acts. Styling
 * one as the other is fine; *typing* one as the other is how a control ends up unreachable.
 */
export function ButtonLink({
  variant = 'secondary',
  className,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant }) {
  return (
    <a
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-md border px-4 text-base font-medium',
        'no-underline transition-colors duration-150',
        VARIANTS[variant],
        variant === 'tertiary' && 'underline underline-offset-4',
        className,
      )}
      {...rest}
    />
  );
}
