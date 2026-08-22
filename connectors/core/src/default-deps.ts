/**
 * Real dependencies for every registered connector (ADR-0002).
 *
 * **This lives beside the registry because it names connectors, and `connectors/core` is the only
 * module allowed to.** It first sat in `services/ingestion`, where composition naturally belongs —
 * and `eslint.config.mjs` rejected it: *"a service that names a source has broken the plugin
 * boundary"*. The rule was right. A service that constructs `httpLeverDeps` knows which sources
 * exist, and adding a second board would then edit a service, which is the property ADR-0002 exists
 * to prevent.
 *
 * Configuration arrives as a value. A module that read `packages/config` itself would decide its own
 * dependencies from a layer that is not permitted to.
 *
 * ## Sources with no fetcher
 *
 * Only Lever has one. The five immigration sources and `git-scm` have always been driven by fixtures
 * in tests; no production client was ever written for them.
 *
 * They are wired to `unwired()`, which **throws with the source named** rather than returning empty
 * results. A stub returning `null` would make an unwired source indistinguishable from a source that
 * answered and had nothing — the failure this codebase keeps finding, in expiry, in health checks,
 * and in `salary_is_stated`.
 */

import { httpLeverDeps } from '@zentavio/connector-lever/http';

import { createRegistry, type ConnectorDeps } from './default-registry.ts';
import { ConnectorError } from './errors.ts';
import type { ConnectorRegistry } from './registry.ts';

/** The configuration the sources need. Passed in, never read here. */
export interface SourceConfig {
  /** Comma-separated Lever board slugs. Empty reads no boards, which is a valid deployment. */
  readonly leverBoards: string;
  readonly leverApiBase: string;
}

export interface SourceRuntime {
  /** Injected so composition itself is testable without a network. */
  readonly fetchImpl?: typeof globalThis.fetch;
  /** Injected so `fetchedAt` is not read from a global clock inside the pipeline. */
  readonly now: () => Date;
}

/** Board slugs, trimmed and de-duplicated. An empty configuration yields an empty list, not a guess. */
export function boardsFrom(configured: string): readonly string[] {
  return [
    ...new Set(
      configured
        .split(',')
        .map((slug) => slug.trim())
        .filter((slug) => slug !== ''),
    ),
  ];
}

/** A source nobody has written a fetcher for. Throws, so "not wired" never reads as "nothing there". */
function unwired(sourceId: string): never {
  throw new ConnectorError(
    `${sourceId} has no fetcher: no production client was ever written for it, and it has only ever run against fixtures.`,
    { kind: 'request', sourceId },
  );
}

/** Every connector's dependencies, real where one exists. */
export function realConnectorDeps(config: SourceConfig, runtime: SourceRuntime): ConnectorDeps {
  const lever = httpLeverDeps({
    boards: boardsFrom(config.leverBoards),
    apiBase: config.leverApiBase,
    ...(runtime.fetchImpl === undefined ? {} : { fetchImpl: runtime.fetchImpl }),
    now: runtime.now,
  });

  return {
    deBundesanzeiger: { knownPublications: [], fetchDocument: async () => unwired('de-bundesanzeiger') },
    deAufenthg: { knownDocuments: [], fetchDocument: async () => unwired('de-aufenthg') },
    deBayingg: { fetchDocument: async () => unwired('de-bayingg') },
    luLegilux: { fetchInstruments: async () => unwired('lu-legilux') },
    nzInz: { fetchInstructions: async () => unwired('nz-inz') },
    chSem: { fetchDirective: async () => unwired('ch-sem') },
    gitScm: { fetchPage: async () => unwired('git-scm') },
    lever,
  };
}

/** The composed registry, ready to run. */
export function composeRegistry(config: SourceConfig, runtime: SourceRuntime): ConnectorRegistry {
  return createRegistry(realConnectorDeps(config, runtime));
}
