/**
 * The `migrate` command (ADR-0012's runner, made reachable; ADR-0014's runtime).
 *
 * ```text
 * node packages/db/src/migrate.ts --dry-run
 * node packages/db/src/migrate.ts
 * ```
 *
 * Runs on plain Node — no loader, no build step — because relative imports name the file that
 * exists on disk and Node 22.18+ strips types natively (ADR-0014).
 *
 * This file is deliberately thin. Ordering, checksums, and the three refusals that stop a
 * migration set from corrupting history live in `migrations/runner.ts`, tested without a database.
 * What is here is argument parsing, connection setup, output, and exit codes — the parts that only
 * matter when a human is watching.
 */

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { databaseSchema, load } from '@zentavio/config';
import { PostgresMigrationExecutor } from './migrations/executor.ts';
import { loadMigrationFiles } from './migrations/files.ts';
import { migrationsDirectory } from './migrations/apply.ts';
import { MigrationError, migrate, plan } from './migrations/runner.ts';

/**
 * Exit codes are part of the contract: CI and a human both need to tell "nothing to do" from
 * "refused to proceed" without reading prose.
 *
 * `USAGE` is separate from `FAILED` because a typo in a flag is not a database problem, and a
 * script that retries on failure should not retry on a typo.
 */
export const EXIT = {
  OK: 0,
  FAILED: 1,
  USAGE: 2,
} as const;

const USAGE = `Usage: node packages/db/src/migrate.ts [--dry-run]

  --dry-run   Report what would be applied, then exit without applying it or
              writing anything to the database.
  --help      This message.

Reads ZENTAVIO_DATABASE_URL through @zentavio/config. Migrations are read from
packages/db/migrations/, resolved from this file rather than the working directory.`;

/**
 * A connection string carries a password, and this command prints where it connected. `pg` would
 * happily log the whole thing; a URL in a CI log is a leaked credential that outlives the run.
 *
 * Returns a description safe to print, or a placeholder if the string will not parse — an
 * unparseable URL must not fall through to printing the original.
 */
export function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const database = url.pathname.replace(/^\//, '') || '(none)';
    return `${url.hostname}:${url.port || '5432'}/${database}`;
  } catch {
    return '(unparseable connection string)';
  }
}

export interface Flags {
  readonly dryRun: boolean;
  readonly help: boolean;
}

/** Throws on an unknown flag rather than ignoring it: a silently dropped `--dry-run` applies migrations. */
export function parseFlags(argv: readonly string[]): Flags {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return { dryRun: values['dry-run'] === true, help: values.help === true };
}

/**
 * `schema_migrations` may not exist yet, and a dry run must not create it.
 *
 * `--dry-run` that writes DDL is not a dry run. On a fresh database the honest answer is "nothing
 * is applied yet", which is exactly what an empty list means.
 */
async function bookkeepingExists(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
  );
  return rows[0]?.exists === true;
}

export interface RunOptions {
  readonly argv: readonly string[];
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export async function run(options: RunOptions): Promise<number> {
  const { out, err } = options;

  let flags: Flags;
  try {
    flags = parseFlags(options.argv);
  } catch (cause) {
    err(cause instanceof Error ? cause.message : String(cause));
    err(USAGE);
    return EXIT.USAGE;
  }

  if (flags.help) {
    out(USAGE);
    return EXIT.OK;
  }

  let config: { databaseUrl: string; databaseMaxConnections: number; databaseConnectionTimeoutMs: number };
  try {
    config = load(databaseSchema);
  } catch (cause) {
    // ConfigError already says which variable and why. Repeating it would only add noise.
    err(cause instanceof Error ? cause.message : String(cause));
    return EXIT.FAILED;
  }

  const pool = new Pool({
    connectionString: config.databaseUrl,
    // One connection: this command is serial by nature, and a pool of ten would open nine
    // connections that do nothing but make an exhausted server harder to diagnose.
    max: 1,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  });

  try {
    out(`${flags.dryRun ? 'Planning' : 'Migrating'} ${describeTarget(config.databaseUrl)}`);
    const files = await loadMigrationFiles(migrationsDirectory);
    const executor = new PostgresMigrationExecutor(pool);

    if (flags.dryRun) {
      const initialized = await bookkeepingExists(pool);
      const applied = initialized ? await executor.appliedIds() : [];
      const checksums = initialized ? await executor.appliedChecksums() : new Map<string, string>();
      if (!initialized) {
        out('schema_migrations does not exist yet — treating every migration as pending.');
      }

      // `plan` is what refuses an out-of-order, edited, or missing migration. Calling it here means
      // a dry run reports those refusals too, which is the point of running one.
      const pending = plan(files, applied, checksums);
      if (pending.length === 0) {
        out(`Up to date — ${String(files.length)} migration(s), none pending.`);
        return EXIT.OK;
      }
      out(`${String(pending.length)} pending:`);
      for (const entry of pending) out(`  ${entry.id}`);
      out('Nothing was applied. Re-run without --dry-run to apply.');
      return EXIT.OK;
    }

    await executor.ensureBookkeeping();
    const result = await migrate(files, executor);

    if (result.applied.length === 0) {
      out(`Up to date — ${String(result.skipped.length)} migration(s) already applied.`);
      return EXIT.OK;
    }
    out(`Applied ${String(result.applied.length)}:`);
    for (const id of result.applied) out(`  ${id}`);
    return EXIT.OK;
  } catch (cause) {
    // A MigrationError is a refusal with a written explanation — printing a stack trace over it
    // buries the sentence that says what to do.
    if (cause instanceof MigrationError) {
      err(cause.message);
    } else {
      err(cause instanceof Error ? (cause.stack ?? cause.message) : String(cause));
    }
    return EXIT.FAILED;
  } finally {
    await pool.end();
  }
}

/**
 * Only when executed directly, so importing this module from a test does not run migrations.
 * `import.meta.main` is not available on the Node floor in `engines`, so compare paths.
 */
const executedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (executedDirectly) {
  const code = await run({
    argv: process.argv.slice(2),
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
  process.exitCode = code;
}
