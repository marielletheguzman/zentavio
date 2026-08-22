import { ConnectorError } from '@zentavio/connectors-core';
import { describe, expect, it } from 'vitest';

import { boardUrl, httpLeverDeps } from './http.ts';

/** A `fetch` that answers from memory. No test in this repository makes a network call. */
function respondWith(body: unknown, init: { status?: number; json?: boolean } = {}) {
  const status = init.status ?? 200;
  const calls: string[] = [];

  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (init.json === false ? Promise.reject(new Error('not json')) : body),
    } as Response;
  }) as unknown as typeof globalThis.fetch;

  return { fetchImpl, calls };
}

const NOW = () => new Date('2026-08-23T00:00:00Z');

describe('the endpoint it calls', () => {
  it('builds the documented Postings API URL', () => {
    expect(boardUrl('leverdemo')).toBe('https://api.lever.co/v0/postings/leverdemo?mode=json');
  });

  it('escapes a slug rather than trusting it into the path', () => {
    expect(boardUrl('odd/slug')).toContain('odd%2Fslug');
  });

  it('honours a configured base, so a run can point at a recorded stub', () => {
    expect(boardUrl('leverdemo', 'http://127.0.0.1:9999/')).toBe(
      'http://127.0.0.1:9999/v0/postings/leverdemo?mode=json',
    );
  });
});

describe('reading a board', () => {
  it('returns the postings as served, with the time they were read', async () => {
    const { fetchImpl, calls } = respondWith([{ id: 'a', text: 'Engineer' }]);
    const deps = httpLeverDeps({ boards: ['leverdemo'], fetchImpl, now: NOW });

    const board = await deps.fetchBoard('leverdemo');

    expect(calls).toEqual(['https://api.lever.co/v0/postings/leverdemo?mode=json']);
    expect(board).toMatchObject({ board: 'leverdemo', fetchedAt: '2026-08-23T00:00:00.000Z' });
    expect(board?.postings).toHaveLength(1);
  });

  it('treats a 404 as a board that is gone, not a failure', async () => {
    // Gone is data. The connector reports `degraded`; throwing here would make a retired board look
    // like an outage and open a breaker over it.
    const { fetchImpl } = respondWith(null, { status: 404 });
    const deps = httpLeverDeps({ boards: ['leverdemo'], fetchImpl, now: NOW });

    expect(await deps.fetchBoard('leverdemo')).toBeNull();
  });

  it('reports a rate limit as retryable and a bad request as not', async () => {
    // Retrying a 403 hides a legal problem behind a delay; the kind is what keeps `withRetry` honest.
    const limited = httpLeverDeps({ boards: ['b'], fetchImpl: respondWith(null, { status: 429 }).fetchImpl, now: NOW });
    const refused = httpLeverDeps({ boards: ['b'], fetchImpl: respondWith(null, { status: 403 }).fetchImpl, now: NOW });

    await expect(limited.fetchBoard('b')).rejects.toMatchObject({ kind: 'rate-limited', sourceId: 'lever' });
    await expect(refused.fetchBoard('b')).rejects.toBeInstanceOf(ConnectorError);
  });

  it('refuses a response that is not the array the API documents', async () => {
    // Guessing at an unfamiliar shape would produce postings nobody published.
    const { fetchImpl } = respondWith({ postings: [] });
    const deps = httpLeverDeps({ boards: ['b'], fetchImpl, now: NOW });

    await expect(deps.fetchBoard('b')).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('carries the configured boards through, and invents none', async () => {
    const { fetchImpl } = respondWith([]);
    expect(httpLeverDeps({ boards: [], fetchImpl }).configuredBoards).toEqual([]);
    expect(httpLeverDeps({ boards: ['a', 'b'], fetchImpl }).configuredBoards).toEqual(['a', 'b']);
  });
});
