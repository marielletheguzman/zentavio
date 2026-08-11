/**
 * The composed registry — the one place in the repository that names a connector (ADR-0002).
 *
 * **Deliberately not re-exported from `index.ts`.** A connector imports the contract and helpers
 * from `@zentavio/connectors-core`, and this module imports the connectors; folding it into the
 * main entry point would make that a runtime import cycle. Consumers reach it through the
 * `./registry` export path instead, which keeps the cycle at the package-manifest level where it
 * is harmless and off the module graph where it would not be.
 *
 * Adding a source touches this file, the source's own folder, `packages/config`, and tests —
 * nothing else. Any other file in that diff means ADR-0002 was violated.
 */

import { AufenthgConnector, type AufenthgDeps } from '@zentavio/connector-de-aufenthg';
import { BundesanzeigerConnector, type BundesanzeigerDeps } from '@zentavio/connector-de-bundesanzeiger';
import { LegiluxConnector, type LegiluxDeps } from '@zentavio/connector-lu-legilux';
import { InzConnector, type InzDeps } from '@zentavio/connector-nz-inz';

import { ConnectorRegistry } from './registry.ts';

/**
 * Per-source dependencies, supplied by the composition root rather than read here. A registry
 * that constructed its own HTTP clients would be untestable and would read configuration from a
 * layer that is not allowed to.
 */
export interface ConnectorDeps {
  readonly deBundesanzeiger: BundesanzeigerDeps;
  readonly deAufenthg: AufenthgDeps;
  readonly luLegilux: LegiluxDeps;
  readonly nzInz: InzDeps;
}

/**
 * Build the registry. A function rather than a module-level constant, so two callers cannot
 * share mutable state and a test can compose a registry with stubbed sources.
 */
export function createRegistry(deps: ConnectorDeps): ConnectorRegistry {
  return new ConnectorRegistry()
    .register(new BundesanzeigerConnector(deps.deBundesanzeiger))
    .register(new AufenthgConnector(deps.deAufenthg))
    .register(new LegiluxConnector(deps.luLegilux))
    .register(new InzConnector(deps.nzInz));
}
