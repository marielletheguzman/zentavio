import type { AnyConnector, ValidationResult } from '@zentavio/connectors-core';
import type { SourcedRequirement } from '@zentavio/types';
import { describe, expect, it } from 'vitest';

import {
  dayBefore,
  planIngest,
  summarize,
  toRow,
  type ExistingRequirement,
} from './requirement-ingest.ts';

function requirement(overrides: Partial<SourcedRequirement> = {}): SourcedRequirement {
  return {
    requirementId: 'de.eu-blue-card.salary-threshold.general',
    domain: 'immigration',
    imposedBy: 'destination',
    jurisdiction: 'DE',
    pathwayId: 'de.eu-blue-card',
    profession: null,
    kind: 'threshold',
    value: { amount: 50700, currency: 'EUR', period: 'year', basis: 'gross' },
    appliesTo: { category: 'general' },
    domainDetail: { percentOfBeitragsbemessungsgrenze: 50 },
    evaluation: 'numeric-gte',
    needsInput: ['expected_gross_annual_salary_eur'],
    sourceTier: 1,
    sourceUrl: 'https://www.bundesanzeiger.de/…',
    retrievedAt: '2026-08-04T00:00:00.000Z',
    authority: 'Bundesministerium des Innern',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    version: '2026',
    contested: false,
    refreshAfter: '2025-12-31',
    ...overrides,
  };
}

/** A connector that accepts everything, so planning is what is under test. */
function stubConnector(validate: (r: readonly SourcedRequirement[]) => ValidationResult = () => ({ issues: [] })): AnyConnector {
  return {
    meta: {
      id: 'de-bundesanzeiger',
      version: '1.0.0',
      kind: 'immigration',
      regions: ['DE'],
      rateLimit: { requests: 1, windowMs: 1000 },
      reliability: 0,
      termsUrl: 'https://example.invalid/terms',
    },
    search: async () => ({ items: [] }),
    fetch: async () => null,
    normalize: (raw) => raw,
    validate: validate as AnyConnector['validate'],
    healthCheck: async () => ({ state: 'healthy' }),
  };
}

const ids = (requirementId: string) => `id-for-${requirementId}`;

describe('dayBefore', () => {
  it('crosses a year boundary', () => {
    // A threshold effective 2027-01-01 must close its predecessor on 2026-12-31. String slicing
    // gets this wrong; UTC arithmetic does not.
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });

  it('crosses a month boundary and a leap day', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2028-03-01')).toBe('2028-02-29');
  });
});

describe('toRow', () => {
  it('maps a normalized requirement onto the repository row shape', () => {
    const row = toRow(requirement(), 'row-1');

    expect(row).toMatchObject({
      id: 'row-1',
      requirement_id: 'de.eu-blue-card.salary-threshold.general',
      domain: 'immigration',
      imposed_by: 'destination',
      jurisdiction: 'DE',
      pathway_id: 'de.eu-blue-card',
      source_tier: 1,
      version: '2026',
      effective_from: '2026-01-01',
    });
  });

  it('serialises jsonb columns, so a threshold keeps its currency and period', () => {
    const row = toRow(requirement(), 'row-1');

    expect(JSON.parse(String(row.value))).toEqual({
      amount: 50700,
      currency: 'EUR',
      period: 'year',
      basis: 'gross',
    });
  });

  it('carries needs_input through — it is what produces needsFromUser', () => {
    expect(toRow(requirement(), 'row-1').needs_input).toEqual(['expected_gross_annual_salary_eur']);
  });
});

describe('planIngest', () => {
  it('inserts when nothing is stored', () => {
    const plan = planIngest(stubConnector(), [requirement()], [], ids);

    expect(plan.decisions).toHaveLength(1);
    expect(plan.decisions[0]?.action).toBe('insert');
    expect(plan.decisions[0]?.row?.version).toBe('2026');
  });

  it('is idempotent — the same version already stored is unchanged, not a duplicate', () => {
    // Re-running an ingest must be safe. `uq_req__id_version` would reject the duplicate anyway,
    // but failing a scheduled run on a no-op is not acceptable behaviour.
    const existing: ExistingRequirement[] = [
      {
        id: 'existing-1',
        requirementId: 'de.eu-blue-card.salary-threshold.general',
        version: '2026',
        effectiveTo: null,
      },
    ];

    const plan = planIngest(stubConnector(), [requirement()], existing, ids);
    expect(plan.decisions[0]?.action).toBe('unchanged');
    expect(plan.decisions[0]?.row).toBeUndefined();
  });

  it('supersedes when a new version arrives, closing the old row rather than editing it', () => {
    // The whole point of versioning: a person planned against the old number, and "the threshold
    // you were planning against changed" only exists if the old row does.
    const existing: ExistingRequirement[] = [
      {
        id: 'existing-2026',
        requirementId: 'de.eu-blue-card.salary-threshold.general',
        version: '2026',
        effectiveTo: null,
      },
    ];
    const next = requirement({
      version: '2027',
      effectiveFrom: '2027-01-01',
      effectiveTo: '2027-12-31',
      value: { amount: 52000, currency: 'EUR', period: 'year', basis: 'gross' },
    });

    const [decision] = planIngest(stubConnector(), [next], existing, ids).decisions;

    expect(decision?.action).toBe('supersede');
    expect(decision?.supersedes).toEqual({ id: 'existing-2026', closeOn: '2026-12-31' });
    expect(decision?.row?.supersedes).toBe('existing-2026');
  });

  it('closes the old row the day before the new one starts, never on the same day', () => {
    // Closing on the new effective date leaves both live for a day, and `uq_req__current` would
    // reject the insert — correctly, because two live rows make evaluation non-deterministic.
    const existing: ExistingRequirement[] = [
      { id: 'old', requirementId: 'r', version: '1', effectiveTo: null },
    ];
    const [decision] = planIngest(
      stubConnector(),
      [requirement({ requirementId: 'r', version: '2', effectiveFrom: '2027-01-01' })],
      existing,
      ids,
    ).decisions;

    expect(decision?.supersedes?.closeOn).toBe('2026-12-31');
  });

  it('does not supersede a row that is already closed', () => {
    // A superseded row is history. Only a live row can be closed, and treating a closed one as
    // current would produce a second closure and a broken chain.
    const existing: ExistingRequirement[] = [
      { id: 'closed', requirementId: 'r', version: '1', effectiveTo: '2025-12-31' },
    ];
    const [decision] = planIngest(
      stubConnector(),
      [requirement({ requirementId: 'r', version: '2' })],
      existing,
      ids,
    ).decisions;

    expect(decision?.action).toBe('insert');
    expect(decision?.supersedes).toBeUndefined();
  });

  it('rejects what the connector rejects, and reports why', () => {
    const rejecting = stubConnector(() => ({
      issues: [
        {
          severity: 'error',
          code: 'threshold-implausible',
          message: '700 EUR/year is below any plausible Blue Card minimum',
        },
      ],
    }));

    const [decision] = planIngest(rejecting, [requirement()], [], ids).decisions;

    expect(decision?.action).toBe('reject');
    expect(decision?.row).toBeUndefined();
    expect(decision?.issues?.[0]?.code).toBe('threshold-implausible');
  });

  it('stores a record carrying only warnings', () => {
    // `no-archived-document` is a warning until ADR-0021's enforcement phase. A warning must not
    // block ingestion, or nothing would ingest at all today.
    const warning = stubConnector(() => ({
      issues: [{ severity: 'warning', code: 'no-archived-document', message: 'no archived copy' }],
    }));

    expect(planIngest(warning, [requirement()], [], ids).decisions[0]?.action).toBe('insert');
  });

  it('is pure — the same inputs produce the same plan', () => {
    const inputs = [requirement(), requirement({ requirementId: 'other' })];

    expect(planIngest(stubConnector(), inputs, [], ids)).toEqual(
      planIngest(stubConnector(), inputs, [], ids),
    );
  });

  it('names the source it planned for, without this module naming any source', () => {
    expect(planIngest(stubConnector(), [], [], ids).sourceId).toBe('de-bundesanzeiger');
  });
});

describe('summarize', () => {
  it('counts each outcome', () => {
    const existing: ExistingRequirement[] = [
      { id: 'a', requirementId: 'unchanged-one', version: '2026', effectiveTo: null },
    ];
    const plan = planIngest(
      stubConnector((rows) =>
        rows[0]?.requirementId === 'bad'
          ? { issues: [{ severity: 'error', code: 'nope', message: 'no' }] }
          : { issues: [] },
      ),
      [
        requirement({ requirementId: 'new-one' }),
        requirement({ requirementId: 'unchanged-one' }),
        requirement({ requirementId: 'bad' }),
      ],
      existing,
      ids,
    );

    // Three inputs: `new-one` inserts, `unchanged-one` is already stored at this version, `bad`
    // is rejected by the connector.
    expect(summarize(plan)).toEqual({
      sourceId: 'de-bundesanzeiger',
      inserted: 1,
      superseded: 0,
      unchanged: 1,
      rejected: 1,
    });
  });
});

describe('archival enforcement (ADR-0021)', () => {
  it('rejects every rule when the archive failed', () => {
    // Not just the ones that parsed badly — all of them. A partially evidenced ingest is harder to
    // reason about later than none at all.
    const plan = planIngest(
      stubConnector(),
      [requirement(), requirement({ requirementId: 'second' })],
      [],
      ids,
      { kind: 'failed', reason: 'storage unreachable' },
    );

    expect(plan.decisions.every((d) => d.action === 'reject')).toBe(true);
    expect(plan.decisions).toHaveLength(2);
  });

  it('says why, naming the storage reason and the ADR', () => {
    const [decision] = planIngest(stubConnector(), [requirement()], [], ids, {
      kind: 'failed',
      reason: 'connect ECONNREFUSED',
    }).decisions;

    expect(decision?.issues?.[0]?.code).toBe('no-archived-document');
    expect(decision?.issues?.[0]?.message).toContain('connect ECONNREFUSED');
    expect(decision?.issues?.[0]?.message).toContain('ADR-0021');
  });

  it('carries the document id onto every row when archiving succeeded', () => {
    const [decision] = planIngest(stubConnector(), [requirement()], [], ids, {
      kind: 'archived',
      documentId: 'doc-1',
    }).decisions;

    expect(decision?.action).toBe('insert');
    expect(decision?.row?.document_id).toBe('doc-1');
  });

  it('stores with no document when the connector declares nothing to archive', () => {
    // A deliberate connector statement, not an incident — collapsing it into "failed" would make a
    // storage outage indistinguishable from a source that never had a document.
    const [decision] = planIngest(stubConnector(), [requirement()], [], ids, {
      kind: 'none-declared',
    }).decisions;

    expect(decision?.action).toBe('insert');
    expect(decision?.row?.document_id).toBeNull();
  });

  it('a failed archive beats every other outcome, including unchanged', () => {
    // Enforcement is checked before anything else. A rule already stored is not a reason to accept
    // a payload whose evidence is missing.
    const existing: ExistingRequirement[] = [
      { id: 'e1', requirementId: requirement().requirementId, version: '2026', effectiveTo: null },
    ];
    const plan = planIngest(stubConnector(), [requirement()], existing, ids, {
      kind: 'failed',
      reason: 'nope',
    });

    expect(plan.decisions[0]?.action).toBe('reject');
  });
});
