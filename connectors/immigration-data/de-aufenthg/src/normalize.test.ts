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
  it('produces every provision that is literal on this page', () => {
    const rows = connector().normalize(FIXTURE);

    expect(rows.map((r) => r.requirementId).sort()).toEqual([
      'de.eu-blue-card.employment-duration',
      'de.eu-blue-card.experience-route-occupations',
      'de.eu-blue-card.professional-experience',
      'de.eu-blue-card.qualification',
      'de.eu-blue-card.qualification.abs1-s2',
      'de.eu-blue-card.recent-graduate',
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

  it('models the no-degree route rather than merely naming it', () => {
    // The qualification row used to carry `alternativeRouteNotModelled` so it would not read as
    // "no degree means no Blue Card". § 18g Abs. 2 is now a route of its own, so the label is
    // gone and the thing it apologised for is built.
    const rows = connector().normalize(FIXTURE);
    const experience = rows.find((r) => r.requirementId === 'de.eu-blue-card.professional-experience');
    const gate = rows.find((r) => r.requirementId === 'de.eu-blue-card.experience-route-occupations');

    for (const row of rows) {
      expect(row.domainDetail).not.toHaveProperty('alternativeRouteNotModelled');
    }

    expect((experience?.appliesTo as { route?: string }).route).toBe('abs2');
    expect(experience?.value).toEqual({ amount: 3, unit: 'years' });
    expect(experience?.domainDetail).toMatchObject({ acquiredWithinYears: 7 });

    // Abs. 2 admits **two** groups, not Abs. 1 S. 2's ten. Reading the wrong sentence here would
    // open the no-degree route to eight groups the statute never put on it.
    expect(gate?.value).toEqual(['133', '25']);
  });

  it('requires a degree on the Abs. 1 routes and not on Abs. 2', () => {
    // The condition is stated once per route it governs. Pathway-wide would demand a degree of
    // exactly the population Abs. 2 exists to admit without one.
    const routesRequiringDegree = connector()
      .normalize(FIXTURE)
      .filter((r) => r.needsInput.includes('has_recognised_academic_degree'))
      .map((r) => (r.appliesTo as { route?: string }).route)
      .sort();

    expect(routesRequiringDegree).toEqual(['abs1-s1', 'abs1-s2']);
  });

  it('gives the reduced route a second, independent gate', () => {
    // § 18g Abs. 1 S. 2 reads "Nr. 1 oder Nr. 2". A recent graduate outside the listed groups
    // reaches the same threshold, and requiring both gates would deny them.
    const row = connector()
      .normalize(FIXTURE)
      .find((r) => r.requirementId === 'de.eu-blue-card.recent-graduate');

    expect(row?.kind).toBe('right');
    expect(row?.evaluation).toBe('numeric-lte');
    expect(row?.value).toEqual({ amount: 3, unit: 'years' });
    expect((row?.appliesTo as { route?: string }).route).toBe('abs1-s2');
  });

  it('records that the reduced routes need labour-market consent, without blocking on it', () => {
    // § 18g Abs. 1 S. 1 grants the Blue Card *ohne* Zustimmung der Bundesagentur für Arbeit; the
    // S. 2 and Abs. 2 routes need it. It is recorded rather than made a rule on purpose — nobody
    // can answer it in advance, so a rule would leave those routes permanently undetermined.
    const consentOf = (id: string) =>
      connector()
        .normalize(FIXTURE)
        .find((r) => r.requirementId === id)?.domainDetail['requiresLabourMarketConsent'];

    expect(consentOf('de.eu-blue-card.recent-graduate')).toBe(true);
    expect(consentOf('de.eu-blue-card.experience-route-occupations')).toBe(true);
    expect(consentOf('de.eu-blue-card.qualification')).toBeUndefined();
  });

  it('widens the qualification question to the equivalent tertiary programme', () => {
    // § 18g Abs. 1 S. 5. Not its own rule — it changes what the existing question means, and a
    // narrower question excludes people the statute admits.
    const row = connector()
      .normalize(FIXTURE)
      .find((r) => r.requirementId === 'de.eu-blue-card.qualification');

    expect(row?.domainDetail['equivalentQualificationAccepted']).toEqual(
      expect.stringContaining('ISCED 2011'),
    );
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
  it('accepts the real statute with no issues at all', () => {
    // Archival is not checked here. A connector never archives — it returns data — so it cannot
    // report whether a document was stored. That belongs to `services/ingestion` (ADR-0021).
    const c = connector();
    const result = c.validate(c.normalize(FIXTURE));

    expect(isIngestible(result)).toBe(true);
    expect(result.issues).toEqual([]);
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
    const broken = { ...row!, value: { amount: 900, unit: 'months' } };

    expect(isIngestible(c.validate([broken]))).toBe(false);
  });
});

describe('routes (ADR-0024)', () => {
  const byId = (id: string) => connector().normalize(FIXTURE).find((r) => r.requirementId === id);

  it('scopes the occupation list to the reduced route and nothing else', () => {
    // It is the gate that opens `abs1-s2`. Scoped anywhere else it would either do nothing or —
    // worse — hand the reduced threshold to occupations the statute never listed.
    expect(byId('de.eu-blue-card.reduced-threshold-occupations')?.appliesTo).toEqual({
      route: 'abs1-s2',
    });
  });

  it('leaves the six-month duration pathway-wide', () => {
    // § 18g Abs. 3 governs every way in. A route here would silently exempt the other routes.
    expect(byId('de.eu-blue-card.employment-duration')?.appliesTo).toEqual({});
  });

  it('states the duration in the shape the evaluator can compare', () => {
    // `{ months: 6 }` parsed, stored, and then evaluated `undetermined` forever, because the
    // evaluator reads `value.amount`. A rule that is on file and can never be satisfied is the
    // quietest failure available.
    expect(byId('de.eu-blue-card.employment-duration')?.value).toEqual({
      amount: 6,
      unit: 'months',
    });
  });

  it('never writes a legal citation where a route id belongs', () => {
    // A route id is a join key; a citation is display text that may be reworded at any time.
    // Anything with a space or a section symbol is the citation leaking into the key.
    for (const row of connector().normalize(FIXTURE)) {
      const route = (row.appliesTo as { route?: unknown }).route;
      if (route === undefined) continue;

      expect(typeof route).toBe('string');
      expect(route as string).not.toMatch(/[\s§]/);
      expect(route).not.toBe(row.domainDetail['legalBasis']);
    }
  });
});

describe('what this connector deliberately does not model', () => {
  it('emits no rule for § 19f rejection grounds', () => {
    // A real provision this parser cannot read safely — its substance is on another page. A rule
    // that looks authoritative and is subtly wrong is worse than a missing one for immigration
    // data, so the omission is recorded in the README rather than filled in.
    const ids = connector().normalize(FIXTURE).map((r) => r.requirementId);

    expect(ids).not.toContain('de.eu-blue-card.rejection-grounds');
  });

  it('makes no rule of the Bundesagentur’s consent, only a note', () => {
    // Nobody can answer it in advance. As a rule it would leave the S. 2 and Abs. 2 routes
    // permanently `undetermined`, which reads as "we cannot tell you" for a route that is open.
    const ids = connector().normalize(FIXTURE).map((r) => r.requirementId);

    expect(ids).not.toContain('de.eu-blue-card.labour-market-consent');
    expect(
      connector()
        .normalize(FIXTURE)
        .some((r) => r.needsInput.includes('labour_market_consent')),
    ).toBe(false);
  });
});
