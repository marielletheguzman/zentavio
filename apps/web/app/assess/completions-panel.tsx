'use client';

/**
 * What you have read, recorded — and visibly not counted (M6).
 *
 * This sits under the assessment on the same page **on purpose**. The milestone's own sentence is
 * *"visible to the user, so nobody optimizes for completions"*, and the way to make that visible is
 * to put the thing that does not move readiness next to the thing that does, with each saying which
 * it is.
 *
 * Marking something finished writes a row about a *resource*. Nothing about the person changes: no
 * skill, no status, no readiness. The panel says that before you click and again after.
 */

import { useCallback, useEffect, useState } from 'react';

interface Resource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly format: string;
  readonly costBand: string;
  readonly coverage: string;
  readonly completedAt: string | null;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly resources: readonly Resource[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

export function CompletionsPanel({
  gatewayUrl,
  devUserId,
  skillSlug,
}: {
  gatewayUrl: string;
  devUserId: string;
  skillSlug: string;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [note, setNote] = useState<string | null>(null);

  const headers = useCallback(
    () => ({ 'content-type': 'application/json', 'x-zentavio-dev-user': devUserId }),
    [devUserId],
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `${gatewayUrl}/v1/learning-resources?skill=${encodeURIComponent(skillSlug)}`,
        { headers: headers() },
      );
      if (!response.ok) throw new Error(`gateway returned ${String(response.status)}`);

      const body = (await response.json()) as { resources: readonly Resource[] };
      setState({ kind: 'ready', resources: body.resources });
    } catch (error) {
      setState({ kind: 'unavailable', reason: error instanceof Error ? error.message : 'unknown' });
    }
  }, [gatewayUrl, headers, skillSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markFinished(resource: Resource) {
    try {
      const response = await fetch(`${gatewayUrl}/v1/learning-completions`, {
        method: 'POST',
        headers: headers(),
        // No skill and no score. A completion is about the resource; what it demonstrated is not
        // ours to infer and not the caller's to assert.
        body: JSON.stringify({ resourceId: resource.id, completedAt: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error(`gateway returned ${String(response.status)}`);

      setNote(
        `Recorded that you finished “${resource.title}”. Your readiness is unchanged — reading is ` +
          'not evidence, and nothing about your profile moved.',
      );
      await load();
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That did not save.');
    }
  }

  if (state.kind === 'loading') return <p>Loading what is worth reading…</p>;

  if (state.kind === 'unavailable') {
    return (
      <section>
        <h2>We could not load the reading list</h2>
        <p>{state.reason}. Nothing about your profile has changed.</p>
      </section>
    );
  }

  if (state.resources.length === 0) {
    return (
      <section>
        <h2>Nothing catalogued for this skill yet</h2>
        <p>That is a gap in what we have ingested, not a judgement about the material that exists.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>What is worth reading</h2>
      <p className="hint">
        Marking something finished records that you read it. <strong>It does not move your
        readiness</strong> — only a passed assessment does that, and only for the skill it covers.
      </p>

      {note === null ? null : <p role="status">{note}</p>}

      <ul>
        {state.resources.map((resource) => (
          <li key={resource.id}>
            <a href={resource.url} rel="noreferrer noopener" target="_blank">
              {resource.title}
            </a>{' '}
            <span className="hint">
              {resource.format} · {resource.costBand}
            </span>{' '}
            {resource.completedAt === null ? (
              <button type="button" onClick={() => void markFinished(resource)}>
                Mark finished
              </button>
            ) : (
              <span className="hint">
                Finished {resource.completedAt.slice(0, 10)} — still counted as claimed, not
                evidenced.
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
