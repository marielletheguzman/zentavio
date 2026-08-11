/**
 * Recording an answer, against a real database.
 *
 * The behaviour under test is versioning: a correction must not destroy the answer a verdict was
 * already computed from. `uq_person_facts__current` and `uq_person_facts__version` are what enforce
 * it, and this asserts the repository actually satisfies them rather than working around them.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  InvalidFactValueError,
  UnknownFactKindError,
  currentFacts,
  recordFact,
} from '../../../packages/db/src/repositories/person-facts.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

const KEY = 'expected_gross_annual_salary_eur';
const DEGREE = 'has_recognised_academic_degree';
const MONTHS = 'employment_contract_months';

/** A valid answer for the monetary kind. Anything less is refused, which is the point. */
function euros(amount: number) {
  return { amount, currency: 'EUR', period: 'year', basis: 'gross' };
}

let pool: Pool;
let db: Kysely<Database>;
let userId: string;

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM person_facts');
  await pool.query('DELETE FROM person_fact_kinds');
  await pool.query('DELETE FROM users');

  userId = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
    userId,
    `facts-${userId.slice(0, 8)}@example.invalid`,
  ]);
  await pool.query(
    `INSERT INTO person_fact_kinds (key, value_type, unit, prompt, rationale, sensitive)
     VALUES ($1, 'monetary', 'EUR/year', 'What gross annual salary do you expect?',
             'The Blue Card threshold is compared against gross annual pay.', true)`,
    [KEY],
  );
  await pool.query(
    `INSERT INTO person_fact_kinds (key, value_type, unit, prompt, rationale, sensitive)
     VALUES ($1, 'boolean', NULL, 'Do you hold a recognised higher-education degree?',
             '§ 18g Abs. 1 S. 1 AufenthG addresses a Fachkraft mit akademischer Ausbildung.', false)`,
    [DEGREE],
  );
  await pool.query(
    `INSERT INTO person_fact_kinds (key, value_type, unit, prompt, rationale, sensitive)
     VALUES ($1, 'integer', 'months', 'How many months does the job offer run for?',
             '§ 18g Abs. 3 AufenthG requires at least six months of employment.', false)`,
    [MONTHS],
  );
});

describe('recordFact', () => {
  it('stores the first answer as version 1', async () => {
    const row = await recordFact(db, { userId, key: KEY, value: euros(52000) });

    expect(row.version).toBe(1);
    expect(row.is_current).toBe(true);
    expect(row.basis).toBe('self_reported');
  });

  it('a correction supersedes rather than overwrites', async () => {
    // The verdict computed against 52 000 must remain explicable after the correction to 48 000.
    await recordFact(db, { userId, key: KEY, value: euros(52000) });
    const corrected = await recordFact(db, { userId, key: KEY, value: euros(48000) });

    expect(corrected.version).toBe(2);

    const all = await db
      .selectFrom('person_facts')
      .select(['version', 'is_current', 'value'])
      .where('user_id', '=', userId)
      .orderBy('version')
      .execute();

    expect(all).toHaveLength(2);
    expect(all[0]?.is_current).toBe(false);
    expect(all[0]?.value).toMatchObject({ amount: 52000 });
    expect(all[1]?.is_current).toBe(true);
  });

  it('leaves exactly one current row per fact', async () => {
    await recordFact(db, { userId, key: KEY, value: euros(1) });
    await recordFact(db, { userId, key: KEY, value: euros(2) });
    await recordFact(db, { userId, key: KEY, value: euros(3) });

    const current = await currentFacts(db, userId);
    expect(current).toHaveLength(1);
    expect(current[0]?.version).toBe(3);
  });

  it('never reuses a version, even after the previous row is soft-deleted', async () => {
    // "The salary as it stood at v2" is what an explained verdict is built from.
    await recordFact(db, { userId, key: KEY, value: euros(1) });
    await pool.query('UPDATE person_facts SET deleted_at = now() WHERE user_id = $1', [userId]);

    const next = await recordFact(db, { userId, key: KEY, value: euros(2) });
    expect(next.version).toBe(2);
  });

  it('refuses a key the catalogue does not define, naming the rule', async () => {
    // Left to the foreign key this would surface as a constraint name the caller has to decode.
    await expect(
      recordFact(db, { userId, key: 'salary_but_misspelled', value: euros(1) }),
    ).rejects.toThrow(UnknownFactKindError);
  });

  it('records a verified answer with its detail', async () => {
    const row = await recordFact(db, {
      userId,
      key: KEY,
      value: euros(60000),
      basis: 'verified',
      basisDetail: 'signed offer letter',
    });

    // `ck_person_facts__verified` refuses a verified row with no date — a claim about evidence
    // with no evidence. The column has no database default, so the repository supplies one.
    expect(row.basis).toBe('verified');
    expect(row.basis_detail).toBe('signed offer letter');
    expect(row.verified_at).toBeInstanceOf(Date);
  });
});

describe('currentFacts', () => {
  it('returns nothing for a person who has answered nothing', async () => {
    expect(await currentFacts(db, userId)).toEqual([]);
  });

  it('excludes soft-deleted rows', async () => {
    await recordFact(db, { userId, key: KEY, value: euros(1) });
    await pool.query('UPDATE person_facts SET deleted_at = now() WHERE user_id = $1', [userId]);

    expect(await currentFacts(db, userId)).toEqual([]);
  });
});

describe('a fact is typed at the write boundary', () => {
  /**
   * The defect a browser found on 2026-08-11, asserted where it was actually possible.
   *
   * Answering "no" to the degree question stored the string `'no'`, and the evaluator's
   * `bool(value)` reads every non-empty string as `True` — so somebody who had just said they held
   * no degree was told the qualification rule was **Met**. The repository is where that becomes
   * impossible, because it is the write path every caller shares.
   */
  it('refuses the string that told someone they held a degree they do not have', async () => {
    await expect(recordFact(db, { userId, key: DEGREE, value: 'no' })).rejects.toThrow(
      InvalidFactValueError,
    );

    // And nothing was written. A refused answer must not leave a version behind, or the next
    // correction is numbered against a row that was never valid.
    expect(await currentFacts(db, userId)).toEqual([]);
  });

  it('stores a real boolean, both ways', async () => {
    const no = await recordFact(db, { userId, key: DEGREE, value: false });
    expect(no.value).toBe(false);

    const yes = await recordFact(db, { userId, key: DEGREE, value: true });
    expect(yes.value).toBe(true);
    expect(yes.version).toBe(2);
  });

  it('refuses every other spelling of a boolean', async () => {
    for (const value of ['true', 'false', 'yes', 0, 1]) {
      await expect(recordFact(db, { userId, key: DEGREE, value })).rejects.toThrow(
        InvalidFactValueError,
      );
    }
  });

  it('stores an integer as a number and refuses the numeric string', async () => {
    const row = await recordFact(db, { userId, key: MONTHS, value: 12 });
    expect(row.value).toBe(12);

    await expect(recordFact(db, { userId, key: MONTHS, value: '12' })).rejects.toThrow(
      InvalidFactValueError,
    );
  });

  it('refuses a monetary answer with no currency, however plausible the number', async () => {
    // 60 000 of an unstated currency compared against a EUR threshold is a confident wrong answer.
    await expect(recordFact(db, { userId, key: KEY, value: 60000 })).rejects.toThrow(
      InvalidFactValueError,
    );
    await expect(
      recordFact(db, { userId, key: KEY, value: { amount: 60000, currency: 'USD', period: 'year' } }),
    ).rejects.toThrow(InvalidFactValueError);
  });

  it('names the key in the message, because a client has to know which field', async () => {
    await expect(recordFact(db, { userId, key: DEGREE, value: 'no' })).rejects.toThrow(
      /has_recognised_academic_degree/,
    );
  });
});
