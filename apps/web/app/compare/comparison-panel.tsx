'use client';

/**
 * The comparison, rendered.
 *
 * A Client Component because it owns interaction and transient state. Everything derived from the
 * wire lives in `lib/comparison-view.ts`, which is pure and tested; this file is markup and the
 * fetch.
 *
 * **Data goes through the API gateway only** (`.claude/skills/frontend/SKILL.md`).
 *
 * ## Three things this file must not do, written where the mistake would be made
 *
 * **No ordering.** Groups and destinations are rendered in the order they arrive. There is no sort
 * here, no "best match" first, and no numbered list — a numbered list is a ranking whatever the
 * caption says. The wire's `orderingNote` is printed verbatim above the groups rather than
 * paraphrased.
 *
 * **No cell state is rendered by colour alone.** `unmodelled` and `not_applicable` mean opposite
 * things and look alike in every table ever built, so each cell carries its label, its border
 * *style*, and a sentence naming whose statement it is. Two cells that differ only in hue have said
 * the same thing twice.
 *
 * **`REMOTE` is not a winner.** It has no immigration rules, so it will usually be the row with the
 * fewest unresolved questions — a difference in kind, not a result. The card says so in words every
 * time it is drawn, because the reader's eye will otherwise do the arithmetic by itself.
 *
 * Destinations are rendered as cards rather than as rows of one table. A table needs a column per
 * dimension, and `REMOTE` declares four nobody else has — so every country would carry four empty
 * cells, which is exactly the "empty means nothing" reading ADR-0026 forbids.
 */

import { useCallback, useEffect, useId, useState } from 'react';

import { asOfProblem } from '../../lib/as-of.ts';
import {
  toComparisonView,
  toNoEmployabilityView,
  type CellView,
  type ComparisonViewState,
  type DestinationView,
  type GroupView,
} from '../../lib/comparison-view.ts';

/**
 * The development credential header.
 *
 * A real session will be an httpOnly cookie the browser sends on its own, and this disappears —
 * `security.md` requires tokens opaque to the frontend and never in `localStorage` or a URL.
 */
function devAuthHeader(devUserId: string): Record<string, string> {
  return { 'x-zentavio-dev-user': devUserId };
}

/**
 * One dimension of one destination.
 *
 * The class carries the state and the text carries it again. `attribution` is printed rather than
 * implied: it is the difference between *"we have not sourced this"* and *"this does not apply
 * here"*, and it is the only thing standing between those two once they are both grey.
 */
function Cell({ cell }: { cell: CellView }) {
  return (
    <li className={`cell cell-${cell.state}`}>
      <span className="cell-heading">{cell.heading}</span>{' '}
      <span className="cell-label">{cell.label}</span>
      <p className="cell-attribution">
        A statement about <strong>{cell.attribution}</strong>.
      </p>
      {cell.detail !== null && <p className="cell-detail">{cell.detail}</p>}

      {cell.questions.length > 0 && (
        <p className="cell-detail">
          Answering would move this: {cell.questions.join('; ')}.{' '}
          <a href="/eligibility">Answer it</a>
        </p>
      )}

      {cell.requirementIds.length > 0 && (
        // Every cell that came from rules names them. A comparison that cannot be taken apart
        // factor by factor is a score with extra steps.
        <p className="cell-source">Rules checked here: {cell.requirementIds.join(', ')}</p>
      )}
    </li>
  );
}

function Destination({ destination }: { destination: DestinationView }) {
  return (
    <article className={destination.isRemote ? 'destination destination-remote' : 'destination'}>
      <h4 className="destination-name">
        {destination.name} <span className="destination-code">{destination.destination}</span>
      </h4>

      {destination.isRemote && (
        // Printed on every render, not only when the row happens to look complete. The sentence
        // ADR-0028 asks for is the one nobody writes once the layout looks finished.
        <p className="destination-kind">
          Not a country — a way of working. There are no immigration rules here to satisfy, so this
          will usually be the row with the fewest unresolved questions. That is a difference in kind,
          not a recommendation.
        </p>
      )}

      {/* The service's own sentence, not reworded: the reasoning belongs to the layer that did it. */}
      <p className="binding-reason">{destination.bindingReason}</p>

      <ul className="cells">
        {destination.cells.map((cell) => (
          <Cell cell={cell} key={cell.dimension} />
        ))}
      </ul>

      {destination.quota !== null && (
        // A cap is a property of the pathway, not a dimension the person is evaluated on
        // (ADR-0027), so it sits beside the cells and carries no state. **Absent means absent** —
        // a destination with no quota block has not been declared uncapped.
        <div className="quota">
          <p className="quota-headline">{destination.quota.headline}</p>
          <p className="quota-places">{destination.quota.places}</p>
          <p className="cell-source">
            Allocated by {destination.quota.allocatedBy}, per {destination.quota.period}.
          </p>
          {destination.quota.unsourcedReason !== null && (
            <p className="cell-detail">{destination.quota.unsourcedReason}</p>
          )}
        </div>
      )}
    </article>
  );
}

function Group({ group }: { group: GroupView }) {
  return (
    <section className="card" aria-label={group.label}>
      {/* The group label says what stands in the way. Never a bare constraint name, and never a
          position — "first" is not a thing a group is. */}
      <h3>{group.label}</h3>

      <div className="destinations">
        {group.destinations.map((destination) => (
          <Destination destination={destination} key={destination.destination} />
        ))}
      </div>
    </section>
  );
}

export function ComparisonPanel({
  gatewayUrl,
  devUserId,
  today,
}: {
  gatewayUrl: string;
  devUserId: string;
  /**
   * Computed on the server and passed in, **not** `new Date()` here.
   *
   * Variable input during render is a hydration mismatch, and it is a correctness point too: every
   * destination is compared as of one date, and that date should come from one clock.
   */
  today: string;
}) {
  const [state, setState] = useState<ComparisonViewState>({ kind: 'idle' });
  const [asOf, setAsOf] = useState(today);
  const asOfId = useId();

  const compare = useCallback(
    async function compare(date: string) {
      // A date control can hand back a five-digit year. Caught before the request because the
      // gateway answers it with a 400, and a 400 renders below as "something went wrong on our
      // side" — which would be false. This one is the input. See `lib/as-of.ts`.
      const problem = asOfProblem(date);
      if (problem !== null) {
        setState({ kind: 'error', message: problem, retryable: false });
        return;
      }

      setState({ kind: 'loading' });
      try {
        const response = await fetch(
          `${gatewayUrl}/v1/comparison?asOf=${encodeURIComponent(date)}`,
          { headers: devAuthHeader(devUserId) },
        );

        if (!response.ok) {
          // 503 is one destination that could not be evaluated, and the whole comparison is
          // withheld rather than shown short a row — retryable. A 4xx here is our bug, and telling
          // someone to retry a bug is how they retry forever.
          setState({
            kind: 'error',
            message:
              response.status === 503
                ? 'The comparison cannot be built right now. One destination could not be checked, and a partial comparison would be worse than none.'
                : 'Something went wrong on our side. This is not a problem with your details.',
            retryable: response.status === 503,
          });
          return;
        }

        const body = await response.json();

        // Not an error: no track chosen, or no profile. Both make every row equally uninformative,
        // and saying which beats rendering five destinations that all read the same empty readiness.
        if (body.status === 'no-employability') {
          setState(toNoEmployabilityView(String(body.reason)));
          return;
        }

        setState(toComparisonView(body));
      } catch {
        setState({ kind: 'error', message: 'Could not reach the service.', retryable: true });
      }
    },
    [gatewayUrl, devUserId],
  );

  // Compared on load, unlike `/eligibility`. Nothing is written here and nothing is submitted — the
  // page is a read, and making someone press a button to see a read is a step with no meaning.
  useEffect(() => {
    void compare(today);
  }, [compare, today]);

  return (
    <section aria-labelledby="comparison-heading">
      <h2 id="comparison-heading">Four countries, and working remotely</h2>

      <div className="card">
        <div className="controls">
          <div>
            <label htmlFor={asOfId}>Compare the rules as they stood on</label>
            <input
              id={asOfId}
              type="date"
              value={asOf}
              onChange={(event) => {
                setAsOf(event.target.value);
              }}
            />
          </div>
          <button type="button" onClick={() => void compare(asOf)}>
            Compare
          </button>
        </div>
        <p className="hint">
          Immigration rules change, and every destination here is checked against the same date. A
          comparison that mixed dates would compare nothing while looking like it compared
          something.
        </p>
      </div>

      {state.kind === 'loading' && (
        // A skeleton in the shape of the result — a group heading and two destination blocks — so
        // nothing on the page moves when the answer arrives.
        <>
          <p role="status">Checking every destination against the rules on file…</p>
          <div className="skeleton" aria-hidden="true">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
          </div>
        </>
      )}

      {state.kind === 'error' && (
        <div className="card notice notice-error" role="alert">
          <p>{state.message}</p>
          {state.retryable && (
            <button type="button" onClick={() => void compare(asOf)}>
              Try again
            </button>
          )}
        </div>
      )}

      {state.kind === 'no-employability' && (
        <div className="card unknown">
          <h3>{state.headline}</h3>
          <p>{state.explanation}</p>
          <nav className="next-action">
            <a href="/">Upload a résumé</a>
            <a href="/gap">Choose a track</a>
          </nav>
        </div>
      )}

      {state.kind === 'comparison' && (
        <>
          {/* Above the groups, not below them in small print. By the time a reader reaches the
              bottom they have already decided the first row is the best one. */}
          <p className="ordering-note">{state.orderingNote}</p>

          {state.groups.map((group) => (
            <Group group={group} key={group.binding} />
          ))}

          <div className="provenance">
            <p>
              Every destination compared as of <span className="numeric">{state.asOf}</span>.
            </p>
            {/* Verbatim. Never reworded, never shortened — it is what keeps this information
                rather than advice. */}
            <p>{state.disclaimer}</p>
          </div>
        </>
      )}
    </section>
  );
}
