'use client';

/**
 * Taking an assessment, and reading what a pass did — and did not — claim (ADR-0030).
 *
 * ## What this component is careful about
 *
 * **`doesNotEvidence` is rendered three times, on purpose**: before starting, on a pass, and on a
 * failure. A limit shown only in the small print of a success is a limit nobody reads, and the
 * whole reason this page exists is that a person can tell what our `evidenced` means about them.
 *
 * **The claim is never composed here.** Every sentence about what was shown comes from the
 * instrument's own `evidences` fields. A sentence written in the browser would be a claim nobody
 * authored and nobody could revise.
 *
 * **No answer key ever arrives.** The gateway omits it; this could not reveal it if it tried, and
 * the grade comes back from the server rather than being computed beside the questions.
 */

import { useCallback, useEffect, useId, useState } from 'react';

interface Option {
  readonly key: string;
  readonly text: string;
}

interface Item {
  readonly id: string;
  readonly position: number;
  readonly stem: string;
  readonly options: readonly Option[];
}

interface Assessment {
  readonly id: string;
  readonly slug: string;
  readonly version: number;
  readonly title: string;
  readonly description: string | null;
  readonly itemCount: number;
  readonly passThreshold: number;
  readonly doesNotEvidence: string;
}

interface Result {
  readonly score: number;
  readonly passThreshold: number;
  readonly itemCount: number;
  readonly passed: boolean;
  readonly evidenced: readonly { readonly evidences: string; readonly sourceUrl: string }[];
  readonly doesNotEvidence: string;
  readonly promotedSkillId: string | null;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' }
  | { readonly kind: 'offered'; readonly assessments: readonly Assessment[] }
  | { readonly kind: 'taking'; readonly assessment: Assessment; readonly attemptId: string; readonly items: readonly Item[] }
  | { readonly kind: 'done'; readonly assessment: Assessment; readonly result: Result }
  | { readonly kind: 'unavailable'; readonly reason: string };

export function AssessmentPanel({
  gatewayUrl,
  devUserId,
  skillSlug,
}: {
  gatewayUrl: string;
  devUserId: string;
  skillSlug: string;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const headingId = useId();

  const headers = useCallback(
    () => ({ 'content-type': 'application/json', 'x-zentavio-dev-user': devUserId }),
    [devUserId],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `${gatewayUrl}/v1/assessments?skill=${encodeURIComponent(skillSlug)}`,
          { headers: headers() },
        );
        if (!response.ok) throw new Error(`gateway returned ${String(response.status)}`);

        const body = (await response.json()) as { assessments: readonly Assessment[] };
        if (cancelled) return;

        setState(
          body.assessments.length === 0
            ? { kind: 'none' }
            : { kind: 'offered', assessments: body.assessments },
        );
      } catch (error) {
        if (!cancelled) {
          setState({ kind: 'unavailable', reason: error instanceof Error ? error.message : 'unknown' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, headers, skillSlug]);

  async function start(assessment: Assessment) {
    setAnswers({});
    try {
      const response = await fetch(`${gatewayUrl}/v1/assessments/${assessment.id}/attempts`, {
        method: 'POST',
        headers: headers(),
      });
      if (!response.ok) throw new Error(`gateway returned ${String(response.status)}`);

      const body = (await response.json()) as { attemptId: string; items: readonly Item[] };
      setState({ kind: 'taking', assessment, attemptId: body.attemptId, items: body.items });
    } catch (error) {
      setState({ kind: 'unavailable', reason: error instanceof Error ? error.message : 'unknown' });
    }
  }

  async function submit(assessment: Assessment, attemptId: string) {
    try {
      const response = await fetch(`${gatewayUrl}/v1/attempts/${attemptId}/answers`, {
        method: 'POST',
        headers: headers(),
        // Answers only. There is no score to send — the server computes it from its own key.
        body: JSON.stringify({ answers }),
      });
      if (!response.ok) throw new Error(`gateway returned ${String(response.status)}`);

      setState({ kind: 'done', assessment, result: (await response.json()) as Result });
    } catch (error) {
      setState({ kind: 'unavailable', reason: error instanceof Error ? error.message : 'unknown' });
    }
  }

  if (state.kind === 'loading') {
    return <p>Looking for assessments…</p>;
  }

  if (state.kind === 'unavailable') {
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId}>We could not load this</h2>
        <p>{state.reason}. Nothing about your profile has changed.</p>
      </section>
    );
  }

  if (state.kind === 'none') {
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId}>No assessment exists for this skill yet</h2>
        <p>
          That is a gap in what we have written, not a judgement about you. Until an assessment
          exists, this skill stays <strong>claimed</strong> — and claimed skills do not move your
          readiness.
        </p>
      </section>
    );
  }

  if (state.kind === 'offered') {
    return (
      <section aria-labelledby={headingId} id="assessment-heading">
        <h2 id={headingId}>Available now</h2>
        {state.assessments.map((assessment) => (
          <div className="card" key={assessment.id}>
            <h3>{assessment.title}</h3>
            {assessment.description === null ? null : <p>{assessment.description}</p>}
            <p>
              {assessment.itemCount} questions. {assessment.passThreshold} correct to pass.
            </p>
            {/* Before you start, not after you pass. */}
            <p className="hint">
              <strong>What passing this will not show:</strong> {assessment.doesNotEvidence}
            </p>
            <button type="button" onClick={() => void start(assessment)}>
              Start
            </button>
          </div>
        ))}
      </section>
    );
  }

  if (state.kind === 'taking') {
    const answered = Object.keys(answers).length;

    return (
      <section aria-labelledby={headingId} id="assessment-heading">
        <h2 id={headingId}>{state.assessment.title}</h2>
        <p className="hint">
          An unanswered question counts as wrong. {answered} of {state.items.length} answered.
        </p>

        {state.items.map((item) => (
          <fieldset className="card" key={item.id}>
            <legend>
              {item.position}. {item.stem}
            </legend>
            {item.options.map((option) => (
              <label key={option.key} htmlFor={`${item.id}-${option.key}`}>
                <input
                  type="radio"
                  id={`${item.id}-${option.key}`}
                  name={item.id}
                  value={option.key}
                  checked={answers[item.id] === option.key}
                  onChange={() => {
                    setAnswers((previous) => ({ ...previous, [item.id]: option.key }));
                  }}
                />
                {option.text}
              </label>
            ))}
          </fieldset>
        ))}

        <button type="button" onClick={() => void submit(state.assessment, state.attemptId)}>
          Submit answers
        </button>
      </section>
    );
  }

  const { result, assessment } = state;

  return (
    <section aria-labelledby={headingId} id="assessment-heading">
      <h2 id={headingId}>
        {result.passed ? 'Passed' : 'Not passed'} — {result.score} of {result.itemCount} correct
      </h2>
      <p>
        {result.passThreshold} correct were needed.{' '}
        {result.passed
          ? result.promotedSkillId === null
            ? 'Your profile could not be updated because you do not have one yet; the result stands and is recorded.'
            : 'This skill is now evidenced on your profile, and your readiness reflects it.'
          : 'Nothing on your profile changed. You can take this again.'}
      </p>

      {result.passed && result.evidenced.length > 0 ? (
        <div className="card">
          <h3>What this showed</h3>
          {/* Only the questions actually answered correctly. Listing every claim on a pass would
              credit somebody with capabilities they demonstrably did not show. */}
          <ul>
            {result.evidenced.map((claim) => (
              <li key={claim.sourceUrl + claim.evidences}>
                {claim.evidences}{' '}
                <a href={claim.sourceUrl} rel="noreferrer noopener" target="_blank">
                  Read the source
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Rendered whether they passed or failed: the limit of the instrument is not a consolation
          prize handed to people who did badly. */}
      <div className="card">
        <h3>What it does not show</h3>
        <p>{result.doesNotEvidence}</p>
      </div>

      <p className="hint">
        {assessment.title} — version {assessment.version}. A later version may ask different
        questions; this result stays attached to the one you took.
      </p>
    </section>
  );
}
