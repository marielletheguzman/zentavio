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
  toEligibilityView,
  toFactValue,
  type EligibilityViewState,
  type PromptLookup,
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
  const [state, setState] = useState<EligibilityViewState>({ kind: 'idle' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(today);
  const asOfId = useId();

  async function evaluate(date: string) {
    setState({ kind: 'loading' });
    setNote(null);
    try {
      const response = await fetch(
        `${gatewayUrl}/v1/eligibility?pathway=${encodeURIComponent(pathway)}&asOf=${encodeURIComponent(date)}`,
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

      setState(toEligibilityView(await response.json(), FALLBACK_PROMPTS));
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
        <p>
          Immigration rules change. An answer is only meaningful against a date, so this one is
          shown on every result rather than assumed.
        </p>
        <button type="button" onClick={() => void evaluate(asOf)}>
          Check eligibility
        </button>
      </div>

      {state.kind === 'idle' && (
        <p>Choose a date and check. Nothing is submitted until you do.</p>
      )}

      {state.kind === 'loading' && <p role="status">Checking the rules on file…</p>}

      {state.kind === 'error' && (
        <div role="alert">
          <p>{state.message}</p>
          {state.retryable && (
            <button type="button" onClick={() => void evaluate(asOf)}>
              Try again
            </button>
          )}
        </div>
      )}

      {state.kind === 'verdict' && (
        <div>
          <h3>{state.headline}</h3>
          <p>{state.explanation}</p>

          {state.questions.length > 0 && (
            <div>
              {state.questions.map((question) => (
                <div key={question.key}>
                  <label htmlFor={question.key}>{question.prompt}</label>
                  <input
                    id={question.key}
                    inputMode="decimal"
                    value={answers[question.key] ?? ''}
                    onChange={(event) => {
                      setAnswers((previous) => ({ ...previous, [question.key]: event.target.value }));
                    }}
                  />
                  <button type="button" onClick={() => void submitAnswer(question.key)}>
                    Save and re-check
                  </button>
                </div>
              ))}
            </div>
          )}

          {note !== null && <p role="status">{note}</p>}

          {state.blockers.length > 0 && (
            <div>
              <h4>What blocks this</h4>
              <ul>
                {state.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}

          <h4>Every rule we checked</h4>
          <ul>
            {state.requirements.map((requirement) => (
              <li key={requirement.requirementId}>
                <strong>{requirement.label}</strong> — {requirement.requirementId}
                {requirement.detail !== null && <p>{requirement.detail}</p>}
                <p>
                  Decided by {requirement.authority}, in effect from {requirement.effectiveFrom}.{' '}
                  <a href={requirement.sourceUrl} rel="noreferrer noopener" target="_blank">
                    Read the source
                  </a>
                </p>
              </li>
            ))}
          </ul>

          {state.notes.length > 0 && (
            <ul>
              {state.notes.map((noteText) => (
                <li key={noteText}>{noteText}</li>
              ))}
            </ul>
          )}

          <p>
            As of {state.asOf}. Confidence: {state.confidence}.
          </p>
          {/* Verbatim. Never reworded, never shortened — it is what keeps this information
              rather than advice. */}
          <p>{state.disclaimer}</p>
        </div>
      )}
    </section>
  );
}
