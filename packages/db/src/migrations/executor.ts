/**
 * The PostgreSQL-backed `MigrationExecutor` (ADR-0012).
 *
 * `runner.ts` decides *what* to apply and refuses what would corrupt history; this decides *how* to
 * talk to a database. Keeping them apart is what lets the dangerous half — ordering, idempotence,
 * checksums — be tested without a server.
 */

import type { Pool, PoolClient } from 'pg';
import type { MigrationExecutor } from './runner.js';

/**
 * The runner's own bookkeeping table.
 *
 * Created here rather than as migration `00000000000000-create-schema-migrations.sql`, because a
 * migration cannot record that it was applied in a table that does not exist yet. `IF NOT EXISTS`
 * makes the bootstrap idempotent, which is the same property every migration needs anyway.
 *
 * No `updated_at`/`deleted_at`, unlike every domain table: a row here is an immutable event. An
 * applied migration is never edited and never soft-deleted — that is precisely what the runner's
 * checksum and missing-file refusals exist to enforce.
 */
const BOOKKEEPING_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         text        PRIMARY KEY,
  checksum   text        NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

export class PostgresMigrationExecutor implements MigrationExecutor {
  readonly #pool: Pool;
  /** Set only while inside `withTransaction`, so `execute` joins the transaction rather than
   * running on a second connection outside it. */
  #transactionClient: PoolClient | undefined;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async #query(sql: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }> {
    const client = this.#transactionClient;
    const result = client
      ? await client.query(sql, params as unknown[] | undefined)
      : await this.#pool.query(sql, params as unknown[] | undefined);
    return { rows: result.rows as unknown[] };
  }

  /** Must be called once before `migrate`. Idempotent. */
  async ensureBookkeeping(): Promise<void> {
    await this.#query(BOOKKEEPING_DDL);
  }

  async execute(sql: string): Promise<void> {
    await this.#query(sql);
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#transactionClient) {
      // Nesting would produce a savepoint-less inner "transaction" whose rollback silently
      // discards the outer one's work too.
      throw new Error('withTransaction is not re-entrant');
    }

    const client = await this.#pool.connect();
    this.#transactionClient = client;
    try {
      await client.query('BEGIN');
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      // A failed ROLLBACK must not replace the error that caused it — that error is the diagnosis.
      try {
        await client.query('ROLLBACK');
      } catch {
        /* the connection is already unusable; releasing it below is the recovery */
      }
      throw error;
    } finally {
      this.#transactionClient = undefined;
      client.release();
    }
  }

  async appliedIds(): Promise<readonly string[]> {
    const { rows } = await this.#query('SELECT id FROM schema_migrations ORDER BY id');
    return (rows as { id: string }[]).map((row) => row.id);
  }

  async recordApplied(id: string, checksum: string): Promise<void> {
    await this.#query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [
      id,
      checksum,
    ]);
  }

  async appliedChecksums(): Promise<ReadonlyMap<string, string>> {
    const { rows } = await this.#query('SELECT id, checksum FROM schema_migrations');
    return new Map((rows as { id: string; checksum: string }[]).map((row) => [row.id, row.checksum]));
  }
}
