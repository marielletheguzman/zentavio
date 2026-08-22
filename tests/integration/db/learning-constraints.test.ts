/**
 * The learning tables, against a real database.
 *
 * **The assertion that matters is the negative one.** Recording a completion must leave
 * `profile_skills` untouched: `ai/skill-gap` credits only `evidenced` skills, so a completion that
 * quietly wrote one would raise a person's readiness for clicking *finished*. That is the shortcut
 * M6 exists to refuse, and it is the kind of thing that gets added later by someone being helpful —
 * so it is pinned here rather than left to a code comment.
 *
 * Everything else here is the constraints doing what the entity file says they do. A `CHECK` that
 * was never exercised is a `CHECK` nobody knows the shape of.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CompletionInvariantError,
  completionsForUser,
  recordCompletion,
  resourcesForSkill,
  usableResources,
} from '../../../packages/db/src/repositories/learning.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let userId: string;
let profileId: string;
let skillId: string;

const SOURCE_ID = 'kubernetes-io';

async function insertSource(): Promise<void> {
  await pool.query(
    `INSERT INTO connector_sources
       (id, kind, display_name, connector_version, source_tier, terms_url, legal_basis,
        rate_limit, refresh_window, schedule)
     VALUES ($1, 'learning', 'Kubernetes Documentation', '1.0.0', 1,
             'https://kubernetes.io/terms', 'Documentation published under CC BY 4.0',
             '{"requests":30,"per":"minute"}'::jsonb, '30 days', '0 3 * * 1')
     ON CONFLICT (id) DO NOTHING`,
    [SOURCE_ID],
  );
}

async function insertResource(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const row = {
    provider: 'kubernetes.io',
    // UUIDv7 is time-ordered, so two ids created in the same millisecond share their first bytes —
    // slicing the front produced colliding external ids. The tail is the random half.
    external_id: `res-${id.slice(-12)}`,
    title: 'Kubernetes Basics',
    url: 'https://kubernetes.io/docs/tutorials/kubernetes-basics/',
    format: 'tutorial',
    language: 'en',
    cost_band: 'free',
    source_tier: 1,
    link_status: 'ok',
    retired_at: null,
    grants_evidence: false,
    ...overrides,
  };

  await pool.query(
    `INSERT INTO learning_resources
       (id, provider, external_id, title, url, format, language, cost_band,
        source_id, source_tier, source_url, retrieved_at, last_verified_at,
        link_status, retired_at, grants_evidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$5,now(),now(),$11,$12,$13)`,
    [
      id,
      row.provider,
      row.external_id,
      row.title,
      row.url,
      row.format,
      row.language,
      row.cost_band,
      SOURCE_ID,
      row.source_tier,
      row.link_status,
      row.retired_at,
      row.grants_evidence,
    ],
  );
  return id;
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM learning_completions');
  await pool.query('DELETE FROM learning_resource_skills');
  await pool.query('DELETE FROM learning_resources');
  await pool.query('DELETE FROM profile_skills');
  await pool.query('DELETE FROM user_profiles');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM skills');
  await insertSource();

  userId = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
    userId,
    `learner-${userId.slice(0, 8)}@example.invalid`,
  ]);

  profileId = uuidv7();
  await pool.query(
    `INSERT INTO user_profiles (id, user_id, version, is_current) VALUES ($1,$2,1,true)`,
    [profileId, userId],
  );

  skillId = uuidv7();
  await pool.query(
    `INSERT INTO skills (id, slug, name, kind, source_tier, basis) VALUES ($1,'kubernetes','Kubernetes','technology',3,'curated')`,
    [skillId],
  );
});

describe('a completion is a claim about a resource, never about a person', () => {
  it('writes no profile_skills row', async () => {
    // **The regression this file exists to prevent.** Readiness credits only `evidenced` skills, so
    // a completion that promoted one would let somebody raise their readiness by clicking finished.
    const resourceId = await insertResource();

    await recordCompletion(db, {
      userId,
      resourceId,
      completedAt: '2026-08-01T00:00:00Z',
      newId: uuidv7,
    });

    const { rows } = await pool.query('SELECT id FROM profile_skills');
    expect(rows).toEqual([]);
  });

  it('does not promote even when the resource grants evidence', async () => {
    // `grants_evidence` marks a resource whose completion *could* promote a skill. Nothing acts on
    // it yet, and the flag existing is not the same as the mechanism existing.
    const resourceId = await insertResource({ grants_evidence: true, format: 'certification' });

    await recordCompletion(db, {
      userId,
      resourceId,
      completedAt: '2026-08-01T00:00:00Z',
      newId: uuidv7,
    });

    const { rows } = await pool.query('SELECT id FROM profile_skills');
    expect(rows).toEqual([]);
  });

  it('records the date the person gives, not the date they told us', async () => {
    const resourceId = await insertResource();

    const row = await recordCompletion(db, {
      userId,
      resourceId,
      completedAt: '2026-03-04T00:00:00Z',
      newId: uuidv7,
    });

    expect(new Date(row.completed_at).toISOString()).toBe('2026-03-04T00:00:00.000Z');
    expect(row.basis).toBe('self_reported');
  });

  it('keeps one row when the same resource is recorded twice', async () => {
    // Finishing a course twice is one fact about a person. Two rows would double whatever an
    // observed-pace estimate later reads.
    const resourceId = await insertResource();

    await recordCompletion(db, { userId, resourceId, completedAt: '2026-03-04T00:00:00Z', newId: uuidv7 });
    await recordCompletion(db, {
      userId,
      resourceId,
      completedAt: '2026-05-06T00:00:00Z',
      note: 'finished the labs too',
      newId: uuidv7,
    });

    const rows = await completionsForUser(db, userId).execute();
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.completed_at).toISOString()).toBe('2026-05-06T00:00:00.000Z');
    expect(rows[0]!.note).toBe('finished the labs too');
  });

  it('refuses a completion dated in the future', async () => {
    // The database cannot hold this: PostgreSQL refuses a non-immutable function in a CHECK. So the
    // guard is the repository's, and this is the test that says so.
    const resourceId = await insertResource();

    await expect(
      recordCompletion(db, {
        userId,
        resourceId,
        completedAt: '2027-01-01T00:00:00Z',
        newId: uuidv7,
        now: () => new Date('2026-08-22T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(CompletionInvariantError);
  });

  it('stores an offered certificate link without reading it', async () => {
    const resourceId = await insertResource();

    const row = await recordCompletion(db, {
      userId,
      resourceId,
      completedAt: '2026-08-01T00:00:00Z',
      evidenceUrl: 'https://example.invalid/certificate/123',
      newId: uuidv7,
    });

    // Stored, never trusted. It changes no status and no score — a link is not a verification.
    expect(row.evidence_url).toBe('https://example.invalid/certificate/123');
    const { rows } = await pool.query('SELECT id FROM profile_skills');
    expect(rows).toEqual([]);
  });
});

describe('what may be shown to somebody', () => {
  it('excludes a dead link and a retired resource, without deleting either', async () => {
    // Excluded rather than deleted, so a path that already recommended one can still explain itself.
    const live = await insertResource({ title: 'Live' });
    await insertResource({ title: 'Dead', link_status: 'dead' });
    await insertResource({ title: 'Retired', retired_at: new Date().toISOString() });

    const rows = await usableResources(db).execute();

    expect(rows.map((row) => row.id)).toEqual([live]);
    const { rows: stored } = await pool.query('SELECT id FROM learning_resources');
    expect(stored).toHaveLength(3);
  });

  it('returns a skill’s resources with the coverage that decides whether they close a gap', async () => {
    const primary = await insertResource({ title: 'A primary course' });
    const mentions = await insertResource({ title: 'A course that mentions it' });

    for (const [resourceId, coverage] of [
      [primary, 'primary'],
      [mentions, 'mentioned'],
    ] as const) {
      await pool.query(
        `INSERT INTO learning_resource_skills (id, resource_id, skill_id, coverage, basis)
         VALUES ($1,$2,$3,$4,'provider-stated')`,
        [uuidv7(), resourceId, skillId, coverage],
      );
    }

    const rows = await resourcesForSkill(db, skillId).execute();

    // `mentioned` sorts after `primary`: a course that merely mentions a skill does not close a gap
    // in it, and the caller must be able to tell them apart.
    expect(rows.map((row) => row.coverage)).toEqual(['mentioned', 'primary']);
  });
});

describe('the constraints the entity file promises', () => {
  it('refuses a resource above tier 2', async () => {
    // Official provider pages only — an aggregator's listing goes stale and misattributes.
    await expect(insertResource({ source_tier: 3 })).rejects.toThrow(/ck_lr__tier/);
  });

  it('refuses a certification with no authority', async () => {
    await expect(
      pool.query(
        `INSERT INTO learning_resources
           (id, provider, external_id, title, url, format, language, cost_band,
            source_id, source_tier, source_url, retrieved_at, last_verified_at, is_certification)
         VALUES ($1,'p','e','t','https://example.invalid','certification','en','free',$2,1,
                 'https://example.invalid', now(), now(), true)`,
        [uuidv7(), SOURCE_ID],
      ),
    ).rejects.toThrow(/ck_lr__cert_authority/);
  });

  it('refuses a resource whose source is not a registered connector', async () => {
    await expect(
      pool.query(
        `INSERT INTO learning_resources
           (id, provider, external_id, title, url, format, language, cost_band,
            source_id, source_tier, source_url, retrieved_at, last_verified_at)
         VALUES ($1,'p','e','t','https://example.invalid','course','en','free','not-registered',1,
                 'https://example.invalid', now(), now())`,
        [uuidv7()],
      ),
    ).rejects.toThrow(/fk_lr__sources/);
  });

  it('refuses a connector id that is not kebab-case', async () => {
    await expect(
      pool.query(
        `INSERT INTO connector_sources
           (id, kind, display_name, connector_version, source_tier, terms_url, legal_basis,
            rate_limit, refresh_window, schedule)
         VALUES ('Not Kebab','learning','x','1.0.0',1,'https://example.invalid','x',
                 '{}'::jsonb,'1 day','0 3 * * 1')`,
      ),
    ).rejects.toThrow(/ck_cs__id_format/);
  });

  it('refuses an open breaker that cannot say when it opened', async () => {
    // An open breaker with no opening time can never be closed on a timer, so the source silently
    // disappears from every run.
    await expect(
      pool.query(
        `INSERT INTO connector_sources
           (id, kind, display_name, connector_version, source_tier, terms_url, legal_basis,
            rate_limit, refresh_window, schedule, breaker_state)
         VALUES ('broken-source','learning','x','1.0.0',1,'https://example.invalid','x',
                 '{}'::jsonb,'1 day','0 3 * * 1','open')`,
      ),
    ).rejects.toThrow(/ck_cs__breaker_time/);
  });
});
