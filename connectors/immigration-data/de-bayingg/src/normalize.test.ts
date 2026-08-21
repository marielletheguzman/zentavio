import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isIngestible } from '@zentavio/connectors-core';
import { describe, expect, it } from 'vitest';

import { ARTICLE_IDS, BayIngGConnector, type ArticleRaw, type BayIngGRaw } from './index.ts';
import { articleText, parseBayIngG, toPlainText } from './parse.ts';

/** Art. 2 and Art. 3 as gesetze-bayern.de served them, captured verbatim. */
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../tests/fixtures/connectors/de-bayingg/bayingg-art2-art3.json', import.meta.url),
    ),
    'utf8',
  ),
) as BayIngGRaw;

function connector(overrides: Partial<Record<string, ArticleRaw | null>> = {}) {
  return new BayIngGConnector({
    fetchDocument: async (id) => {
      if (id in overrides) return overrides[id] ?? null;
      if (id === ARTICLE_IDS.title) return FIXTURE.title;
      if (id === ARTICLE_IDS.foreignQualification) return FIXTURE.foreignQualification;
      return null;
    },
  });
}

describe('reading the page the portal actually serves', () => {
  it('finds the ECTS figure through the wording the statute uses', () => {
    // **The bug this test was written from.** Written against a summary, the pattern was
    // `mindestens 180 ECTS` — which appears nowhere. The statute says "bei Anwendung des
    // ECTS-Systems mindestens 180 Punkte", so the connector read nothing and reported no rule.
    // Silence, not an error.
    expect(toPlainText(FIXTURE.title.html)).toContain('ECTS-Systems mindestens 180 Punkte');

    const parsed = parseBayIngG(FIXTURE.title.html, FIXTURE.foreignQualification.html);
    expect(parsed.minimumEctsCredits).toBe(180);
  });

  it('reads the study duration the statute writes as a word', () => {
    const parsed = parseBayIngG(FIXTURE.title.html, FIXTURE.foreignQualification.html);
    expect(parsed.minimumSemesters).toBe(6);
  });

  it('accepts a digit too, in case an amendment writes one', () => {
    const amended = FIXTURE.title.html.replace('sechs Semestern', '8 Semestern');
    expect(parseBayIngG(amended, FIXTURE.foreignQualification.html).minimumSemesters).toBe(8);
  });

  it('returns null for a number word it does not know, rather than guessing', () => {
    const amended = FIXTURE.title.html.replace('sechs Semestern', 'zwölf Semestern');
    expect(parseBayIngG(amended, FIXTURE.foreignQualification.html).minimumSemesters).toBeNull();
  });

  it('keeps one article’s text out of another’s slice', () => {
    // The portal serves each article inside a shell that links the others by number. A pattern
    // scanning the whole document would read whatever the navigation happened to contain.
    const art2 = articleText(toPlainText(FIXTURE.title.html), 2);
    expect(art2).toContain('Regelstudienzeit');
    expect(art2).not.toContain('Studium bestätigen');
  });

  it('reads Art. 3 Abs. 4 — the sentence that makes this about a foreign qualification', () => {
    const parsed = parseBayIngG(FIXTURE.title.html, FIXTURE.foreignQualification.html);
    expect(parsed.thirdCountryEvidenceMustMatchArt2).toBe(true);
  });
});

describe('the rows this produces', () => {
  const rows = new BayIngGConnector({ fetchDocument: async () => null }).normalize(FIXTURE);
  const byId = new Map(rows.map((row) => [row.requirementId, row]));

  it('produces recognition rows carrying a profession and no pathway', () => {
    // `ck_req__scope`: a recognition row is scoped by profession. It is also why retrieval had to
    // learn to gather by profession — no pathway-scoped query returns one (ADR-0029).
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.domain).toBe('recognition');
      expect(row.pathwayId).toBeNull();
      expect(row.profession).toBe('ingenieur-protected-title');
      expect(row.subdivision).toBe('BY');
    }
  });

  it('scopes every row to the origin it was written for', () => {
    // Art. 3 Abs. 4 is about evidence from outside the EU/EEA. An unscoped row would state these
    // conditions of every applicant, including the ones the article does not reach.
    for (const row of rows) {
      expect(row.appliesTo).toMatchObject({ origin_jurisdiction: ['PH'] });
    }
  });

  it('states the numbers in the shape the evaluator can compare', () => {
    // `{ semesters: 6 }` parses, stores, and then evaluates undetermined forever — a rule on file
    // that can never be satisfied. `{ amount, unit }` is what `numeric-gte` reads.
    expect(byId.get('de.ingenieur-title.by.study-duration.ph')?.value).toEqual({
      amount: 6,
      unit: 'semesters',
    });
    expect(byId.get('de.ingenieur-title.by.ects-credits.ph')?.value).toEqual({
      amount: 180,
      unit: 'ects',
    });
  });

  it('says that what is gated is the title and not the work', () => {
    // A surface rendering this as "you cannot work in Germany" would be false about a person's
    // life: engineering work is not regulated, the professional title is.
    for (const row of rows) {
      expect(row.domainDetail).toMatchObject({ gatesTitleNotActivity: true });
    }
  });

  it('carries the permission itself as a document nobody here can decide', () => {
    const permission = byId.get('de.ingenieur-title.by.permission.ph');
    expect(permission?.evaluation).toBe('document-present');
    // Deliberately undecidable: only the authority knows whether it was granted, and asserting it
    // either way would be inventing a verdict.
    expect(permission?.needsInput).toEqual([]);
  });

  it('writes no numeric rule when Art. 3 does not say it reaches a foreign qualification', () => {
    // Without Abs. 4, Art. 2's numbers describe a German degree and say nothing about anyone
    // trained abroad. Stating them anyway would invent a hurdle.
    const withoutAbs4 = {
      ...FIXTURE,
      foreignQualification: {
        ...FIXTURE.foreignQualification,
        html: FIXTURE.foreignQualification.html.replace(/Studium best[äa]tigen/g, 'entfällt'),
      },
    };

    const reduced = new BayIngGConnector({ fetchDocument: async () => null }).normalize(withoutAbs4);
    expect(reduced.map((row) => row.requirementId)).toEqual([
      'de.ingenieur-title.by.permission.ph',
    ]);
  });

  it('passes validation and is ingestible', () => {
    const result = new BayIngGConnector({ fetchDocument: async () => null }).validate(rows);
    expect(isIngestible(result)).toBe(true);
  });

  it('refuses a row that lost its origin scope', () => {
    const unscoped = rows.map((row) => ({ ...row, appliesTo: {} }));
    const result = new BayIngGConnector({ fetchDocument: async () => null }).validate(unscoped);

    // The scope key has no CHECK behind it (ADR-0029), so a typo is caught here or nowhere.
    expect(isIngestible(result)).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'missing-origin-scope')).toBe(true);
  });
});

describe('fetching both articles or neither', () => {
  it('returns one payload holding both', async () => {
    const raw = await connector().fetch(ARTICLE_IDS.title);
    expect(raw?.title.documentId).toBe('BayIngG2016-2');
    expect(raw?.foreignQualification.documentId).toBe('BayIngG2016-3');
  });

  it('returns null when the companion article is gone', async () => {
    // Half the law is not a partial answer: without Art. 3 nothing here applies to a foreign
    // qualification, and writing the numeric rules anyway would state them of everybody.
    const raw = await connector({ [ARTICLE_IDS.foreignQualification]: null }).fetch(
      ARTICLE_IDS.title,
    );
    expect(raw).toBeNull();
  });

  it('archives both instruments, both as primary', async () => {
    // ADR-0025: a row citing only Art. 2 would pass the archival check while being unreadable as
    // the rule it actually is.
    const raw = await connector().fetch(ARTICLE_IDS.title);
    const sources = connector().archivableSources(raw as BayIngGRaw);

    expect(sources.map((source) => source.instrumentId)).toEqual([
      'BayIngG2016-2',
      'BayIngG2016-3',
    ]);
    expect(sources.every((source) => source.role === 'primary')).toBe(true);
    expect(sources.every((source) => source.source.isOriginal)).toBe(true);
  });

  it('reports degraded when the page fetches but its text cannot be found', async () => {
    const hollow: ArticleRaw = { ...FIXTURE.title, html: '<html><body>Wartung</body></html>' };
    const status = await connector({ [ARTICLE_IDS.title]: hollow }).healthCheck();

    expect(status.state).toBe('degraded');
  });
});
