/**
 * `person_fact_kinds` and `person_facts`, verified by attempting to violate them.
 *
 * A constraint expression that parses but fails to reject is invisible on review, so every one of
 * them is exercised with a row it must refuse.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { expectViolation, migratedTestPool } from './database.ts';

let pool: Pool;
let userId: string;

const KIND = 'test_expected_salary_eur';

async function insertKind(overrides: Record<string, unknown> = {}): Promise<void> {
  const row = {
    key: KIND,
    value_type: 'monetary',
    unit: 'EUR/year',
    prompt: 'What gross annual salary do you expect?',
    rationale: 'The Blue Card threshold is compared against gross annual pay.',
    sensitive: true,
    allowed_values: [],
    ...overrides,
  };
  await pool.query(
    `INSERT INTO person_fact_kinds (key, value_type, unit, prompt, rationale, sensitive, allowed_values)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.key, row.value_type, row.unit, row.prompt, row.rationale, row.sensitive, row.allowed_values],
  );
}

async function insertFact(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const row = {
    id,
    user_id: userId,
    kind_key: KIND,
    version: 1,
    is_current: true,
    value: JSON.stringify({ amount: 60000, currency: 'EUR', period: 'year', basis: 'gross' }),
    basis: 'self_reported',
    verified_at: null,
    valid_until: null,
    ...overrides,
  };
  await pool.query(
    `INSERT INTO person_facts (id, user_id, kind_key, version, is_current, value, basis, verified_at, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      row.id,
      row.user_id,
      row.kind_key,
      row.version,
      row.is_current,
      row.value,
      row.basis,
      row.verified_at,
      row.valid_until,
    ],
  );
  return id;
}

beforeAll(async () => {
  pool = await migratedTestPool();
});

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  // Child tables first: person_facts references both users and person_fact_kinds with RESTRICT,
  // so clearing in the wrong order fails on a foreign key rather than on the assertion.
  await pool.query('DELETE FROM person_facts');
  await pool.query('DELETE FROM person_fact_kinds WHERE key LIKE $1', ['test_%']);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, ['person-facts-%@example.invalid']);

  userId = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
    userId,
    `person-facts-${userId.slice(0, 8)}@example.invalid`,
  ]);
  await insertKind();
});

describe('person_fact_kinds', () => {
  it('rejects a value_type outside the closed set', async () => {
    const violation = await expectViolation(pool, () => insertKind({ key: 'test_bad_type', value_type: 'freeform' }));
    expect(violation.constraint).toBe('ck_pfk__value_type');
  });

  it('rejects an enum with no permitted values — it could not be answered', async () => {
    const violation = await expectViolation(pool, () =>
      insertKind({ key: 'test_enum', value_type: 'enum', unit: null, allowed_values: [] }),
    );
    expect(violation.constraint).toBe('ck_pfk__enum_values');
  });

  it('rejects permitted values on a kind that is not an enum', async () => {
    // A constraint nobody enforces reads as one that is enforced, which is worse than none.
    const violation = await expectViolation(pool, () =>
      insertKind({ key: 'test_bool', value_type: 'boolean', unit: null, allowed_values: ['yes', 'no'] }),
    );
    expect(violation.constraint).toBe('ck_pfk__enum_values');
  });

  it('rejects a measured value with no unit — it is not comparable to a threshold', async () => {
    const violation = await expectViolation(pool, () =>
      insertKind({ key: 'test_no_unit', value_type: 'monetary', unit: null }),
    );
    expect(violation.constraint).toBe('ck_pfk__unit_required');
  });

  it('allows a self-describing type to omit the unit', async () => {
    await expect(
      insertKind({ key: 'test_has_offer', value_type: 'boolean', unit: null }),
    ).resolves.toBeUndefined();
  });

  it('rejects a key that is not snake_case', async () => {
    // The key must match a `requirements.needs_input` element exactly; a shape rule here is what
    // stops `expectedSalary` and `expected_salary` both existing.
    const violation = await expectViolation(pool, () => insertKind({ key: 'Expected-Salary' }));
    expect(violation.constraint).toBe('ck_pfk__key_shape');
  });
});

describe('person_facts', () => {
  it('stores an answer with its provenance', async () => {
    const id = await insertFact();
    const { rows } = await pool.query('SELECT basis, value FROM person_facts WHERE id = $1', [id]);

    expect(rows[0]?.basis).toBe('self_reported');
    expect(rows[0]?.value).toMatchObject({ amount: 60000, currency: 'EUR' });
  });

  it('refuses a fact whose kind is not in the catalogue', async () => {
    // This is the invariant the pair of tables exists for. A rule may only ask for a fact the
    // product can accept; the reverse produces a `needsFromUser` nobody can answer.
    const violation = await expectViolation(pool, () => insertFact({ kind_key: 'salary_but_misspelled' }));
    expect(violation.constraint).toBe('fk_person_facts__kinds');
  });

  it('refuses a second live answer for the same person and fact', async () => {
    // Two current rows would make the evaluator pick whichever the query returned first — the same
    // non-determinism `uq_req__current` prevents on the rule side.
    await insertFact({ version: 1 });
    const violation = await expectViolation(pool, () => insertFact({ version: 2 }));
    expect(violation.constraint).toBe('uq_person_facts__current');
  });

  it('keeps history: an older version coexists with the current one', async () => {
    await insertFact({ version: 1, is_current: false });
    await insertFact({ version: 2, is_current: true });

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM person_facts WHERE user_id = $1',
      [userId],
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('never reuses a version, even after a soft delete', async () => {
    // "The salary as it stood at v2" is what an explained verdict is built from. Reusing a number
    // makes that phrase ambiguous.
    const first = await insertFact({ version: 1, is_current: false });
    await pool.query('UPDATE person_facts SET deleted_at = now() WHERE id = $1', [first]);

    const violation = await expectViolation(pool, () => insertFact({ version: 1 }));
    expect(violation.constraint).toBe('uq_person_facts__version');
  });

  it('rejects version zero', async () => {
    const violation = await expectViolation(pool, () => insertFact({ version: 0 }));
    expect(violation.constraint).toBe('ck_person_facts__version');
  });

  it('rejects a basis outside the closed set', async () => {
    const violation = await expectViolation(pool, () => insertFact({ basis: 'assumed' }));
    expect(violation.constraint).toBe('ck_person_facts__basis');
  });

  it('refuses to call a fact verified with no verification date', async () => {
    // A claim about evidence, with no evidence.
    const violation = await expectViolation(pool, () => insertFact({ basis: 'verified', verified_at: null }));
    expect(violation.constraint).toBe('ck_person_facts__verified');
  });

  it('allows a self-reported fact that carries an old verification date', async () => {
    // The reverse is legitimate: a verified answer can be superseded by a self-reported correction,
    // and the date of the earlier verification is still a true statement about the earlier row.
    await expect(
      insertFact({ basis: 'self_reported', verified_at: new Date('2026-01-01') }),
    ).resolves.toBeTypeOf('string');
  });

  it('refuses to delete a catalogue entry that answers still reference', async () => {
    await insertFact();
    const violation = await expectViolation(pool, () => pool.query('DELETE FROM person_fact_kinds WHERE key = $1', [KIND]));
    expect(violation.constraint).toBe('fk_person_facts__kinds');
  });

  it('refuses to delete a user who still has facts — erasure is an explicit operation', async () => {
    await insertFact();
    const violation = await expectViolation(pool, () => pool.query('DELETE FROM users WHERE id = $1', [userId]));
    expect(violation.constraint).toBe('fk_person_facts__users');
  });
});

describe('the catalogue covers every fact a rule asks for', () => {
  it('has a row for every requirements.needs_input value', async () => {
    // The invariant that makes `needsFromUser` honest. A rule naming a key with no catalogue entry
    // promises a resolution the product cannot accept, and the verdict stays `undetermined`
    // forever with no action available.
    //
    // Vacuous while `requirements` is empty — nothing writes ingested rules to the database yet.
    // It is written now because it becomes load-bearing the moment ingestion lands, and adding it
    // afterwards means adding it after the first violation.
    const { rows } = await pool.query<{ missing: string }>(
      `SELECT DISTINCT unnest(needs_input) AS missing
         FROM requirements
        WHERE effective_to IS NULL
       EXCEPT
       SELECT key FROM person_fact_kinds`,
    );

    expect(rows.map((r) => r.missing)).toEqual([]);
  });
});
