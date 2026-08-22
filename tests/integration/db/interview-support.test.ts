/**
 * Support floors, against a real database (ADR-0031).
 *
 * **The assertions that matter are the ones about silence.** Below the floor nothing is described,
 * and a stage nobody else mentions never appears — because the failure this milestone is written
 * against is not a crash, it is a plausible sentence about a company's process that four people's
 * preparation time is then spent on.
 *
 * The counts here are fixtures rather than the constants the code imports, so a floor changed in the
 * repository fails these tests instead of quietly moving them with it.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { eraseUser } from '../../../packages/db/src/repositories/erasure.ts';
import {
  InterviewReportInvariantError,
  processForPairing,
  recordInterviewReport,
} from '../../../packages/db/src/repositories/interview-reports.ts';
import type { Database, InterviewStageKindColumn } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let companyId: string;

const AS_OF = '2026-08-22';
const ROLE_FAMILY = 'software-it';

/** The stages most reports agree on: a screen, then coding, then system design. */
const TYPICAL: readonly { position: number; kind: InterviewStageKindColumn }[] = [
  { position: 1, kind: 'recruiter-screen' },
  { position: 2, kind: 'coding' },
  { position: 3, kind: 'system-design' },
];

async function newUser(): Promise<string> {
  const id = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1,$2,'password')`, [
    id,
    `reporter-${id.slice(-10)}@example.invalid`,
  ]);
  return id;
}

/** One report from a fresh person, so the per-person unique index is never the thing under test. */
async function report(
  options: {
    readonly stages?: readonly { position: number; kind: InterviewStageKindColumn }[];
    readonly interviewedOn?: string;
    readonly roleFamily?: string;
  } = {},
): Promise<string> {
  const userId = await newUser();
  await recordInterviewReport(db, {
    userId,
    companyId,
    roleFamily: options.roleFamily ?? ROLE_FAMILY,
    interviewedOn: options.interviewedOn ?? '2026-06-01',
    stages: options.stages ?? TYPICAL,
    newId: uuidv7,
    now: () => new Date(AS_OF),
  });
  return userId;
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM interview_report_stages');
  await pool.query('DELETE FROM interview_reports');
  await pool.query('DELETE FROM companies');
  await pool.query('DELETE FROM users');

  companyId = uuidv7();
  await pool.query(
    `INSERT INTO companies (id, slug, canonical_name, status, source_tier)
     VALUES ($1,'acme','Acme','active',3)`,
    [companyId],
  );
});

describe('below the floor, nothing is described', () => {
  it('says how many reports there are and how many are still needed', async () => {
    // "3 reports, we need 5" invites somebody to contribute one. "Not enough" is a dead end.
    for (let i = 0; i < 3; i += 1) await report();

    const support = await processForPairing(db, { companyId, roleFamily: ROLE_FAMILY, asOf: AS_OF });

    expect(support).toMatchObject({ kind: 'below-support', reportCount: 3, needed: 2 });
  });

  it('describes nothing at four reports, however consistent they are', async () => {
    // Four identical reports are still four. The floor is not a formality that consistency waives.
    for (let i = 0; i < 4; i += 1) await report();

    expect((await processForPairing(db, { companyId, roleFamily: ROLE_FAMILY, asOf: AS_OF })).kind).toBe(
      'below-support',
    );
  });

  it('counts per pairing, not per company', async () => {
    // Fifteen reports about a company's sales interviews say nothing about its backend process.
    for (let i = 0; i < 6; i += 1) await report({ roleFamily: 'sales' });

    const software = await processForPairing(db, { companyId, roleFamily: ROLE_FAMILY, asOf: AS_OF });
    const sales = await processForPairing(db, { companyId, roleFamily: 'sales', asOf: AS_OF });

    expect(software).toMatchObject({ kind: 'below-support', reportCount: 0 });
    expect(sales.kind).toBe('described');
  });

  it('does not count reports older than the window', async () => {
    // A process from four years ago is a different company's process.
    for (let i = 0; i < 5; i += 1) await report({ interviewedOn: '2022-01-01' });

    expect((await processForPairing(db, { companyId, roleFamily: ROLE_FAMILY, asOf: AS_OF })).kind).toBe(
      'below-support',
    );
  });
});

describe('above the floor', () => {
  it('describes the process, counted and dated', async () => {
    for (let i = 0; i < 5; i += 1) await report();

    const support = await processForPairing(db, { companyId, roleFamily: ROLE_FAMILY, asOf: AS_OF });

    expect(support).toMatchObject({ kind: 'described', reportCount: 5, windowMonths: 18 });
    if (support.kind !== 'described') return;
    expect(support.stages.map((stage) => stage.kind)).toEqual([
      'recruiter-screen',
      'coding',
      'system-design',
    ]);
  });

  it('hides a stage only one report mentions', async () => {
    // **The fabricated-specificity case.** One person met a take-home; describing it as part of the
    // company's process sends everybody else to prepare for one.
    for (let i = 0; i < 5; i += 1) await report();
    await report({ stages: [...TYPICAL, { position: 4, kind: 'take-home' }] });

    const support = await processForPairing(db, { companyId, roleFamily: ROLE_FAMILY, asOf: AS_OF });
    if (support.kind !== 'described') throw new Error('expected a described process');

    expect(support.stages.map((stage) => stage.kind)).not.toContain('take-home');
  });

  it('shows a stage once enough reports mention it', async () => {
    for (let i = 0; i < 5; i += 1) await report();
    for (let i = 0; i < 3; i += 1) {
      await report({ stages: [...TYPICAL, { position: 4, kind: 'take-home' }] });
    }

    const support = await processForPairing(db, { companyId, roleFamily: ROLE_FAMILY, asOf: AS_OF });
    if (support.kind !== 'described') throw new Error('expected a described process');

    const takeHome = support.stages.find((stage) => stage.kind === 'take-home');
    expect(takeHome).toMatchObject({ reportCount: 3, typicalPosition: 4 });
  });

  it('never reports high confidence, at any count', async () => {
    // Tier 4 has a ceiling consistency does not raise. Fifty agreeing reports are still fifty
    // strangers' recollections.
    for (let i = 0; i < 20; i += 1) await report();

    const support = await processForPairing(db, { companyId, roleFamily: ROLE_FAMILY, asOf: AS_OF });
    if (support.kind !== 'described') throw new Error('expected a described process');

    expect(support.confidence).toBe('medium');
    expect(support.confidence).not.toBe('high');
  });

  it('carries the count beside every stage it describes', async () => {
    // A pattern without its n is a claim about a company. With it, it is an aggregate.
    for (let i = 0; i < 5; i += 1) await report();

    const support = await processForPairing(db, { companyId, roleFamily: ROLE_FAMILY, asOf: AS_OF });
    if (support.kind !== 'described') throw new Error('expected a described process');

    for (const stage of support.stages) {
      expect(stage.reportCount).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('what a report may be', () => {
  it('refuses one with no stages', async () => {
    // It would count toward support while describing nothing — the cheapest way over a floor.
    const userId = await newUser();

    await expect(
      recordInterviewReport(db, {
        userId,
        companyId,
        roleFamily: ROLE_FAMILY,
        interviewedOn: '2026-06-01',
        stages: [],
        newId: uuidv7,
      }),
    ).rejects.toBeInstanceOf(InterviewReportInvariantError);
  });

  it('refuses an interview that has not happened', async () => {
    const userId = await newUser();

    await expect(
      recordInterviewReport(db, {
        userId,
        companyId,
        roleFamily: ROLE_FAMILY,
        interviewedOn: '2027-01-01',
        stages: TYPICAL,
        newId: uuidv7,
        now: () => new Date(AS_OF),
      }),
    ).rejects.toBeInstanceOf(InterviewReportInvariantError);
  });

  it('refuses a second report from the same person about the same pairing', async () => {
    // Five is not many. Without this, one motivated person clears a floor alone.
    const userId = await report();

    await expect(
      recordInterviewReport(db, {
        userId,
        companyId,
        roleFamily: ROLE_FAMILY,
        interviewedOn: '2026-07-01',
        stages: TYPICAL,
        newId: uuidv7,
        now: () => new Date(AS_OF),
      }),
    ).rejects.toThrow(/uq_ir__user_pairing/);
  });

  it('allows the same person to report a different pairing', async () => {
    const userId = await report();

    await expect(
      recordInterviewReport(db, {
        userId,
        companyId,
        roleFamily: 'sales',
        interviewedOn: '2026-07-01',
        stages: TYPICAL,
        newId: uuidv7,
        now: () => new Date(AS_OF),
      }),
    ).resolves.toBeTruthy();
  });
});

describe('erasure detaches rather than deletes', () => {
  it('keeps the pairing above its floor when a contributor erases', async () => {
    // **The reason this table is not hard-deleted.** Deleting would silently drop the pairing below
    // five and change what a stranger is told about the company.
    const users: string[] = [];
    for (let i = 0; i < 5; i += 1) users.push(await report());

    await eraseUser(db, users[0]!);

    const support = await processForPairing(db, { companyId, roleFamily: ROLE_FAMILY, asOf: AS_OF });
    expect(support).toMatchObject({ kind: 'described', reportCount: 5 });
  });

  it('leaves the report attributable to nobody', async () => {
    const userId = await report();

    await eraseUser(db, userId);

    const { rows } = await pool.query<{ user_id: string | null; anonymized_at: string | null }>(
      'SELECT user_id, anonymized_at FROM interview_reports',
    );
    expect(rows[0]?.user_id).toBeNull();
    expect(rows[0]?.anonymized_at).not.toBeNull();
  });
});
