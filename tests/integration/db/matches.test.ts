/**
 * ADR-0037 against a real database: what a match may claim, enforced by constraint rather than care.
 *
 * The arithmetic is unit-tested and pure. What matters here is that the **schema** refuses the rows
 * the decision forbids, and that the ADR-0036 distinction survives the round trip through
 * PostgreSQL — a rule that lives only in a pure function is a rule the next writer bypasses by
 * inserting directly.
 */

import { matchesForUser, recordMatch, skillsForPosting } from '@zentavio/db';
import type { Database } from '@zentavio/db';
import { extractDuePostings } from '@zentavio/ingestion';
import { SCORER_VERSION, scorePostingForUser } from '@zentavio/matching';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let userId: string;
let profileId: string;
let postingId: string;
let kubernetesId: string;
let terraformId: string;

const DEPS = { now: () => new Date('2026-08-23T12:00:00Z'), newId: uuidv7 };

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM matches');
  await pool.query('DELETE FROM job_posting_skills');
  await pool.query('DELETE FROM job_posting_sources');
  await pool.query('DELETE FROM job_postings');
  await pool.query('DELETE FROM profile_skills');
  await pool.query('DELETE FROM skill_edges');
  await pool.query('DELETE FROM skill_aliases');
  await pool.query('DELETE FROM skills');
  await pool.query('DELETE FROM user_profiles');
  await pool.query('DELETE FROM users');

  userId = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1,$2,'password')`, [
    userId,
    `matcher-${userId.slice(-8)}@example.invalid`,
  ]);

  profileId = uuidv7();
  await pool.query(`INSERT INTO user_profiles (id, user_id, version, is_current) VALUES ($1,$2,1,true)`, [
    profileId,
    userId,
  ]);

  kubernetesId = uuidv7();
  terraformId = uuidv7();
  for (const [id, slug, name] of [
    [kubernetesId, 'kubernetes', 'Kubernetes'],
    [terraformId, 'terraform', 'Terraform'],
  ] as const) {
    await pool.query(
      `INSERT INTO skills (id, slug, name, kind, source_tier, basis) VALUES ($1,$2,$3,'technology',3,'curated')`,
      [id, slug, name],
    );
    await pool.query(
      `INSERT INTO skill_aliases (id, skill_id, alias, normalized, source_tier) VALUES ($1,$2,$3,$3,3)`,
      [uuidv7(), id, slug],
    );
  }

  postingId = uuidv7();
  await pool.query(
    `INSERT INTO job_postings
       (id, dedup_key, dedup_basis, title, url, first_seen_at, last_seen_at, stale_after,
        authority_tier, confidence, description, requirements_text)
     VALUES ($1,$2,'source-identity','Platform Engineer','https://jobs.example.invalid/pe',
             now(), now(), now() + interval '1 day', 2, 'medium', $3, $4)`,
    [
      postingId,
      uuidv7(),
      'We run a large platform.',
      'Qualifications:\n- Production Kubernetes\n- Terraform at scale',
    ],
  );
});

async function holds(skillId: string, status: 'evidenced' | 'claimed'): Promise<void> {
  await pool.query(
    `INSERT INTO profile_skills (id, user_profile_id, skill_id, status, confidence, evidence_kind, source_span)
     VALUES ($1,$2,$3,$4,'high',
             CASE WHEN $4 = 'evidenced' THEN 'role' ELSE NULL END,
             'Led a platform migration')`,
    [uuidv7(), profileId, skillId, status],
  );
}

function score() {
  return scorePostingForUser(db, { userId, userProfileId: profileId, jobPostingId: postingId }, DEPS);
}

describe('the ADR-0036 read, through a real database', () => {
  it('is unknown when the posting has never been extracted', async () => {
    // No extraction run. `extracted_version` is null, which is not the same as "asks for nothing".
    const outcome = await score();

    expect(outcome.result?.status).toBe('unknown');
    expect(outcome.result?.missing).toEqual(['skill extraction has not run for this posting']);

    const [row] = await matchesForUser(db, userId).execute();
    expect(row?.score).toBeNull();
    expect(row?.status).toBe('unknown');
  });

  it('is unknown for a different reason once the posting is read and matches nothing', async () => {
    await pool.query('DELETE FROM skill_aliases');
    await extractDuePostings(db, { now: () => new Date('2026-08-23T11:00:00Z'), newId: uuidv7 });

    // Extracted, zero requirement rows — the state the whole current corpus is in.
    expect(await skillsForPosting(db, postingId).execute()).toHaveLength(0);

    const outcome = await score();
    expect(outcome.result?.status).toBe('unknown');
    expect(outcome.result?.missing).toEqual([
      'the posting states no requirement matching a curated skill',
    ]);
  });

  it('never scores a posting that asks for nothing as a perfect fit', async () => {
    await pool.query('DELETE FROM skill_aliases');
    await extractDuePostings(db, { now: () => new Date('2026-08-23T11:00:00Z'), newId: uuidv7 });

    expect((await score()).result?.score).toBeNull();
  });
});

describe('a real score, end to end', () => {
  beforeEach(async () => {
    await extractDuePostings(db, { now: () => new Date('2026-08-23T11:00:00Z'), newId: uuidv7 });
  });

  it('scores what the person holds against what the posting asked for', async () => {
    await holds(kubernetesId, 'evidenced');

    const outcome = await score();
    expect(outcome.result?.status).toBe('scored');
    expect(outcome.result?.score).toBeGreaterThan(0);

    const [row] = await matchesForUser(db, userId).execute();
    expect(row?.status).toBe('scored');
    expect(row?.scorer_version).toBe(SCORER_VERSION);
    // No model produced any part of this number.
    expect(row?.prompt_version).toBeNull();
  });

  it('carries the gap as named evidence, not only the strengths', async () => {
    await holds(kubernetesId, 'evidenced');
    await score();

    const [row] = await matchesForUser(db, userId).execute();
    const evidence = row?.evidence as { kind: string; label: string }[];
    expect(evidence.some((entry) => entry.kind === 'skill_missing' && entry.label === 'Terraform')).toBe(true);
  });

  it('stores no constraints, because none were evaluated', async () => {
    await holds(kubernetesId, 'evidenced');
    await score();

    // ADR-0037: work authorization stays out of the score until it can actually be evaluated. An
    // empty array is the honest record of that, not an oversight.
    const [row] = await matchesForUser(db, userId).execute();
    expect(row?.constraints).toEqual([]);
  });

  it('replaces the live match rather than accumulating rows', async () => {
    await holds(kubernetesId, 'evidenced');
    await score();
    await holds(terraformId, 'evidenced');
    await score();

    const live = await matchesForUser(db, userId).execute();
    expect(live).toHaveLength(1);
    // The second run saw more of the profile, so it is a different judgment, not the same one twice.
    expect(Number(live[0]?.score)).toBe(1);
  });

  it('refuses to score an expired posting, and says why', async () => {
    await pool.query(
      `UPDATE job_postings SET expired_at = now(), expiry_reason = 'source-delisted' WHERE id = $1`,
      [postingId],
    );

    const outcome = await score();
    expect(outcome.refusedBecause).toBe('posting-expired');
    expect(outcome.matchId).toBeNull();
    expect(await matchesForUser(db, userId).execute()).toHaveLength(0);
  });

  it('refuses a posting that does not exist', async () => {
    const outcome = await scorePostingForUser(
      db,
      { userId, userProfileId: profileId, jobPostingId: uuidv7() },
      DEPS,
    );

    expect(outcome.refusedBecause).toBe('posting-not-found');
  });
});

describe('the schema, not the code, keeps this table honest', () => {
  async function insertMatch(overrides: Record<string, unknown>) {
    const base = {
      id: uuidv7(),
      user_id: userId,
      job_posting_id: postingId,
      score: null as string | null,
      status: 'unknown',
      confidence: 'low',
      evidence: JSON.stringify([{ kind: 'skill_missing', label: 'x', weight: 1 }]),
      scorer_version: SCORER_VERSION,
      knowledge_as_of: new Date(),
      computed_at: new Date(),
      ...overrides,
    };
    return pool.query(
      `INSERT INTO matches (id, user_id, job_posting_id, score, status, confidence, evidence,
                            scorer_version, knowledge_as_of, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
      [
        base.id,
        base.user_id,
        base.job_posting_id,
        base.score,
        base.status,
        base.confidence,
        base.evidence,
        base.scorer_version,
        base.knowledge_as_of,
        base.computed_at,
      ],
    );
  }

  it('refuses a scored row with no number', async () => {
    await expect(insertMatch({ status: 'scored', score: null })).rejects.toThrow(
      /ck_matches__score_iff_scored/,
    );
  });

  it('refuses an unknown row carrying a number — including 0.0', async () => {
    // The whole point: a zero score and an uncomputable score mean opposite things to a person.
    await expect(insertMatch({ status: 'unknown', score: '0.0000' })).rejects.toThrow(
      /ck_matches__score_iff_scored/,
    );
  });

  it('refuses a row with no evidence', async () => {
    await expect(insertMatch({ evidence: JSON.stringify([]) })).rejects.toThrow(
      /ck_matches__evidence_present/,
    );
  });

  it('refuses a score outside 0..1', async () => {
    await expect(insertMatch({ status: 'scored', score: '1.5000' })).rejects.toThrow(
      /ck_matches__score_range/,
    );
  });
});

describe('no Job Match Score exists yet', () => {
  it('writes no job-match scorer version, the way ADR-0035 asserts stated-requirement absent', async () => {
    await extractDuePostings(db, { now: () => new Date('2026-08-23T11:00:00Z'), newId: uuidv7 });
    await holds(kubernetesId, 'evidenced');
    await score();

    const rows = await pool.query(`SELECT scorer_version FROM matches`);
    expect(rows.rows).not.toHaveLength(0);
    for (const row of rows.rows) {
      expect(String(row.scorer_version).startsWith('job-match')).toBe(false);
    }
  });

  it('records a match through recordMatch with the versions that make it re-derivable', async () => {
    const id = await recordMatch(db, {
      id: uuidv7(),
      user_id: userId,
      job_posting_id: postingId,
      score: '0.5000',
      status: 'scored',
      confidence: 'low',
      evidence: JSON.stringify([{ kind: 'skill_match', label: 'Kubernetes', weight: 0.5 }]),
      missing: JSON.stringify([]),
      constraints: JSON.stringify([]),
      scorer_version: SCORER_VERSION,
      prompt_version: null,
      knowledge_as_of: new Date('2026-08-23T12:00:00Z'),
      computed_at: new Date('2026-08-23T12:00:00Z'),
    });

    const [row] = await matchesForUser(db, userId).execute();
    expect(row?.id).toBe(id);
    expect(row?.knowledge_as_of).toBeInstanceOf(Date);
  });
});
