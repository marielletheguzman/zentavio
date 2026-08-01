/**
 * Just-in-time user provisioning, against a real PostgreSQL.
 *
 * The behaviours here are only decidable against a real database, because they are properties of the
 * unique index on `(auth_provider, auth_subject)` and of a real concurrent insert. A mocked query
 * builder would prove nothing about either.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { UnauthenticatedError } from '@zentavio/auth';
import { eraseUser, type Database } from '@zentavio/db';
import { OidcSubjectResolver } from '../../../services/api-gateway/src/auth/oidc-subject.resolver.ts';
import { migratedTestPool } from './database.ts';

const ISSUER = 'https://issuer.example.invalid';
const PROVIDER = `oidc:${ISSUER}`;

let pool: Pool;
let db: Kysely<Database>;

/**
 * A verifier that returns a fixed identity.
 *
 * Token verification itself is covered without a database in `packages/auth/src/oidc.test.ts`. What
 * is under test here is everything that happens *after* a token is trusted.
 */
function verifierFor(subject: string, email?: string) {
  return {
    verify: async () => ({ subject, provider: PROVIDER, ...(email ? { email } : {}) }),
  } as unknown as ConstructorParameters<typeof OidcSubjectResolver>[0];
}

const headers = (token = 'anything') => new Map([['authorization', `Bearer ${token}`]]);

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

beforeEach(async () => {
  await pool.query('DELETE FROM user_profiles');
  await pool.query('DELETE FROM users');
});

afterAll(async () => {
  await db?.destroy();
});

describe('first sign-in', () => {
  it('creates the user, shaped as the schema documents', async () => {
    const resolver = new OidcSubjectResolver(verifierFor('user_abc', 'ada@example.invalid'), db);
    const subject = await resolver.resolve(headers());

    expect(subject.authenticatedVia).toBe('oidc');

    const row = await db
      .selectFrom('users')
      .select(['id', 'email', 'auth_provider', 'auth_subject', 'email_verified_at'])
      .where('id', '=', subject.userId)
      .executeTakeFirstOrThrow();

    expect(row.auth_provider).toBe(PROVIDER);
    expect(row.auth_subject).toBe('user_abc');
    expect(row.email).toBe('ada@example.invalid');
    // The provider asserted the address was verified, so the timestamp is set.
    expect(row.email_verified_at).not.toBeNull();
  });

  it('uses an obviously synthetic address when the provider asserts no verified email', async () => {
    // `users.email` is NOT NULL. Inventing a plausible-looking address would be worse than one that
    // is visibly not a real mailbox — `.invalid` is reserved and can never route.
    const resolver = new OidcSubjectResolver(verifierFor('user_noemail'), db);
    const subject = await resolver.resolve(headers());

    const row = await db
      .selectFrom('users')
      .select(['email', 'email_verified_at'])
      .where('id', '=', subject.userId)
      .executeTakeFirstOrThrow();

    expect(row.email).toBe('user_noemail@oidc.invalid');
    expect(row.email_verified_at).toBeNull();
  });
});

describe('returning sign-in', () => {
  it('reuses the same user rather than creating a second', async () => {
    const resolver = new OidcSubjectResolver(verifierFor('user_repeat'), db);

    const first = await resolver.resolve(headers());
    const second = await resolver.resolve(headers());

    expect(second.userId).toBe(first.userId);

    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM users');
    expect(Number((rows[0] as { n: string }).n)).toBe(1);
  });

  it('does not collide when two people arrive with no email', async () => {
    // Both get a synthetic address, and they must differ — a shared placeholder would trip
    // `uq_users__email` and lock out the second person entirely.
    await new OidcSubjectResolver(verifierFor('subject_one'), db).resolve(headers());
    await expect(
      new OidcSubjectResolver(verifierFor('subject_two'), db).resolve(headers()),
    ).resolves.toBeTruthy();
  });
});

describe('concurrency', () => {
  it('two simultaneous first sign-ins produce one account, not two', async () => {
    // The race the unique index exists for. Without `onConflict … doNothing` plus the re-read, one
    // of these throws and a legitimate first sign-in fails.
    const resolver = new OidcSubjectResolver(verifierFor('user_race'), db);

    const [a, b] = await Promise.all([resolver.resolve(headers()), resolver.resolve(headers())]);

    expect(a.userId).toBe(b.userId);
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM users');
    expect(Number((rows[0] as { n: string }).n)).toBe(1);
  });
});

describe('after erasure', () => {
  it('a returning person becomes a new account, not the old one', async () => {
    // Erasure clears `auth_subject`, so the lookup cannot match the tombstone. That is deliberate:
    // refusing them forever would be a ban, not an erasure. What must NOT happen is the old
    // account — and its data — coming back.
    const resolver = new OidcSubjectResolver(verifierFor('user_erased'), db);
    const first = await resolver.resolve(headers());
    await eraseUser(db, first.userId);

    const second = await resolver.resolve(headers());
    expect(second.userId).not.toBe(first.userId);
  });

  it('and reaches none of the erased profile data', async () => {
    // The property that actually matters. A new account with the old profile attached would be an
    // erasure that erased nothing.
    const resolver = new OidcSubjectResolver(verifierFor('user_erased_data'), db);
    const first = await resolver.resolve(headers());
    await eraseUser(db, first.userId);
    const second = await resolver.resolve(headers());

    const profiles = await db
      .selectFrom('user_profiles')
      .select('id')
      .where('user_id', '=', second.userId)
      .execute();

    expect(profiles).toEqual([]);
  });

  it('leaves the tombstone in place', async () => {
    // The erased row survives so foreign keys and anonymised aggregates stay coherent.
    const resolver = new OidcSubjectResolver(verifierFor('user_tombstone'), db);
    const first = await resolver.resolve(headers());
    await eraseUser(db, first.userId);
    await resolver.resolve(headers());

    const tombstone = await db
      .selectFrom('users')
      .select(['status', 'auth_subject'])
      .where('id', '=', first.userId)
      .executeTakeFirstOrThrow();

    expect(tombstone.status).toBe('erased');
    expect(tombstone.auth_subject).toBeNull();
  });
});

describe('refusals', () => {
  it('refuses a request with no authorization header', async () => {
    const resolver = new OidcSubjectResolver(verifierFor('anyone'), db);
    await expect(resolver.resolve(new Map())).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('refuses a non-bearer scheme', async () => {
    const resolver = new OidcSubjectResolver(verifierFor('anyone'), db);
    await expect(
      resolver.resolve(new Map([['authorization', 'Basic abc']])),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('creates no user when the token does not verify', async () => {
    // A failed verification must not leave a provisioned account behind.
    const failing = {
      verify: async () => {
        throw new Error('nope');
      },
    } as unknown as ConstructorParameters<typeof OidcSubjectResolver>[0];

    await expect(
      new OidcSubjectResolver(failing, db).resolve(headers()),
    ).rejects.toBeInstanceOf(UnauthenticatedError);

    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM users');
    expect(Number((rows[0] as { n: string }).n)).toBe(0);
  });
});
