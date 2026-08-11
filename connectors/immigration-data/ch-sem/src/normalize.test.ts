import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isIngestible } from '@zentavio/connectors-core';
import { describe, expect, it } from 'vitest';

import { SemConnector, type WeisungenRaw } from './index.ts';
import { compactText, normaliseText, parseConditions, parseStandDate } from './parse.ts';

const FIXTURE_DIR = new URL('../../../../tests/fixtures/connectors/ch-sem/', import.meta.url);

/**
 * Kapitel 4 as published — the extracted text only.
 *
 * **The PDF is deliberately not committed.** This connector does not parse PDFs: extraction happens
 * in the fetch half, before `normalize`, so the bytes only ever flow to archival. A committed copy
 * would test nothing here while carrying the SEM office addresses the fixture privacy guards
 * rightly refuse — and those guards are worth more without an exception than with one.
 */
const META = JSON.parse(
  readFileSync(fileURLToPath(new URL('weisungen-aig-kap4.json', FIXTURE_DIR)), 'utf8'),
) as Omit<WeisungenRaw, 'documentBytes'>;

/** Stand-in bytes. `archivable` passes them through untouched, which is all it claims to do. */
const BYTES = new TextEncoder().encode('%PDF-1.7 fixture stand-in for archival');

const FIXTURE: WeisungenRaw = { ...META, documentBytes: BYTES };

function connector() {
  return new SemConnector({ fetchDirective: async () => FIXTURE });
}

const text = () => normaliseText(FIXTURE.documentText);

describe('the extraction damage this parser has to survive', () => {
  it('is real in this document', () => {
    // `Zulassungsvo raussetzungen` and `A rbeitslosigkeit` appear mid-sentence in the extraction.
    expect(FIXTURE.documentText).toMatch(/Zulassungsvo raussetzungen|A rbeitslosigkeit/);
  });

  it('matches through a break wherever the extractor put one', () => {
    // Space-free matching, which is what makes a pattern independent of where the line ended.
    expect(compactText('Zulassungsvo raussetzungen')).toBe('Zulassungsvoraussetzungen');
    expect(compactText('A rbeitslosigkeit')).toBe('Arbeitslosigkeit');
  });

  it('is not solved by rejoining words, which was tried and was worse', () => {
    // A heuristic joining a lower-case letter to a long following word also joins
    // "vorhandener persönlicher" — destroying phrases that were never broken, and failing
    // silently by making patterns stop matching intact text.
    const intact = 'Erfordernis vorhandener persönlicher Voraussetzungen';
    expect(normaliseText(intact)).toBe(intact);
    expect(parseConditions(intact).personalQualification).toBe(true);
  });
});

describe('the document dates itself, and the page that links it does not', () => {
  it('reads the Stand date', () => {
    expect(parseStandDate(text())).toBe('2026-06-30');
  });

  it('reads it day-first', () => {
    // Swiss dates are DD.MM.YYYY — the third format across four countries. `06.07.2026` is 6 July,
    // and month-first would place it in June with no error anywhere.
    expect(parseStandDate('(Stand 06.07.2026)')).toBe('2026-07-06');
    expect(parseStandDate('(Stand 06.07.2026)')).not.toBe('2026-06-07');
  });

  it('refuses a day that does not exist', () => {
    expect(parseStandDate('(Stand 31.02.2026)')).toBeNull();
  });

  it('returns null when the document states no Stand', () => {
    expect(parseStandDate('no date here')).toBeNull();
  });
});

describe('the conditions Kapitel 4 imposes', () => {
  it('finds every one it actually states', () => {
    const conditions = parseConditions(text());

    expect(conditions.economicInterest).toBe(true);
    expect(conditions.priority).toBe(true);
    expect(conditions.vacancyReporting).toBe(true);
    expect(conditions.customaryPay).toBe(true);
    expect(conditions.personalQualification).toBe(true);
  });

  it('is anchored on operative wording, not on headings', () => {
    // The table of contents repeats every heading hundreds of pages before the rule. Matching a
    // heading would find the contents page, where the surrounding text is dot leaders.
    const contentsOnly =
      '4.3.1 Gesamtwirtschaftliches Interesse ......... 26 4.3.2 Vorrang (Art. 21 AIG) ......... 27';

    const conditions = parseConditions(contentsOnly);
    expect(conditions.economicInterest).toBe(false);
    expect(conditions.priority).toBe(false);
  });

  it('finds nothing in an unrelated document', () => {
    const conditions = parseConditions('Ein ganz anderes Dokument über Fischerei.');

    expect(Object.values(conditions).every((found) => found === false)).toBe(true);
  });
});

describe('normalize', () => {
  it('emits the admission conditions as rules', () => {
    const ids = connector()
      .normalize(FIXTURE)
      .map((r) => r.requirementId)
      .sort();

    expect(ids).toEqual([
      'ch.third-country-worker.customary-pay',
      'ch.third-country-worker.economic-interest',
      'ch.third-country-worker.personal-qualification',
      'ch.third-country-worker.priority',
      'ch.third-country-worker.vacancy-reporting',
    ]);
  });

  it('leaves the judgements to an authority', () => {
    // The country's defining property: most conditions are decided by an officer, so the evaluator
    // reports them and refuses to decide. A number here would be a threshold nobody wrote.
    const manual = connector()
      .normalize(FIXTURE)
      .filter((r) => r.evaluation === 'manual');

    expect(manual.map((r) => r.requirementId).sort()).toEqual([
      'ch.third-country-worker.customary-pay',
      'ch.third-country-worker.economic-interest',
      'ch.third-country-worker.priority',
    ]);
    for (const row of manual) expect(row.value).toBeNull();
  });

  it('emits no quota, ever', () => {
    // ADR-0027. A cap is a property of the pathway; `requirements.kind` no longer permits one, and
    // a row for it would tell somebody they failed a capacity limit.
    for (const row of connector().normalize(FIXTURE)) {
      expect(row.kind).not.toBe('quota');
      expect(row.requirementId).not.toContain('quota');
      expect(row.requirementId).not.toContain('hoechstzahl');
    }
  });

  it('still reports that the pathway is capped, separately', () => {
    // The cap is real and belongs on the pathway record. Offered outside `normalize` so it cannot
    // be mistaken for a rule.
    expect(connector().quotaBasis(FIXTURE)).toContain('VZAE Anhang 1 und 2');
  });

  it('dates every rule from the chapter it came from', () => {
    // One `Stand` for the whole document, unlike New Zealand's per-section dates — so a revision
    // re-dates everything at once and the version says which edition a row is from.
    for (const row of connector().normalize(FIXTURE)) {
      expect(row.effectiveFrom).toBe('2026-06-30');
      expect(row.version).toBe('kap4@2026-06-30');
    }
  });

  it('declares no routes', () => {
    for (const row of connector().normalize(FIXTURE)) {
      expect(row.appliesTo).toEqual({});
    }
  });

  it('emits nothing when the chapter carries no date', () => {
    // Every rule here shares one date; without it nothing can be stored against a period.
    const rows = connector().normalize({ ...FIXTURE, documentText: 'Zulassungsvoraussetzungen ohne Datum' });

    expect(rows).toEqual([]);
  });

  it('is pure', () => {
    expect(connector().normalize(FIXTURE)).toEqual(connector().normalize(FIXTURE));
  });
});

describe('validate', () => {
  it('accepts the real chapter with no issues at all', () => {
    const c = connector();
    const result = c.validate(c.normalize(FIXTURE));

    expect(isIngestible(result)).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects a quota smuggled in as a requirement', () => {
    const c = connector();
    const [row] = c.normalize(FIXTURE);
    const smuggled = { ...row!, kind: 'quota' as never, requirementId: 'ch.third-country-worker.quota' };

    expect(isIngestible(c.validate([smuggled]))).toBe(false);
  });

  it('rejects a judgement that was given a value', () => {
    // A rule an authority decides has nothing to compare against. A value would make it look
    // evaluable and produce a verdict nobody is entitled to.
    const c = connector();
    const manual = c.normalize(FIXTURE).find((r) => r.evaluation === 'manual');
    const wrong = { ...manual!, value: { amount: 1, currency: 'CHF', period: 'year' } };

    expect(isIngestible(c.validate([wrong]))).toBe(false);
  });

  it('rejects a chapter that yielded nothing', () => {
    expect(isIngestible(connector().validate([]))).toBe(false);
  });
});

describe('archival', () => {
  it('archives the published PDF, not the extraction', () => {
    // A parse defect in our text is invisible in an archive of our text — the lesson
    // `de-bundesanzeiger` paid for.
    const source = connector().archivable(FIXTURE);

    expect(source.isOriginal).toBe(true);
    expect(source.extension).toBe('pdf');
    expect(source.contentType).toBe('application/pdf');
    expect(source.bytes).toBe(FIXTURE.documentBytes);
  });

  it('keys the archive on the chapter, deterministically', () => {
    expect(connector().archivable(FIXTURE).slug).toBe('weisungen-aig-kap4');
    expect(connector().archivable(FIXTURE).jurisdiction).toBe('CH');
  });
});
