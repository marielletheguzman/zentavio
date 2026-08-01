'use client';

/**
 * The upload surface — all five states.
 *
 * A Client Component because it owns interaction and transient state. Everything derived from the
 * response lives in `lib/parse-view.ts`, which is pure and tested; this file is markup and the
 * fetch.
 *
 * **Data goes through the API gateway only** (`.claude/skills/frontend/SKILL.md`). The browser never
 * talks to `ai/resume-parser` directly — it is an internal service with no auth of its own, and a
 * page that could reach it would be an open parsing endpoint.
 */

import { useId, useRef, useState } from 'react';
import { viewStateFor, summaryFor, type ViewState, type SkillView } from '../../lib/parse-view.ts';

const ACCEPTED = '.pdf,.docx,text/plain';

export function UploadPanel({ gatewayUrl, userId }: { gatewayUrl: string; userId: string }) {
  const [state, setState] = useState<ViewState>({ kind: 'empty' });
  const fileInputId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setState({ kind: 'error', message: 'Choose a résumé file first.', retryable: false });
      return;
    }

    setState({ kind: 'loading' });
    form.set('userId', userId);

    try {
      const response = await fetch(`${gatewayUrl}/v1/resume/upload`, { method: 'POST', body: form });
      const body: unknown = await response.json();

      if (!response.ok) {
        // `retryable` comes from the envelope rather than from the status code, because it is part
        // of the error contract — the service decides, not the UI.
        const error = (body as { error?: { message?: string; retryable?: boolean } }).error;
        setState({
          kind: 'error',
          message: error?.message ?? 'The upload failed.',
          retryable: error?.retryable === true,
        });
        return;
      }

      setState(viewStateFor(body as Parameters<typeof viewStateFor>[0]));
    } catch {
      // Network-level failure. Retryable by nature, and the message says so rather than showing a
      // raw error — `ui-guidelines.md` forbids a bare code.
      setState({
        kind: 'error',
        message: 'Could not reach the server.',
        retryable: true,
      });
    }
  }

  return (
    <section aria-labelledby="upload-heading">
      <h2 id="upload-heading">Upload your résumé</h2>

      <form ref={formRef} onSubmit={onSubmit}>
        <label htmlFor={fileInputId}>Résumé file (PDF or DOCX)</label>
        <input id={fileInputId} name="file" type="file" accept={ACCEPTED} required />
        <button type="submit" disabled={state.kind === 'loading'}>
          {state.kind === 'loading' ? 'Reading…' : 'Upload'}
        </button>
      </form>

      {/*
        Async results are announced (`ui-guidelines.md`). `polite` rather than `assertive` because
        finishing a parse is not an emergency — it should not interrupt what a screen reader is
        already saying.
      */}
      <div aria-live="polite" aria-busy={state.kind === 'loading'}>
        <StateView state={state} onRetry={() => formRef.current?.requestSubmit()} />
      </div>
    </section>
  );
}

function StateView({ state, onRetry }: { state: ViewState; onRetry: () => void }) {
  switch (state.kind) {
    case 'empty':
      // Says why it is empty and offers the next action, rather than "No results".
      return (
        <p>
          No profile yet. Upload a résumé and we will show what we read from it — and what we could
          not.
        </p>
      );

    case 'loading':
      // A skeleton matching the final layout: no spinner in a void, no layout shift on arrival.
      return (
        <ul aria-hidden="true" className="skeleton">
          {[0, 1, 2].map((row) => (
            <li key={row} className="skeleton-row" />
          ))}
        </ul>
      );

    case 'error':
      return (
        <div role="alert">
          <h3>That did not work</h3>
          <p>{state.message}</p>
          {state.retryable ? (
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          ) : (
            <p>Choose a different file, or enter your profile manually.</p>
          )}
        </div>
      );

    case 'unknown':
      // A first-class state with a designed treatment — not an empty cell, and never a zero.
      return (
        <div className="unknown">
          <h3>We could not read this document</h3>
          <p>{state.reason}</p>
          <p>Nothing was guessed, and nothing was saved.</p>
        </div>
      );

    case 'partial':
      return (
        <div>
          <h3>Partly read</h3>
          {/* What loaded is shown; what did not is named; the page stays usable. */}
          <p className="caveat">{state.reason}</p>
          <SkillList skills={state.skills} stored={state.stored} />
        </div>
      );

    case 'success':
      return (
        <div>
          <h3>What we read</h3>
          <SkillList skills={state.skills} stored={state.stored} />
        </div>
      );
  }
}

function SkillList({ skills, stored }: { skills: readonly SkillView[]; stored: boolean }) {
  if (skills.length === 0) {
    return <p>{summaryFor(skills)}</p>;
  }

  return (
    <>
      <p>{summaryFor(skills)}</p>
      {!stored && <p>This was not saved to your profile.</p>}

      <ul className="skills">
        {skills.map((skill) => (
          <li key={skill.slug} className={skill.confidence === 'low' ? 'skill skill-low' : 'skill'}>
            <span className="skill-name">{skill.label}</span>

            {/*
              Evidenced and claimed are words, not colours — the distinction is what makes every
              downstream number honest, and it must survive a monochrome screen.
            */}
            <span className="skill-status">
              {skill.evidenced ? 'Used in described work' : 'Listed only'}
            </span>
            <span className="skill-confidence">{skill.confidenceLabel}</span>

            {/*
              The evidence, reachable inline. A bare claim with no visible basis is a defect
              (`ui-guidelines.md`), and it is also what the user needs in order to disagree.
            */}
            <details>
              <summary>Why we think so</summary>
              <blockquote>{skill.sourceSpan}</blockquote>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
