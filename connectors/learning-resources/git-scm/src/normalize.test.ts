import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isIngestible } from '@zentavio/connectors-core';
import { describe, expect, it } from 'vitest';

import { GitScmConnector, KNOWN_PAGES, purposeOf, type DocPageRaw } from './index.ts';
import { parseDocPage } from './parse.ts';

/** `git-scm.com/docs/git-stash` as served, captured verbatim. */
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../tests/fixtures/connectors/git-scm/git-stash.json', import.meta.url)),
    'utf8',
  ),
) as DocPageRaw;

function connector(page: DocPageRaw | null = FIXTURE) {
  return new GitScmConnector({ fetchPage: async () => page });
}

describe('reading the page', () => {
  it('takes the command from the site’s own title', () => {
    expect(parseDocPage(FIXTURE.html).title).toBe('git-stash');
  });

  it('returns null when the page is not one of the site’s doc pages', () => {
    // Anchored on the site's own `Git - … Documentation` format, so a page that is something else —
    // a redirect, an error page, a rebranded layout — yields nothing rather than a plausible title.
    // A resource with a fabricated title sends somebody to a page that is not what we said it was.
    expect(parseDocPage('<html><title>Something else</title></html>').title).toBeNull();
    expect(parseDocPage('<html><body>no title at all</body></html>').title).toBeNull();
  });

  it('reads a doc page whose command it has never heard of', () => {
    // Parsing is not curation: the parser reads whatever the site titles, and the closed page list
    // is what decides whether a row is written.
    expect(parseDocPage('<title>Git - git-bisect Documentation</title>').title).toBe('git-bisect');
  });
});

describe('the rows this produces', () => {
  const rows = connector().normalize(FIXTURE);

  it('produces one free documentation row for the Git skill', () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'git-scm.com',
      externalId: 'git-stash',
      title: 'git-stash',
      format: 'documentation',
      costBand: 'free',
      skillSlug: 'git',
      coverage: 'primary',
      sourceTier: 1,
    });
  });

  it('never claims a documentation page grants evidence', () => {
    // Reading a manual page is not a demonstration of anything (ADR-0030), and a row saying
    // otherwise would put the deferred certification question back on the table by accident.
    expect(rows[0]?.grantsEvidence).toBe(false);

    const lying = rows.map((row) => ({ ...row, grantsEvidence: true as unknown as false }));
    expect(isIngestible(connector().validate(lying))).toBe(false);
  });

  it('assigns no difficulty level', () => {
    // Reference documentation is not graded, and assigning one would be our opinion wearing the
    // provider's clothes.
    expect(rows[0]?.level).toBeNull();
  });

  it('produces no row for a page nobody wrote a purpose for', () => {
    // The catalogue is a set somebody chose. A page with no stated reason to open it is a crawl
    // result, not a learning resource.
    const stray: DocPageRaw = { ...FIXTURE, documentId: 'git-bisect' };
    expect(connector().normalize(stray)).toEqual([]);
  });

  it('refuses a row pointing off-site', () => {
    const offSite = rows.map((row) => ({ ...row, url: 'https://example.invalid/git-stash' }));
    expect(isIngestible(connector().validate(offSite))).toBe(false);
  });

  it('passes validation as authored', () => {
    expect(isIngestible(connector().validate(rows))).toBe(true);
  });
});

describe('the catalogue it offers', () => {
  it('is a closed list, not a crawl', () => {
    // Crawling a documentation site produces a catalogue nobody chose: every page equally weighted,
    // most irrelevant to any skill we model.
    expect(KNOWN_PAGES).toHaveLength(10);
    for (const page of KNOWN_PAGES) {
      expect(purposeOf(page), page).toBeDefined();
    }
  });

  it('fetches nothing outside that list', async () => {
    expect(await connector().fetch('git-bisect')).toBeNull();
  });

  it('records why we are permitted to read the source', () => {
    // "We checked" is not a record.
    const meta = connector().meta;
    expect(meta.legalBasis).toContain('robots.txt');
    expect(meta.sourceTier).toBe(1);
  });

  it('reports degraded when a page fetches but cannot be read', async () => {
    const hollow: DocPageRaw = { ...FIXTURE, html: '<html><body>Maintenance</body></html>' };
    expect((await connector(hollow).healthCheck()).state).toBe('degraded');
  });
});
