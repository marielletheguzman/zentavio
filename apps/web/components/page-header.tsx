/**
 * The contextual header every screen opens with.
 *
 * It answers the first two questions of the brief's information hierarchy — *where am I* and *what
 * is my current status* — before anything else on the page gets a chance to. The `action` slot is
 * where the screen's **one primary action** goes, which is why it is a single node and not a list.
 *
 * `context` is for the thing the page is currently about: the track being compared against, the
 * date the rules are evaluated as of. It is a separate slot rather than prose because it usually
 * comes with a control to change it, and a sentence with a button inside it wraps badly at 320px.
 */

export function PageHeader({
  title,
  description,
  action,
  context,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  context?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {/*
           * `text-balance` so a two-line title breaks somewhere sensible rather than leaving one
           * word alone on the second line.
           */}
          <h1 className="text-2xl font-semibold text-balance text-ink lg:text-3xl">{title}</h1>
          {description !== undefined && (
            <p className="mt-2 max-w-prose text-base text-ink-muted">{description}</p>
          )}
        </div>
        {action !== undefined && <div className="shrink-0">{action}</div>}
      </div>

      {context !== undefined && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">{context}</div>
      )}
    </header>
  );
}
