import { describe, expect, it } from 'vitest';

import { createRegistry } from './default-registry.ts';

const stubDeps = {
  deBundesanzeiger: {
    knownPublications: ['BAnz AT 18.12.2025 B3'],
    fetchDocument: async () => null,
  },
  deAufenthg: {
    knownDocuments: ['AufenthG-18g'],
    fetchDocument: async () => null,
  },
  deBayingg: {
    fetchDocument: async () => null,
  },
  luLegilux: {
    fetchInstruments: async () => null,
  },
  nzInz: {
    fetchInstructions: async () => null,
  },
  chSem: {
    fetchDirective: async () => null,
  },
  lever: {
    fetchBoard: async () => null,
    configuredBoards: ['leverdemo'],
  },
  gitScm: {
    fetchPage: async () => null,
  },
};

describe('createRegistry', () => {
  it('registers the German immigration sources', () => {
    const registry = createRegistry(stubDeps);

    expect(registry.ids()).toContain('de-bundesanzeiger');
    // Germany's Blue Card rule is two sources: the statute and the annual announcement.
    expect(registry.ids()).toContain('de-aufenthg');
    expect(registry.byKind('immigration').map((c) => c.meta.id)).toContain('de-bundesanzeiger');
    expect(registry.byRegion('DE').map((c) => c.meta.id)).toContain('de-bundesanzeiger');
  });

  it('registers Bavaria, whose rules are a Land’s and not the federation’s', () => {
    // `de-bayingg` shipped for M5 and was never composed here, which the connector-registration
    // invariant found. A recognition rule nobody can reach through the registry is a rule a run
    // silently omits — and this one is the only source of an origin-scoped `recognition` row.
    const registry = createRegistry(stubDeps);

    expect(registry.ids()).toContain('de-bayingg');
    expect(registry.byRegion('DE').map((c) => c.meta.id)).toContain('de-bayingg');
  });

  it('registers Luxembourg, and keeps it out of the German region', () => {
    // The registry is how a second country arrives without a code change anywhere else (ADR-0002).
    // Region scoping is what makes `byRegion` usable for "what do we know about DE?" — a connector
    // answering for the wrong country would be worse than one missing.
    const registry = createRegistry(stubDeps);

    expect(registry.ids()).toContain('lu-legilux');
    expect(registry.byRegion('LU').map((c) => c.meta.id)).toEqual(['lu-legilux']);
    expect(registry.byRegion('DE').map((c) => c.meta.id)).not.toContain('lu-legilux');
  });

  it('registers New Zealand in its own region', () => {
    const registry = createRegistry(stubDeps);

    expect(registry.ids()).toContain('nz-inz');
    expect(registry.byRegion('NZ').map((c) => c.meta.id)).toEqual(['nz-inz']);
    expect(registry.byRegion('DE').map((c) => c.meta.id)).not.toContain('nz-inz');
  });

  it('registers Switzerland, completing the four M4 destinations', () => {
    const registry = createRegistry(stubDeps);

    expect(registry.ids()).toContain('ch-sem');
    expect(registry.byRegion('CH').map((c) => c.meta.id)).toEqual(['ch-sem']);
    // Four countries, four regions, no connector answering for a country that is not its own.
    expect(new Set(registry.all().flatMap((c) => c.meta.regions))).toEqual(
      new Set(['DE', 'LU', 'NZ', 'CH']),
    );
  });

  it('registers the first job board, and it answers for no country', () => {
    // A source is not necessarily a country. Lever's coverage is whatever the configured employers
    // happen to post, which is unknown until a board is read — so it declares no regions rather
    // than claiming one, and `byRegion` keeps answering with immigration sources alone.
    const registry = createRegistry(stubDeps);

    expect(registry.ids()).toContain('lever');
    expect(registry.byKind('job-board').map((c) => c.meta.id)).toEqual(['lever']);
    expect(registry.byRegion('DE').map((c) => c.meta.id)).not.toContain('lever');
  });

  it('registers the Git documentation catalogue, which answers for no country', () => {
    // A learning source is not a destination. `git-scm` shipped in #129 with its folder, its tests
    // and a `connector_sources` row, and without this line — `registerConnectorSource` writes a
    // database row and is also called registering, so the one that was skipped looked done.
    const registry = createRegistry(stubDeps);

    expect(registry.ids()).toContain('git-scm');
    expect(registry.byKind('learning').map((c) => c.meta.id)).toEqual(['git-scm']);
    expect(registry.byRegion('DE').map((c) => c.meta.id)).not.toContain('git-scm');
  });

  it('returns a fresh registry each call, so callers cannot share mutable state', () => {
    expect(createRegistry(stubDeps)).not.toBe(createRegistry(stubDeps));
  });

  it('declares every connector at tier-appropriate reliability of zero until observed', () => {
    // Reliability is derived from validation pass rate and outcome feedback. A connector
    // shipping at 1 asserts a track record it does not have.
    for (const connector of createRegistry(stubDeps).all()) {
      expect(connector.meta.reliability).toBe(0);
    }
  });

  it('gives every connector a terms URL, which is the record that it was checked', () => {
    for (const connector of createRegistry(stubDeps).all()) {
      expect(connector.meta.termsUrl).toMatch(/^https:\/\//);
    }
  });
});
