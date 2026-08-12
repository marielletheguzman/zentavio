/**
 * Turning what the database and the evaluator hold into the comparison's inputs.
 *
 * Pure, and separate from the service that does the I/O, so the two decisions worth arguing about
 * can be tested without a database: **what a stored quota means** (ADR-0027) and **what `REMOTE` is**
 * (ADR-0028).
 *
 * Nothing here evaluates a rule. A country's binding constraint arrives already computed by
 * `ai/career-roadmap`; this module never derives one for a country, because that reasoning lives in
 * one place and the gateway is not it.
 */

import type { ComparisonQuota } from '@zentavio/types';
import type { PathwayRow } from '@zentavio/db';

import type { DestinationInput, EmployabilityInput } from './compose.ts';

/** `REMOTE` is a destination code, not a jurisdiction. No ISO country will ever collide with it. */
export const REMOTE = 'REMOTE';

/**
 * The dimensions `REMOTE` has and nobody can source (ADR-0028).
 *
 * Named rather than populated, and each carries **why it is empty**: these are properties of an
 * employer and a contract, not of a place. There is no Remote Ministry of Labour to publish them,
 * so this is a category difference rather than a sourcing backlog — a different sentence from "not
 * ingested yet", and the surface repeats whichever one applies.
 */
const REMOTE_DIMENSIONS: readonly { readonly dimension: string; readonly reason: string }[] = [
  {
    dimension: 'employer-policy',
    reason:
      'Whether a role may be worked remotely is set by the employer, not by any authority. There ' +
      'is no source to ingest — it is answered per employer, per role.',
  },
  {
    dimension: 'time-zone-overlap',
    reason:
      'Overlap is a property of a specific team’s hours against yours, so it has no value at the ' +
      'level of a destination.',
  },
  {
    dimension: 'contracting-and-tax',
    reason:
      'How you are engaged and taxed depends on the contract and both countries’ treatment of it. ' +
      'Zentavio has not sourced this, and it is sequenced in the backlog rather than guessed.',
  },
  {
    dimension: 'payment-mechanics',
    reason:
      'How you are actually paid — and what it costs to receive it — is a property of the employer ' +
      'and the payment route, not of remote work as such.',
  },
];

/**
 * What binds for `REMOTE`.
 *
 * **Computed here rather than by the evaluator, deliberately.** ADR-0028 says implementing `REMOTE`
 * must require no evaluator change; sending it through an evaluation with no requirements would
 * return `unmodelled`, which asserts that rules exist and we failed to ingest them — the exact false
 * statement the ADR exists to prevent.
 *
 * It draws from a **subset** of ADR-0022's closed set: only `employability` and `none` can bind,
 * because there are no rules to fail and none missing. No new member is added for it.
 */
export function remoteBinding(employability: EmployabilityInput): {
  readonly binding: DestinationInput['binding'];
  readonly reason: string;
} {
  if (employability.status === 'unknown') {
    // Not `unmodelled` as a *destination* claim — what is unmodelled is the person's readiness,
    // which is equally unmodelled for every country on the same screen.
    return {
      binding: 'unmodelled',
      reason:
        employability.reason ??
        'Readiness could not be computed, so nothing can be said about what stands in the way.',
    };
  }

  if (employability.status === 'no_gap') {
    return {
      binding: 'none',
      reason:
        'Remote work has no immigration rules to satisfy, and nothing on your track is missing.',
    };
  }

  return {
    binding: 'employability',
    reason:
      `Remote work has no immigration rules to satisfy. What stands in the way is the ` +
      `${String(employability.missingCount)} requirement(s) still missing from your profile.`,
  };
}

/**
 * `REMOTE` as a destination.
 *
 * One destination, not a class of them — sub-dividing it needs employer-level data (ADR-0028). It
 * has no pathway, so `pathwayId` is `null` and no evaluation is attempted.
 */
export function remoteDestination(employability: EmployabilityInput): DestinationInput {
  const { binding, reason } = remoteBinding(employability);

  return {
    destination: REMOTE,
    name: 'Remote work',
    class: 'remote',
    pathwayId: null,
    eligibility: null,
    binding,
    bindingReason: reason,
    employability,
    quota: null,
    unsourced: REMOTE_DIMENSIONS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The stored quota, or `null` where the pathway has no cap.
 *
 * The two nulls are different and must stay so (ADR-0027): a **null column** means uncapped, and a
 * present object with **`places: null`** means capped by a figure we could not read. Collapsing them
 * would tell somebody a capped pathway is open.
 *
 * A malformed value returns `null` — but only after the fields have failed to appear, and this is
 * seeded tier-1 data rather than anything a user supplies.
 */
export function toQuota(stored: unknown): ComparisonQuota | null {
  if (!isRecord(stored)) return null;

  const allocatedBy = stored['allocated_by'];
  const period = stored['period'];
  if (typeof allocatedBy !== 'string' || typeof period !== 'string') return null;

  const places = stored['places'];
  const unsourcedReason = stored['unsourced_reason'];

  return {
    allocatedBy,
    period,
    places: typeof places === 'number' ? places : null,
    unsourcedReason: typeof unsourcedReason === 'string' ? unsourcedReason : null,
  };
}

/**
 * A country's destination code.
 *
 * The jurisdiction as stored, which is the ISO code the pathway was seeded with. Not derived from
 * the pathway id, whose prefix is a naming convention rather than a guarantee.
 */
export function destinationCode(pathway: PathwayRow): string {
  return pathway.jurisdiction.toUpperCase();
}
