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

import { toRegistration } from '@zentavio/connectors-core';
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

/**
 * A cron expression the scheduler could act on: five space-separated fields.
 *
 * Deliberately shallow. The point is not to reimplement a cron parser here — it is that a blank
 * string, a prose note, or a six-field Quartz expression pasted from elsewhere fails loudly instead
 * of sitting in `connector_sources.schedule` until a scheduler tries to read it.
 */
function isCronish(schedule: string): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field) => /^[*\d,\-/]+$/.test(field));
}

/** A PostgreSQL interval `refresh_window` can hold. `staleAfter` casts this column. */
function isIntervalish(window: string): boolean {
  return /^\d+ (hour|day|week|month|year)s?$/.test(window.trim());
}

/**
 * Every registered connector states a registration the database will accept (ADR-0041).
 *
 * **The type already guarantees the fields exist** — that is the enforcement the ADR chose, and it
 * is why six connectors had to be edited before this file could run. What a type cannot say is that
 * the strings mean anything: `legalBasis: ''` compiles, and would put a source in the table with no
 * recorded reason we are permitted to fetch it, which is the one thing the field exists to prevent.
 */
describe('every registered connector states a usable registration', () => {
  it('records why we are permitted to fetch it', () => {
    for (const connector of registry.all()) {
      const { id, legalBasis } = toRegistration(connector.meta);
      // A sentence, not a shrug. "We checked" is not a record, and neither is "".
      expect(legalBasis.trim().length, `${id} states no legal basis`).toBeGreaterThan(40);
    }
  });

  it('declares a knowledge tier the CHECK constraint accepts', () => {
    // `ck_cs__tier CHECK (source_tier BETWEEN 1 AND 4)`. A tier outside it fails at INSERT, which
    // is a worse place to find out than here.
    for (const connector of registry.all()) {
      const { id, sourceTier } = toRegistration(connector.meta);
      expect(sourceTier, `${id} declares tier ${String(sourceTier)}`).toBeGreaterThanOrEqual(1);
      expect(sourceTier, `${id} declares tier ${String(sourceTier)}`).toBeLessThanOrEqual(4);
    }
  });

  it('names itself as an operator would read it, not as the id repeated', () => {
    for (const connector of registry.all()) {
      const { id, displayName } = toRegistration(connector.meta);
      expect(displayName.trim().length, `${id} has no display name`).toBeGreaterThan(0);
      expect(displayName, `${id} repeats its id as a display name`).not.toBe(id);
    }
  });

  it('states a refresh window and a schedule the scheduler can act on', () => {
    for (const connector of registry.all()) {
      const { id, refreshWindow, schedule } = toRegistration(connector.meta);
      expect(isIntervalish(refreshWindow), `${id} refreshWindow: ${refreshWindow}`).toBe(true);
      expect(isCronish(schedule), `${id} schedule: ${schedule}`).toBe(true);
    }
  });

  it('projects the connector own version and rate limit, never a retyped copy', () => {
    // The defect ADR-0041 recorded: `posting-runner.test.ts` stored `{requests: 60, windowMs: 60_000}`
    // while the Lever connector declared `minIntervalMs: 1000`, so the persisted rate limit
    // disagreed with the limiter that actually ran. A projection cannot drift from its own source.
    for (const connector of registry.all()) {
      const registration = toRegistration(connector.meta);
      expect(registration.connectorVersion).toBe(connector.meta.version);
      expect(registration.rateLimit).toBe(connector.meta.rateLimit);
      expect(registration.regions).toBe(connector.meta.regions);
    }
  });
});
