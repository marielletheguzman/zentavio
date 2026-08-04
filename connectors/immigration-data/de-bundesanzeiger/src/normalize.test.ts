import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isIngestible } from '@zentavio/connectors-core';
import type { MonetaryValue, SourcedRequirement } from '@zentavio/types';
import { describe, expect, it } from 'vitest';

import { BundesanzeigerConnector, type BekanntmachungRaw } from './index.ts';
import { healNumericSpacing, parseBekanntmachung, parseGermanDecimal } from './parse.ts';

/**
 * The real 2026 announcement, captured verbatim from the published PDF including its extraction
 * defects. `normalize` is tested against this fixture and never against the live source
 * (`docs/architecture/connectors.md`, "Adding a source", step 3).
 */
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../tests/fixtures/connectors/de-bundesanzeiger/banz-at-18-12-2025-b3.json', import.meta.url),
    ),
    'utf8',
  ),
) as BekanntmachungRaw;

function connector() {
  return new BundesanzeigerConnector({
    knownPublications: [FIXTURE.publicationId],
    fetchDocument: async (id) => (id === FIXTURE.publicationId ? FIXTURE : null),
  });
}

function amountOf(row: SourcedRequirement): MonetaryValue {
  return row.value as MonetaryValue;
}

describe('the PDF extraction defect this connector exists to survive', () => {
  it('reads the wrong numbers entirely without healing — a €700 salary threshold', () => {
    // This is not hypothetical. The Bundesanzeiger's PDF font map splits digit runs, so the
    // naive pattern finds `700` inside `50 700` and `20` inside `45 934 ,20`. Both are plausible
    // -looking numbers, which is what makes the defect dangerous: it fails to a wrong answer
    // rather than to no answer.
    const naiveEuros = [...FIXTURE.documentText.matchAll(/(\d+(?:,\d+)?) Euro/g)].map((m) => m[1]);
    const naivePercents = [...FIXTURE.documentText.matchAll(/(\d+(?:,\d+)?) Prozent/g)].map((m) => m[1]);

    expect(naiveEuros).toEqual(['700', '20']);
    expect(naivePercents).toEqual(['50', '5,3']);
  });

  it('recovers the real figures once digit runs are rejoined', () => {
    const healed = healNumericSpacing(FIXTURE.documentText);

    expect([...healed.matchAll(/(\d+(?:,\d+)?) Euro/g)].map((m) => m[1])).toEqual(['50700', '45934,20']);
    expect([...healed.matchAll(/(\d+(?:,\d+)?) Prozent/g)].map((m) => m[1])).toEqual(['50', '45,3']);
  });

  it('closes gaps only between digits, leaving prose alone', () => {
    expect(healNumericSpacing('4 5,3 Prozent')).toBe('45,3 Prozent');
    expect(healNumericSpacing('45 934 ,20 Euro')).toBe('45934,20 Euro');
    // A letter in the way means these are separate numbers, not one split one.
    expect(healNumericSpacing('Absatz 1 Satz 1 und 2')).toBe('Absatz 1 Satz 1 und 2');
    expect(healNumericSpacing('1 8 g Absatz 7')).toBe('18 g Absatz 7');
  });
});

describe('parseGermanDecimal', () => {
  it('reads the comma as a decimal point', () => {
    expect(parseGermanDecimal('45934,20')).toBe(45934.2);
    expect(parseGermanDecimal('50700')).toBe(50700);
    expect(parseGermanDecimal('45,3')).toBe(45.3);
  });

  it('returns null rather than NaN for something unparseable', () => {
    expect(parseGermanDecimal('')).toBeNull();
    expect(parseGermanDecimal('fünfzig')).toBeNull();
  });
});

describe('parseBekanntmachung', () => {
  it('takes the year the amounts apply to, not the year of publication', () => {
    // The 2026 rates were published on 18 December 2025. Keying off the publication date would
    // be wrong by one year, every year.
    expect(parseBekanntmachung(FIXTURE.documentText)?.year).toBe(2026);
    expect(FIXTURE.publicationId).toContain('2025');
  });

  it('pairs each percentage with the amount it yields', () => {
    expect(parseBekanntmachung(FIXTURE.documentText)?.thresholds).toEqual([
      { percent: 50, amount: 50700 },
      { percent: 45.3, amount: 45934.2 },
    ]);
  });

  it('returns null when the document names no year', () => {
    expect(parseBekanntmachung('Bekanntmachung ohne Jahresangabe')).toBeNull();
  });
});

describe('normalize', () => {
  it('produces one row per announced threshold, with the verified 2026 figures', () => {
    const rows = connector().normalize(FIXTURE);

    expect(rows).toHaveLength(2);
    expect(amountOf(rows[0]!)).toEqual({ amount: 50700, currency: 'EUR', period: 'year', basis: 'gross' });
    expect(amountOf(rows[1]!)).toEqual({ amount: 45934.2, currency: 'EUR', period: 'year', basis: 'gross' });
  });

  it('identifies the category by percentage, not by document order', () => {
    // A year in which BMI reorders the paragraphs must not silently swap the two thresholds.
    const reordered: BekanntmachungRaw = {
      ...FIXTURE,
      documentText: '... das Jahr 2026 ... 4 5,3 Prozent ... 45 934 ,20 Euro ... 50 Prozent ... 50 700 Euro ...',
    };
    const rows = connector().normalize(reordered);

    const reduced = rows.find((r) => r.requirementId.endsWith('.reduced'));
    const general = rows.find((r) => r.requirementId.endsWith('.general'));
    expect(amountOf(reduced!).amount).toBe(45934.2);
    expect(amountOf(general!).amount).toBe(50700);
  });

  it('carries provenance, tier, and the authority to contact', () => {
    const [row] = connector().normalize(FIXTURE);

    expect(row!.sourceTier).toBe(1);
    expect(row!.sourceUrl).toBe(FIXTURE.sourceUrl);
    expect(row!.retrievedAt).toBe(FIXTURE.fetchedAt);
    expect(row!.authority).toBe('Bundesministerium des Innern');
    expect(row!.domainDetail).toMatchObject({ announcedIn: 'BAnz AT 18.12.2025 B3' });
  });

  it('bounds validity to the calendar year and sets the refresh date the statute fixes', () => {
    // § 18g Abs. 7 obliges BMI to publish the next year's minimums by 31 December of the
    // preceding year, so this window is written by the statute rather than chosen by us.
    const [row] = connector().normalize(FIXTURE);

    expect(row!.effectiveFrom).toBe('2026-01-01');
    expect(row!.effectiveTo).toBe('2026-12-31');
    expect(row!.version).toBe('2026');
    expect(row!.refreshAfter).toBe('2025-12-31');
  });

  it('names the person fact that would resolve an undetermined verdict', () => {
    const [row] = connector().normalize(FIXTURE);

    expect(row!.needsInput).toEqual(['expected_gross_annual_salary_eur']);
    expect(row!.evaluation).toBe('numeric-gte');
  });

  it('is pure — same input, same output, no clock', () => {
    const first = connector().normalize(FIXTURE);
    const second = connector().normalize(FIXTURE);

    expect(first).toEqual(second);
  });

  it('drops a threshold whose percentage matches no category in the statute', () => {
    // An unrecognised percentage means § 18g changed its categories. Emitting the row under a
    // guessed id would attach a real amount to the wrong category.
    const changed: BekanntmachungRaw = {
      ...FIXTURE,
      documentText: 'das Jahr 2027 ... 60 Prozent ... 70 000 Euro',
    };

    expect(connector().normalize(changed)).toEqual([]);
  });

  it('returns an empty array rather than throwing on an unreadable document', () => {
    expect(connector().normalize({ ...FIXTURE, documentText: '' })).toEqual([]);
  });
});

describe('validate', () => {
  it('accepts the real announcement with no issues at all', () => {
    // Archival is not checked here. A connector never archives — it returns data — so it cannot
    // report whether a document was stored. That belongs to `services/ingestion` (ADR-0021).
    const connectorInstance = connector();
    const result = connectorInstance.validate(connectorInstance.normalize(FIXTURE));

    expect(isIngestible(result)).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects a document that yielded nothing', () => {
    const connectorInstance = connector();
    const result = connectorInstance.validate([]);

    expect(isIngestible(result)).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('no-thresholds-parsed');
  });

  it('rejects an implausible amount — the parse defect must not reach the database', () => {
    const connectorInstance = connector();
    const [row] = connectorInstance.normalize(FIXTURE);
    const broken: SourcedRequirement = {
      ...row!,
      value: { amount: 700, currency: 'EUR', period: 'year', basis: 'gross' },
    };

    const result = connectorInstance.validate([broken, row!]);
    expect(isIngestible(result)).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('threshold-implausible');
  });

  it('never throws, whatever it is handed', () => {
    const connectorInstance = connector();

    expect(() => connectorInstance.validate([])).not.toThrow();
  });
});

describe('search and fetch', () => {
  it('returns the known publications', async () => {
    const page = await connector().search({});

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.publicationId).toBe(FIXTURE.publicationId);
    expect(page.nextCursor).toBeUndefined();
  });

  it('returns nothing for a region it does not cover', async () => {
    expect((await connector().search({ regions: ['LU'] })).items).toEqual([]);
  });

  it('returns null for a publication the source does not have', async () => {
    expect(await connector().fetch('BAnz AT 01.01.1999 X9')).toBeNull();
  });
});

describe('healthCheck', () => {
  it('is healthy when the newest publication is retrievable', async () => {
    expect(await connector().healthCheck()).toMatchObject({ state: 'healthy' });
  });

  it('reports unreachable as data rather than throwing', async () => {
    const failing = new BundesanzeigerConnector({
      knownPublications: [FIXTURE.publicationId],
      fetchDocument: async () => {
        throw new Error('connect ETIMEDOUT');
      },
    });

    expect(await failing.healthCheck()).toMatchObject({ state: 'unreachable' });
  });
});
