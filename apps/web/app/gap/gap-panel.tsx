'use client';

/**
 * The gap surface — all six states.
 *
 * Six, not five: `no_gap` is its own state. Rendering "you meet every requirement" as an empty list
 * reads as a loading bug, and `docs/features/skill-gap-analysis.md` is explicit that a bare
 * "you're a great fit!" is a failure.
 *
 * A Client Component because it owns interaction and transient state. Everything derived from the
 * response lives in `lib/gap-view.ts`, which is pure and tested; this file is markup and the fetch.
 *
 * **Data goes through the API gateway only** (`.claude/skills/frontend/SKILL.md`). The browser never
 * talks to `ai/skill-gap` directly — it is an internal service with no auth of its own.
 */

import { useId, useState } from 'react';
import {
  gapViewStateFor,
  type GapBody,
  type GapItemView,
  type GapViewState,
  type ReadinessView,
} from '../../lib/gap-view.ts';

/**
 * The development credential header.
 *
 * A real session will be an httpOnly cookie the browser sends on its own, and this disappears —
 * `security.md` requires tokens opaque to the frontend and never in `localStorage` or a URL.
 */
function devAuthHeader(devUserId: string): Record<string, string> {
  return { 'x-zentavio-dev-user': devUserId };
}

export function GapPanel({ gatewayUrl, devUserId }: { gatewayUrl: string; devUserId: string }) {
  const [state, setState] = useState<GapViewState | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const trackId = useId();
  const marketId = useId();

  async function loadGap() {
    setState({ kind: 'loading' });
    try {
      const response = await fetch(`${gatewayUrl}/v1/gap`, { headers: devAuthHeader(devUserId) });
      const body: unknown = await response.json();

      if (!response.ok) {
        // `retryable` comes from the envelope rather than the status code — the service decides,
        // not the UI.
        const error = (body as { error?: { message?: string; retryable?: boolean } }).error;
        setState({
          kind: 'error',
          message: error?.message ?? 'The gap could not be computed.',
          retryable: error?.retryable === true || response.status === 503,
        });
        return;
      }

      setState(gapViewStateFor(body as GapBody));
    } catch {
      setState({ kind: 'error', message: 'Could not reach the server.', retryable: true });
    }
  }

  async function chooseTarget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const slug = String(form.get('slug') ?? '').trim();
    const market = String(form.get('market') ?? '').trim();
    if (slug === '') {
      setNote('Enter a track to compare against.');
      return;
    }

    setChoosing(true);
    setNote(null);
    try {
      const response = await fetch(`${gatewayUrl}/v1/targets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...devAuthHeader(devUserId) },
        body: JSON.stringify({ slug, ...(market === '' ? {} : { market }) }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        const error = (body as { message?: string; error?: { message?: string } });
        setNote(error.error?.message ?? error.message ?? 'That track could not be set.');
        return;
      }

      // Saying the market out loud matters: it decides which requirements exist at all, so a person
      // comparing against Berlin and one comparing globally are being told different things.
      setNote(market === '' ? `Comparing against ${slug}.` : `Comparing against ${slug} in ${market}.`);
      await loadGap();
    } catch {
      setNote('Could not reach the server.');
    } finally {
      setChoosing(false);
    }
  }

  return (
    <section aria-labelledby="gap-heading">
      <h2 id="gap-heading">How far am I?</h2>

      <form className="card" onSubmit={chooseTarget}>
        <div className="controls">
          <div>
            <label htmlFor={trackId}>Track</label>
            <input id={trackId} name="slug" defaultValue="cloud-platform-engineer" required />
          </div>

          <div>
            <label htmlFor={marketId}>Market (optional)</label>
            <input
              id={marketId}
              name="market"
              placeholder="DE"
              pattern="[A-Z]{2}"
              // Not a display preference. A different market is a different requirement set — German
              // is real for a Berlin role and absent for remote-worldwide.
              aria-describedby={`${marketId}-hint`}
            />
          </div>

          <button type="submit" disabled={choosing}>
            {choosing ? 'Setting…' : 'Compare'}
          </button>
        </div>

        <p className="hint" id={`${marketId}-hint`}>
          Leave blank to compare against the global requirements. A market changes which
          requirements apply, not just how they are shown.
        </p>
      </form>

      {/* Announced politely so a screen reader hears the outcome without losing the user's place. */}
      <p className="hint" role="status" aria-live="polite">
        {note}
      </p>

      {state === null ? (
        <p className="hint">Pick a track to see what stands between you and it.</p>
      ) : (
        <GapBody state={state} onRetry={loadGap} />
      )}
    </section>
  );
}

function GapBody({ state, onRetry }: { state: GapViewState; onRetry: () => void }) {
  switch (state.kind) {
    case 'loading':
      // A skeleton matching the final layout rather than a spinner in a void: the readiness block
      // and then the ordered steps, at the height they will occupy.
      return (
        <ul className="skeleton" aria-busy="true" aria-label="Computing your gap">
          {[0, 1, 2].map((row) => (
            <li className="skeleton-row" key={row} aria-hidden="true" />
          ))}
        </ul>
      );

    case 'error':
      return (
        <div className="card notice notice-error" role="alert">
          <p>{state.message}</p>
          {state.retryable ? (
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      );

    case 'no-target':
      return <p className="hint">{state.reason}</p>;

    case 'no-profile':
      return (
        <div className="card">
          <p>{state.reason}</p>
          <p>
            <a href="/">Upload a résumé</a>
          </p>
        </div>
      );

    case 'unknown':
      // Named, never a generic empty gap. A person deciding what to spend six months learning
      // deserves "we have not modelled this" over a plausible-looking empty list.
      return (
        <div className="card unknown">
          <p>{state.reason}</p>
          {state.missing.length > 0 ? (
            <ul className="notes">
              {state.missing.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );

    case 'no-gap':
      return (
        <div className="card">
          <p>{state.reason}</p>
          <p>
            Checked against {state.held.length} skill{state.held.length === 1 ? '' : 's'} on your
            profile. <ConfidenceNote confidence={state.confidence} />
          </p>
        </div>
      );

    case 'gap':
      return (
        <div className="card">
          <ReadinessBlock readiness={state.readiness} />

          <p>{state.summary}</p>
          <p className="hint">
            <ConfidenceNote confidence={state.confidence} />
          </p>

          {state.missing.length > 0 ? (
            // What the answer did not know, shown beside it rather than buried. A gap that hides
            // its own uncertainty is the confident wrong answer the product exists to avoid.
            <details>
              <summary>What this answer does not know ({state.missing.length})</summary>
              <ul>
                {state.missing.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </details>
          ) : null}

          <ol className="steps">
            {state.items.map((item) => (
              <GapRow key={item.skillId} item={item} />
            ))}
          </ol>

          <p className="provenance">Computed by {state.scorerVersion}.</p>
        </div>
      );
  }
}

function ReadinessBlock({ readiness }: { readiness: ReadinessView }) {
  return (
    <section aria-labelledby="readiness-heading">
      <h3 id="readiness-heading">How ready you are</h3>

      {readiness.known ? (
        <>
          {/* The number and its remainder in one breath. A readiness score without what is still
              missing is a vanity metric (`.claude/context/career-philosophy.md`), so the two are
              never separated by a layout that could hide one. */}
          <p className="axis-value">
            <strong className="numeric">{readiness.percent}%</strong> of what this track asks for,{' '}
            <ConfidenceNote confidence={readiness.confidence} />.
          </p>

          {/* The band, when there is one. A single figure treats a listed skill and a transfer
              edge as measured quantities; they are estimates, and the width is how much of the
              number rests on them. */}
          {readiness.band === null ? null : <p>{readiness.band.label}.</p>}

          {readiness.clusters.length > 0 ? (
            /* Core and peripheral are different questions. 70% of a cluster worth 6% of the track
               is not a strong position, so the share is shown beside the score. */
            <table>
              <caption>Where that number comes from</caption>
              <thead>
                <tr>
                  <th scope="col">Part of the track</th>
                  <th scope="col">You have</th>
                  <th scope="col">Share of the total</th>
                </tr>
              </thead>
              <tbody>
                {readiness.clusters.map((cluster) => (
                  <tr key={cluster.cluster}>
                    <th scope="row">
                      {cluster.label} ({cluster.requirementCount})
                    </th>
                    <td>{cluster.percent}%</td>
                    <td>{cluster.sharePercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <p>
            {readiness.remainingCount} thing{readiness.remainingCount === 1 ? '' : 's'} still to
            close — listed below, in the order you would close them.
          </p>
        </>
      ) : (
        /* Not a 0% bar. "We cannot tell" and "you are not ready" are opposite statements, and an
           empty progress bar says the second while meaning the first. */
        <p>{readiness.reason ?? 'There is not enough here to give you a number yet.'}</p>
      )}

      {/* Never an invented timeline. `career-philosophy.md`: optimistic timelines are the most
          damaging thing a career platform can produce, because people reorganise their lives
          around them. */}
      <p className="hint">{readiness.timeBasis}</p>

      {/* The assumption behind the number, stated where the number is. A penalty nobody can see
          is a hidden penalty, whatever the module comment says. */}
      <p className="hint">{readiness.assumption}</p>

      {readiness.caveats.length > 0 ? (
        <details>
          <summary>What this number does not account for ({readiness.caveats.length})</summary>
          <ul>
            {readiness.caveats.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="provenance">Scored by {readiness.scorerVersion}.</p>
    </section>
  );
}

function ConfidenceNote({ confidence }: { confidence: { level: string; label: string } }) {
  // The words carry the meaning, not the styling. Nothing here is conveyed by colour alone.
  return <span data-confidence={confidence.level}>{confidence.label}</span>;
}

function GapRow({ item }: { item: GapItemView }) {
  return (
    <li className="step">
      <h3>
        {item.position}. {item.label}
      </h3>
      <p>{item.importance}</p>

      {item.blockedBy.length === 0 ? (
        // The most actionable sentence on the screen, so it is stated rather than implied by
        // position alone.
        <p>You can start this now.</p>
      ) : (
        <p>Comes after {item.blockedBy.join(', ')}.</p>
      )}

      {item.partial === null ? null : <p>{item.partial.label}</p>}

      {item.unweighted ? (
        // Listed, never defaulted: a default weight would be an invented market fact.
        <p>We do not know how much this one matters for this track yet.</p>
      ) : null}
    </li>
  );
}
