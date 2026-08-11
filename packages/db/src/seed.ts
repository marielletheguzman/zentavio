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
import { IMMIGRATION_PATHWAYS } from './immigration-pathways.ts';
import { PERSON_FACT_KINDS } from './person-fact-kinds.ts';
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

/**
 * One requirement of the track, and how much it matters.
 *
 * `marketScope` is null for a global requirement. German for a Berlin role is real in one market
 * and absent in another, and both rows coexist — the more specific one wins during evaluation
 * (`docs/database/entities/skill.md`).
 */
export interface SeedCareerSkill {
  readonly skill: string;
  readonly weight: number;
  readonly cluster: string;
  readonly marketScope: string | null;
}

/** One typed, weighted edge of the graph. */
export interface SeedEdge {
  readonly from: string;
  readonly to: string;
  readonly type: string;
  readonly weight: number;
}

export interface SeedFile {
  readonly career: SeedCareer;
  readonly skills: readonly SeedSkill[];
  /** Optional so a seed file that predates the graph still loads. */
  readonly careerSkills?: readonly SeedCareerSkill[];
  readonly edges?: readonly SeedEdge[];
}

export const EDGE_TYPES = [
  'requires',
  'adjacent_to',
  'transfers_to',
  'subsumes',
  'tooling_of',
] as const;

export const CAREER_SKILL_CLUSTERS = [
  'core',
  'supporting',
  'differentiating',
  'peripheral',
] as const;

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
 * Legal-form suffixes, stripped from a company name before it becomes a resolution key.
 *
 * "Google Germany GmbH" and "Google Germany" are the same employer, and a connector emits whichever
 * string the posting happened to contain. Deliberately a **closed list of exact tokens**, not a
 * pattern: `ag` is a legal form in Germany and also the whole name of real companies, so anything
 * cleverer than an explicit list starts deciding which employers exist.
 */
const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  'inc',
  'llc',
  'ltd',
  'limited',
  'plc',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'mbh',
  'ag',
  'se',
  'kg',
  'ug',
  'bv',
  'nv',
  'sa',
  'sas',
  'sarl',
  'srl',
  'spa',
  'ab',
  'as',
  'oy',
  'aps',
  'pty',
  'pte',
  'kk',
]);

/**
 * The resolution key for a company name (`docs/database/entities/company.md`).
 *
 * `normalizeAlias` plus legal-suffix removal. **This is the only function permitted to produce
 * `company_aliases.normalized`.** Two normalizations that drift make resolution miss silently — the
 * skill graph already demonstrated that failure, where the phrase lands in `unmatched` and reads as
 * a coverage gap rather than the bug it is.
 *
 * Suffixes are stripped only from the **end**, and never all of them: "Ltd" in the middle of a name
 * is part of the name, and a name that is *only* a suffix (a company literally called "Company")
 * must not normalize to nothing, because an empty key would collide with every other empty one.
 */
export function normalizeCompanyAlias(value: string): string {
  const words = normalizeAlias(value).split(' ').filter(Boolean);

  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1] ?? '')) {
    words.pop();
  }

  return words.join(' ');
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

  const known = new Set(slugs);

  for (const entry of seed.careerSkills ?? []) {
    if (!known.has(entry.skill)) {
      problems.push(`careerSkills references unknown skill: ${entry.skill}`);
    }
    if (entry.weight < 0 || entry.weight > 1) {
      problems.push(`careerSkills weight out of range for ${entry.skill}: ${entry.weight}`);
    }
    if (!(CAREER_SKILL_CLUSTERS as readonly string[]).includes(entry.cluster)) {
      problems.push(`careerSkills unknown cluster for ${entry.skill}: ${entry.cluster}`);
    }
    if (entry.marketScope !== null && !/^[A-Z]{2}$/.test(entry.marketScope)) {
      problems.push(`careerSkills marketScope is not an ISO 3166-1 alpha-2 code: ${entry.marketScope}`);
    }
  }

  // Same (career, skill, market) twice would be rejected by uq_career_skills__career_skill_market
  // mid-load, naming one row while the file may have several problems.
  const seenRequirement = new Set<string>();
  for (const entry of seed.careerSkills ?? []) {
    const key = `${entry.skill}|${entry.marketScope ?? 'ZZ'}`;
    if (seenRequirement.has(key)) {
      problems.push(`duplicate careerSkills entry: ${entry.skill} (${entry.marketScope ?? 'global'})`);
    }
    seenRequirement.add(key);
  }

  const seenEdge = new Set<string>();
  for (const edge of seed.edges ?? []) {
    if (!known.has(edge.from)) problems.push(`edge references unknown skill: ${edge.from}`);
    if (!known.has(edge.to)) problems.push(`edge references unknown skill: ${edge.to}`);
    if (edge.from === edge.to) {
      problems.push(`edge is self-referential: ${edge.from} ${edge.type} ${edge.to}`);
    }
    if (!(EDGE_TYPES as readonly string[]).includes(edge.type)) {
      problems.push(`unknown edge type: ${edge.type}`);
    }
    if (edge.weight < 0 || edge.weight > 1) {
      problems.push(`edge weight out of range: ${edge.from} ${edge.type} ${edge.to} = ${edge.weight}`);
    }
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (seenEdge.has(key)) problems.push(`duplicate edge: ${edge.from} ${edge.type} ${edge.to}`);
    seenEdge.add(key);
  }

  // A `requires` cycle makes the dependency ordering M1b produces impossible, and the database
  // cannot see it — every individual row is legal. Reported here, where the whole file is visible.
  for (const cycle of requiresCycles(seed.edges ?? [])) {
    problems.push(`requires-edges form a cycle: ${cycle.join(' -> ')}`);
  }

  return problems;
}

/**
 * Cycles among `requires` edges, as readable paths.
 *
 * A gap is ordered by walking prerequisites, so a cycle means there is no first thing to learn.
 * `ck_skill_edges__no_self` catches the one-hop case; nothing in the schema can catch three skills
 * that require each other in a ring, because each row is individually valid.
 */
export function requiresCycles(edges: readonly SeedEdge[]): readonly (readonly string[])[] {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type !== 'requires') continue;
    const outgoing = graph.get(edge.from) ?? [];
    outgoing.push(edge.to);
    graph.set(edge.from, outgoing);
  }

  const found: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const walk = (node: string): void => {
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const seen = state.get(next);
      if (seen === 'visiting') {
        found.push([...stack.slice(stack.indexOf(next)), next]);
      } else if (seen === undefined) {
        walk(next);
      }
    }
    stack.pop();
    state.set(node, 'done');
  };

  for (const node of graph.keys()) {
    if (state.get(node) === undefined) walk(node);
  }
  return found;
}

export interface SeedPlan {
  readonly careersInserted: number;
  readonly skillsInserted: number;
  readonly skillsUpdated: number;
  readonly aliasesInserted: number;
  readonly careerSkillsInserted: number;
  readonly edgesInserted: number;
  /** Fact kinds inserted or refreshed. Upserted, so this counts rows touched. */
  readonly factKindsUpserted: number;
  /** Immigration pathways inserted. Requirements cannot be stored without their pathway. */
  readonly pathwaysInserted: number;
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
        `${String(plan.aliasesInserted)} alias(es), ` +
        `${String(plan.careerSkillsInserted)} requirement(s), ` +
        `${String(plan.edgesInserted)} edge(s), ` +
        `${String(plan.factKindsUpserted)} fact kind(s), ` +
        `${String(plan.pathwaysInserted)} pathway(s).`,
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
  let careerSkillsInserted = 0;
  let edgesInserted = 0;
  let factKindsUpserted = 0;
  let pathwaysInserted = 0;

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

    // The graph, after every skill exists. Resolved by slug rather than carried through from the
    // loop above, because a rerun updates existing skills instead of inserting them and the ids
    // must be read back either way.
    const idBySlug = new Map<string, string>();
    const { rows: skillRows } = await client.query<{ id: string; slug: string }>(
      'SELECT id, slug FROM skills WHERE deleted_at IS NULL',
    );
    for (const row of skillRows) idBySlug.set(row.slug, row.id);

    const { rows: careerRows } = await client.query<{ id: string }>(
      'SELECT id FROM careers WHERE slug = $1 AND deleted_at IS NULL',
      [career.slug],
    );
    const careerId = careerRows[0]?.id;
    if (careerId === undefined) throw new Error(`career ${career.slug} could not be read back`);

    for (const entry of seed.careerSkills ?? []) {
      const skillId = idBySlug.get(entry.skill);
      if (skillId === undefined) throw new Error(`careerSkills references unknown skill ${entry.skill}`);
      const result = await client.query(
        `INSERT INTO career_skills (id, career_id, skill_id, weight, cluster, basis, market_scope, source_tier, source_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
         ON CONFLICT (career_id, skill_id, COALESCE(market_scope, 'ZZ')) WHERE deleted_at IS NULL DO NOTHING`,
        [uuidv7(), careerId, skillId, entry.weight, entry.cluster, SEED_BASIS, entry.marketScope, SEED_TIER],
      );
      careerSkillsInserted += result.rowCount ?? 0;
    }

    for (const edge of seed.edges ?? []) {
      const from = idBySlug.get(edge.from);
      const to = idBySlug.get(edge.to);
      if (from === undefined || to === undefined) {
        throw new Error(`edge references unknown skill: ${edge.from} -> ${edge.to}`);
      }
      // `support` stays NULL: these are curated, not counted. Only a posting-cooccurrence edge is
      // required to state how many observations back it, and none of these are derived that way.
      const result = await client.query(
        `INSERT INTO skill_edges (id, from_skill_id, to_skill_id, edge_type, weight, basis, support, source_tier, source_url)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, NULL)
         ON CONFLICT (from_skill_id, to_skill_id, edge_type) WHERE deleted_at IS NULL DO NOTHING`,
        [uuidv7(), from, to, edge.type, edge.weight, SEED_BASIS, SEED_TIER],
      );
      edgesInserted += result.rowCount ?? 0;
    }

    // The fact catalogue. Not from the seed file and carrying no source tier, because a fact kind
    // is the shape of a question rather than sourced knowledge — see `person-fact-kinds.ts`.
    // Idempotent on `key`, and it updates the wording: a prompt is user-facing copy that will be
    // improved, and leaving an old phrasing in place because the row already existed would make
    // the catalogue silently un-editable.
    for (const kind of PERSON_FACT_KINDS) {
      const result = await client.query(
        `INSERT INTO person_fact_kinds (key, value_type, unit, prompt, rationale, sensitive, allowed_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (key) DO UPDATE SET
           value_type = EXCLUDED.value_type,
           unit = EXCLUDED.unit,
           prompt = EXCLUDED.prompt,
           rationale = EXCLUDED.rationale,
           sensitive = EXCLUDED.sensitive,
           allowed_values = EXCLUDED.allowed_values,
           updated_at = now()`,
        [
          kind.key,
          kind.valueType,
          kind.unit,
          kind.prompt,
          kind.rationale,
          kind.sensitive,
          [...kind.allowedValues],
        ],
      );
      factKindsUpserted += result.rowCount ?? 0;
    }

    // Immigration pathways. Seeded rather than ingested because `requirements.pathway_id` is a
    // foreign key onto this table — the first real requirement insert fails without the row.
    //
    // Insert-only on conflict: this row's fields are tier-1 statements from a statute, and an
    // upsert would silently overwrite a curated `official_sources` list with whatever the code
    // happened to hold. Changing a pathway is a deliberate edit, not a side effect of re-seeding.
    for (const pathway of IMMIGRATION_PATHWAYS) {
      const result = await client.query(
        `INSERT INTO immigration_pathways (id, pathway_id, jurisdiction, name, description, official_sources, quota)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (pathway_id) DO NOTHING`,
        [
          uuidv7(),
          pathway.pathwayId,
          pathway.jurisdiction,
          pathway.name,
          pathway.description,
          JSON.stringify(
            pathway.officialSources.map((s) => ({ url: s.url, authoritative_for: s.authoritativeFor })),
          ),
          // ADR-0027: the cap lives here rather than as a requirement, and `null` means this
          // pathway has none — distinct from a quota whose *value* we could not source, which is
          // an object with `places: null`.
          pathway.quota === undefined
            ? null
            : JSON.stringify({
                allocated_by: pathway.quota.allocatedBy,
                period: pathway.quota.period,
                places: pathway.quota.places,
                unsourced_reason: pathway.quota.unsourcedReason ?? null,
                source_url: pathway.quota.sourceUrl,
              }),
        ],
      );
      pathwaysInserted += result.rowCount ?? 0;
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

  return {
    careersInserted,
    skillsInserted,
    skillsUpdated,
    aliasesInserted,
    careerSkillsInserted,
    edgesInserted,
    factKindsUpserted,
    pathwaysInserted,
  };
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
