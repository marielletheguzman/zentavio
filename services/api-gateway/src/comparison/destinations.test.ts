/**
 * The two decisions that turn stored data into a destination, and both are ADR compliance clauses.
 *
 * A quota's two nulls mean opposite things (ADR-0027), and `REMOTE` must never acquire a pathway or
 * an immigration verdict (ADR-0028). Both are cheap to break by accident and expensive to notice.
 */

import type { PathwayRow } from '@zentavio/db';
import { describe, expect, it } from 'vitest';

import { REMOTE, destinationCode, remoteBinding, remoteDestination, toQuota } from './destinations.ts';
import type { EmployabilityInput } from './compose.ts';

const READY: EmployabilityInput = { status: 'no_gap', missingCount: 0, reason: null };
const NOT_READY: EmployabilityInput = { status: 'ok', missingCount: 12, reason: null };
const NO_READINESS: EmployabilityInput = {
  status: 'unknown',
  missingCount: 0,
  reason: 'Nobody has modelled this track.',
};

function pathway(overrides: Partial<PathwayRow> = {}): PathwayRow {
  return {
    pathway_id: 'ch.third-country-worker',
    jurisdiction: 'CH',
    name: 'Aufenthalt mit Erwerbstätigkeit',
    description: null,
    quota: null,
    is_active: true,
    ...overrides,
  };
}

describe('toQuota', () => {
  it('reads an uncapped pathway as having no quota', () => {
    expect(toQuota(null)).toBeNull();
  });

  it('keeps a sourced cap as the number it is', () => {
    const quota = toQuota({
      allocated_by: 'VZAE Anhang 1',
      period: 'calendar year',
      places: 8500,
      unsourced_reason: null,
    });

    expect(quota?.places).toBe(8500);
    expect(quota?.unsourcedReason).toBeNull();
  });

  /**
   * The distinction ADR-0027 exists for: **capped-and-unsourced is not uncapped**, and the two
   * arrive as the same JSON `null` in different positions.
   */
  it('keeps capped-and-unsourced distinguishable from uncapped, and carries why', () => {
    const capped = toQuota({
      allocated_by: 'VZAE Anhang 1 und 2',
      period: 'calendar year',
      places: null,
      unsourced_reason: 'robots.txt disallows the annex',
    });

    expect(capped).not.toBeNull();
    expect(capped?.places).toBeNull();
    expect(capped?.unsourcedReason).toBe('robots.txt disallows the annex');

    // Uncapped produces no object at all, so no surface can confuse the two.
    expect(toQuota(null)).toBeNull();
  });

  it('refuses a value missing the fields that make a quota meaningful', () => {
    expect(toQuota({ places: 8500 })).toBeNull();
    expect(toQuota('a cap exists')).toBeNull();
    expect(toQuota([])).toBeNull();
  });
});

describe('destinationCode', () => {
  it('uses the stored jurisdiction rather than the pathway id prefix', () => {
    expect(destinationCode(pathway({ jurisdiction: 'ch', pathway_id: 'weird.id' }))).toBe('CH');
  });
});

describe('remoteBinding', () => {
  it('binds on employability when the profile has gaps, and never on eligibility', () => {
    const { binding, reason } = remoteBinding(NOT_READY);

    expect(binding).toBe('employability');
    expect(reason).toContain('12');
  });

  it('binds on nothing when there is no gap', () => {
    expect(remoteBinding(READY).binding).toBe('none');
  });

  /**
   * ADR-0028's subset: `eligibility` can never bind for `REMOTE`, because there are no rules to
   * fail. Asserted across every readiness state rather than only the interesting one.
   */
  it('never reports eligibility or recognition as what binds', () => {
    for (const employability of [READY, NOT_READY, NO_READINESS]) {
      expect(['employability', 'none', 'unmodelled']).toContain(
        remoteBinding(employability).binding,
      );
    }
  });
});

describe('remoteDestination', () => {
  it('has no pathway and no eligibility verdict, and never gains one', () => {
    const remote = remoteDestination(READY);

    expect(remote.destination).toBe(REMOTE);
    expect(remote.class).toBe('remote');
    expect(remote.pathwayId).toBeNull();
    expect(remote.eligibility).toBeNull();
  });

  it('carries no quota — remote work has no cap to be allocated', () => {
    expect(remoteDestination(READY).quota).toBeNull();
  });

  /**
   * Named, not populated (ADR-0028). Each dimension states **why** it is empty, and the reason is
   * about employers rather than about our backlog — which is the sentence a surface repeats.
   */
  it('names its own dimensions with a reason, and populates none of them', () => {
    const unsourced = remoteDestination(READY).unsourced ?? [];

    expect(unsourced.map((d) => d.dimension)).toEqual([
      'employer-policy',
      'time-zone-overlap',
      'contracting-and-tax',
      'payment-mechanics',
    ]);

    for (const dimension of unsourced) {
      expect(dimension.reason.length).toBeGreaterThan(20);
    }

    // Two of the four are properties of an employer or a contract rather than gaps in our coverage.
    expect(unsourced[0]?.reason).toContain('employer');
  });

  it('shares the same employability input every country gets', () => {
    expect(remoteDestination(NOT_READY).employability).toBe(NOT_READY);
  });
});
