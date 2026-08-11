/**
 * What a person's answer is allowed to be, and the one place that decides.
 *
 * ## Why this exists
 *
 * A browser check on 2026-08-11 found the failure this module is written to make impossible.
 * Answering **"no"** to *"do you hold a recognised degree?"* rendered **"Met — qualification"**.
 * The string `'no'` was stored verbatim as a boolean fact and the evaluator's `bool(value)` read
 * every non-empty string as `True`, so a person who said they had no degree was told the rule was
 * satisfied. That is a false positive about somebody's relocation, produced by four layers each
 * assuming another one had checked.
 *
 * So: **a person fact is typed at the write boundary.** By the time a value reaches the evaluator
 * it already satisfies its catalogue kind, and nothing downstream interprets a presentation string
 * as a domain value. There is no coercion here — `'true'`, `'yes'`, and `1` are **not** booleans,
 * and refusing them is the point rather than an inconvenience.
 *
 * The catalogue (`person_fact_kinds`) is authoritative. This module reads it; it never restates it.
 */

/** The `value_type` column's closed set, mirroring `ck_pfk__value_type`. */
export type PersonFactValueType =
  | 'monetary'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'string'
  | 'enum'
  | 'date';

/**
 * One catalogue entry as the gateway serves it.
 *
 * Everything a surface needs to ask the question and shape the answer — which is exactly why the
 * frontend must not carry its own copy. A hardcoded prompt or unit in a component is a second
 * source of truth that drifts the moment a rule is added, and the drift is silent.
 */
export interface PersonFactKindWire {
  readonly key: string;
  readonly valueType: PersonFactValueType;
  /** `'EUR/year'`, `'months'`, `'years'`. Null where the type is self-describing. */
  readonly unit: string | null;
  /** The question, in the person's words. A surface renders this, never the key. */
  readonly prompt: string;
  /** Why we are asking. Shown alongside, because asking without saying why reads as collection. */
  readonly rationale: string;
  /** Drives retention and logging treatment (`docs/architecture/privacy.md`). */
  readonly sensitive: boolean;
  /** Permitted values for `enum`, empty otherwise. */
  readonly allowedValues: readonly string[];
}

export type PersonFactValueCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

// A monetary answer is a `MonetaryValue` (`requirement.ts`) — the same shape a monetary threshold
// is stored in, which is what makes the two comparable without a conversion nobody wrote down.
// Checked structurally below rather than re-declared here.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Finite and a real number. `NaN` and `Infinity` are what a bad parse produces, not a quantity. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** `YYYY-MM-DD`, and a real day — `2026-02-31` parses in JS and is not one. */
function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/**
 * Whether a value satisfies its catalogue kind.
 *
 * **Fails closed.** An unrecognised `valueType` is refused rather than waved through: a kind this
 * does not know how to check is a kind nothing has validated, and storing it would put the product
 * back where the degree question was.
 *
 * Messages name the value's actual type. "Invalid value" gives whoever is debugging a client
 * nothing, and this endpoint is reachable from a browser console.
 */
export function validatePersonFactValue(
  kind: Pick<PersonFactKindWire, 'key' | 'valueType' | 'unit' | 'allowedValues'>,
  value: unknown,
): PersonFactValueCheck {
  switch (kind.valueType) {
    case 'boolean':
      // No coercion, deliberately. `'no'` is what a text input produces and is exactly the value
      // that read as `true` downstream; `'false'` and `0` are the same trap wearing other clothes.
      return typeof value === 'boolean'
        ? { ok: true }
        : {
            ok: false,
            message:
              `${kind.key} is a boolean and must be sent as true or false, not ` +
              `${describe(value)}. A string is never coerced: 'no' would read as true.`,
          };

    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return {
          ok: false,
          message: `${kind.key} is a whole number of ${kind.unit ?? 'units'}, not ${describe(value)}.`,
        };
      }
      return { ok: true };

    case 'decimal':
      return isFiniteNumber(value)
        ? { ok: true }
        : {
            ok: false,
            message: `${kind.key} is a number of ${kind.unit ?? 'units'}, not ${describe(value)}.`,
          };

    case 'monetary':
      return validateMonetary(kind, value);

    case 'string':
      // Non-empty: an empty answer is not an answer, and storing one makes an `undetermined`
      // verdict look resolved.
      return typeof value === 'string' && value.trim() !== ''
        ? { ok: true }
        : { ok: false, message: `${kind.key} is text and must not be empty (got ${describe(value)}).` };

    case 'enum':
      if (typeof value !== 'string') {
        return { ok: false, message: `${kind.key} is one of a fixed set, not ${describe(value)}.` };
      }
      // The UI constrains the choice; this is what makes the constraint true. A client is
      // convenience, never enforcement.
      return kind.allowedValues.includes(value)
        ? { ok: true }
        : {
            ok: false,
            message: `'${value}' is not a permitted value for ${kind.key}: ${kind.allowedValues.join(', ')}.`,
          };

    case 'date':
      return isIsoDate(value)
        ? { ok: true }
        : { ok: false, message: `${kind.key} is a date as YYYY-MM-DD, not ${describe(value)}.` };

    default:
      // Unreachable while the catalogue's CHECK constraint and this union agree — and if they ever
      // stop agreeing, the new type arrives unvalidated, which is the failure this module exists
      // to prevent. Refusing is the safe direction.
      return {
        ok: false,
        message:
          `${kind.key} has value type '${String(kind.valueType)}', which nothing knows how to ` +
          'validate. Refused rather than stored unchecked.',
      };
  }
}

/**
 * A monetary answer must carry its currency and period, and they must be the ones the catalogue
 * declares.
 *
 * 60 000 of an unstated currency against a EUR threshold is a confident wrong answer, and the
 * evaluator's own `_units_match` only refuses a *declared* mismatch — an undeclared one passes
 * straight through as if it agreed. So the unit is enforced here, where it is known.
 */
function validateMonetary(
  kind: Pick<PersonFactKindWire, 'key' | 'unit'>,
  value: unknown,
): PersonFactValueCheck {
  if (!isRecord(value)) {
    return {
      ok: false,
      message: `${kind.key} is an amount with its currency and period, not ${describe(value)}.`,
    };
  }

  if (!isFiniteNumber(value['amount']) || value['amount'] <= 0) {
    return { ok: false, message: `${kind.key} needs a positive numeric amount.` };
  }

  const [currency, period] = (kind.unit ?? '/').split('/');
  if (typeof value['currency'] !== 'string' || typeof value['period'] !== 'string') {
    return { ok: false, message: `${kind.key} must state its currency and period.` };
  }

  if (value['currency'] !== currency || value['period'] !== period) {
    return {
      ok: false,
      message:
        `${kind.key} is recorded in ${String(currency)}/${String(period)}; ` +
        `${value['currency']}/${value['period']} would be compared against a threshold it does not match.`,
    };
  }

  return { ok: true };
}

/** The value's shape, for a message. Never the value itself — it may be somebody's salary. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return 'a string';
  return `a ${typeof value}`;
}
