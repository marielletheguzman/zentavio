/**
 * ADR-0034's compliance section, against a real database.
 *
 * **The postings come from the real Lever connector and its committed fixture**, not from hand-built
 * rows. The decisions being tested are about what a source can and cannot supply, and a fixture
 * invented here would supply whatever the test needed — including the employer identity whose
 * absence is the entire reason `dedup_basis` exists.
 */

import { LeverConnector, REGISTRATION, type BoardRaw } from '@zentavio/connector-lever';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerConnectorSource } from '../../../packages/db/src/repositories/learning.ts';
import {
  dedupKeyFor,
  expireBecauseNotFetched,
  expireMissing,
  livePostings,
  sourcesForPosting,
  upsertPostingFromSource,
} from '../../../packages/db/src/repositories/jobs.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../fixtures/connectors/lever/leverdemo.json', import.meta.url)), 'utf8'),
) as BoardRaw;

const BOARD = 'leverdemo';

let pool: Pool;
let db: Kysely<Database>;

function rows() {
  return new LeverConnector({ fetchBoard: async () => FIXTURE, configuredBoards: [BOARD] }).normalize(FIXTURE);
}

function observation(overrides: Partial<Parameters<typeof upsertPostingFromSource>[1]['observation']> = {}) {
  return {
    sourceTier: 2,
    sourceUrl: `https://api.lever.co/v0/postings/${BOARD}?mode=json`,
    retrievedAt: new Date('2026-08-22T00:00:00Z'),
    connectorVersion: '1.0.0',
    runId: uuidv7(),
    ...overrides,
  };
}

/** Store the board exactly as the connector normalized it. */
async function ingestBoard() {
  const stored = [];
  for (const row of rows()) {
    stored.push(
      await upsertPostingFromSource(db, {
        identity: { sourceId: row.sourceId, sourceScope: row.sourceScope, externalId: row.externalId },
        fields: {
          title: row.title,
          url: row.url,
          locationRaw: row.locationText,
          countryCode: row.countryCode,
          isRemote: row.isRemote,
          remoteScope: row.remoteScope,
          commitmentRaw: row.commitment,
          departmentRaw: row.department,
          teamRaw: row.team,
          salaryIsStated: row.salaryIsStated,
          postedAt: row.postedAt === null ? null : new Date(row.postedAt),
        },
        observation: observation(),
      }),
    );
  }
  return stored;
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM job_posting_sources');
  await pool.query('DELETE FROM job_postings');
  await pool.query('DELETE FROM connector_sources');

  await registerConnectorSource(db, {
    id: REGISTRATION.id,
    kind: REGISTRATION.kind,
    displayName: REGISTRATION.displayName,
    connectorVersion: '1.0.0',
    sourceTier: REGISTRATION.sourceTier,
    termsUrl: REGISTRATION.termsUrl,
    legalBasis: REGISTRATION.legalBasis,
    rateLimit: { requests: 60, windowMs: 60_000 },
    refreshWindow: REGISTRATION.refreshWindow,
    schedule: REGISTRATION.schedule,
  }).execute();
});

describe('identity', () => {
  it('stores one posting per source identity', async () => {
    const stored = await ingestBoard();

    expect(stored.map((result) => result.action)).toEqual(['inserted', 'inserted', 'inserted']);
    expect(await livePostings(db).execute()).toHaveLength(3);
  });

  it('treats re-ingesting the same identity as an update, not a duplicate', async () => {
    await ingestBoard();
    const again = await ingestBoard();

    expect(again.map((result) => result.action)).toEqual(['updated', 'updated', 'updated']);
    expect(await livePostings(db).execute()).toHaveLength(3);
  });

  it('keeps two postings apart when the same external id appears under different scopes', async () => {
    // The failure this prevents: a source numbering postings per employer, whose id 1 on one board
    // is a different job from id 1 on another. Merging them would look like deduplication working.
    const [first] = rows();
    const shared = { title: first!.title, url: first!.url, postedAt: new Date(first!.postedAt!) };

    const a = await upsertPostingFromSource(db, {
      identity: { sourceId: 'lever', sourceScope: 'board-a', externalId: 'shared-1' },
      fields: shared,
      observation: observation(),
    });
    const b = await upsertPostingFromSource(db, {
      identity: { sourceId: 'lever', sourceScope: 'board-b', externalId: 'shared-1' },
      fields: shared,
      observation: observation(),
    });

    expect(b.action).toBe('inserted');
    expect(b.jobPostingId).not.toBe(a.jobPostingId);
  });

  it('records the board as a namespace and never as an employer', async () => {
    const [stored] = await ingestBoard();
    const [source] = await sourcesForPosting(db, stored!.jobPostingId).execute();
    const posting = await db
      .selectFrom('job_postings')
      .select(['company_id', 'company_name_raw'])
      .where('id', '=', stored!.jobPostingId)
      .executeTakeFirstOrThrow();

    expect(source?.source_scope).toBe(BOARD);
    expect(posting.company_id).toBeNull();
    expect(posting.company_name_raw).toBeNull();
  });
});

describe('deduplication', () => {
  it('gives a posting with no employer a key that matches nothing, and says so', async () => {
    const stored = await ingestBoard();

    for (const result of stored) expect(result.dedupBasis).toBe('source-identity');
    expect(new Set(stored.map((result) => result.dedupKey)).size).toBe(3);
  });

  it('derives a matchable key only when an employer identity exists', () => {
    const identity = { sourceId: 'lever', sourceScope: BOARD, externalId: 'abc' };
    const fields = {
      title: 'Senior Backend Engineer',
      url: 'https://jobs.example.invalid/senior-backend',
      locationRaw: 'Berlin, Germany',
      postedAt: new Date('2026-08-01T00:00:00Z'),
    };

    const withoutEmployer = dedupKeyFor(identity, fields);
    const withEmployer = dedupKeyFor(identity, { ...fields, companyNameRaw: 'Testfirma GmbH' });
    // Same job, same employer, a different source and a differently-punctuated title.
    const elsewhere = dedupKeyFor(
      { sourceId: 'greenhouse', sourceScope: 'testfirma', externalId: '99' },
      { ...fields, title: 'Senior  Backend   Engineer!', companyNameRaw: 'testfirma gmbh' },
    );

    expect(withoutEmployer.basis).toBe('source-identity');
    expect(withEmployer.basis).toBe('employer-title-location');
    expect(elsewhere.key).toBe(withEmployer.key);
  });

  it('refuses to merge when a recomputed key would collide, and records the refusal', async () => {
    // Two postings that acquire an employer and become indistinguishable. Merging them is
    // destructive — matches and applications already point at both — so both rows stay.
    const employer = {
      companyNameRaw: 'Testfirma GmbH',
      title: 'Platform Engineer',
      url: 'https://jobs.example.invalid/platform-engineer',
      locationRaw: 'Berlin',
    };
    const first = { sourceId: 'lever', sourceScope: BOARD, externalId: 'collide-1' };
    const second = { sourceId: 'lever', sourceScope: BOARD, externalId: 'collide-2' };

    await upsertPostingFromSource(db, { identity: first, fields: { title: 'Platform Engineer', url: 'https://jobs.example.invalid/platform-engineer' }, observation: observation() });
    await upsertPostingFromSource(db, { identity: second, fields: { title: 'Platform Engineer', url: 'https://jobs.example.invalid/platform-engineer' }, observation: observation() });

    await upsertPostingFromSource(db, { identity: first, fields: employer, observation: observation() });
    const collided = await upsertPostingFromSource(db, { identity: second, fields: employer, observation: observation() });

    expect(collided.collisionRefused).toBe(true);
    expect(await livePostings(db).execute()).toHaveLength(2);

    const row = await db
      .selectFrom('job_postings')
      .select(['contested', 'flags', 'dedup_basis'])
      .where('id', '=', collided.jobPostingId)
      .executeTakeFirstOrThrow();

    expect(row.contested).toBe(true);
    expect(row.flags).toContain('dedup-collision-unmerged');
    // The key it keeps is the one it already had, so its basis stays what that key means.
    expect(row.dedup_basis).toBe('source-identity');
  });

  it('refuses two live postings under one key at the database level', async () => {
    const [stored] = await ingestBoard();
    const other = await db.selectFrom('job_postings').select(['id', 'dedup_key']).where('id', '!=', stored!.jobPostingId).executeTakeFirstOrThrow();

    await expect(
      db.updateTable('job_postings').set({ dedup_key: stored!.dedupKey }).where('id', '=', other.id).execute(),
    ).rejects.toThrow(/uq_job_postings__dedup/);
  });
});

describe('expiry', () => {
  const sweepIdentity = { sourceId: 'lever', sourceScope: BOARD };

  it('expires nothing when the listing was not exhaustive', async () => {
    await ingestBoard();

    const result = await expireMissing(db, {
      identity: sweepIdentity,
      seenExternalIds: [],
      listingIsExhaustive: false,
    });

    expect(result).toMatchObject({ expired: [], counted: 0, skipped: 'listing-not-exhaustive' });
    expect(await livePostings(db).execute()).toHaveLength(3);
  });

  it('does not count a non-exhaustive run towards a later expiry', async () => {
    // A count built from runs that were never evidence is not evidence either.
    await ingestBoard();
    const survivor = rows()[0]!.externalId;

    await expireMissing(db, { identity: sweepIdentity, seenExternalIds: [survivor], listingIsExhaustive: false });
    const [row] = await db.selectFrom('job_posting_sources').select('missed_runs').where('external_id', '=', rows()[1]!.externalId).execute();

    expect(row?.missed_runs).toBe(0);
  });

  it('needs more than one exhaustive run before it retires anything', async () => {
    await ingestBoard();
    const [kept, dropped] = rows();

    const first = await expireMissing(db, {
      identity: sweepIdentity,
      seenExternalIds: [kept!.externalId],
      listingIsExhaustive: true,
    });
    expect(first.expired).toEqual([]);
    expect(await livePostings(db).execute()).toHaveLength(3);

    const second = await expireMissing(db, {
      identity: sweepIdentity,
      seenExternalIds: [kept!.externalId],
      listingIsExhaustive: true,
    });
    expect(second.expired).toHaveLength(2);

    const gone = await db
      .selectFrom('job_postings as jp')
      .innerJoin('job_posting_sources as jps', 'jps.job_posting_id', 'jp.id')
      .select(['jp.expired_at', 'jp.expiry_reason'])
      .where('jps.external_id', '=', dropped!.externalId)
      .executeTakeFirstOrThrow();

    expect(gone.expiry_reason).toBe('source-delisted');
    expect(gone.expired_at).not.toBeNull();
  });

  it('forgets the missed runs when a posting comes back', async () => {
    await ingestBoard();
    const [kept] = rows();

    await expireMissing(db, { identity: sweepIdentity, seenExternalIds: [kept!.externalId], listingIsExhaustive: true });
    await ingestBoard();

    const counts = await db.selectFrom('job_posting_sources').select('missed_runs').execute();
    expect(counts.every((row) => row.missed_runs === 0)).toBe(true);
  });

  it('retains an expired posting rather than deleting it', async () => {
    await ingestBoard();
    await expireMissing(db, { identity: sweepIdentity, seenExternalIds: [], listingIsExhaustive: true });
    await expireMissing(db, { identity: sweepIdentity, seenExternalIds: [], listingIsExhaustive: true });

    expect(await livePostings(db).execute()).toHaveLength(0);
    const all = await db.selectFrom('job_postings').select('id').execute();
    expect(all).toHaveLength(3);
  });

  it('says when it was our failure rather than a delisting', async () => {
    // Our failure must never look like the source's statement — a person tracking the posting is
    // owed the difference.
    await ingestBoard();
    const expired = await expireBecauseNotFetched(db, sweepIdentity);

    expect(expired).toHaveLength(3);
    const reasons = await db.selectFrom('job_postings').select('expiry_reason').execute();
    expect(new Set(reasons.map((row) => row.expiry_reason))).toEqual(new Set(['source-not-fetched']));
  });
});

describe('what a source may state', () => {
  it('does not record silence about remote work as an on-site job', async () => {
    // Lever's `workplaceType: "unspecified"` is in the fixture. `false` here would read as on-site.
    await ingestBoard();
    const stated = await db.selectFrom('job_postings').select(['is_remote', 'remote_scope']).execute();

    expect(stated.every((row) => row.is_remote === null || row.is_remote === false)).toBe(true);
    expect(stated.every((row) => row.remote_scope === null)).toBe(true);
  });

  it('never stores a salary the source did not publish', async () => {
    await ingestBoard();
    const money = await db.selectFrom('job_postings').select(['salary_is_stated', 'salary_min', 'salary_max', 'currency']).execute();

    for (const row of money) {
      expect(row.salary_is_stated).toBe(false);
      expect(row.salary_min).toBeNull();
      expect(row.salary_max).toBeNull();
      expect(row.currency).toBeNull();
    }
  });

  it('refuses a stated salary carrying no amount', async () => {
    await expect(
      upsertPostingFromSource(db, {
        identity: { sourceId: 'lever', sourceScope: BOARD, externalId: 'invented-pay' },
        fields: { title: 'Engineer', url: 'https://jobs.example.invalid/e', salaryIsStated: true },
        observation: observation(),
      }),
    ).rejects.toThrow(/ck_job_postings__stated_salary_has_amount/);
  });

  it('refuses a remote scope on a posting nobody called remote', async () => {
    await expect(
      upsertPostingFromSource(db, {
        identity: { sourceId: 'lever', sourceScope: BOARD, externalId: 'invented-scope' },
        fields: { title: 'Engineer', url: 'https://jobs.example.invalid/e', isRemote: null, remoteScope: 'worldwide' },
        observation: observation(),
      }),
    ).rejects.toThrow(/ck_job_postings__scope_needs_remote/);
  });

  it('carries the location verbatim and takes the country from the field that stated it', async () => {
    await ingestBoard();
    const row = await db
      .selectFrom('job_postings')
      .select(['location_raw', 'country_code'])
      .where('location_raw', '=', 'Bombay, MH')
      .executeTakeFirstOrThrow();

    expect(row.country_code).toBe('IN');
  });
});

describe('tier and staleness', () => {
  it('writes tier-2 confidence for a job board, never high', async () => {
    const [stored] = await ingestBoard();
    const row = await db
      .selectFrom('job_postings')
      .select(['confidence', 'authority_tier'])
      .where('id', '=', stored!.jobPostingId)
      .executeTakeFirstOrThrow();

    expect(row).toMatchObject({ confidence: 'medium', authority_tier: 2 });
  });

  it('refuses an update from a worse tier and keeps the better source’s words', async () => {
    const identity = { sourceId: 'lever', sourceScope: BOARD, externalId: 'tiered' };
    await upsertPostingFromSource(db, {
      identity,
      fields: { title: 'Staff Engineer', url: 'https://jobs.example.invalid/staff' },
      observation: observation({ sourceTier: 1 }),
    });

    const worse = await upsertPostingFromSource(db, {
      identity,
      fields: { title: 'staff engineer (m/f/d)', url: 'https://jobs.example.invalid/staff' },
      observation: observation({ sourceTier: 3, retrievedAt: new Date('2026-08-23T00:00:00Z') }),
    });

    expect(worse.action).toBe('refused-lower-tier');
    const row = await db
      .selectFrom('job_postings')
      .select(['title', 'authority_tier', 'confidence', 'last_seen_at'])
      .where('id', '=', worse.jobPostingId)
      .executeTakeFirstOrThrow();

    expect(row.title).toBe('Staff Engineer');
    expect(row.authority_tier).toBe(1);
    expect(row.confidence).toBe('high');
    // It was still seen: refusing the words is not refusing the sighting.
    expect(new Date(row.last_seen_at).toISOString()).toBe('2026-08-23T00:00:00.000Z');
  });

  it('derives staleness from the writing source’s own refresh window', async () => {
    const [stored] = await ingestBoard();
    const row = await db
      .selectFrom('job_postings')
      .select(['stale_after', 'last_seen_at'])
      .where('id', '=', stored!.jobPostingId)
      .executeTakeFirstOrThrow();

    // Lever registers a one-day refresh window.
    const hours = (new Date(row.stale_after).getTime() - new Date(row.last_seen_at).getTime()) / 3_600_000;
    expect(hours).toBe(24);
  });
});
