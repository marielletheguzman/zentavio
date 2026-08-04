import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isIngestible } from '@zentavio/connectors-core';
import { describe, expect, it } from 'vitest';

import { AufenthgConnector, type StatuteRaw } from './index.ts';
import {
  parseMinimumEmploymentMonths,
  parseReducedThresholdIscoGroups,
  toPlainText,
} from './parse.ts';

/** § 18g as served, captured verbatim including its ISO-8859-1 entity encoding. */
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../tests/fixtures/connectors/de-aufenthg/aufenthg-18g.json', import.meta.url)),
    'utf8',
  ),
) as StatuteRaw;

function connector() {
  return new AufenthgConnector({
    knownDocuments: [FIXTURE.documentId],
    fetchDocument: async (id) => (id === FIXTURE.documentId ? FIXTURE : null),
  });
}

describe('the encoding this connector has to survive', () => {
  it('decodes the numeric entities the page serves', () => {
    // The page is ISO-8859-1 and entity-encodes umlauts. A pattern anchored on `ä` never fires
    // against the raw bytes, and the connector reports no rules rather than failing — silent.
    expect(FIXTURE.html).toContain('&#228;');

    const text = toPlainText(FIXTURE.html);
    expect(text).toContain('Beschäftigungsdauer');
    expect(text).not.toContain('&#228;');
  });
});

describe('§ 18g Abs. 3 — minimum employment duration', () => {
  it('reads the duration the statute writes as a word', () => {
    expect(parseMinimumEmploymentMonths(toPlainText(FIXTURE.html))).toBe(6);
  });

  it('accepts a digit too, in case an amendment writes one', () => {
    expect(parseMinimumEmploymentMonths('Beschäftigungsdauer von mindestens 9 Monaten')).toBe(9);
  });

  it('returns null for a number word it does not know, rather than guessing', () => {
    // A guessed duration is a rule nobody wrote. No row is better than a wrong one.
    expect(parseMinimumEmploymentMonths('Beschäftigungsdauer von mindestens vierzehn Monaten')).toBeNull();
  });
});

describe('§ 18g Abs. 1 — the reduced-threshold occupations', () => {
  it('reads the ISCO-08 groups the statute lists', () => {
    expect(parseReducedThresholdIscoGroups(toPlainText(FIXTURE.html))).toEqual([
      '132',
      '133',
      '134',
      '21',
      '221',
      '222',
      '225',
      '226',
      '23',
      '25',
    ]);
  });

  it('is anchored on the sentence, not on bare digits', () => {
    // The page is full of numbers that are section references and dates. Matching digits alone
    // would produce an occupation list containing "2009" and "292".
    const groups = parseReducedThresholdIscoGroups(toPlainText(FIXTURE.html));
    expect(groups).not.toContain('2009');
    expect(groups).not.toContain('292');
    expect(groups).not.toContain('18');
  });

  it('returns nothing when the list is absent', () => {
    expect(parseReducedThresholdIscoGroups('kein Verzeichnis hier')).toEqual([]);
  });
});

describe('normalize', () => {
  it('produces the three provisions that are literal on this page', () => {
    const rows = connector().normalize(FIXTURE);

    expect(rows.map((r) => r.requirementId).sort()).toEqual([
      'de.eu-blue-card.employment-duration',
      'de.eu-blue-card.qualification',
      'de.eu-blue-card.reduced-threshold-occupations',
    ]);
  });

  it('marks the occupation list as a right, not a hurdle', () => {
    // It *lowers* the salary threshold. An evaluator treating it as something to fail would
    // reject exactly the people the statute is being generous to.
    const row = connector()
      .normalize(FIXTURE)
      .find((r) => r.requirementId === 'de.eu-blue-card.reduced-threshold-occupations');

    expect(row?.kind).toBe('right');
    expect(row?.value).toContain('133');
  });

  it('records that the no-degree route exists but is not modelled', () => {
    // Without this the qualification row reads as "no degree means no Blue Card", which § 18g
    // Abs. 2 contradicts.
    const row = connector()
      .normalize(FIXTURE)
      .find((r) => r.requirementId === 'de.eu-blue-card.qualification');

    expect(row?.domainDetail).toMatchObject({
      alternativeRouteNotModelled: expect.stringContaining('Abs. 2'),
    });
  });

  it('does not claim the statute began on the day we read it', () => {
    // Using the fetch date would make every as-of query before today return no rules.
    const [row] = connector().normalize(FIXTURE);

    expect(row?.effectiveFrom).toBe('2023-11-18');
    expect(row?.effectiveFrom).not.toBe(FIXTURE.fetchedAt.slice(0, 10));
  });

  it('leaves the statute open-ended, unlike the annual announcement', () => {
    // A statute applies until amended. The salary figures expire on 31 December; these do not.
    for (const row of connector().normalize(FIXTURE)) {
      expect(row.effectiveTo).toBeNull();
    }
  });

  it('carries tier 1 and the deciding authority on every row', () => {
    for (const row of connector().normalize(FIXTURE)) {
      expect(row.sourceTier).toBe(1);
      expect(row.authority).toContain('Bundesamt für Justiz');
      expect(row.needsInput.length).toBeGreaterThan(0);
    }
  });

  it('is pure', () => {
    expect(connector().normalize(FIXTURE)).toEqual(connector().normalize(FIXTURE));
  });

  it('returns nothing rather than guessing when the page is unreadable', () => {
    expect(connector().normalize({ ...FIXTURE, html: '<html><body>nichts</body></html>' })).toEqual([]);
  });
});

describe('validate', () => {
  it('accepts the real statute, flagging only the missing archive', () => {
    const c = connector();
    const result = c.validate(c.normalize(FIXTURE));

    expect(isIngestible(result)).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain('no-archived-document');
  });

  it('rejects a page that yielded nothing, naming the likely cause', () => {
    const c = connector();
    const result = c.validate([]);

    expect(isIngestible(result)).toBe(false);
    expect(result.issues[0]?.message).toContain('ISO-8859-1');
  });

  it('rejects an implausible duration', () => {
    const c = connector();
    const [row] = c.normalize(FIXTURE);
    const broken = { ...row!, value: { months: 900 } };

    expect(isIngestible(c.validate([broken]))).toBe(false);
  });
});

describe('what this connector deliberately does not model', () => {
  it('emits no rule for § 19f rejection grounds or the Abs. 2 experience route', () => {
    // Both are real provisions this parser cannot read safely. A rule that looks authoritative and
    // is subtly wrong is worse than a missing one for immigration data, so the omission is
    // recorded in `domainDetail` and the README rather than filled in.
    const ids = connector().normalize(FIXTURE).map((r) => r.requirementId);

    expect(ids).not.toContain('de.eu-blue-card.rejection-grounds');
    expect(ids).not.toContain('de.eu-blue-card.experience-route');
  });
});
