/**
 * Form controls, with the label rules the guidelines make non-optional.
 *
 * **A placeholder is not a label.** `.claude/context/ui-guidelines.md` says labels are always
 * visible, and the reason is that a placeholder disappears exactly when it is needed — while the
 * field is being filled in, and afterwards when it is being checked. So `label` is required on
 * every control here and there is no variant that hides it.
 *
 * **Errors sit beside the field, in words, and are announced.** "Enter a salary in EUR", not
 * "invalid". The error is wired through `aria-describedby` and `aria-invalid` rather than being
 * red text that happens to be nearby, because red text that happens to be nearby is invisible to
 * anyone not looking at it.
 *
 * **Validate on blur and on submit, never per keystroke.** That is the guidelines' rule and it is
 * the caller's job — these components render an error, they do not decide when one exists.
 */

import { useId } from 'react';

import { cx } from './cx.ts';

const CONTROL = cx(
  'min-h-12 w-full rounded-md border border-border-strong bg-canvas px-3 text-base text-ink',
  'placeholder:text-ink-muted',
  'aria-invalid:border-negative',
  'disabled:cursor-not-allowed disabled:opacity-60',
);

type FieldShellProps = {
  label: string;
  /** Shown under the control, always. Says what the answer is used for, not what a valid one looks like. */
  hint?: React.ReactNode;
  error?: string | undefined;
  children: (ids: { controlId: string; describedBy: string | undefined }) => React.ReactNode;
};

/**
 * The label / control / hint / error arrangement, shared by every control type.
 *
 * Render-prop rather than cloning children: the ids have to reach the actual control element, and
 * `cloneElement` on an unknown child guesses at which prop to set.
 */
export function Field({ label, hint, error, children }: FieldShellProps) {
  const controlId = useId();
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;

  const describedBy =
    [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={controlId} className="text-sm font-medium text-ink">
        {label}
      </label>

      {children({ controlId, describedBy })}

      {hint !== undefined && (
        <p id={hintId} className="max-w-prose text-sm text-ink-muted">
          {hint}
        </p>
      )}

      {/*
       * Announced politely. An assertive live region interrupts whatever the reader is in the
       * middle of, which for a validation message is worse than waiting for a pause.
       */}
      {error !== undefined && (
        <p id={errorId} role="status" className="text-sm font-medium text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: React.ReactNode;
  error?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ controlId, describedBy }) => (
        <input
          id={controlId}
          aria-describedby={describedBy}
          aria-invalid={error !== undefined || undefined}
          className={CONTROL}
          {...rest}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: React.ReactNode;
  error?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ controlId, describedBy }) => (
        <select
          id={controlId}
          aria-describedby={describedBy}
          aria-invalid={error !== undefined || undefined}
          className={CONTROL}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

/**
 * File input.
 *
 * The native control is kept and styled rather than replaced by a button that opens a hidden one.
 * A hidden input is where keyboard access and drag-and-drop both quietly stop working, and the
 * upload surface is the first thing a new user touches.
 */
export function FileField({
  label,
  hint,
  error,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: React.ReactNode;
  error?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ controlId, describedBy }) => (
        <input
          id={controlId}
          type="file"
          aria-describedby={describedBy}
          aria-invalid={error !== undefined || undefined}
          className={cx(
            CONTROL,
            'py-3 file:mr-4 file:min-h-8 file:rounded-md file:border-0',
            'file:bg-accent file:px-4 file:text-base file:font-medium file:text-accent-contrast',
          )}
          {...rest}
        />
      )}
    </Field>
  );
}
