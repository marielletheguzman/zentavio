/**
 * The connector registry (ADR-0002).
 *
 * This module is the **only** place in the repository that may reference a connector.
 * `services/ingestion` iterates the registry and never learns a source's name; `eslint.config.mjs`
 * makes `import { greenhouse }` inside `services/` a build error (ADR-0005).
 *
 * The registry is a value, not a side effect. Registration is explicit rather than
 * filesystem-scanned or import-side-effect driven, because a connector that appears in a run
 * depending on whether a module happened to be imported is a source of failures nobody can
 * reproduce.
 */

import type { Connector, ConnectorKind } from './contract.ts';

/** Any connector, whatever it reads and produces. The registry does not care. */
export type AnyConnector = Connector<unknown, unknown>;

export class DuplicateConnectorError extends Error {
  readonly id: string;

  constructor(id: string) {
    super(
      `Connector id '${id}' is already registered. Ids are foreign keys in the database and are ` +
        `never reused — pick a new id rather than replacing this one (ADR-0002).`,
    );
    this.name = 'DuplicateConnectorError';
    this.id = id;
  }
}

export class UnknownConnectorError extends Error {
  readonly id: string;

  constructor(id: string, known: readonly string[]) {
    super(`No connector registered with id '${id}'. Registered: ${known.join(', ') || '(none)'}.`);
    this.name = 'UnknownConnectorError';
    this.id = id;
  }
}

export class ConnectorRegistry {
  readonly #byId = new Map<string, AnyConnector>();

  /**
   * Add a connector.
   *
   * Rejects a duplicate id loudly. Silently replacing would mean a database row citing
   * `source_id` pointed at different behaviour than the one that wrote it, and nothing about
   * the data would reveal the swap.
   */
  register(connector: AnyConnector): this {
    const { id } = connector.meta;
    if (this.#byId.has(id)) throw new DuplicateConnectorError(id);
    this.#byId.set(id, connector);
    return this;
  }

  get(id: string): AnyConnector {
    const found = this.#byId.get(id);
    if (found === undefined) throw new UnknownConnectorError(id, this.ids());
    return found;
  }

  /** `undefined` rather than throwing, for callers deciding whether to act. */
  find(id: string): AnyConnector | undefined {
    return this.#byId.get(id);
  }

  ids(): readonly string[] {
    return [...this.#byId.keys()];
  }

  all(): readonly AnyConnector[] {
    return [...this.#byId.values()];
  }

  byKind(kind: ConnectorKind): readonly AnyConnector[] {
    return this.all().filter((connector) => connector.meta.kind === kind);
  }

  /**
   * Connectors that meaningfully cover a country, including those declaring `'*'`.
   *
   * Comparison is case-sensitive against ISO-3166-1 alpha-2 as stored. A connector declaring
   * `'de'` does not match `'DE'`, and that is deliberate: silently case-folding here would let
   * an inconsistent `regions` list pass unnoticed until a country returned no sources.
   */
  byRegion(region: string): readonly AnyConnector[] {
    return this.all().filter(
      (connector) => connector.meta.regions.includes('*') || connector.meta.regions.includes(region),
    );
  }
}
