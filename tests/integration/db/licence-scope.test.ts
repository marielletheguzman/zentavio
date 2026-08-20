/**
 * Whether the track a person is pursuing is licence-gated, against a real database.
 *
 * **This exists because the guard that reads it was unreachable.** `ai/career-roadmap` refuses to
 * give a licence-gated profession a visa-only verdict and returns `unknown` with recognition named
 * (ADR-0010). The flag that triggers it was an optional argument to the gateway that no caller ever
 * passed, so the refusal never fired: a nurse would have received the visa answer, which is the
 * most harmful output this product can produce.
 *
 * The unit test for the service uses a stub and proves the value is forwarded. It cannot prove the
 * join is right — that is what this does, and the difference has caught this repository before.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { licenceScopeForUser } from '../../../packages/db/src/repositories/targets.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let userId: string;

/** A career row, gated or not. `profession` is required when gated — `ck_careers__licence_profession`. */
async function insertCareer(options: {
  readonly slug: string;
  readonly profession: string | null;
  readonly licenceGated: boolean;
}): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO careers (id, slug, name, family, profession, licence_gated, source_tier, basis)
     VALUES ($1, $2, $3, $4, $5, $6, 2, 'curated')`,
    [id, options.slug, options.slug, 'healthcare', options.profession, options.licenceGated],
  );
  return id;
}

async function target(careerId: string, rank: number): Promise<void> {
  await pool.query(
    `INSERT INTO user_targets (id, user_id, career_id, rank, status) VALUES ($1, $2, $3, $4, 'active')`,
    [uuidv7(), userId, careerId, rank],
  );
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM user_targets');
  await pool.query('DELETE FROM careers');
  await pool.query('DELETE FROM users');

  userId = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
    userId,
    `licence-${userId.slice(0, 8)}@example.invalid`,
  ]);
});

describe('licenceScopeForUser', () => {
  it('reports a licence-gated track with the profession it is gated by', async () => {
    const career = await insertCareer({
      slug: 'registered-nurse',
      profession: 'registered-nurse',
      licenceGated: true,
    });
    await target(career, 1);

    expect(await licenceScopeForUser(db, userId)).toEqual({
      profession: 'registered-nurse',
      licenceGated: true,
    });
  });

  it('reports a track that is not gated', async () => {
    const career = await insertCareer({
      slug: 'cloud-platform-engineer',
      profession: null,
      licenceGated: false,
    });
    await target(career, 1);

    expect(await licenceScopeForUser(db, userId)).toEqual({
      profession: null,
      licenceGated: false,
    });
  });

  it('returns undefined when the person has chosen no track', async () => {
    // Not the same as "not gated". There is no track to be gated, and the caller must not read
    // absence as a claim that recognition does not apply.
    expect(await licenceScopeForUser(db, userId)).toBeUndefined();
  });

  it('follows rank, so a second choice cannot decide whether recognition is checked', async () => {
    const gated = await insertCareer({
      slug: 'registered-nurse',
      profession: 'registered-nurse',
      licenceGated: true,
    });
    const ungated = await insertCareer({
      slug: 'cloud-platform-engineer',
      profession: null,
      licenceGated: false,
    });
    await target(gated, 1);
    await target(ungated, 2);

    expect(await licenceScopeForUser(db, userId)).toEqual({
      profession: 'registered-nurse',
      licenceGated: true,
    });
  });

  it('ignores an abandoned target', async () => {
    const career = await insertCareer({
      slug: 'registered-nurse',
      profession: 'registered-nurse',
      licenceGated: true,
    });
    await target(career, 1);
    await pool.query(`UPDATE user_targets SET status = 'abandoned' WHERE user_id = $1`, [userId]);

    expect(await licenceScopeForUser(db, userId)).toBeUndefined();
  });

  it('ignores a soft-deleted career', async () => {
    // A deleted career must not keep gating, and must not keep un-gating either. Both directions
    // matter, so the row is excluded rather than defaulted.
    const career = await insertCareer({
      slug: 'registered-nurse',
      profession: 'registered-nurse',
      licenceGated: true,
    });
    await target(career, 1);
    await pool.query(`UPDATE careers SET deleted_at = now() WHERE id = $1`, [career]);

    expect(await licenceScopeForUser(db, userId)).toBeUndefined();
  });
});
