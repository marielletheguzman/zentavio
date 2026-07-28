/**
 * The migration runner (ADR-0012).
 *
 * Ours rather than Kysely's migrator for one reason: `migrations.md` requires SQL that a generated
 * engine will not emit — `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT … NOT VALID`, and backfills
 * that commit between batches. A file can opt out of the surrounding transaction here, which is
 * what makes those expressible.
 *
 * The executor is injected. That is not only for testing: it keeps this file free of any driver
 * import, so the ordering and idempotence logic — the part that can corrupt a database — is
 * verifiable without one.
 */

export interface MigrationFile {
  /** Ordering key and identity: `20260728143000-create-requirements`. */
  readonly id: string;
  readonly sql: string;
}

/**
 * The minimum a caller must provide. `withTransaction` is separate from `execute` so a
 * `CONCURRENTLY` file can bypass it.
 */
export interface MigrationExecutor {
  execute(sql: string): Promise<void>;
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
  appliedIds(): Promise<readonly string[]>;
  recordApplied(id: string, checksum: string): Promise<void>;
  /** Checksums of applied migrations, so an edited file is detectable. */
  appliedChecksums(): Promise<ReadonlyMap<string, string>>;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * PostgreSQL cannot run these inside a transaction block, so a file containing one opts out.
 * Matching on the statement rather than a filename convention means a file cannot accidentally
 * claim transactional safety it does not have.
 */
const NON_TRANSACTIONAL = /\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b|\bDROP\s+INDEX\s+CONCURRENTLY\b/i;

export function isNonTransactional(sql: string): boolean {
  return NON_TRANSACTIONAL.test(sql);
}

/**
 * A stable checksum, so an already-applied migration that was later edited is caught. Not
 * cryptographic — it only needs to change when the content does.
 */
export function checksum(sql: string): string {
  // Normalize line endings first: a Windows checkout must not appear to have edited every file.
  const normalized = sql.replace(/\r\n/g, '\n');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (((h2 >>> 0) * 4294967296 + (h1 >>> 0)) >>> 0).toString(16).padStart(8, '0');
}

export interface PlanEntry {
  readonly id: string;
  readonly reason: 'pending';
}

/**
 * Decide what to apply, and refuse anything that would corrupt history.
 *
 * Three refusals, each a real way a migration set goes wrong:
 *
 * - **Out-of-order:** a file ordered before an already-applied one means two developers' branches
 *   merged with interleaved timestamps. Applying it now produces a schema that no fresh database
 *   would ever reach, so the two histories diverge silently.
 * - **Edited after applying:** the checksum changed, so what ran is not what the file says. Every
 *   fresh database from now on differs from every existing one.
 * - **Missing:** an applied migration whose file is gone. History is unreproducible.
 */
export function plan(
  files: readonly MigrationFile[],
  applied: readonly string[],
  checksums: ReadonlyMap<string, string> = new Map(),
): readonly PlanEntry[] {
  const ids = files.map((f) => f.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new MigrationError(`duplicate migration id(s): ${[...new Set(duplicates)].join(', ')}`);
  }

  const sorted = [...files].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const appliedSet = new Set(applied);

  const missing = applied.filter((id) => !ids.includes(id));
  if (missing.length > 0) {
    throw new MigrationError(
      `applied migration(s) have no file: ${missing.join(', ')}. ` +
        'History must stay reproducible — restore the file rather than deleting the record.',
    );
  }

  for (const file of sorted) {
    if (!appliedSet.has(file.id)) continue;
    const recorded = checksums.get(file.id);
    if (recorded !== undefined && recorded !== checksum(file.sql)) {
      throw new MigrationError(
        `migration ${file.id} was edited after being applied. ` +
          'Fix forward with a new migration; an applied migration is immutable.',
      );
    }
  }

  const lastApplied = sorted.filter((f) => appliedSet.has(f.id)).at(-1)?.id;
  const pending = sorted.filter((f) => !appliedSet.has(f.id));

  if (lastApplied !== undefined) {
    const outOfOrder = pending.filter((f) => f.id < lastApplied);
    if (outOfOrder.length > 0) {
      throw new MigrationError(
        `migration(s) ordered before the last applied one (${lastApplied}): ` +
          `${outOfOrder.map((f) => f.id).join(', ')}. ` +
          'Rename them with a later timestamp so a fresh database reaches the same schema.',
      );
    }
  }

  return pending.map((f) => ({ id: f.id, reason: 'pending' as const }));
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/** Apply every pending migration in order. Idempotent: a second run applies nothing. */
export async function migrate(
  files: readonly MigrationFile[],
  executor: MigrationExecutor,
): Promise<MigrateResult> {
  const applied = await executor.appliedIds();
  const checksums = await executor.appliedChecksums();
  const pending = plan(files, applied, checksums);

  const byId = new Map(files.map((f) => [f.id, f]));
  const done: string[] = [];

  for (const entry of pending) {
    const file = byId.get(entry.id);
    if (!file) throw new MigrationError(`planned migration ${entry.id} disappeared`);

    const run = async (): Promise<void> => {
      await executor.execute(file.sql);
      await executor.recordApplied(file.id, checksum(file.sql));
    };

    // A CONCURRENTLY file runs outside a transaction, and therefore is not atomic with its own
    // record. That is PostgreSQL's constraint, not a choice: the recovery is to re-run, which the
    // idempotence check makes safe.
    if (isNonTransactional(file.sql)) {
      await run();
    } else {
      await executor.withTransaction(run);
    }
    done.push(file.id);
  }

  return { applied: done, skipped: applied.filter((id) => byId.has(id)) };
}
