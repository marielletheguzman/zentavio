/**
 * M4's coverage verification.
 *
 * The milestone is verified by *"a user sees one market marked `unknown` on salary while another is
 * complete, and the comparison is still usable — partial coverage rendered as a designed state
 * rather than a blank."* So these tests are not incidental: **they are the milestone**, and they
 * exercise all five cell states plus every compliance clause ADR-0026 and ADR-0028 wrote down.
 *
 * The property under all of them: **incomplete knowledge must never become negative evidence.**
 */

import type { EligibilityResponseWire } from '@zentavio/types';
import { describe, expect, it } from 'vitest';

import { composeComparison, type DestinationInput } from './compose.ts';

const AS_OF = '2026-08-11';
const DISCLAIMER = 'Sourced official information, not legal advice.';

function verdict(overrides: Partial<EligibilityResponseWire> = {}): EligibilityResponseWire {
  return {
    pathway_id: 'de.eu-blue-card',
    status: 'met',
    requirements: [
      {
        requirement_id: 'de.eu-blue-card.salary-threshold.general',
        domain: 'immigration',
        imposed_by: 'destination',
        result: 'met',
        authority: 'Bundesministerium des Innern',
        source_url: 'https://www.bundesanzeiger.de/x',
        effective_from: '2026-01-01',
        needs_input: [],
      },
    ],
    blockers: [],
    needs_from_user: [],
    binding_domain: null,
    confidence: 'high',
    as_of: AS_OF,
    disclaimer: DISCLAIMER,
    notes: [],
    evaluator_version: '1.0.0',
    ...overrides,
  };
}

const READY = { status: 'no_gap' as const, missingCount: 0, reason: null };
const NOT_READY = { status: 'ok' as const, missingCount: 27, reason: null };

function country(overrides: Partial<DestinationInput> & { destination: string }): DestinationInput {
  return {
    name: overrides.destination,
    class: 'country',
    pathwayId: `${overrides.destination.toLowerCase()}.pathway`,
    eligibility: verdict(),
    binding: 'none',
    bindingReason: 'Nothing stands in the way.',
    employability: READY,
    quota: null,
    ...overrides,
  };
}

/** `REMOTE` as ADR-0028 defines it: no pathway, no verdict, real readiness. */
const REMOTE: DestinationInput = {
  destination: 'REMOTE',
  name: 'Remote',
  class: 'remote',
  pathwayId: null,
  eligibility: null,
  binding: 'employability',
  bindingReason: 'You qualify; the distance is to the work itself.',
  employability: NOT_READY,
  quota: null,
  unsourced: [
    {
      dimension: 'contracting-and-tax',
      reason:
        'What you keep depends on your employer and your contract rather than on a place, so no ' +
        'authority publishes it.',
    },
  ],
};

const cellOf = (wire: ReturnType<typeof composeComparison>, destination: string, dimension: string) =>
  wire.groups
    .flatMap((group) => group.destinations)
    .find((d) => d.destination === destination)
    ?.cells.find((cell) => cell.dimension === dimension);

describe('complete coverage', () => {
  it('renders a fully evaluated destination as met on both axes', () => {
    const wire = composeComparison([country({ destination: 'DE' })], AS_OF, DISCLAIMER);

    expect(cellOf(wire, 'DE', 'eligibility')?.state).toBe('met');
    expect(cellOf(wire, 'DE', 'employability')?.state).toBe('met');
  });

  it('carries the rules behind each cell, so the comparison is explainable', () => {
    // ADR-0026: an ordering — or a cell — that cannot be explained factor by factor is not
    // shippable.
    const wire = composeComparison([country({ destination: 'DE' })], AS_OF, DISCLAIMER);

    expect(cellOf(wire, 'DE', 'eligibility')?.requirementIds).toContain(
      'de.eu-blue-card.salary-threshold.general',
    );
  });
});

describe('partial coverage — the state M4 is verified by', () => {
  it('stays usable when one destination is unmodelled and another is complete', () => {
    // The milestone's own scenario. Both destinations are present, both are readable, and neither
    // is described in terms of the other.
    const wire = composeComparison(
      [country({ destination: 'DE' }), country({ destination: 'NZ', eligibility: null, binding: 'unmodelled', bindingReason: 'Nothing ingested.' })],
      AS_OF,
      DISCLAIMER,
    );

    expect(cellOf(wire, 'DE', 'eligibility')?.state).toBe('met');
    expect(cellOf(wire, 'NZ', 'eligibility')?.state).toBe('unmodelled');
    expect(wire.groups.flatMap((g) => g.destinations)).toHaveLength(2);
  });

  it('says whose gap an unmodelled cell is', () => {
    // A missing rule for New Zealand says something about Zentavio, not about New Zealand, and the
    // cell has to attribute it correctly or the reader will attribute it to the country.
    const wire = composeComparison(
      [country({ destination: 'NZ', eligibility: null, binding: 'unmodelled', bindingReason: 'x' })],
      AS_OF,
      DISCLAIMER,
    );

    expect(cellOf(wire, 'NZ', 'eligibility')?.detail).toContain('We have not ingested');
  });
});

describe('undetermined — the Swiss shape', () => {
  it('stays undetermined and names what would move it', () => {
    // Most Swiss conditions are an authority's judgement, so `undetermined` with reasons is the
    // correct answer rather than a failure.
    const wire = composeComparison(
      [
        country({
          destination: 'CH',
          eligibility: verdict({
            status: 'undetermined',
            needs_from_user: ['has_recognised_professional_qualification'],
            notes: ['Three conditions are decided by a cantonal authority.'],
          }),
          binding: 'eligibility',
          bindingReason: 'The rules are what stand in the way right now.',
        }),
      ],
      AS_OF,
      DISCLAIMER,
    );

    const cell = cellOf(wire, 'CH', 'eligibility');
    expect(cell?.state).toBe('undetermined');
    expect(cell?.needsFromUser).toEqual(['has_recognised_professional_qualification']);
    expect(cell?.state).not.toBe('not_met');
  });

  it('is never rendered as a failure', () => {
    const wire = composeComparison(
      [country({ destination: 'CH', eligibility: verdict({ status: 'undetermined' }), binding: 'eligibility', bindingReason: 'x' })],
      AS_OF,
      DISCLAIMER,
    );

    expect(cellOf(wire, 'CH', 'eligibility')?.state).not.toBe('not_met');
    expect(cellOf(wire, 'CH', 'eligibility')?.state).not.toBe('unmodelled');
  });
});

describe('not_applicable — the REMOTE shape (ADR-0028)', () => {
  it('marks eligibility not_applicable, never unknown or unmodelled', () => {
    // The distinction the ADR exists for: `not_applicable` is about REMOTE, `unmodelled` is about
    // us. Rendering the first as the second claims we failed to source something that does not
    // exist.
    const wire = composeComparison([REMOTE], AS_OF, DISCLAIMER);
    const cell = cellOf(wire, 'REMOTE', 'eligibility');

    expect(cell?.state).toBe('not_applicable');
    expect(cell?.state).not.toBe('unmodelled');
    expect(cell?.detail).toContain('property of remote work');
  });

  it('produces not_applicable and unmodelled from different branches, with different reasons', () => {
    // They look alike in a table and mean opposite things, so a surface needs both the state and a
    // sentence to tell them apart.
    const wire = composeComparison(
      [REMOTE, country({ destination: 'NZ', eligibility: null, binding: 'unmodelled', bindingReason: 'x' })],
      AS_OF,
      DISCLAIMER,
    );

    const remote = cellOf(wire, 'REMOTE', 'eligibility');
    const nz = cellOf(wire, 'NZ', 'eligibility');

    expect(remote?.state).not.toBe(nz?.state);
    expect(remote?.detail).not.toBe(nz?.detail);
  });

  it('computes employability for REMOTE exactly as for a country', () => {
    // Readiness against a career track has no jurisdiction in it, so this cell is as real as any
    // country's — and often the only complete row on the screen.
    const wire = composeComparison([REMOTE], AS_OF, DISCLAIMER);

    expect(cellOf(wire, 'REMOTE', 'employability')?.state).toBe('not_met');
    expect(cellOf(wire, 'REMOTE', 'employability')?.detail).toContain('27');
  });

  it('says why its own dimensions are unsourced, and it is not a to-do', () => {
    // "Nobody publishes this because there is no authority" is a different sentence from "we have
    // not got to it yet", and only the second is a backlog item.
    const wire = composeComparison([REMOTE], AS_OF, DISCLAIMER);

    expect(cellOf(wire, 'REMOTE', 'contracting-and-tax')?.detail).toContain('no authority publishes it');
  });

  it('never has a pathway', () => {
    const wire = composeComparison([REMOTE], AS_OF, DISCLAIMER);
    const remote = wire.groups.flatMap((g) => g.destinations).find((d) => d.destination === 'REMOTE');

    expect(remote?.pathwayId).toBeNull();
    expect(remote?.class).toBe('remote');
  });
});

describe('grouping carries no ranking (ADR-0026)', () => {
  const five = () => [
    country({ destination: 'DE' }),
    country({ destination: 'LU', binding: 'employability', bindingReason: 'x', employability: NOT_READY }),
    country({ destination: 'CH', eligibility: verdict({ status: 'undetermined' }), binding: 'eligibility', bindingReason: 'x' }),
    country({ destination: 'NZ', eligibility: null, binding: 'unmodelled', bindingReason: 'x' }),
    REMOTE,
  ];

  it('is stable under reordering of the input', () => {
    // The compliance clause: grouping is data, not a sort key. If the input order could change the
    // output order, something in here would be ranking.
    const forwards = composeComparison(five(), AS_OF, DISCLAIMER);
    const backwards = composeComparison([...five()].reverse(), AS_OF, DISCLAIMER);

    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
  });

  it('orders within a group alphabetically and nothing else', () => {
    const wire = composeComparison(five(), AS_OF, DISCLAIMER);
    const employability = wire.groups.find((g) => g.binding === 'employability');

    expect(employability?.destinations.map((d) => d.destination)).toEqual(['LU', 'REMOTE']);
  });

  it('does not position a destination better for having more known data', () => {
    // *more known data ≠ better destination.* NZ knows nothing and DE knows everything; both are
    // in their binding-constraint group, and neither is moved for the amount we happen to have
    // ingested.
    const wire = composeComparison(five(), AS_OF, DISCLAIMER);
    const bindings = wire.groups.map((g) => g.binding);

    // The order is the fixed one, which describes what stands in the way — not coverage.
    expect(bindings).toEqual(['none', 'employability', 'eligibility', 'unmodelled']);
  });

  it('declares its own order arbitrary, on the wire', () => {
    // A reader assumes a list is ranked unless told otherwise, and telling them is cheaper than a
    // ranking we cannot justify.
    const wire = composeComparison(five(), AS_OF, DISCLAIMER);

    expect(wire.orderingNote).toContain('carries no meaning');
  });

  it('labels every group in words rather than by constraint name', () => {
    const wire = composeComparison(five(), AS_OF, DISCLAIMER);

    for (const group of wire.groups) {
      expect(group.label).not.toBe(group.binding);
      expect(group.label.length).toBeGreaterThan(10);
    }
  });

  it('omits a group nobody is in, rather than rendering it empty', () => {
    const wire = composeComparison([country({ destination: 'DE' })], AS_OF, DISCLAIMER);

    expect(wire.groups.map((g) => g.binding)).toEqual(['none']);
  });
});

describe('no score exists anywhere (ADR-0022, ADR-0026)', () => {
  it('emits no numeric ranking field, at any depth', () => {
    // The compliance clause a reviewer greps for, asserted instead. A composite would rank a
    // destination lower for having a rule we have not ingested yet.
    const wire = composeComparison(
      [country({ destination: 'DE' }), REMOTE],
      AS_OF,
      DISCLAIMER,
    );

    const serialised = JSON.stringify(wire);
    for (const forbidden of ['"score"', '"rank"', '"position"', '"weight"', '"total"']) {
      expect(serialised, `${forbidden} must not appear in a comparison`).not.toContain(forbidden);
    }
  });
});

describe('the quota is context, not a cell (ADR-0027)', () => {
  it('sits beside the cells and has no state', () => {
    // No state is true of a capacity limit, so giving it a cell would force the surface to invent
    // one.
    const wire = composeComparison(
      [
        country({
          destination: 'CH',
          quota: {
            allocatedBy: 'VZAE Anhang 1 und 2',
            period: 'calendar year',
            places: null,
            unsourcedReason: 'The annex is published where we cannot read it.',
          },
        }),
      ],
      AS_OF,
      DISCLAIMER,
    );

    const ch = wire.groups.flatMap((g) => g.destinations).find((d) => d.destination === 'CH');
    expect(ch?.quota?.places).toBeNull();
    expect(ch?.quota?.unsourcedReason).toContain('cannot read');
    expect(ch?.cells.map((c) => c.dimension)).not.toContain('quota');
  });
});

describe('one date for the whole comparison', () => {
  it('carries the asOf and the disclaimer verbatim', () => {
    // A comparison whose destinations were evaluated on different dates compares nothing.
    const wire = composeComparison([country({ destination: 'DE' })], AS_OF, DISCLAIMER);

    expect(wire.asOf).toBe(AS_OF);
    expect(wire.disclaimer).toBe(DISCLAIMER);
  });
});
