/**
 * Reading migration files off disk.
 *
 * Separate from `runner.ts` so the runner stays free of I/O and remains verifiable without a
 * filesystem or a database. This module's whole job is turning a directory into an ordered,
 * validated `MigrationFile[]`.
 *
 * The one rule that matters here: **a file that does not match the naming convention is an error,
 * never a skip.** A silently ignored migration is the worst failure available — the schema is
 * wrong, nothing said so, and the file is sitting right there looking applied.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MigrationError, type MigrationFile } from './runner.ts';

/**
 * `<YYYYMMDDHHMMSS>-<kebab-description>.sql` (docs/database/migrations.md).
 *
 * The timestamp is a total order, so merge conflicts between two branches are visible as two
 * files rather than silent as one overwritten position.
 */
const MIGRATION_FILENAME = /^\d{14}-[a-z0-9]+(?:-[a-z0-9]+)*\.sql$/;

/** The id is the filename without `.sql` — the runner's identity and ordering key. */
export function migrationIdFromFilename(filename: string): string {
  return filename.slice(0, -'.sql'.length);
}

/**
 * Load every migration in `dir`, sorted by id.
 *
 * Throws rather than returning partial results: a caller that received four of five migrations
 * would apply them and report success.
 */
export async function loadMigrationFiles(dir: string): Promise<readonly MigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (cause) {
    throw new MigrationError(`cannot read migrations directory ${dir}: ${String(cause)}`);
  }

  // README.md and any other documentation in the directory is not a migration and not a mistake.
  const candidates = entries.filter((name) => name.toLowerCase().endsWith('.sql'));

  const malformed = candidates.filter((name) => !MIGRATION_FILENAME.test(name));
  if (malformed.length > 0) {
    throw new MigrationError(
      `migration file(s) do not match <YYYYMMDDHHMMSS>-<kebab-description>.sql: ${malformed
        .sort()
        .join(', ')}. ` +
        'Rename them — an unrecognised file would otherwise be skipped without a word.',
    );
  }

  const files = await Promise.all(
    candidates.map(async (name) => ({
      id: migrationIdFromFilename(name),
      sql: await readFile(join(dir, name), 'utf8'),
    })),
  );

  return files.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
