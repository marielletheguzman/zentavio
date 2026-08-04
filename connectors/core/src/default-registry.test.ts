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
