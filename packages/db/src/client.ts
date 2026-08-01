/**
 * The Kysely client (ADR-0012).
 *
 * Two factories, deliberately. `createDb` connects; `createCompileOnlyDb` compiles queries without
 * a connection, which is what makes repository SQL verifiable before any PostgreSQL exists. It is
 * **not** a substitute for integration tests — `docs/development/testing.md` forbids mocking
 * PostgreSQL, and a compiled query proves the SQL we *send*, never that the database accepts it.
 */

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresDialect,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { Pool, types as pgTypes } from 'pg';
import type { Database } from './schema.ts';

/** PostgreSQL OID for `date`. */
const PG_TYPE_DATE = 1082;

/**
 * Return DATE columns as strings instead of Date objects.
 *
 * `pg` parses DATE into a Date at local midnight, so `2026-01-01` read in a negative-offset
 * timezone becomes `2025-12-31` once formatted. Rule validity windows decide eligibility verdicts,
 * so an off-by-one day is a wrong answer, not a cosmetic issue. `schema.ts` types DATE as a string;
 * this is what makes that true at runtime.
 */
export function configureDateParsing(): void {
  pgTypes.setTypeParser(PG_TYPE_DATE, (value) => value);
}

export interface DbConnectionOptions {
  readonly connectionString: string;
  readonly maxConnections: number;
  /** Fail fast rather than queueing forever behind an exhausted pool. */
  readonly connectionTimeoutMs?: number;
}

export function createDb(options: DbConnectionOptions): Kysely<Database> {
  configureDateParsing();
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: options.connectionString,
        max: options.maxConnections,
        connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
      }),
    }),
  });
}

/**
 * Compiles SQL, executes nothing. Every query built through a repository can therefore be asserted
 * exactly — including that a parameter is bound rather than interpolated, which is the difference
 * between a query and an injection.
 */
export function createCompileOnlyDb(): Kysely<Database> {
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}
