/**
 * ADR-0002's compliance check: a connector that exists is a connector the registry knows about.
 *
 * `docs/architecture/connectors.md` says adding a source is *"one folder plus one registry line"*,
 * and `docs/development/connector-guide.md` makes the registry line Step 7. Nothing enforced it,
 * and `git-scm` shipped in #129 without one — reachable only by an integration test importing the
 * class directly, which `eslint.config.mjs` permits for tests and which therefore looked fine.
 *
 * **The omission had no runtime symptom**, because nothing composes `createRegistry` yet. That is
 * exactly why it needs a test rather than vigilance: the failure is invisible until the day a
 * service iterates the registry and a source is silently absent from a run nobody knows is short.
 *
 * There is a second reason this class of mistake is easy to make. `registerConnectorSource` writes a
 * `connector_sources` row and is also called "registering"; #129 did that one and skipped this one.
 * Two operations, one word.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { createRegistry, type ConnectorDeps } from '@zentavio/connectors-core/registry';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONNECTORS = join(ROOT, 'connectors');

/** `connectors/core` is the SDK and the registry itself, not a source. */
const NOT_A_SOURCE = new Set(['core']);

/**
 * Composed with no dependencies at all.
 *
 * The invariant is about **registration**, not about what a source needs to run, and stubbing every
 * connector's dependencies here would mean this file changes for reasons that have nothing to do
 * with what it asserts. It works because a connector's constructor may only store what it is given —
 * a constructor that fetched, read configuration, or validated its dependencies would fail here,
 * loudly, which is the right outcome for a connector doing work at construction time.
 */
const registry = createRegistry({} as unknown as ConnectorDeps);

/**
 * A **built** connector: `connectors/<kind>/<id>/package.json`.
 *
 * The manifest is what separates a source from a structure placeholder. `job-boards/greenhouse` and
 * its siblings are directories holding a README that states a purpose and nothing else; they are not
 * missing registrations, they are not yet connectors.
 */
function builtConnectors(): readonly string[] {
  const found: string[] = [];
  for (const kind of readdirSync(CONNECTORS)) {
    if (NOT_A_SOURCE.has(kind)) continue;
    const kindPath = join(CONNECTORS, kind);
    if (!statSync(kindPath).isDirectory()) continue;

    for (const id of readdirSync(kindPath)) {
      const idPath = join(kindPath, id);
      if (!statSync(idPath).isDirectory()) continue;
      if (existsSync(join(idPath, 'package.json'))) found.push(id);
    }
  }
  return found.sort();
}

describe('every built connector is registered', () => {
  it('finds the connectors on disk, so an empty list cannot pass this file', () => {
    // A discovery bug that returned nothing would make every assertion below vacuously true.
    expect(builtConnectors().length).toBeGreaterThanOrEqual(6);
  });

  it('registers each one in `createRegistry`', () => {
    // The failure this catches: a new connector folder, fully built and tested, that no run will
    // ever execute because the one line composing it was never added.
    for (const id of builtConnectors()) {
      expect(registry.ids(), `connectors/*/${id} is built but not in createRegistry`).toContain(id);
    }
  });

  it('registers nothing that is not on disk', () => {
    // The other direction: a registration outliving the folder it names would fail at import rather
    // than here, but a registration whose id drifted from its directory would not fail at all —
    // and `meta.id` is a foreign key, so the drift would be invisible and permanent.
    for (const id of registry.ids()) {
      expect(builtConnectors(), `${id} is registered with no connectors/*/${id} directory`).toContain(id);
    }
  });

  it('gives every registered connector a distinct id', () => {
    // `ConnectorRegistry` refuses a duplicate loudly; this asserts the guarantee rather than the
    // mechanism, so replacing the registry implementation cannot quietly drop it.
    expect(new Set(registry.ids()).size).toBe(registry.ids().length);
  });
});
