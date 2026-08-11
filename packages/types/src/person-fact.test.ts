/**
 * The write boundary's type check, tested at the boundary rather than through it.
 *
 * The case that produced this module is `'no'` against a boolean kind. It was stored verbatim,
 * `bool('no')` is `True` in Python, and a person who had just said they held no degree was told
 * the qualification rule was **Met**. Every refusal below is a variant of that same trap.
 */

import { describe, expect, it } from 'vitest';

import { validatePersonFactValue, type PersonFactKindWire } from './person-fact.ts';

function kind(overrides: Partial<PersonFactKindWire> & { key: string }): PersonFactKindWire {
  return {
    valueType: 'string',
    unit: null,
    prompt: overrides.key,
    rationale: 'a rule asks for it',
    sensitive: false,
    allowedValues: [],
    ...overrides,
  };
}

const DEGREE = kind({ key: 'has_recognised_academic_degree', valueType: 'boolean' });
const MONTHS = kind({ key: 'employment_contract_months', valueType: 'integer', unit: 'months' });
const SALARY = kind({
  key: 'expected_gross_annual_salary_eur',
  valueType: 'monetary',
  unit: 'EUR/year',
});

describe('boolean facts are booleans, and nothing else is coerced into one', () => {
  it('accepts true and false', () => {
    expect(validatePersonFactValue(DEGREE, true)).toEqual({ ok: true });
    expect(validatePersonFactValue(DEGREE, false)).toEqual({ ok: true });
  });

  it('refuses the string that produced the defect', () => {
    // 'no' is what a free-text box gives you, and it read as `true` for as long as nothing checked.
    const check = validatePersonFactValue(DEGREE, 'no');

    expect(check.ok).toBe(false);
    expect(check.ok === false && check.message).toContain('has_recognised_academic_degree');
  });

  it('refuses every other spelling of a boolean', () => {
    // Each of these is a plausible thing a client might send, and coercing any of them would put
    // the interpretation back in the layer that got it wrong.
    for (const value of ['true', 'false', 'yes', 'No', '', 0, 1, null, [], {}]) {
      expect(validatePersonFactValue(DEGREE, value).ok).toBe(false);
    }
  });
});

describe('integer facts', () => {
  it('accepts a whole number', () => {
    expect(validatePersonFactValue(MONTHS, 12)).toEqual({ ok: true });
  });

  it('refuses a numeric string, however convincing', () => {
    // `'12'` compares as a number in some languages and as text in others. Storing it makes the
    // verdict depend on which one reads it.
    expect(validatePersonFactValue(MONTHS, '12').ok).toBe(false);
  });

  it('refuses a fraction where the catalogue says whole', () => {
    expect(validatePersonFactValue(MONTHS, 12.5).ok).toBe(false);
  });

  it('refuses NaN and Infinity, which is what a bad parse produces', () => {
    expect(validatePersonFactValue(MONTHS, Number.NaN).ok).toBe(false);
    expect(validatePersonFactValue(MONTHS, Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it('refuses a boolean, which is a number in JavaScript and not a quantity', () => {
    expect(validatePersonFactValue(MONTHS, true).ok).toBe(false);
  });
});

describe('monetary facts carry the unit the catalogue declares', () => {
  it('accepts an amount in the declared currency and period', () => {
    expect(
      validatePersonFactValue(SALARY, {
        amount: 60000,
        currency: 'EUR',
        period: 'year',
        basis: 'gross',
      }),
    ).toEqual({ ok: true });
  });

  it('refuses a bare number', () => {
    // 60 000 of an unstated currency against a EUR threshold is a confident wrong answer.
    expect(validatePersonFactValue(SALARY, 60000).ok).toBe(false);
  });

  it('refuses a different currency or period', () => {
    // The evaluator's own unit check only catches a *declared* mismatch. An undeclared one passes
    // through as if it agreed, which is why this is enforced where the unit is known.
    expect(
      validatePersonFactValue(SALARY, { amount: 60000, currency: 'USD', period: 'year' }).ok,
    ).toBe(false);
    expect(
      validatePersonFactValue(SALARY, { amount: 60000, currency: 'EUR', period: 'month' }).ok,
    ).toBe(false);
  });

  it('refuses a non-positive amount', () => {
    expect(
      validatePersonFactValue(SALARY, { amount: 0, currency: 'EUR', period: 'year' }).ok,
    ).toBe(false);
  });

  it('does not name the amount in its message', () => {
    // The message goes into an HTTP response and possibly a log. Somebody's pay does not belong
    // in either (`docs/architecture/privacy.md`).
    const check = validatePersonFactValue(SALARY, { amount: 123456, currency: 'USD', period: 'year' });

    expect(check.ok === false && check.message).not.toContain('123456');
  });
});

describe('enum facts are constrained by the catalogue, not by the client', () => {
  const level = kind({
    key: 'german_language_level',
    valueType: 'enum',
    allowedValues: ['A1', 'A2', 'B1', 'B2'],
  });

  it('accepts a permitted value', () => {
    expect(validatePersonFactValue(level, 'B2')).toEqual({ ok: true });
  });

  it('refuses one outside the set, and names the set', () => {
    const check = validatePersonFactValue(level, 'C2');

    expect(check.ok).toBe(false);
    expect(check.ok === false && check.message).toContain('A1, A2, B1, B2');
  });

  it('refuses a non-string', () => {
    expect(validatePersonFactValue(level, 2).ok).toBe(false);
  });
});

describe('string and date facts', () => {
  const isco = kind({ key: 'isco_08_group', valueType: 'string' });

  it('accepts text and refuses an empty answer', () => {
    expect(validatePersonFactValue(isco, '25')).toEqual({ ok: true });
    expect(validatePersonFactValue(isco, '   ').ok).toBe(false);
    expect(validatePersonFactValue(isco, 25).ok).toBe(false);
  });

  it('accepts a real date and refuses one that only looks like a date', () => {
    const awarded = kind({ key: 'degree_awarded_on', valueType: 'date' });

    expect(validatePersonFactValue(awarded, '2024-06-30')).toEqual({ ok: true });
    // `2026-02-31` constructs a Date in JavaScript and is not a day.
    expect(validatePersonFactValue(awarded, '2026-02-31').ok).toBe(false);
    expect(validatePersonFactValue(awarded, '30/06/2024').ok).toBe(false);
  });
});

describe('an unknown value type fails closed', () => {
  it('refuses rather than storing something nothing has checked', () => {
    // If the catalogue's CHECK constraint ever gains a type this module does not know, the new
    // type arrives unvalidated. Refusing is the safe direction — accepting is how the boolean
    // defect happened.
    const exotic = { ...kind({ key: 'x' }), valueType: 'quaternion' } as unknown as PersonFactKindWire;

    const check = validatePersonFactValue(exotic, 'anything');
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.message).toContain('quaternion');
  });
});
