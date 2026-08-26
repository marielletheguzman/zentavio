/**
 * The four states `.claude/context/ui-guidelines.md` requires every async surface to design
 * *before* the success state is styled, plus the one this product adds.
 *
 * | state | the rule it exists to keep |
 * |---|---|
 * | `LoadingSkeleton` | a skeleton matching the final layout — no spinner in a void, no shift on arrival |
 * | `EmptyState` | say why it is empty and offer the next action |
 * | `ErrorState` | what failed, whether retrying is worth it, and a way to retry |
 * | `UnknownState` | **a designed treatment, not an empty cell and not a zero** |
 *
 * `UnknownState` is the one that is specific to Zentavio. "We cannot tell" and "the answer is none"
 * are opposite statements, and every generic component library renders them the same way — as
 * absence. A 0% bar says the second while meaning the first, which is why the readiness block has
 * no bar at all when there is no number.
 */

import { Button } from './button.tsx';
import { cx } from './cx.ts';

/**
 * Rows at the height the real content will occupy.
 *
 * `rows` and `tall` exist so a caller can match its own layout — three list rows is not the same
 * shape as a verdict block, and a skeleton that is the wrong shape reintroduces the layout shift
 * it was added to prevent.
 */
export function LoadingSkeleton({
  rows = 3,
  tall = false,
  label,
}: {
  rows?: number;
  tall?: boolean;
  /** What is being computed. Read aloud; the bars themselves are hidden. */
  label: string;
}) {
  return (
    <div aria-busy="true" aria-label={label} className="mt-4 flex flex-col gap-2" role="status">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cx(
            'rounded-md bg-ink opacity-10',
            tall && index === 0 ? 'h-16' : 'h-12',
            // Motion only where it shows a relationship, and never against the user's wishes.
            'motion-safe:animate-pulse',
          )}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  what,
  why,
  action,
}: {
  title: string;
  /** What is missing. */
  what: React.ReactNode;
  /** What happens once it is there — the half most empty states leave out. */
  why?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-6">
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-prose text-base text-ink-muted">{what}</p>
      {why !== undefined && <p className="mt-2 max-w-prose text-base text-ink-muted">{why}</p>}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * `retryable` comes from the response envelope, not from the status code.
 *
 * The service decides whether trying again could work; the UI does not get to guess. Offering a
 * retry for something that will never succeed is how a person ends up clicking a button eleven
 * times, and hiding one for something transient is how they give up on a working system.
 */
export function ErrorState({
  message,
  retryable = false,
  onRetry,
  details,
}: {
  message: string;
  retryable?: boolean;
  onRetry?: () => void;
  /** Behind a disclosure. Never the default view — a stack trace is not an error message. */
  details?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-lg border border-negative bg-surface p-6"
    >
      <h3 className="text-lg font-semibold text-ink">We could not do that</h3>
      <p className="mt-2 max-w-prose text-base text-ink">{message}</p>
      {/*
       * Stated every time, because it is the question the reader actually has. An error on a
       * surface that has just been told something about their career reads as "did I lose it?".
       */}
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Your profile is unchanged. Nothing was saved.
      </p>

      {retryable && onRetry !== undefined && (
        <div className="mt-4">
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}

      {details !== undefined && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-ink-muted">
            View technical details
          </summary>
          <div className="mt-2 text-sm text-ink-muted">{details}</div>
        </details>
      )}
    </div>
  );
}

/**
 * Not an error, and styled so it cannot be read as one.
 *
 * A strong neutral border rather than a semantic colour: the platform has not failed and the
 * person has not failed, so nothing here is positive, caution or negative. `missing` is the part
 * that makes it useful — an unknown that does not name what is needed is just a shrug.
 */
export function UnknownState({
  title,
  reason,
  missing = [],
  action,
}: {
  title: string;
  reason: React.ReactNode;
  missing?: readonly string[];
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-lg border-2 border-border-strong bg-surface p-6">
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-prose text-base text-ink">{reason}</p>

      {missing.length > 0 && (
        <>
          <h4 className="mt-6 text-sm font-medium tracking-wide text-ink-muted uppercase">
            What would resolve it
          </h4>
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-6 text-base text-ink-muted">
            {missing.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </>
      )}

      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}
