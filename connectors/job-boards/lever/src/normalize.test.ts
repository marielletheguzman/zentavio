import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isIngestible } from '@zentavio/connectors-core';
import { describe, expect, it } from 'vitest';

import { LeverConnector, type BoardRaw, type JobPostingRecord } from './index.ts';
import { toPosting, type LeverPosting } from './parse.ts';

/** `api.lever.co/v0/postings/leverdemo?mode=json` as served on 2026-08-22, first three postings. */
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../tests/fixtures/connectors/lever/leverdemo.json', import.meta.url)),
    'utf8',
  ),
) as BoardRaw;

const CONTEXT = { board: 'leverdemo', fetchedAt: '2026-08-22T00:00:00Z', sourceId: 'lever' };

/**
 * A fresh connector per test. The limiter spaces requests a second apart, so a shared instance
 * would make one test's fetch pay for another's — and that spacing is the behaviour under test
 * elsewhere, not something to work around here.
 */
function connector(board: BoardRaw | null = FIXTURE, boards: readonly string[] = ['leverdemo']) {
  return new LeverConnector({ fetchBoard: async () => board, configuredBoards: boards });
}

/**
 * A posting with a field genuinely absent, rather than present and `undefined`. That is the shape
 * the API actually serves for a field it omits, and the repository's `exactOptionalPropertyTypes`
 * is what keeps the two from being confused here.
 */
function without(posting: LeverPosting, ...keys: readonly (keyof LeverPosting)[]): LeverPosting {
  const copy: Record<string, unknown> = { ...posting };
  for (const key of keys) delete copy[key];
  return copy as LeverPosting;
}

describe('the rows this produces', () => {
  const rows = connector().normalize(FIXTURE);

  it('produces one row per published posting', () => {
    expect(rows).toHaveLength(3);
  });

  it('carries the posting as the source states it', () => {
    expect(rows[0]).toEqual({
      sourceId: 'lever',
      // The board is the namespace the posting id belongs to, and nothing more.
      sourceScope: 'leverdemo',
      externalId: '33538a2f-d27d-4a96-8f05-fa4b0e4d940e',
      title: 'AbelsonTaylor Writer',
      url: 'https://jobs.lever.co/leverdemo/33538a2f-d27d-4a96-8f05-fa4b0e4d940e',
      companyNameRaw: null,
      // The prose itself is asserted by its own tests below rather than pasted here: a golden object
      // holding four paragraphs stops being readable as a contract.
      description: rows[0]?.description ?? null,
      requirementsText: rows[0]?.requirementsText ?? null,
      countryCode: 'US',
      locationText: 'Arlington, TX',
      isRemote: false,
      remoteScope: null,
      department: 'Customer Success',
      team: 'Professional Services',
      commitment: 'Regular Full Time (Salary)',
      salaryIsStated: false,
      salaryMin: null,
      salaryMax: null,
      currency: null,
      salaryPeriod: null,
      // `createdAt` is epoch milliseconds, read as UTC. Anything local-time here would pass in one
      // timezone and fail in another — the bug class CI structurally cannot catch.
      postedAt: '2019-03-21T16:33:55.299Z',
      sourceTier: 2,
      sourceUrl: 'https://api.lever.co/v0/postings/leverdemo?mode=json',
      retrievedAt: '2026-08-22T00:00:00Z',
    } satisfies JobPostingRecord);
  });

  it('never states a salary', () => {
    // Lever publishes no structured pay. A number parsed out of the description would be a guess
    // with a currency attached, and every score derived from it would inherit the guess.
    for (const row of rows) expect(row.salaryIsStated).toBe(false);
  });

  it('never states a remote scope', () => {
    // `workplaceType` says whether a role is remote; nothing says whether that means worldwide, a
    // country or a region — the most consequential thing to be wrong about for somebody choosing
    // where to live.
    for (const row of rows) expect(row.remoteScope).toBeNull();
  });

  it('takes the country from the field that states it, never from the location text', () => {
    // "Bombay, MH" is free text the source also answers properly, in `country`.
    expect(rows[2]).toMatchObject({ countryCode: 'IN', locationText: 'Bombay, MH' });

    const unstated = toPosting({ ...FIXTURE.postings[2]!, country: null }, CONTEXT);
    expect(unstated).toMatchObject({ countryCode: null, locationText: 'Bombay, MH' });
  });

  it('leaves a field the source omits null rather than defaulting it', () => {
    // The third posting states no commitment.
    expect(rows[2]?.commitment).toBeNull();
  });

  it('keeps the posting’s own prose, and its requirement lists apart from it', () => {
    // Stored so extraction has an input later, and never read for facts (ADR-0033). Two fields, not
    // one: merging them would lose which sentences were requirements and which were company prose.
    expect(rows[0]?.description).toContain('Demo Job Listing');
    expect(rows[0]?.requirementsText).toContain('Qualifications:');
    expect(rows[0]?.requirementsText).toContain('- be very smart');
    // The requirements are not buried inside the prose, which is what makes them separable later.
    expect(rows[0]?.description).not.toContain('be very smart');
  });

  it('flattens list markup mechanically, keeping the text and dropping the tags', () => {
    // `<b>bold text</b>` is a formatting choice, not a fact. The words survive; the markup does not,
    // and nothing is summarised or reordered on the way through.
    expect(rows[0]?.requirementsText).toContain('- bold text');
    expect(rows[0]?.requirementsText).not.toContain('<');
  });

  it('states no requirements rather than an empty string when the source lists none', () => {
    // "Said nothing" and "we stored nothing" must not look alike.
    expect(toPosting(without(FIXTURE.postings[0]!, 'lists'), CONTEXT)?.requirementsText).toBeNull();
  });

  it('calls a role remote only when the source does', () => {
    // `hybrid` and `unspecified` are both in the fixture, and neither is remote.
    expect(rows.map((row) => row.isRemote)).toEqual([false, false, false]);
    expect(toPosting({ ...FIXTURE.postings[0]!, workplaceType: 'remote' }, CONTEXT)?.isRemote).toBe(true);
  });
});

describe('postings it refuses to write a row for', () => {
  const first = FIXTURE.postings[0]!;

  it('drops a posting nobody could apply for', () => {
    // A job we cannot link to is a job somebody cannot act on, and listing it would waste the one
    // thing this feature is supposed to save them.
    const unlinkable = without(first, 'hostedUrl', 'applyUrl');
    expect(toPosting(unlinkable, CONTEXT)).toBeNull();
  });

  it('falls back to the application form when the posting page is absent', () => {
    expect(toPosting(without(first, 'hostedUrl'), CONTEXT)?.url).toBe(
      'https://jobs.lever.co/leverdemo/33538a2f-d27d-4a96-8f05-fa4b0e4d940e/apply',
    );
  });

  it('drops a posting with no id or no title', () => {
    expect(toPosting(without(first, 'id'), CONTEXT)).toBeNull();
    expect(toPosting({ ...first, id: '' }, CONTEXT)).toBeNull();
    expect(toPosting({ ...first, text: '   ' }, CONTEXT)).toBeNull();
  });

  it('states no posting date rather than an invented one', () => {
    expect(toPosting(without(first, 'createdAt'), CONTEXT)?.postedAt).toBeNull();
  });

  it('keeps one broken posting from taking the rest of the board with it', () => {
    const board: BoardRaw = { ...FIXTURE, postings: [without(first, 'id'), ...FIXTURE.postings] };
    expect(connector(board).normalize(board)).toHaveLength(3);
  });
});

describe('validation', () => {
  const rows = connector().normalize(FIXTURE);

  it('accepts the board as served', () => {
    expect(isIngestible(connector().validate(rows))).toBe(true);
  });

  it('refuses a stated salary', () => {
    // The guard against the failure this connector is most likely to grow: somebody adding a
    // description parser and calling the result a salary.
    const invented = rows.map((row) => ({ ...row, salaryIsStated: true as unknown as false }));
    const result = connector().validate(invented);
    expect(isIngestible(result)).toBe(false);
    expect(result.issues[0]?.code).toBe('salary-invented');
  });

  it('refuses a remote scope', () => {
    const invented = rows.map((row) => ({ ...row, remoteScope: 'worldwide' as unknown as null }));
    const result = connector().validate(invented);
    expect(isIngestible(result)).toBe(false);
    expect(result.issues[0]?.code).toBe('remote-scope-invented');
  });

  it('refuses the same posting twice', () => {
    // A posting id identifies one posting; two rows under it would double-count one job. It is the
    // source identity, not a deduplication key — that is persistence’s (ADR-0034).
    const result = connector().validate([rows[0]!, rows[0]!]);
    expect(isIngestible(result)).toBe(false);
    expect(result.issues[0]?.code).toBe('duplicate-external-id');
  });

  it('refuses a row nobody could act on', () => {
    const result = connector().validate([{ ...rows[0]!, url: 'javascript:void 0' }]);
    expect(isIngestible(result)).toBe(false);
    expect(result.issues[0]?.code).toBe('unusable-url');
  });
});

describe('what it will read', () => {
  it('reads only boards somebody configured', async () => {
    // Nothing here discovers boards, guesses organisation slugs, or enumerates Lever's customers.
    expect(await connector().fetch('some-other-company')).toBeNull();
  });

  it('honours the caller’s limit', async () => {
    const page = await connector(FIXTURE, ['leverdemo', 'another']).search({ limit: 1 });
    expect(page.items).toHaveLength(1);
  });

  it('returns no board rather than an invented empty one when a board is gone', async () => {
    const page = await connector(null).search({});
    expect(page.items).toEqual([]);
  });

  it('records why we are permitted to read the source', () => {
    // "We checked" is not a record.
    const meta = connector(null).meta;
    expect(meta.legalBasis).toContain('robots.txt');
    expect(meta.legalBasis).toContain('published');
    expect(meta.sourceTier).toBe(2);
  });
});

describe('health', () => {
  it('is healthy when a configured board answers with nothing open', async () => {
    // A company with nothing open is a real state. Treating it as a fault would make every quiet
    // employer look like a broken integration.
    const empty: BoardRaw = { ...FIXTURE, postings: [] };
    expect((await connector(empty).healthCheck()).state).toBe('healthy');
  });

  it('is degraded when no board is configured', async () => {
    expect((await connector(FIXTURE, []).healthCheck()).state).toBe('degraded');
  });

  it('is degraded when the configured board is no longer served', async () => {
    expect((await connector(null).healthCheck()).state).toBe('degraded');
  });

  it('is unreachable when the source throws, and says what it said', async () => {
    const broken = new LeverConnector({
      fetchBoard: async () => {
        throw new Error('ECONNRESET');
      },
      configuredBoards: ['leverdemo'],
    });
    expect(await broken.healthCheck()).toMatchObject({ state: 'unreachable', detail: 'ECONNRESET' });
  });
});

describe('what it archives', () => {
  it('archives the postings as served, as the original', () => {
    const archived = connector().archivable(FIXTURE);
    expect(archived.isOriginal).toBe(true);
    expect(archived.slug).toBe('lever-leverdemo');
    expect(archived.year).toBe(2026);
    expect(JSON.parse(new TextDecoder().decode(archived.bytes))).toEqual(FIXTURE.postings);
  });
});
