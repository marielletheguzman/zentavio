'use client';

/**
 * The eligibility surface, and the loop the milestone is verified by.
 *
 * A Client Component because it owns interaction and transient state. Everything derived from a
 * verdict lives in `lib/eligibility-view.ts`, which is pure and tested; this file is markup, the
 * fetch, and the form.
 *
 * **Data goes through the API gateway only** (`.claude/skills/frontend/SKILL.md`). The browser
 * never talks to `ai/career-roadmap` directly — it is an internal service with no auth of its own.
 *
 * **No eligibility decision is made here.** The panel renders what the evaluator said. If a
 * comparison, a threshold, or a status ever appears in this file, the reasoning has leaked into the
 * layer that cannot be tested without a browser.
 */

import { useId, useState } from 'react';

import {
  toFactValue,
  toViabilityView,
  type PromptLookup,
  type ViabilityViewState,
} from '../../lib/eligibility-view.ts';

/**
 * The development credential header.
 *
 * A real session will be an httpOnly cookie the browser sends on its own, and this disappears —
 * `security.md` requires tokens opaque to the frontend and never in `localStorage` or a URL.
 */
function devAuthHeader(devUserId: string): Record<string, string> {
  return { 'x-zentavio-dev-user': devUserId };
}

/** Prompts the catalogue owns. Hardcoding the wording here would fork it from the database. */
const FALLBACK_PROMPTS: PromptLookup = {
  expected_gross_annual_salary_eur: 'What gross annual salary do you expect, in euros?',
};

const UNITS: Readonly<Record<string, string | null>> = {
  expected_gross_annual_salary_eur: 'EUR/year',
};

export function EligibilityPanel({
  gatewayUrl,
  devUserId,
  pathway,
  today,
}: {
  gatewayUrl: string;
  devUserId: string;
  pathway: string;
  /**
   * Computed on the server and passed in, **not** `new Date()` here.
   *
   * Variable input during render is a hydration mismatch: the server renders one date and the
   * client another, and React warns about exactly this. It also happens to be a correctness point
   * — the date a verdict is stated against should come from one clock, not from whichever machine
   * happened to render.
   */
  today: string;
}) {
  const [state, setState] = useState<ViabilityViewState>({ kind: 'idle' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(today);
  const asOfId = useId();

  async function evaluate(date: string) {
    setState({ kind: 'loading' });
    setNote(null);
    try {
      // `/v1/viability`, not `/v1/eligibility`. Eligibility alone renders "you meet the
      // requirements" to someone who is 13% ready, which is the output ADR-0022 removed.
      const response = await fetch(
        `${gatewayUrl}/v1/viability?pathway=${encodeURIComponent(pathway)}&asOf=${encodeURIComponent(date)}`,
        { headers: devAuthHeader(devUserId) },
      );

      if (!response.ok) {
        // 503 is the evaluator being unreachable — retryable. A 4xx here is our bug, and saying
        // "try again" for a bug is how a user retries forever.
        setState({
          kind: 'error',
          message:
            response.status === 503
              ? 'Eligibility cannot be evaluated right now. No answer is better than a wrong one here.'
              : 'Something went wrong on our side. This is not a problem with your details.',
          retryable: response.status === 503,
        });
        return;
      }

      const body = await response.json();

      // No readiness half means no pair. Shown as its own state rather than falling back to
      // eligibility alone — that fallback is the thing ADR-0022 exists to prevent.
      if (body.status === 'no-employability') {
        setState({ kind: 'no-employability', reason: String(body.reason) });
        return;
      }

      setState(toViabilityView(body, FALLBACK_PROMPTS));
    } catch {
      setState({
        kind: 'error',
        message: 'Could not reach the service.',
        retryable: true,
      });
    }
  }

  async function submitAnswer(key: string) {
    const shaped = toFactValue(key, answers[key] ?? '', UNITS[key] ?? null);
    if (!shaped.ok) {
      setNote(shaped.message);
      return;
    }

    setNote(null);
    const response = await fetch(`${gatewayUrl}/v1/person-facts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...devAuthHeader(devUserId) },
      body: JSON.stringify({ key, value: shaped.value }),
    });

    if (!response.ok) {
      setNote('That answer could not be saved.');
      return;
    }

    const saved = (await response.json()) as { version: number };
    // Says "recorded", never "updated": a correction is a new version, and the previous answer is
    // still what an earlier verdict was computed from.
    setNote(saved.version === 1 ? 'Answer recorded.' : `Answer recorded as version ${String(saved.version)}.`);

    // Re-evaluate immediately. The whole point of `needsFromUser` is that answering it moves you.
    await evaluate(asOf);
  }

  return (
    <section aria-labelledby="eligibility-heading">
      <h2 id="eligibility-heading">Germany — EU Blue Card</h2>

      <div className="card">
        <div className="controls">
          <div>
            <label htmlFor={asOfId}>Evaluate the rules as they stood on</label>
            <input
              id={asOfId}
              type="date"
              value={asOf}
              onChange={(event) => {
                setAsOf(event.target.value);
              }}
            />
          </div>
          <button type="button" onClick={() => void evaluate(asOf)}>
            Check eligibility
          </button>
        </div>
        <p className="hint">
          Immigration rules change. An answer is only meaningful against a date, so this one is
          shown on every result rather than assumed.
        </p>
      </div>

      {state.kind === 'idle' && (
        <p className="hint">Choose a date and check. Nothing is submitted until you do.</p>
      )}

      {state.kind === 'loading' && (
        // A skeleton in the shape of the verdict — headline, the two axes, the rule list — so
        // nothing on the page moves when the answer arrives.
        <>
          <p role="status">Checking the rules on file…</p>
          <div className="skeleton" aria-hidden="true">
            <div className="skeleton-row" />
            <div className="axes">
              <div className="skeleton-row" />
              <div className="skeleton-row" />
            </div>
            <div className="skeleton-row" />
          </div>
        </>
      )}

      {state.kind === 'error' && (
        <div className="card notice notice-error" role="alert">
          <p>{state.message}</p>
          {state.retryable && (
            <button type="button" onClick={() => void evaluate(asOf)}>
              Try again
            </button>
          )}
        </div>
      )}

      {state.kind === 'no-employability' && (
        <div className="card">
          <h3>We can check the rules, but not your readiness yet</h3>
          <p>
            Whether this is worth pursuing depends on both. Upload a résumé and choose a track, and
            this will show you which of the two is actually in your way.
          </p>
        </div>
      )}

      {state.kind === 'viability' && (
        <div className="card">
          <h3 className="verdict-headline">{state.headline}</h3>
          {/* The service's own sentence. Not reworded here — the reasoning belongs to the layer
              that did the reasoning. */}
          <p className="binding-reason">{state.bindingReason}</p>

          <h4>Where you stand</h4>
          {/*
            Two axes side by side, and the one that binds carries a heavier border. The border is
            never the only signal: the axis that binds also says so in words, because a border
            weight is invisible to a screen reader and to anyone who cannot see the difference.
          */}
          <dl className="axes">
            <div className={state.binding === 'eligibility' ? 'axis axis-binding' : 'axis'}>
              <dt className="axis-label">The rules</dt>
              <dd className="axis-value">{state.eligibility.headline}</dd>
              {state.binding === 'eligibility' && <p className="axis-label">This is what binds.</p>}
            </div>

            <div className={state.binding === 'employability' ? 'axis axis-binding' : 'axis'}>
              <dt className="axis-label">Your readiness</dt>
              <dd className="axis-value">
                {state.readiness === null ? (
                  'Not enough on file to say yet.'
                ) : (
                  <>
                    {/* A range, never one number. The width is how much rests on what you have told
                        us rather than what we can see. */}
                    between <span className="numeric">{state.readiness.low}%</span> and{' '}
                    <span className="numeric">{state.readiness.high}%</span>
                    {state.readiness.missing > 0 && ` — ${String(state.readiness.missing)} skill(s) still missing`}
                  </>
                )}
              </dd>
              {state.readiness !== null && (
                // The band drawn as the range it is. Decorative only — the same figures are stated
                // above in words, so nothing is lost when this cannot be seen.
                <div className="band" aria-hidden="true">
                  <div
                    className="band-range"
                    style={{
                      left: `${String(state.readiness.low)}%`,
                      width: `${String(Math.max(state.readiness.high - state.readiness.low, 1))}%`,
                    }}
                  />
                </div>
              )}
              {state.binding === 'employability' && (
                <p className="axis-label">This is what binds.</p>
              )}
            </div>
          </dl>

          {state.questions.length > 0 && (
            <div>
              {state.questions.map((question) => (
                <div className="question" key={question.key}>
                  <div>
                    <label htmlFor={question.key}>{question.prompt}</label>
                    <input
                      id={question.key}
                      inputMode="decimal"
                      value={answers[question.key] ?? ''}
                      onChange={(event) => {
                        setAnswers((previous) => ({ ...previous, [question.key]: event.target.value }));
                      }}
                    />
                  </div>
                  <button type="button" onClick={() => void submitAnswer(question.key)}>
                    Save and re-check
                  </button>
                </div>
              ))}
            </div>
          )}

          {note !== null && (
            <p className="hint" role="status">
              {note}
            </p>
          )}

          {state.eligibility.blockers.length > 0 && (
            <div>
              <h4>What blocks this</h4>
              <ul className="requirements">
                {state.eligibility.blockers.map((blocker) => (
                  <li className="requirement requirement-not_met" key={blocker}>
                    {blocker}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h4>Every rule we checked</h4>
          <ul className="requirements">
            {state.eligibility.requirements.map((requirement) => (
              // The status is a border colour AND a border *style* AND the word in `label` —
              // "Not answered yet" is a dashed edge, not a paler version of a decided rule.
              <li
                className={`requirement requirement-${requirement.result}`}
                key={requirement.requirementId}
              >
                <span className="requirement-label">{requirement.label}</span>{' '}
                <span className="requirement-id">{requirement.requirementId}</span>
                {requirement.detail !== null && (
                  <p className="requirement-detail">{requirement.detail}</p>
                )}
                <p className="requirement-source">
                  Decided by {requirement.authority}, in effect from {requirement.effectiveFrom}.{' '}
                  <a href={requirement.sourceUrl} rel="noreferrer noopener" target="_blank">
                    Read the source
                  </a>
                </p>
              </li>
            ))}
          </ul>

          {state.eligibility.notes.length > 0 && (
            <ul className="notes">
              {state.eligibility.notes.map((noteText) => (
                <li key={noteText}>{noteText}</li>
              ))}
            </ul>
          )}

          <div className="provenance">
            <p>
              As of <span className="numeric">{state.asOf}</span>. Confidence:{' '}
              {state.eligibility.confidence}.
            </p>
            {/* Verbatim. Never reworded, never shortened — it is what keeps this information
                rather than advice. */}
            <p>{state.disclaimer}</p>
          </div>
        </div>
      )}
    </section>
  );
}
