'use client';

/**
 * Recording what you applied to, and what came of it.
 *
 * A Client Component because it owns interaction. Everything derived from the data lives in
 * `lib/applications-view.ts`, which is pure and tested; this file is markup and the fetch.
 *
 * **Capture is one tap or it does not happen** (`docs/features/outcomes-learning.md`). Outcome
 * data cannot be bought or backfilled, so recording *rejected* must never be a form — it is the
 * most common outcome and the one nobody comes back to type.
 *
 * **Nothing here is required.** No blocking, no nagging, no "complete your profile". A person who
 * records nothing gets a product that works exactly as well, minus the calibration.
 */

import type { ApplicationWire, OutcomeKind } from '@zentavio/types';
import { useCallback, useEffect, useState } from 'react';

import {
  predictionLine,
  toApplicationsView,
  type ApplicationsViewState,
} from '../../lib/applications-view.ts';

function devAuthHeader(devUserId: string): Record<string, string> {
  return { 'x-zentavio-dev-user': devUserId };
}

export function ApplicationsPanel({
  gatewayUrl,
  devUserId,
}: {
  gatewayUrl: string;
  devUserId: string;
}) {
  const [state, setState] = useState<ApplicationsViewState>({ kind: 'loading' });
  const [role, setRole] = useState('');
  const [country, setCountry] = useState('');
  const [sponsorship, setSponsorship] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${gatewayUrl}/v1/applications`, {
        headers: devAuthHeader(devUserId),
      });

      if (!response.ok) {
        setState({
          kind: 'error',
          message: 'Your applications could not be loaded.',
          retryable: response.status >= 500,
        });
        return;
      }

      const body = (await response.json()) as { applications: readonly ApplicationWire[] };
      setState(toApplicationsView(body.applications));
    } catch {
      setState({ kind: 'error', message: 'Could not reach the service.', retryable: true });
    }
  }, [gatewayUrl, devUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addApplication() {
    if (role.trim() === '') {
      setNote('What did you apply for?');
      return;
    }

    setNote(null);
    const response = await fetch(`${gatewayUrl}/v1/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...devAuthHeader(devUserId) },
      body: JSON.stringify({
        externalRole: role.trim(),
        ...(country.trim() === '' ? {} : { countryCode: country.trim().toUpperCase() }),
        requiredSponsorship: sponsorship,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: unknown };
      } | null;
      setNote(
        typeof body?.error?.message === 'string' ? body.error.message : 'That could not be saved.',
      );
      return;
    }

    setRole('');
    setCountry('');
    setSponsorship(false);
    // Says "recorded", never "tracked": nothing here watches the application on your behalf.
    setNote('Recorded, with what we predicted about you today.');
    await load();
  }

  async function record(applicationId: string, kind: OutcomeKind) {
    setNote(null);
    const response = await fetch(`${gatewayUrl}/v1/applications/${applicationId}/outcomes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...devAuthHeader(devUserId) },
      body: JSON.stringify({ kind }),
    });

    if (!response.ok) {
      setNote('That outcome could not be recorded.');
      return;
    }

    setNote('Recorded. Thank you — this is what makes the numbers checkable.');
    await load();
  }

  return (
    <section aria-labelledby="applications-heading">
      <h2 id="applications-heading">What you applied to</h2>

      <div className="card">
        <div className="controls">
          <div>
            <label htmlFor="role">What did you apply for?</label>
            <input
              id="role"
              type="text"
              value={role}
              placeholder="Senior Backend Engineer at Acme"
              onChange={(event) => {
                setRole(event.target.value);
              }}
            />
          </div>
          <div>
            <label htmlFor="country">Where (optional)</label>
            <input
              id="country"
              type="text"
              value={country}
              placeholder="DE"
              maxLength={2}
              onChange={(event) => {
                setCountry(event.target.value);
              }}
            />
          </div>
          <button type="button" onClick={() => void addApplication()}>
            Record it
          </button>
        </div>

        <label htmlFor="sponsorship">
          <input
            id="sponsorship"
            type="checkbox"
            checked={sponsorship}
            onChange={(event) => {
              setSponsorship(event.target.checked);
            }}
          />{' '}
          This one needed a visa
        </label>

        <p className="hint">
          Recorded for you only. What you tell us here is what lets us check whether our own
          readiness numbers meant anything — and it is never shown to anyone else.
        </p>
      </div>

      {note !== null && (
        <p className="hint" role="status">
          {note}
        </p>
      )}

      {state.kind === 'loading' && <p role="status">Loading what you have recorded…</p>}

      {state.kind === 'error' && (
        <div className="card notice notice-error" role="alert">
          <p>{state.message}</p>
          {state.retryable && (
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          )}
        </div>
      )}

      {state.kind === 'empty' && (
        <div className="card">
          {/* Its own state, not an empty list: an empty list reads as a loading bug. */}
          <p>Nothing recorded yet.</p>
          <p className="hint">
            Add an application above — including one you made without us. Each one you record makes
            our readiness score falsifiable rather than decorative.
          </p>
        </div>
      )}

      {state.kind === 'ready' &&
        state.applications.map((application) => (
          <div className="card" key={application.id}>
            <h3>{application.role}</h3>
            <p className="requirement-label">{application.statusLabel}</p>

            <p className="requirement-source">
              {application.appliedOn === null
                ? 'No application date recorded.'
                : `Applied ${application.appliedOn}.`}
              {application.countryCode !== null && ` ${application.countryCode}.`}
              {application.requiredSponsorship && ' Needed a visa.'}
            </p>

            {/* The pairing this table exists for. Shown to the person it was about, because a
                score nobody can check against a result is not a prediction. */}
            <p className="requirement-detail">{predictionLine(application)}</p>

            {application.outcomes.length > 0 && (
              <ul className="requirements">
                {application.outcomes.map((outcome) => (
                  <li className="requirement" key={outcome.id}>
                    <span className="requirement-label">{outcome.label}</span>{' '}
                    <span className="requirement-id">{outcome.occurredOn}</span>
                    {outcome.elapsed !== null && (
                      <p className="requirement-detail">{outcome.elapsed}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {application.canRecord.length > 0 && (
              <div>
                <h4>What happened?</h4>
                {application.canRecord.map((choice) => (
                  <button
                    type="button"
                    key={choice.kind}
                    onClick={() => void record(application.id, choice.kind)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
    </section>
  );
}
