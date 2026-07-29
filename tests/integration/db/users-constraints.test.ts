/**
 * What the `users` schema refuses — and specifically, ADR-0013's compliance section.
 *
 * The decision was to store `email` as `text` and fold case in a unique index rather than adopt the
 * `citext` extension. Two things have to be true for that to be a real guarantee rather than a
 * preference, and both are asserted here:
 *
 *   1. a differently-cased duplicate is rejected **by the database**, at write time
 *   2. no PostgreSQL extension was installed — otherwise `citext` could reappear quietly in a later
 *      migration and nothing would notice
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { expectViolation, migratedTestPool } from './database.js';
import { newId } from './fixtures.js';

let pool: Pool;

beforeAll(async () => {
  pool = await migratedTestPool();
});

beforeEach(async () => {
  await pool.query('DELETE FROM users');
});

afterAll(async () => {
  await pool?.end();
});

async function insertUser(
  email: string,
  overrides: { deletedAt?: string | null; authSubject?: string | null } = {},
): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO users (id, email, auth_provider, auth_subject, deleted_at)
     VALUES ($1, $2, 'password', $3, $4)`,
    [id, email, overrides.authSubject ?? null, overrides.deletedAt ?? null],
  );
  return id;
}

describe('ADR-0013: case-insensitive email uniqueness', () => {
  it('rejects the same address in a different case', async () => {
    await insertUser('ada@example.com');

    const violation = await expectViolation(pool, () => insertUser('Ada@Example.COM'));
    expect(violation.constraint).toBe('uq_users__email');
  });

  it('stores the address as entered rather than lower-casing it', async () => {
    await insertUser('Ada.Lovelace@Example.com');
    const { rows } = await pool.query<{ email: string }>('SELECT email FROM users');
    // The person is addressed the way they wrote it; only the index folds case.
    expect(rows[0]?.email).toBe('Ada.Lovelace@Example.com');
  });

  it('finds the row through the documented lookup, whatever case is supplied', async () => {
    const id = await insertUser('Ada@Example.com');

    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL',
      ['ADA@EXAMPLE.COM'],
    );
    expect(rows.map((r) => r.id)).toEqual([id]);
  });

  it('can serve that lookup from the index rather than scanning', async () => {
    await insertUser('ada@example.com');

    // The claim under test is that the *predicate matches the index expression* — without that,
    // ADR-0013 buys the uniqueness guarantee and loses the lookup path. It is not a claim about
    // what the planner picks: on a one-row table a sequential scan is genuinely cheaper, so
    // asserting on an unhinted plan would be a test of table size. `enable_seqscan = off` removes
    // that variable, and LOCAL scopes it to this transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
        ['ada@example.com'],
      );
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain('uq_users__email');
      expect(plan).toContain('lower(email)');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('frees the address once the account is soft-deleted', async () => {
    // The index is partial on deleted_at IS NULL, so a removed account does not hold its email
    // hostage.
    await insertUser('ada@example.com', { deletedAt: '2026-01-01T00:00:00Z' });
    await expect(insertUser('ADA@example.com')).resolves.toBeTruthy();
  });

  it('distinguishes different addresses that differ only after the fold', async () => {
    await insertUser('ada@example.com');
    await expect(insertUser('ada2@example.com')).resolves.toBeTruthy();
  });
});

describe('ADR-0013: no extension was installed', () => {
  it('has no PostgreSQL extension beyond plpgsql', async () => {
    const { rows } = await pool.query<{ extname: string }>(
      'SELECT extname FROM pg_extension ORDER BY extname',
    );
    // If citext (or anything else) is ever added by a migration, this fails and the ADR gets
    // revisited deliberately rather than by accident.
    expect(rows.map((r) => r.extname)).toEqual(['plpgsql']);
  });
});

describe('the rest of the users table', () => {
  it('rejects a status outside the three', async () => {
    const violation = await expectViolation(pool, () =>
      pool.query(
        `INSERT INTO users (id, email, auth_provider, status) VALUES ($1, $2, 'password', 'banned')`,
        [newId(), 'status@example.com'],
      ),
    );
    expect(violation.constraint).toBe('ck_users__status');
  });

  it('rejects the same external identity twice for one provider', async () => {
    await insertUser('one@example.com', { authSubject: 'subject-1' });
    const violation = await expectViolation(pool, () =>
      insertUser('two@example.com', { authSubject: 'subject-1' }),
    );
    expect(violation.constraint).toBe('uq_users__auth_subject');
  });

  it('does not re-bind an external identity after a soft delete', async () => {
    // Unlike the email index, this one is not partial on deleted_at — a delegated identity that
    // could be re-bound is an account-takeover path.
    await insertUser('one@example.com', {
      authSubject: 'subject-2',
      deletedAt: '2026-01-01T00:00:00Z',
    });
    const violation = await expectViolation(pool, () =>
      insertUser('two@example.com', { authSubject: 'subject-2' }),
    );
    expect(violation.constraint).toBe('uq_users__auth_subject');
  });

  it('allows many rows with no external identity', async () => {
    await insertUser('a@example.com');
    await expect(insertUser('b@example.com')).resolves.toBeTruthy();
  });
});
