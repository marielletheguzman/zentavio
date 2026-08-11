/**
 * The catalogue is the contract, so it is checked as one.
 *
 * Two things have to hold across every entry, and neither is enforceable by a database constraint:
 * that the write boundary knows how to validate the type (a kind nothing can validate is a kind
 * stored unchecked), and that a surface can actually render the question. Both were false in
 * practice until 2026-08-11 — the catalogue held six kinds and the eligibility panel knew about
 * one, so five questions rendered as raw keys in free-text boxes and a boolean came back `'no'`.
 */

import { PERSON_FACT_KINDS } from '../../../packages/db/src/person-fact-kinds.ts';
import { validatePersonFactValue, type PersonFactKindWire } from '../../../packages/types/src/person-fact.ts';
import { describe, expect, it } from 'vitest';

/** The seed shape as the gateway serves it. Same fields, same names — this is the mapping. */
function asWire(seed: (typeof PERSON_FACT_KINDS)[number]): PersonFactKindWire {
  return {
    key: seed.key,
    valueType: seed.valueType,
    unit: seed.unit,
    prompt: seed.prompt,
    rationale: seed.rationale,
    sensitive: seed.sensitive,
    allowedValues: seed.allowedValues,
  };
}

/** One value that must be accepted, and one that must not, per type. */
const SAMPLES: Readonly<Record<string, { readonly valid: unknown; readonly invalid: unknown }>> = {
  boolean: { valid: false, invalid: 'no' },
  integer: { valid: 3, invalid: '3' },
  decimal: { valid: 3.5, invalid: '3.5' },
  string: { valid: 'x', invalid: 5 },
  date: { valid: '2026-01-01', invalid: '01/01/2026' },
  monetary: { valid: null, invalid: 60000 },
  enum: { valid: null, invalid: 5 },
};

describe('every catalogue kind is one the write boundary can validate', () => {
  it.each(PERSON_FACT_KINDS.map((seed) => [seed.key, seed] as const))(
    '%s accepts a correctly typed answer and refuses a presentation string',
    (_key, seed) => {
      const wire = asWire(seed);
      const sample = SAMPLES[seed.valueType];

      expect(sample, `no sample defined for value type '${seed.valueType}'`).toBeDefined();
      if (sample === undefined) return;

      // Monetary and enum need the kind's own unit or permitted values to build a valid case, so
      // they are constructed here rather than listed above.
      const valid =
        seed.valueType === 'monetary'
          ? (() => {
              const [currency, period] = (seed.unit ?? '/').split('/');
              return { amount: 1, currency, period, basis: 'gross' };
            })()
          : seed.valueType === 'enum'
            ? seed.allowedValues[0]
            : sample.valid;

      expect(validatePersonFactValue(wire, valid).ok).toBe(true);
      expect(validatePersonFactValue(wire, sample.invalid).ok).toBe(false);
    },
  );

  it('refuses a string for every kind that is not textual', () => {
    // The single failure mode this whole slice exists to close: a free-text box's output reaching
    // the domain. `enum` is excluded because its values genuinely are strings — constrained ones.
    for (const seed of PERSON_FACT_KINDS) {
      if (seed.valueType === 'string' || seed.valueType === 'enum' || seed.valueType === 'date') {
        continue;
      }

      expect(
        validatePersonFactValue(asWire(seed), 'no'),
        `${seed.key} accepted the string 'no'`,
      ).toMatchObject({ ok: false });
    }
  });
});

describe('every catalogue kind can be asked and answered', () => {
  it('asks a question rather than naming a column', () => {
    for (const seed of PERSON_FACT_KINDS) {
      expect(seed.prompt, seed.key).not.toBe(seed.key);
      expect(seed.prompt.length, seed.key).toBeGreaterThan(10);
    }
  });

  it('says why it is asking', () => {
    // A product that asks for a salary without naming the rule that needs it reads as collection.
    for (const seed of PERSON_FACT_KINDS) {
      expect(seed.rationale.length, seed.key).toBeGreaterThan(20);
    }
  });

  it('carries a unit wherever the answer is a measured quantity', () => {
    // `6` against a threshold of `6` is not an answer until both say what they are counting.
    for (const seed of PERSON_FACT_KINDS) {
      if (!['monetary', 'integer', 'decimal'].includes(seed.valueType)) continue;
      expect(seed.unit, seed.key).not.toBeNull();
    }
  });

  it('gives an enum its permitted values and nothing else them', () => {
    for (const seed of PERSON_FACT_KINDS) {
      if (seed.valueType === 'enum') {
        expect(seed.allowedValues.length, seed.key).toBeGreaterThan(0);
      } else {
        expect(seed.allowedValues, seed.key).toEqual([]);
      }
    }
  });
});
