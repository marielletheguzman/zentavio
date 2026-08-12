/**
 * The view layer's half of M4's verification.
 *
 * `compose.test.ts` proves the *data* keeps the five states apart. This proves the **screen** does
 * — which is where they collapse in practice, because two states that render as an empty cell with
 * a grey border have been merged no matter what the wire said.
 *
 * ADR-0028 asks for exactly this: *"`not_applicable` and `unknown` render differently, asserted in
 * the view layer"*.
 */

import type { ComparisonWire, DestinationComparison } from '@zentavio/types';
import { describe, expect, it } from 'vitest';

import { toComparisonView, toNoEmployabilityView, toQuotaView } from './comparison-view.ts';

const AS_OF = '2026-08-11';

function destination(
  overrides: Partial<DestinationComparison> & { destination: string },
): DestinationComparison {
  return {
    name: overrides.destination,
    class: 'country',
    pathwayId: 'x.pathway',
    binding: 'none',
    bindingReason: 'Nothing stands in the way.',
    cells: [],
    quota: null,
    ...overrides,
  };
}

function wire(destinations: readonly DestinationComparison[]): ComparisonWire {
  return {
    groups: [{ binding: 'none', label: 'Nothing stands in the way', destinations }],
    asOf: AS_OF,
    disclaimer: 'Sourced official information, not legal advice.',
    orderingNote: 'Destinations within a group are listed alphabetically. That order carries no meaning.',
  };
}

function firstCell(view: ReturnType<typeof toComparisonView>) {
  if (view.kind !== 'comparison') throw new Error('expected a comparison');
  const cell = view.groups[0]?.destinations[0]?.cells[0];
  if (cell === undefined) throw new Error('expected a cell');
  return cell;
}

describe('cell states', () => {
  /**
   * The one assertion this file exists for. Same shape of cell, two states, and **every** rendered
   * field differs — label, attribution, and the sentence.
   */
  it('renders unmodelled and not_applicable as different statements about different subjects', () => {
    const ours = firstCell(
      toComparisonView(
        wire([
          destination({
            destination: 'NZ',
            cells: [
              {
                dimension: 'eligibility',
                state: 'unmodelled',
                detail: 'We have not ingested any rule for this destination yet.',
                requirementIds: [],
                needsFromUser: [],
              },
            ],
          }),
        ]),
      ),
    );

    const theirs = firstCell(
      toComparisonView(
        wire([
          destination({
            destination: 'REMOTE',
            class: 'remote',
            pathwayId: null,
            cells: [
              {
                dimension: 'eligibility',
                state: 'not_applicable',
                detail: 'Remote work has no immigration pathway.',
                requirementIds: [],
                needsFromUser: [],
              },
            ],
          }),
        ]),
      ),
    );

    expect(ours.label).not.toBe(theirs.label);
    expect(ours.detail).not.toBe(theirs.detail);

    // The part that matters most: they are statements about different subjects, and the view says
    // so in a field rather than leaving a reader to infer it from a border colour.
    expect(ours.attribution).toBe('Zentavio');
    expect(theirs.attribution).toBe('the destination');
  });

  it('says whose gap an unmodelled cell is, in words', () => {
    const cell = firstCell(
      toComparisonView(
        wire([
          destination({
            destination: 'NZ',
            cells: [
              { dimension: 'eligibility', state: 'unmodelled', detail: null, requirementIds: [], needsFromUser: [] },
            ],
          }),
        ]),
      ),
    );

    expect(cell.label).toBe('We have not sourced this');
    // Not "unknown" — a reader hears "unknowable", which is a claim about the world.
    expect(cell.label.toLowerCase()).not.toContain('unknown');
  });

  it('never renders undetermined as a refusal', () => {
    const cell = firstCell(
      toComparisonView(
        wire([
          destination({
            destination: 'CH',
            cells: [
              {
                dimension: 'eligibility',
                state: 'undetermined',
                detail: 'Three conditions are an authority’s judgement.',
                requirementIds: ['ch.wider-economic-interest'],
                needsFromUser: ['salary_gross_annual'],
              },
            ],
          }),
        ]),
      ),
    );

    expect(cell.label).toBe('Not answered yet');
    for (const word of ['not met', 'failed', 'no', 'rejected']) {
      expect(cell.label.toLowerCase()).not.toBe(word);
    }
    expect(cell.questions).toEqual(['salary_gross_annual']);
  });

  it('words REMOTE’s inapplicable cell as being about remote work, not about a missing source', () => {
    const cell = firstCell(
      toComparisonView(
        wire([
          destination({
            destination: 'REMOTE',
            class: 'remote',
            pathwayId: null,
            cells: [
              { dimension: 'eligibility', state: 'not_applicable', detail: null, requirementIds: [], needsFromUser: [] },
            ],
          }),
        ]),
      ),
    );

    expect(cell.label).toBe('Does not apply to remote work');
  });

  it('renders a dimension it has no name for as its key rather than inventing one', () => {
    const cell = firstCell(
      toComparisonView(
        wire([
          destination({
            destination: 'DE',
            cells: [
              { dimension: 'cost-of-living', state: 'unmodelled', detail: null, requirementIds: [], needsFromUser: [] },
            ],
          }),
        ]),
      ),
    );

    expect(cell.heading).toBe('cost-of-living');
  });
});

describe('quota (ADR-0027)', () => {
  it('renders a capped-and-unsourced quota as capped, never as open', () => {
    const view = toQuotaView({
      allocatedBy: 'VZAE Anhang 1 und 2',
      period: 'calendar year',
      places: null,
      unsourcedReason: 'fedlex.admin.ch disallows /filestore/*',
    });

    expect(view?.headline).toContain('capped');
    expect(view?.places).not.toContain('no cap');
    expect(view?.places).not.toContain('0');
    expect(view?.unsourcedReason).toContain('fedlex');
  });

  it('renders a sourced cap as its number', () => {
    expect(toQuotaView({ allocatedBy: 'x', period: 'y', places: 8500, unsourcedReason: null })?.places).toBe(
      '8,500 places',
    );
  });

  it('says nothing at all where no quota is recorded', () => {
    // Deliberately not "no cap": an empty column is weaker than a sourced statement that the
    // pathway is uncapped, and the screen must not upgrade one into the other.
    expect(toQuotaView(null)).toBeNull();
  });
});

describe('no ranking survives into the view (ADR-0026)', () => {
  it('adds no score, rank or position field', () => {
    const view = toComparisonView(
      wire([destination({ destination: 'DE' }), destination({ destination: 'REMOTE', class: 'remote' })]),
    );

    const serialised = JSON.stringify(view);
    for (const forbidden of ['score', 'rank', 'position', 'weight', 'total', 'best']) {
      expect(serialised.toLowerCase()).not.toContain(`"${forbidden}"`);
    }
  });

  it('keeps the order the wire supplied, without re-sorting', () => {
    const view = toComparisonView(
      wire([
        destination({ destination: 'NZ' }),
        destination({ destination: 'CH' }),
        destination({ destination: 'DE' }),
      ]),
    );

    if (view.kind !== 'comparison') throw new Error('expected a comparison');
    expect(view.groups[0]?.destinations.map((d) => d.destination)).toEqual(['NZ', 'CH', 'DE']);
  });

  it('carries the ordering note verbatim rather than paraphrasing it', () => {
    const source = wire([destination({ destination: 'DE' })]);
    const view = toComparisonView(source);

    if (view.kind !== 'comparison') throw new Error('expected a comparison');
    expect(view.orderingNote).toBe(source.orderingNote);
  });

  it('marks REMOTE as a different class rather than as a country with gaps', () => {
    const view = toComparisonView(
      wire([destination({ destination: 'REMOTE', class: 'remote', pathwayId: null })]),
    );

    if (view.kind !== 'comparison') throw new Error('expected a comparison');
    expect(view.groups[0]?.destinations[0]?.isRemote).toBe(true);
  });
});

describe('no readiness to compare on', () => {
  it('distinguishes no track from no profile', () => {
    const noTarget = toNoEmployabilityView('no-target');
    const noProfile = toNoEmployabilityView('no-profile');

    if (noTarget.kind !== 'no-employability' || noProfile.kind !== 'no-employability') {
      throw new Error('expected both to be answers rather than errors');
    }

    expect(noTarget.headline).not.toBe(noProfile.headline);
    expect(noTarget.explanation).toContain('track');
    expect(noProfile.explanation).toContain('profile');
  });
});
