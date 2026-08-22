import { describe, expect, it } from 'vitest';

import { boardsFrom, composeRegistry, realConnectorDeps, type SourceConfig } from './default-deps.ts';

const CONFIG: SourceConfig = { leverBoards: 'leverdemo', leverApiBase: 'https://api.lever.co' };

const RUNTIME = {
  now: () => new Date('2026-08-23T00:00:00Z'),
  fetchImpl: (async () => ({ ok: true, status: 200, json: async () => [] }) as Response) as unknown as typeof fetch,
};

describe('boards come from configuration', () => {
  it('reads a comma-separated list', () => {
    expect(boardsFrom('leverdemo,acme')).toEqual(['leverdemo', 'acme']);
  });

  it('tolerates spacing and repetition without inventing anything', () => {
    expect(boardsFrom(' leverdemo , acme ,leverdemo')).toEqual(['leverdemo', 'acme']);
  });

  it('reads no boards from an empty configuration', () => {
    // Empty is a valid deployment: the connector reports `degraded` rather than pretending.
    expect(boardsFrom('')).toEqual([]);
    expect(boardsFrom(' , ')).toEqual([]);
  });
});

describe('the composed registry', () => {
  it('registers every connector, so composition supplies every slot', () => {
    const registry = composeRegistry(CONFIG, RUNTIME);

    expect(registry.byKind('job-board').map((connector) => connector.meta.id)).toEqual(['lever']);
    expect(registry.ids().length).toBeGreaterThanOrEqual(7);
  });

  it('gives the job board the boards that were configured', () => {
    expect(realConnectorDeps({ ...CONFIG, leverBoards: 'a,b' }, RUNTIME).lever.configuredBoards).toEqual(['a', 'b']);
  });

  it('makes a source with no fetcher fail loudly rather than answer emptily', async () => {
    // "Not wired" must never read as "nothing there" — the failure this codebase keeps finding.
    const deps = realConnectorDeps(CONFIG, RUNTIME);

    await expect(deps.luLegilux.fetchInstruments('x' as never)).rejects.toMatchObject({ sourceId: 'lu-legilux' });
    await expect(deps.gitScm.fetchPage('git-stash')).rejects.toThrow(/no fetcher/);
  });
});
