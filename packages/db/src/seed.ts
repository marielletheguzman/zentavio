/**
 * The `seed` command — load the closed skill set the résumé parser resolves against.
 *
 * ```text
 * node packages/db/src/seed.ts --dry-run
 * node packages/db/src/seed.ts
 * ```
 *
 * Reference data, not schema. Deliberately not a migration: migrations are immutable once applied
 * (`docs/database/migrations.md`), and this data is expected to be *replaced* by real ingestion
 * rather than amended forever by a chain of INSERT migrations. See `seeds/README.md` for the
 * provenance and why every row is tier 3.
 *
 * **Idempotent, keyed on `slug`.** Running it twice changes nothing, which is what makes it safe to
 * put in a startup script or run against an environment nobody is sure about.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { databaseSchema, load } from '@zentavio/config';
import { uuidv7 } from './uuid.ts';

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2 } as const;

const USAGE = `Usage: node packages/db/src/seed.ts [--dry-run]

  --dry-run   Report what would be inserted or updated, then exit writing nothing.
  --help      This message.

Reads ZENTAVIO_DATABASE_URL through @zentavio/config. Seed data is read from packages/db/seeds/,
resolved from this file rather than the working directory.`;

/** Resolved from this module, so running the command from another directory cannot change what it loads. */
export const seedsDirectory = fileURLToPath(new URL('../seeds/', import.meta.url));

/**
 * Every seeded row is tier 3, `curated`, with no `retrieved_at`.
 *
 * Not a placeholder for something better later — it is the honest tier for identifications that were
 * curated by hand rather than ingested from a source. Claiming ESCO without having fetched it would
 * be a provenance lie, and tier 3 maps to `low` confidence downstream, which is the correct posture
 * for a hand-seeded registry.
 */
const SEED_TIER = 3;
const SEED_BASIS = 'curated';

export interface SeedSkill {
  readonly slug: string;
  readonly name: string;
  readonly kind: string;
  readonly sourceUrl: string | null;
  readonly aliases: readonly string[];
}

export interface SeedCareer {
  readonly slug: string;
  readonly name: string;
  readonly family: string;
  readonly description: string | null;
  readonly profession: string | null;
  readonly licenceGated: boolean;
  readonly sourceTier: number;
  readonly basis: string;
  readonly sourceUrl: string | null;
}

export interface SeedFile {
  readonly career: SeedCareer;
  readonly skills: readonly SeedSkill[];
}

/**
 * Alias resolution key: casefolded, punctuation stripped, whitespace collapsed.
 *
 * This is the function that decides whether "Kubernetes (K8s)" and "kubernetes k8s" are the same
 * lookup. It must stay in step with whatever the parser uses to normalize an extracted phrase — if
 * the two ever disagree, resolution silently misses and the skill lands in `unmatched` instead.
 *
 * Deliberately narrow: strip anything that is not a letter, digit, or `+`/`#`, because `c++` and
 * `c#` are skill names where punctuation is the name.
 */
export function normalizeAlias(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}+#]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Validate the seed file's own invariants before touching the database.
 *
 * The database enforces these too, but a constraint violation mid-load reports one row while the
 * file may have several problems — and a partially applied seed is worse than a refused one.
 */
export function validateSeed(seed: SeedFile): readonly string[] {
  const problems: string[] = [];

  const slugs = seed.skills.map((s) => s.slug);
  for (const duplicate of new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))) {
    problems.push(`duplicate skill slug: ${duplicate}`);
  }

  for (const skill of seed.skills) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.slug)) {
      problems.push(`skill slug is not kebab-case: ${skill.slug}`);
    }
  }

  // One alias resolves to exactly one skill (uq_skill_aliases__normalized). Caught here so the
  // report names both skills rather than whichever row PostgreSQL happened to reject.
  const owner = new Map<string, string>();
  for (const skill of seed.skills) {
    for (const alias of [skill.name, ...skill.aliases]) {
      const key = normalizeAlias(alias);
      const existing = owner.get(key);
      if (existing !== undefined && existing !== skill.slug) {
        problems.push(`alias "${alias}" (${key}) is claimed by both ${existing} and ${skill.slug}`);
      }
      owner.set(key, skill.slug);
    }
  }

  return problems;
}

export interface SeedPlan {
  readonly careersInserted: number;
  readonly skillsInserted: number;
  readonly skillsUpdated: number;
  readonly aliasesInserted: number;
}

interface RunOptions {
  readonly argv: readonly string[];
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export async function loadSeedFile(path: string): Promise<SeedFile> {
  return JSON.parse(await readFile(path, 'utf8')) as SeedFile;
}

export async function run(options: RunOptions): Promise<number> {
  const { out, err } = options;

  let dryRun = false;
  try {
    const { values } = parseArgs({
      args: [...options.argv],
      options: { 'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false } },
      strict: true,
      allowPositionals: false,
    });
    if (values.help === true) {
      out(USAGE);
      return EXIT.OK;
    }
    dryRun = values['dry-run'] === true;
  } catch (cause) {
    err(cause instanceof Error ? cause.message : String(cause));
    err(USAGE);
    return EXIT.USAGE;
  }

  const seedPath = new URL('cloud-platform-engineering.json', new URL('../seeds/', import.meta.url));
  const seed = await loadSeedFile(fileURLToPath(seedPath));

  const problems = validateSeed(seed);
  if (problems.length > 0) {
    err(`Seed file is invalid — nothing was written:`);
    for (const problem of problems) err(`  ${problem}`);
    return EXIT.FAILED;
  }

  let config: { databaseUrl: string; databaseConnectionTimeoutMs: number };
  try {
    config = load(databaseSchema);
  } catch (cause) {
    err(cause instanceof Error ? cause.message : String(cause));
    return EXIT.FAILED;
  }

  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 1,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  });

  try {
    const plan = await applySeed(pool, seed, { dryRun });
    out(
      `${dryRun ? 'Would apply' : 'Applied'}: ` +
        `${String(plan.careersInserted)} career(s), ` +
        `${String(plan.skillsInserted)} skill(s) inserted, ` +
        `${String(plan.skillsUpdated)} updated, ` +
        `${String(plan.aliasesInserted)} alias(es).`,
    );
    if (dryRun) out('Nothing was written. Re-run without --dry-run to apply.');
    return EXIT.OK;
  } catch (cause) {
    err(cause instanceof Error ? (cause.stack ?? cause.message) : String(cause));
    return EXIT.FAILED;
  } finally {
    await pool.end();
  }
}

/**
 * Apply the seed, or report what applying it would do.
 *
 * Runs in one transaction so a failure halfway leaves nothing behind. A half-seeded registry is the
 * worst outcome available: the parser would resolve some phrases and silently drop others, and
 * `unmatched` would look like a coverage gap rather than a failed load.
 */
export async function applySeed(
  pool: Pool,
  seed: SeedFile,
  options: { readonly dryRun?: boolean } = {},
): Promise<SeedPlan> {
  const client = await pool.connect();
  let careersInserted = 0;
  let skillsInserted = 0;
  let skillsUpdated = 0;
  let aliasesInserted = 0;

  try {
    await client.query('BEGIN');

    const career = seed.career;
    const careerResult = await client.query(
      `INSERT INTO careers (id, slug, name, family, description, profession, licence_gated, source_tier, basis, source_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING`,
      [
        uuidv7(),
        career.slug,
        career.name,
        career.family,
        career.description,
        career.profession,
        career.licenceGated,
        career.sourceTier,
        career.basis,
        career.sourceUrl,
      ],
    );
    careersInserted += careerResult.rowCount ?? 0;

    for (const skill of seed.skills) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO skills (id, slug, name, kind, source_tier, basis, source_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING
         RETURNING id`,
        [uuidv7(), skill.slug, skill.name, skill.kind, SEED_TIER, SEED_BASIS, skill.sourceUrl],
      );

      let skillId: string;
      if (inserted.rowCount === 1) {
        skillsInserted += 1;
        skillId = (inserted.rows[0] as { id: string }).id;
      } else {
        // Already present. Refresh the display fields but never the slug — the slug is the identity
        // the parser's closed set is built from, and changing it silently breaks extraction.
        const existing = await client.query<{ id: string }>(
          `UPDATE skills SET name = $2, kind = $3, source_url = $4, updated_at = now()
            WHERE slug = $1 AND deleted_at IS NULL
        RETURNING id`,
          [skill.slug, skill.name, skill.kind, skill.sourceUrl],
        );
        if (existing.rowCount !== 1) throw new Error(`skill ${skill.slug} exists but could not be read back`);
        skillsUpdated += 1;
        skillId = (existing.rows[0] as { id: string }).id;
      }

      // The display name is itself an alias — a résumé saying "Kubernetes" must resolve without the
      // name having to be repeated in the alias list.
      for (const alias of [skill.name, ...skill.aliases]) {
        const aliasResult = await client.query(
          `INSERT INTO skill_aliases (id, skill_id, alias, normalized, source_tier)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (normalized) DO NOTHING`,
          [uuidv7(), skillId, alias, normalizeAlias(alias), SEED_TIER],
        );
        aliasesInserted += aliasResult.rowCount ?? 0;
      }
    }

    if (options.dryRun === true) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already unusable; releasing below is the recovery */
    }
    throw error;
  } finally {
    client.release();
  }

  return { careersInserted, skillsInserted, skillsUpdated, aliasesInserted };
}

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
