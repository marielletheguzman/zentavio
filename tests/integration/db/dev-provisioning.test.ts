/**
 * The development credential provisions its user, and does not resurrect an erased one.
 *
 * An integration test rather than a unit one because the whole defect lived in the database: the
 * dev resolver returned a subject for a user id with no row, and the foreign key surfaced several
 * layers later as a 500. A mocked database cannot fail that way, which is precisely why it went
 * unnoticed.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from '@zentavio/db';
import { InsecureDevSubjectResolver, UnauthenticatedError } from '@zentavio/auth';
import { DevSubjectResolver } from '../../../services/api-gateway/src/auth/dev-subject.resolver.ts';
import { eraseUser } from '@zentavio/db';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;

const DEV_USER = '00000000-0000-7000-8000-0000000000aa';

function resolver(options: { isProduction?: boolean; enabled?: boolean } = {}): DevSubjectResolver {
  return new DevSubjectResolver(
    new InsecureDevSubjectResolver({
      enabled: options.enabled ?? true,
      isProduction: options.isProduction ?? false,
    }),
    db,
  );
}

function headers(userId: string): ReadonlyMap<string, string> {
  return new Map([['x-zentavio-dev-user', userId]]);
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

beforeEach(async () => {
  await pool.query('DELETE FROM user_targets');
  await pool.query('DELETE FROM user_profiles');
  await pool.query('DELETE FROM users');
});

afterAll(async () => {
  await db?.destroy();
});

describe('the development credential', () => {
  it('creates the user it names, so a write does not fail on a foreign key', async () => {
    const subject = await resolver().resolve(headers(DEV_USER));
    expect(subject.userId).toBe(DEV_USER);

    const { rows } = await pool.query('SELECT id, status FROM users WHERE id = $1', [DEV_USER]);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { status: string }).status).toBe('active');
  });

  it('is idempotent across restarts, so a developer keeps one account', async () => {
    // The id comes from the header rather than being generated. That is the point: pick an id,
    // use it for weeks, get the same account and the same profile.
    await resolver().resolve(headers(DEV_USER));
    await resolver().resolve(headers(DEV_USER));

    const { rows } = await pool.query('SELECT count(*)::text AS n FROM users WHERE id = $1', [
      DEV_USER,
    ]);
    expect((rows[0] as { n: string }).n).toBe('1');
  });

  it('leaves an existing user completely alone', async () => {
    // Provisioning must not overwrite a real row. A developer whose account has a profile and a
    // target should not have its email rewritten by signing in again.
    await pool.query(
      `INSERT INTO users (id, email, auth_provider) VALUES ($1, 'real@example.invalid', 'password')`,
      [DEV_USER],
    );

    await resolver().resolve(headers(DEV_USER));

    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [DEV_USER]);
    expect((rows[0] as { email: string }).email).toBe('real@example.invalid');
  });

  it('does not resurrect an erased account', async () => {
    // `eraseUser` tombstones rather than deletes, so the insert conflicts and does nothing. A dev
    // credential that silently un-erased an account would make the erasure tests lie.
    await pool.query(
      `INSERT INTO users (id, email, auth_provider) VALUES ($1, 'gone@example.invalid', 'password')`,
      [DEV_USER],
    );
    await eraseUser(db, DEV_USER);

    await resolver().resolve(headers(DEV_USER));

    const { rows } = await pool.query('SELECT status, email FROM users WHERE id = $1', [DEV_USER]);
    const row = rows[0] as { status: string; email: string };
    expect(row.status).toBe('erased');
    expect(row.email).toContain('erased+');
  });

  it('provisions nothing in production, however the flag is set', async () => {
    // The dangerous check stays in the wrapped resolver — one implementation of "refuse in
    // production", not two that can drift. This asserts the wrapper cannot bypass it.
    await expect(resolver({ isProduction: true }).resolve(headers(DEV_USER))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );

    const { rows } = await pool.query('SELECT count(*)::text AS n FROM users');
    expect((rows[0] as { n: string }).n).toBe('0');
  });

  it('provisions nothing when the credential is malformed', async () => {
    await expect(resolver().resolve(headers('not-a-uuid'))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );

    const { rows } = await pool.query('SELECT count(*)::text AS n FROM users');
    expect((rows[0] as { n: string }).n).toBe('0');
  });

  it('provisions nothing when the credential is absent', async () => {
    await expect(resolver().resolve(new Map())).rejects.toBeInstanceOf(UnauthenticatedError);

    const { rows } = await pool.query('SELECT count(*)::text AS n FROM users');
    expect((rows[0] as { n: string }).n).toBe('0');
  });
});
