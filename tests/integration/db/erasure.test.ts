/**
 * Erasure, against a real PostgreSQL.
 *
 * A deletion routine that nobody has watched delete is a promise. These tests are the audit: they
 * create real personal data, erase it, and assert it is gone — including the versions a naive
 * implementation forgets, because a superseded profile is exactly as personal as the live one.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import {
  applySeed,
  createProfileVersion,
  eraseUser,
  hasPersonalData,
  loadSeedFile,
  seedsDirectory,
  uuidv7,
  type Database,
} from '@zentavio/db';
import { join } from 'node:path';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let userId: string;
let skillId: string;

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

beforeEach(async () => {
  await pool.query('DELETE FROM user_profiles');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM skill_aliases');
  await pool.query('DELETE FROM skills');
  await pool.query('DELETE FROM careers');
  await applySeed(pool, await loadSeedFile(join(seedsDirectory, 'cloud-platform-engineering.json')));

  userId = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
    userId,
    `subject-${userId.slice(0, 8)}@example.invalid`,
  ]);

  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM skills WHERE slug = 'kubernetes'`);
  skillId = rows[0]!.id;
});

afterAll(async () => {
  await db?.destroy();
});

async function givenAProfile(): Promise<void> {
  await createProfileVersion(db, {
    userId,
    skills: [
      {
        skill_id: skillId,
        status: 'evidenced',
        evidence_kind: 'role',
        source_span: 'Led a Kubernetes migration',
        confidence: 'high',
      },
    ],
  });
}

async function count(table: 'user_profiles' | 'profile_skills'): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number((rows[0] as { n: string }).n);
}

describe('eraseUser', () => {
  it('deletes every profile version, not just the current one', async () => {
    // A superseded profile is exactly as personal as the live one, and it is the thing a naive
    // implementation forgets — `is_current` is right there, inviting a WHERE clause.
    await givenAProfile();
    await givenAProfile();
    await givenAProfile();
    expect(await count('user_profiles')).toBe(3);

    const report = await eraseUser(db, userId);

    expect(report.profilesDeleted).toBe(3);
    expect(await count('user_profiles')).toBe(0);
  });

  it('takes the profile skills with them', async () => {
    await givenAProfile();
    expect(await count('profile_skills')).toBe(1);

    await eraseUser(db, userId);
    expect(await count('profile_skills')).toBe(0);
  });

  it('leaves a tombstone rather than deleting the user row', async () => {
    // Deleting the row would orphan or destroy outcome data that is no longer personal.
    await givenAProfile();
    await eraseUser(db, userId);

    const { rows } = await pool.query<{ status: string; email: string }>(
      'SELECT status, email FROM users WHERE id = $1',
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('erased');
  });

  it('clears the identifying columns', async () => {
    const original = `subject-${userId.slice(0, 8)}@example.invalid`;
    await eraseUser(db, userId);

    const { rows } = await pool.query<{ email: string; auth_subject: string | null }>(
      'SELECT email, auth_subject FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0]?.email).not.toBe(original);
    expect(rows[0]?.email).not.toContain('subject-');
    expect(rows[0]?.auth_subject).toBeNull();
  });

  it('can erase two users without colliding on the email unique index', async () => {
    // The cleared email must stay unique. A constant like 'erased@invalid' would make the second
    // erasure fail — and fail at the worst possible moment.
    const second = uuidv7();
    await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
      second,
      `other-${second.slice(0, 8)}@example.invalid`,
    ]);

    await eraseUser(db, userId);
    await expect(eraseUser(db, second)).resolves.toMatchObject({ userTombstoned: true });
  });

  it('is idempotent — erasing twice is not an error', async () => {
    await givenAProfile();
    await eraseUser(db, userId);

    const second = await eraseUser(db, userId);
    // Nothing left to do, and the caller can tell: no profiles, no fresh tombstone.
    expect(second.profilesDeleted).toBe(0);
    expect(second.userTombstoned).toBe(false);
  });

  it('reports honestly when the user never existed', async () => {
    const report = await eraseUser(db, uuidv7());
    expect(report.userTombstoned).toBe(false);
    expect(report.profilesDeleted).toBe(0);
  });

  it('leaves world facts alone', async () => {
    // skills and careers are shared by every user and are not personal data. An erasure that took
    // them would destroy the registry for everyone.
    await givenAProfile();
    await eraseUser(db, userId);

    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM skills');
    expect(Number((rows[0] as { n: string }).n)).toBeGreaterThan(0);
  });
});

describe('hasPersonalData — the audit', () => {
  it('is true while a profile exists', async () => {
    await givenAProfile();
    expect(await hasPersonalData(db, userId)).toBe(true);
  });

  it('is true for a live account with no profile yet', async () => {
    expect(await hasPersonalData(db, userId)).toBe(true);
  });

  it('is false after erasure', async () => {
    await givenAProfile();
    await eraseUser(db, userId);
    expect(await hasPersonalData(db, userId)).toBe(false);
  });

  it('is false for a user who never existed', async () => {
    expect(await hasPersonalData(db, uuidv7())).toBe(false);
  });
});
