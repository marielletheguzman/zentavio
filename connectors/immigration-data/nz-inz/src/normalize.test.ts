import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isIngestible } from '@zentavio/connectors-core';
import { describe, expect, it } from 'vitest';

import { InzConnector, type InzRaw } from './index.ts';
import {
  parseAdultMinimumWage,
  parseEffectiveFrom,
  parseWageEffectiveFrom,
  requiresMarketRate,
  requiresMinimumWage,
  toPlainText,
} from './parse.ts';

/** The instruction sections and MBIE's rates page, captured as served. */
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../tests/fixtures/connectors/nz-inz/aewv-instructions.json', import.meta.url)),
    'utf8',
  ),
) as InzRaw;

function connector() {
  return new InzConnector({ fetchInstructions: async () => FIXTURE });
}

const wageText = () => toPlainText(FIXTURE.minimumWage.html);
const sectionText = (code: string) =>
  toPlainText(FIXTURE.instructions.find((i) => i.section === code)?.html ?? '');

describe('the viewer script these pages carry inline', () => {
  it('is stripped before any pattern runs', () => {
    // Every instruction page embeds its viewer's JavaScript above the text, so a naive extraction
    // reads `function printWindow()` before it reaches a word of law.
    expect(FIXTURE.instructions[0]?.html).toContain('printWindow');

    const text = sectionText('WA3.15');
    expect(text).not.toContain('printWindow');
    expect(text).not.toContain('location.href');
  });
});

describe('dates are day-first, and reading them the other way is silent', () => {
  it('reads the Effective date an instruction carries', () => {
    expect(parseEffectiveFrom(sectionText('WA3.15'))).toBe('2025-12-08');
  });

  it('does not read 09/10 as September', () => {
    // The whole trap: `09/10/2023` parsed month-first is a real date eleven months early, with no
    // error anywhere. Same class as the German font map and the French thousands separator.
    expect(parseEffectiveFrom('Effective 09/10/2023')).toBe('2023-10-09');
    expect(parseEffectiveFrom('Effective 09/10/2023')).not.toBe('2023-09-10');
  });

  it('refuses a day that does not exist rather than rolling it forward', () => {
    // `2026-02-31` constructs a Date in JavaScript and is not a day.
    expect(parseEffectiveFrom('Effective 31/02/2026')).toBeNull();
  });

  it('returns null when a section states no date', () => {
    // A rule with no date cannot be stored against a period, so no row is better than a guessed one.
    expect(parseEffectiveFrom('no date here')).toBeNull();
  });
});

describe('the rules the instructions state', () => {
  it('finds the minimum-wage requirement in WA3.15', () => {
    expect(requiresMinimumWage(sectionText('WA3.15'))).toBe(true);
  });

  it('finds the market-rate test, which is a judgement rather than a threshold', () => {
    expect(requiresMarketRate(sectionText('WA3.15'))).toBe(true);
  });

  it('does not invent either from an unrelated section', () => {
    expect(requiresMinimumWage('WA3.25 Remuneration will be calculated per hour.')).toBe(false);
  });
});

describe('the wage, on a page that is a whole website', () => {
  it('reads the adult rate from the table row', () => {
    const wage = parseAdultMinimumWage(wageText());

    expect(wage).not.toBeNull();
    expect(wage!).toBeGreaterThan(10);
    expect(wage!).toBeLessThan(200);
  });

  it('takes the hourly figure, not the daily one beside it', () => {
    // The row is hourly, 8-hour day, week, fortnight. The second figure is eight times the first,
    // and a threshold eight times too high rejects everybody.
    const wage = parseAdultMinimumWage('Adult $23.95 $191.60 $958 $1,916');
    expect(wage).toBe(23.95);
  });

  it('handles a thousands separator without reading it as a decimal', () => {
    expect(parseAdultMinimumWage('Adult $1,234.50 $9,876')).toBe(1234.5);
  });

  it('is anchored on the row, not on the first dollar figure on the page', () => {
    // ~545 KB of navigation and guidance surrounds one table. The first `$` on the page is not it.
    expect(
      parseAdultMinimumWage('Call us on $0800 or see our $5 guide. Adult $23.95 $191.60'),
    ).toBe(23.95);
  });

  it('reads the date the rates take effect, written as prose', () => {
    expect(parseWageEffectiveFrom(wageText())).toBe('2026-04-01');
  });

  it('returns null rather than guessing when no rate is stated', () => {
    expect(parseAdultMinimumWage('no rates today')).toBeNull();
  });
});

describe('normalize', () => {
  it('produces the rules these instructions actually state', () => {
    const ids = connector()
      .normalize(FIXTURE)
      .map((r) => r.requirementId)
      .sort();

    expect(ids).toContain('nz.aewv.remuneration');
    expect(ids).toContain('nz.aewv.market-rate');
  });

  it('states the threshold hourly, as the instruction assesses it', () => {
    // `WA3.25` calculates remuneration as guaranteed payment per hour and MBIE publishes an hourly
    // rate, so nothing converts. One fewer place to be wrong than either European rule.
    const row = connector()
      .normalize(FIXTURE)
      .find((r) => r.requirementId === 'nz.aewv.remuneration');

    expect(row?.value).toMatchObject({ currency: 'NZD', period: 'hour', basis: 'gross' });
  });

  it('records both instruments, with no formula between them', () => {
    // ADR-0025 without arithmetic: the instruction states the rule, MBIE states the figure. A
    // `formula` role here would describe a multiplication that does not happen.
    const row = connector()
      .normalize(FIXTURE)
      .find((r) => r.requirementId === 'nz.aewv.remuneration');

    const derived = (row?.domainDetail as { derivedFrom: readonly { role: string }[] }).derivedFrom;
    expect(derived.map((d) => d.role).sort()).toEqual(['operand', 'primary']);
    expect(derived.map((d) => d.role)).not.toContain('formula');
  });

  it('refuses to decide the market rate', () => {
    // An immigration officer decides it. `manual` is the honest evaluation, and a number here
    // would be a threshold nobody wrote.
    const row = connector()
      .normalize(FIXTURE)
      .find((r) => r.requirementId === 'nz.aewv.market-rate');

    expect(row?.evaluation).toBe('manual');
    expect(row?.value).toBeNull();
    expect(row?.needsInput).toEqual([]);
  });

  it('takes every effective date from its own instruction', () => {
    // Not hardcoded, which is what `de-aufenthg` has to do because its page carries no date.
    for (const row of connector().normalize(FIXTURE)) {
      expect(row.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('declares no routes — the AEWV has one way in', () => {
    // A routeless pathway behaves exactly as pathways did before ADR-0024, asserted by that ADR's
    // own tests. New Zealand is the case that shows routes stayed additive.
    for (const row of connector().normalize(FIXTURE)) {
      expect(row.appliesTo).toEqual({});
    }
  });

  it('emits no remuneration rule when the wage cannot be read', () => {
    // A threshold that compares against nothing is worse than an absent one, because it evaluates.
    const rows = connector().normalize({
      ...FIXTURE,
      minimumWage: { ...FIXTURE.minimumWage, html: '<html><body>no rates</body></html>' },
    });

    expect(rows.map((r) => r.requirementId)).not.toContain('nz.aewv.remuneration');
  });

  it('skips a section with no Effective date rather than dating it itself', () => {
    const rows = connector().normalize({
      ...FIXTURE,
      instructions: [{ ...FIXTURE.instructions[0]!, html: '<p>WA3.15 rules with no date</p>' }],
    });

    expect(rows).toEqual([]);
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

  it('rejects an hourly rate outside any plausible band', () => {
    // The band is hourly, an order of magnitude away from the European annual thresholds. A figure
    // lifted from elsewhere on the page lands outside it.
    const c = connector();
    const row = c.normalize(FIXTURE).find((r) => r.requirementId === 'nz.aewv.remuneration');
    const broken = { ...row!, value: { amount: 958, currency: 'NZD', period: 'hour', basis: 'gross' } };

    expect(isIngestible(c.validate([broken]))).toBe(false);
  });

  it('rejects a threshold that does not record what set it', () => {
    const c = connector();
    const row = c.normalize(FIXTURE).find((r) => r.requirementId === 'nz.aewv.remuneration');
    const undocumented = { ...row!, domainDetail: { legalBasis: 'x' } };

    expect(isIngestible(c.validate([undocumented]))).toBe(false);
  });

  it('rejects a payload that yielded nothing', () => {
    expect(isIngestible(connector().validate([]))).toBe(false);
  });
});

describe('archival (ADR-0025)', () => {
  it('offers every instruction section and the wage page', () => {
    const sources = connector().archivableSources(FIXTURE);

    expect(sources).toHaveLength(FIXTURE.instructions.length + 1);
    expect(sources.filter((s) => s.role === 'operand')).toHaveLength(1);
  });

  it('archives the wage page even though nothing multiplies it', () => {
    // The role says what it contributed. A threshold whose figure came from a page nobody kept is
    // unrecomputable whether or not arithmetic was involved.
    const operand = connector()
      .archivableSources(FIXTURE)
      .find((s) => s.role === 'operand');

    expect(operand?.instrumentId).toBe('mbie-adult-minimum-wage');
    expect(operand?.source.isOriginal).toBe(true);
  });

  it('slugs an instruction by its stable id, not by its section code', () => {
    // A section code can be reworded by an amendment; the id is what fetches the document.
    const sources = connector().archivableSources(FIXTURE);
    const first = sources[0];

    expect(first?.source.slug).toBe(`inz-opsmanual-${FIXTURE.instructions[0]!.documentId}`);
    expect(first?.source.slug).not.toContain('WA');
  });

  it('gives every instrument a distinct slug', () => {
    // Two documents under one object key archive one and silently overwrite the other.
    const slugs = connector().archivableSources(FIXTURE).map((s) => s.source.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
