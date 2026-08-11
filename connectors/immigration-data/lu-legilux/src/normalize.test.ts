import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isIngestible } from '@zentavio/connectors-core';
import { describe, expect, it } from 'vitest';

import { LegiluxConnector, type LegiluxRaw } from './index.ts';
import {
  computeThreshold,
  parseAverageSalary,
  parseGeneralMultiplier,
  parseReducedGroups,
  parseReducedMultiplier,
  toPlainText,
} from './parse.ts';

/** Both instruments as served, captured verbatim including their consolidation markup. */
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../tests/fixtures/connectors/lu-legilux/rgd-26-09-2008.json', import.meta.url)),
    'utf8',
  ),
) as LegiluxRaw;

function connector() {
  return new LegiluxConnector({ fetchInstruments: async () => FIXTURE });
}

describe('the consolidation markup this connector has to survive', () => {
  it('removes the amendment markers Legilux injects mid-phrase', () => {
    // A consolidated act carries its amending act's boundaries inline, so "une fois et demie"
    // arrives as `une fois 1 > et demie 1 <`. Anchored on the intact phrase, nothing fires.
    expect(FIXTURE.formulaHtml).toContain('&gt;');

    const text = toPlainText(FIXTURE.formulaHtml);
    expect(text).toContain('une fois et demie le salaire annuel brut moyen');
  });
});

describe('the multipliers, which are the rule', () => {
  it('reads the general multiplier though it is written in words', () => {
    expect(parseGeneralMultiplier(toPlainText(FIXTURE.formulaHtml))).toBe(1.5);
  });

  it('does not read the amendment marker as the multiplier', () => {
    // The marker immediately after "une fois" is a digit `1`. Read as the multiplier it produces a
    // threshold two thirds of the real one — a plausible wrong answer, not an error.
    expect(parseGeneralMultiplier(toPlainText(FIXTURE.formulaHtml))).not.toBe(1);
  });

  it('reads the derogation multiplier, anchored on the derogation', () => {
    expect(parseReducedMultiplier(toPlainText(FIXTURE.formulaHtml))).toBe(1.2);
  });

  it('returns null for a multiplier phrase it does not know, rather than guessing', () => {
    expect(
      parseGeneralMultiplier('un seuil salarial égal à trois fois et quart le salaire annuel brut moyen'),
    ).toBeNull();
  });

  it('accepts digits too, in case an amendment writes them', () => {
    expect(parseGeneralMultiplier('seuil salarial égal à 1,7 fois le salaire annuel brut moyen')).toBe(1.7);
  });
});

describe('the occupation groups the derogation opens', () => {
  it('reads the CITP groups the instrument names', () => {
    expect(parseReducedGroups(toPlainText(FIXTURE.formulaHtml))).toEqual(['1', '2']);
  });

  it('takes only the group codes, never the prose beneath them', () => {
    // The instrument enumerates occupations under each group. Turning that prose into an
    // occupation list would be this connector inventing a rule nobody wrote.
    const groups = parseReducedGroups(toPlainText(FIXTURE.formulaHtml));
    expect(groups).toHaveLength(2);
  });
});

describe('the average salary, and the separator that fails quietly', () => {
  it('reads a five-figure amount written with a dot as the thousands separator', () => {
    const parsed = parseAverageSalary(toPlainText(FIXTURE.operand.html));

    expect(parsed?.amount).toBeGreaterThan(20_000);
    expect(parsed?.year).toBe(2024);
  });

  it('does not read the thousands dot as a decimal point', () => {
    // `Number('65.652')` is sixty-five. Both parse; only one is a salary, and the wrong one makes
    // a threshold almost anybody clears. Same failure shape as the German €700 defect.
    const parsed = parseAverageSalary('le salaire annuel brut moyen est de 65.652 euros pour l’année 2024');

    expect(parsed?.amount).toBe(65652);
    expect(parsed?.amount).not.toBe(65.652);
  });

  it('keeps a real decimal comma', () => {
    const parsed = parseAverageSalary('le salaire annuel brut moyen est de 65.652,40 euros pour l’année 2024');
    expect(parsed?.amount).toBeCloseTo(65652.4, 2);
  });

  it('returns null when no average is stated', () => {
    expect(parseAverageSalary('rien ici')).toBeNull();
  });
});

describe('the multiplication ADR-0025 places here', () => {
  it('is exact to the cent', () => {
    expect(computeThreshold(1.2, 65652)).toBe(78782.4);
    expect(computeThreshold(1.5, 65652)).toBe(98478);
  });

  it('does not accumulate floating-point dust', () => {
    // 1.1 × 3.3 in binary floating point is 3.6300000000000003. A threshold is money.
    expect(computeThreshold(1.1, 3.3)).toBe(3.63);
  });
});

describe('normalize', () => {
  it('produces both thresholds and the gate that opens the lower one', () => {
    const rows = connector().normalize(FIXTURE);

    expect(rows.map((r) => r.requirementId).sort()).toEqual([
      'lu.eu-blue-card.reduced-threshold-occupations',
      'lu.eu-blue-card.salary-threshold.general',
      'lu.eu-blue-card.salary-threshold.reduced',
    ]);
  });

  it('computes the reduced threshold below the general one', () => {
    // The relationship, not the figures: the derogation exists to lower the bar, and a connector
    // that produced the opposite would be wrong in a way no single-value assertion catches.
    const rows = connector().normalize(FIXTURE);
    const amount = (id: string) =>
      (rows.find((r) => r.requirementId === id)?.value as { amount: number }).amount;

    expect(amount('lu.eu-blue-card.salary-threshold.reduced')).toBeLessThan(
      amount('lu.eu-blue-card.salary-threshold.general'),
    );
  });

  it('records every instrument the number came from', () => {
    // ADR-0025: a computed threshold that names one of its two sources is not evidence.
    for (const row of connector().normalize(FIXTURE)) {
      if (row.kind !== 'threshold') continue;

      const derived = (row.domainDetail as { derivedFrom: readonly { role: string }[] }).derivedFrom;
      expect(derived.map((d) => d.role).sort()).toEqual(['formula', 'operand']);
    }
  });

  it('records the operands themselves, so the arithmetic can be re-performed', () => {
    const row = connector()
      .normalize(FIXTURE)
      .find((r) => r.requirementId === 'lu.eu-blue-card.salary-threshold.general');

    const derived = (row?.domainDetail as {
      derivedFrom: readonly { role: string; multiplier?: number; amount?: number }[];
    }).derivedFrom;

    const multiplier = derived.find((d) => d.role === 'formula')?.multiplier;
    const average = derived.find((d) => d.role === 'operand')?.amount;
    expect(multiplier).toBeDefined();
    expect(average).toBeDefined();
    expect(computeThreshold(multiplier!, average!)).toBe((row?.value as { amount: number }).amount);
  });

  it('emits nothing at all when the average is missing', () => {
    // A multiplier with nothing to multiply is an unknown rule, not a partially known one. A
    // default here would invent the figure this connector exists to derive honestly.
    const rows = connector().normalize({
      ...FIXTURE,
      operand: { ...FIXTURE.operand, html: '<html><body>rien</body></html>' },
    });

    expect(rows).toEqual([]);
  });

  it('marks the occupation list as a right, not a hurdle', () => {
    const row = connector()
      .normalize(FIXTURE)
      .find((r) => r.requirementId === 'lu.eu-blue-card.reduced-threshold-occupations');

    expect(row?.kind).toBe('right');
    expect(row?.value).toEqual(['1', '2']);
  });

  it('scopes each threshold to its own route', () => {
    const rows = connector().normalize(FIXTURE);
    const routeOf = (id: string) =>
      (rows.find((r) => r.requirementId === id)?.appliesTo as { route?: string }).route;

    expect(routeOf('lu.eu-blue-card.salary-threshold.general')).toBe('general');
    expect(routeOf('lu.eu-blue-card.salary-threshold.reduced')).toBe('citp-1-2');
    expect(routeOf('lu.eu-blue-card.reduced-threshold-occupations')).toBe('citp-1-2');
  });

  it('never writes a legal citation where a route id belongs', () => {
    for (const row of connector().normalize(FIXTURE)) {
      const route = (row.appliesTo as { route?: unknown }).route;
      if (route === undefined) continue;

      expect(typeof route).toBe('string');
      expect(route as string).not.toMatch(/[\s§]/);
    }
  });

  it('refreshes on the operand, which is what expires', () => {
    // The formula applies until amended; the average is republished annually. A rule is stale as
    // soon as its fastest-moving input is (ADR-0025).
    const [row] = connector().normalize(FIXTURE);
    expect(row?.refreshAfter).toBe('2026-06-30');
  });

  it('is pure', () => {
    expect(connector().normalize(FIXTURE)).toEqual(connector().normalize(FIXTURE));
  });
});

describe('validate', () => {
  it('accepts the real instruments with no issues at all', () => {
    const c = connector();
    const result = c.validate(c.normalize(FIXTURE));

    expect(isIngestible(result)).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects a threshold in the range the separator defect produces', () => {
    // 65.652 read as a decimal, times 1.5, is about 98 euros a year.
    const c = connector();
    const [row] = c.normalize(FIXTURE);
    const broken = { ...row!, value: { amount: 98.48, currency: 'EUR', period: 'year', basis: 'gross' } };

    expect(isIngestible(c.validate([broken]))).toBe(false);
  });

  it('rejects a computed threshold that does not record its instruments', () => {
    const c = connector();
    const [row] = c.normalize(FIXTURE);
    const undocumented = { ...row!, domainDetail: { legalBasis: 'x' } };

    expect(isIngestible(c.validate([undocumented]))).toBe(false);
  });

  it('rejects a payload that yielded nothing', () => {
    expect(isIngestible(connector().validate([]))).toBe(false);
  });
});

describe('archival (ADR-0025)', () => {
  it('offers both instruments, each as an original', () => {
    const sources = connector().archivableSources(FIXTURE);

    expect(sources.map((s) => s.role)).toEqual(['formula', 'operand']);
    for (const source of sources) {
      expect(source.source.isOriginal).toBe(true);
      expect(source.source.jurisdiction).toBe('LU');
      expect(source.instrumentId).toMatch(/^eli\//);
    }
  });

  it('gives each instrument a distinct, deterministic slug', () => {
    // The object key is derived from it. Two instruments under one key would archive one and
    // silently overwrite the other, leaving the rule half-evidenced with no error anywhere.
    const [formula, operand] = connector().archivableSources(FIXTURE);

    expect(formula?.source.slug).not.toBe(operand?.source.slug);
    expect(connector().archivableSources(FIXTURE)[0]?.source.slug).toBe(formula?.source.slug);
  });

  it('dates the consolidation from its own ELI, not from the act it consolidates', () => {
    // `…/rgd/2008/09/26/n3/consolide/20240701` is a 2024 document of a 2008 act. Keyed under 2008
    // it would collide with every other consolidation of the same act.
    const [formula] = connector().archivableSources(FIXTURE);
    expect(formula?.source.year).toBe(2024);
  });

  it('still offers the primary instrument on its own', () => {
    // A caller that knows nothing about derived rules must still archive what the rule's own row
    // cites.
    expect(connector().archivable(FIXTURE).slug).toBe(
      connector().archivableSources(FIXTURE)[0]?.source.slug,
    );
  });
});
