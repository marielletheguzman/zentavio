/**
 * ADR-0035 against a real database: what a row may claim, enforced by constraint rather than by care.
 *
 * The scanner's rules are unit-tested. What matters here is that the **schema** refuses the rows the
 * ADR forbids — a rule that lives only in a pure function is a rule the next writer can bypass by
 * inserting directly.
 */

import { aliasIndex, replacePostingSkills, skillsForPosting, postingsForSkill } from '@zentavio/db';
import type { Database } from '@zentavio/db';
import { extractSkills, rowsFor } from '@zentavio/ingestion';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let postingId: string;
let kubernetesId: string;
let terraformId: string;

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM job_posting_skills');
  await pool.query('DELETE FROM job_posting_sources');
  await pool.query('DELETE FROM job_postings');
  await pool.query('DELETE FROM skill_aliases');
  await pool.query('DELETE FROM skills');

  kubernetesId = uuidv7();
  terraformId = uuidv7();
  for (const [id, slug, name, aliases] of [
    [kubernetesId, 'kubernetes', 'Kubernetes', ['kubernetes', 'k8s']],
    [terraformId, 'terraform', 'Terraform', ['terraform']],
  ] as const) {
    await pool.query(
      `INSERT INTO skills (id, slug, name, kind, source_tier, basis) VALUES ($1,$2,$3,'technology',3,'curated')`,
      [id, slug, name],
    );
    for (const alias of aliases) {
      await pool.query(
        `INSERT INTO skill_aliases (id, skill_id, alias, normalized, source_tier) VALUES ($1,$2,$3,$4,3)`,
        [uuidv7(), id, alias, alias],
      );
    }
  }

  postingId = uuidv7();
  await pool.query(
    `INSERT INTO job_postings
       (id, dedup_key, dedup_basis, title, url, first_seen_at, last_seen_at, stale_after, authority_tier, confidence,
        description, requirements_text)
     VALUES ($1,$2,'source-identity','Platform Engineer','https://jobs.example.invalid/pe',
             now(), now(), now() + interval '1 day', 2, 'medium', $3, $4)`,
    [
      postingId,
      uuidv7(),
      'Our platform runs on Kubernetes and we like it that way.',
      'Qualifications:\n- 5 years of Terraform\n- Production Kubernetes',
    ],
  );
});

/** The whole path: read the posting, scan it against the curated vocabulary, store what resolved. */
async function extractAndStore() {
  const posting = await db
    .selectFrom('job_postings')
    .select(['id', 'description', 'requirements_text'])
    .where('id', '=', postingId)
    .executeTakeFirstOrThrow();

  const found = extractSkills(
    { description: posting.description, requirementsText: posting.requirements_text },
    await aliasIndex(db),
  );

  return replacePostingSkills(db, postingId, rowsFor(posting.id, found, uuidv7));
}

describe('extraction, end to end', () => {
  it('stores what the curated vocabulary resolved, and nothing else', async () => {
    expect(await extractAndStore()).toBe(2);

    const stored = await skillsForPosting(db, postingId).execute();
    expect(stored.map((row) => row.skill_id).sort()).toEqual([kubernetesId, terraformId].sort());
  });

  it('carries the sentence a person could check', async () => {
    await extractAndStore();
    const stored = await skillsForPosting(db, postingId).execute();

    for (const row of stored) expect(row.source_span).not.toBeNull();
    expect(stored.find((row) => row.skill_id === terraformId)?.source_span).toBe('5 years of Terraform');
  });

  it('claims description-extraction on every row', async () => {
    await extractAndStore();
    const stored = await skillsForPosting(db, postingId).execute();

    expect(new Set(stored.map((row) => row.basis))).toEqual(new Set(['description-extraction']));
    expect(stored.every((row) => row.prompt_version === null)).toBe(true);
  });

  it('re-extracts by replacing, so a removed requirement does not linger', async () => {
    // A skill the posting no longer mentions would otherwise persist, indistinguishable from a
    // current one.
    await extractAndStore();
    await pool.query(`UPDATE job_postings SET requirements_text = $2 WHERE id = $1`, [
      postingId,
      'Qualifications:\n- Production Kubernetes',
    ]);

    await extractAndStore();
    const stored = await skillsForPosting(db, postingId).execute();

    expect(stored.map((row) => row.skill_id)).toEqual([kubernetesId]);
  });

  it('produces identical rows on a second run', async () => {
    // Deterministic weights are what keep a `matches` row re-derivable.
    await extractAndStore();
    const first = await skillsForPosting(db, postingId).execute();
    await extractAndStore();
    const second = await skillsForPosting(db, postingId).execute();

    expect(second.map((row) => [row.skill_id, row.weight, row.is_required, row.source_span])).toEqual(
      first.map((row) => [row.skill_id, row.weight, row.is_required, row.source_span]),
    );
  });

  it('finds the postings asking for a skill', async () => {
    await extractAndStore();

    const wanting = await postingsForSkill(db, terraformId).execute();
    expect(wanting).toHaveLength(1);
    expect(wanting[0]).toMatchObject({ title: 'Platform Engineer', is_required: true });
  });
});

describe('what the schema refuses', () => {
  function insert(overrides: Record<string, unknown>) {
    const row = {
      id: uuidv7(),
      job_posting_id: postingId,
      skill_id: kubernetesId,
      weight: '0.6',
      basis: 'description-extraction',
      is_required: false,
      section: 'requirements',
      source_span: 'Production Kubernetes',
      extractor_version: 'alias-scan@1.0.0',
      prompt_version: null,
      ...overrides,
    };
    return db.insertInto('job_posting_skills').values(row as never).execute();
  }

  it('refuses an extracted row with no span', async () => {
    // A requirement whose sentence cannot be shown is not storable (ADR-0035).
    await expect(insert({ source_span: null })).rejects.toThrow(/ck_jpsk__extracted_has_span/);
  });

  it('refuses a required row whose span came from the description', async () => {
    // "Our platform runs on Kubernetes" is a mention. The constraint is what stops it becoming a
    // requirement when a future writer forgets the rule.
    await expect(insert({ section: 'description', is_required: true })).rejects.toThrow(
      /ck_jpsk__required_from_list/,
    );
  });

  it('allows a description row that claims nothing', async () => {
    await expect(insert({ section: 'description', is_required: false })).resolves.toBeDefined();
  });

  it('refuses two rows for the same skill on one posting', async () => {
    await insert({});
    await expect(insert({})).rejects.toThrow(/uq_jpsk__posting_skill/);
  });

  it('refuses a weight outside 0..1', async () => {
    await expect(insert({ weight: '1.5' })).rejects.toThrow(/ck_jpsk__weight/);
  });
});

describe('the label nothing has earned', () => {
  it('stores no stated-requirement row, because no source states requirements structurally', async () => {
    // This fails the day a source does — which is the day someone should read ADR-0035 again rather
    // than reach for the stronger label because it is available.
    await extractAndStore();

    const stated = await db
      .selectFrom('job_posting_skills')
      .select('id')
      .where('basis', '=', 'stated-requirement')
      .execute();

    expect(stated).toEqual([]);
  });
});
