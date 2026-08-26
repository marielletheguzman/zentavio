import { describe, expect, it } from 'vitest';

import type { Connector, ConnectorKind, ConnectorMeta } from './contract.ts';
import { ConnectorRegistry, DuplicateConnectorError, UnknownConnectorError } from './registry.ts';

function stubConnector(
  id: string,
  kind: ConnectorKind = 'immigration',
  regions: readonly string[] = ['DE'],
): Connector<unknown, unknown> {
  const meta: ConnectorMeta = {
    id,
    version: '1.0.0',
    kind,
    regions,
    rateLimit: { requests: 1, windowMs: 1000 },
    reliability: 0,
    termsUrl: 'https://example.invalid/terms',
    displayName: `Stub ${id}`,
    sourceTier: 1,
    legalBasis: 'Stub source used only by this file; nothing is fetched.',
    refreshWindow: '30 days',
    schedule: '0 0 * * *',
  };
  return {
    meta,
    search: async () => ({ items: [] }),
    fetch: async () => null,
    normalize: (raw) => raw,
    validate: () => ({ issues: [] }),
    healthCheck: async () => ({ state: 'healthy' }),
  };
}

describe('ConnectorRegistry', () => {
  it('registers and retrieves by id', () => {
    const registry = new ConnectorRegistry().register(stubConnector('de-aufenthg'));

    expect(registry.get('de-aufenthg').meta.id).toBe('de-aufenthg');
    expect(registry.ids()).toEqual(['de-aufenthg']);
  });

  it('refuses a duplicate id rather than replacing it', () => {
    // A silent replacement would leave database rows citing `source_id` pointing at different
    // behaviour than the connector that wrote them, with nothing in the data revealing the swap.
    const registry = new ConnectorRegistry().register(stubConnector('de-aufenthg'));

    expect(() => registry.register(stubConnector('de-aufenthg'))).toThrow(DuplicateConnectorError);
    expect(registry.all()).toHaveLength(1);
  });

  it('names the registered ids when asked for an unknown one', () => {
    const registry = new ConnectorRegistry().register(stubConnector('de-aufenthg'));

    expect(() => registry.get('de-bundesanzeiger')).toThrow(UnknownConnectorError);
    expect(() => registry.get('de-bundesanzeiger')).toThrow(/de-aufenthg/);
  });

  it('returns undefined from find rather than throwing', () => {
    const registry = new ConnectorRegistry();

    expect(registry.find('nothing-here')).toBeUndefined();
  });

  it('filters by kind', () => {
    const registry = new ConnectorRegistry()
      .register(stubConnector('de-aufenthg', 'immigration'))
      .register(stubConnector('some-board', 'job-board'));

    expect(registry.byKind('immigration').map((c) => c.meta.id)).toEqual(['de-aufenthg']);
    expect(registry.byKind('salary')).toEqual([]);
  });

  it('matches a region, and includes wildcard connectors', () => {
    const registry = new ConnectorRegistry()
      .register(stubConnector('de-only', 'immigration', ['DE']))
      .register(stubConnector('everywhere', 'market', ['*']))
      .register(stubConnector('lu-only', 'immigration', ['LU']));

    expect(registry.byRegion('DE').map((c) => c.meta.id)).toEqual(['de-only', 'everywhere']);
  });

  it('does not case-fold a region', () => {
    // Silently folding here would let an inconsistent `regions` list pass unnoticed until a
    // country returned no sources at all — a failure that looks like missing coverage.
    const registry = new ConnectorRegistry().register(stubConnector('de-only', 'immigration', ['DE']));

    expect(registry.byRegion('de')).toEqual([]);
  });

  it('is a value, not a side effect — two registries do not share state', () => {
    const first = new ConnectorRegistry().register(stubConnector('de-aufenthg'));
    const second = new ConnectorRegistry();

    expect(first.ids()).toEqual(['de-aufenthg']);
    expect(second.ids()).toEqual([]);
  });
});
