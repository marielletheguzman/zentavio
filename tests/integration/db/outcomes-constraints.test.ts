/**
 * Applications and outcomes, and the one erasure that detaches rather than deletes.
 *
 * The property under test that matters most is the detachment: an outcome must survive erasure
 * without its subject, because it is the only thing that ever makes a predicted score checkable —
 * and `ck_outcomes__anonymized` exists so a row cannot claim to be both anonymous and attributed.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { eraseUser, hasPersonalData } from '../../../packages/db/src/repositories/erasure.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { expectViolation, migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let userId: string;
let seq = 0;

async function insertUser(): Promise<string> {
  seq += 1;
  const id = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
    id,
    `outcomes-n${String(seq)}@example.invalid`,
  ]);
  return id;
}

async function insertApplication(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const row = {
    id,
    user_id: userId,
    external_role: 'Platform Engineer',
    status: 'applied',
    applied_at: new Date('2026-03-01T00:00:00Z'),
    predicted_score: null,
    scorer_version: null,
    source: 'user-recorded',
    ...overrides,
  };
  await pool.query(
    `INSERT INTO applications (id, user_id, external_role, status, applied_at, predicted_score, scorer_version, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [row.id, row.user_id, row.external_role, row.status, row.applied_at, row.predicted_score, row.scorer_version, row.source],
  );
  return String(row.id);
}

async function insertOutcome(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const row = {
    id,
    user_id: userId,
    application_id: null,
    kind: 'offered',
    occurred_at: new Date('2026-04-15T00:00:00Z'),
    occurred_month: '2026-04-01',
    predicted_score: null,
    scorer_version: null,
    source: 'user-reported',
    confidence: 'high',
    anonymized_at: null,
    ...overrides,
  };
  await pool.query(
    `INSERT INTO outcomes (id, user_id, application_id, kind, occurred_at, occurred_month,
                           predicted_score, scorer_version, source, confidence, anonymized_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      row.id, row.user_id, row.application_id, row.kind, row.occurred_at, row.occurred_month,
      row.predicted_score, row.scorer_version, row.source, row.confidence, row.anonymized_at,
    ],
  );
  return String(row.id);
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM outcomes');
  await pool.query('DELETE FROM applications');
  await pool.query('DELETE FROM person_facts');
  await pool.query('DELETE FROM user_targets');
  await pool.query('DELETE FROM user_profiles');
  await pool.query('DELETE FROM users');
  userId = await insertUser();
});

describe('applications', () => {
  it('requires something identifying what was applied to', async () => {
    // An application to nothing in particular cannot be calibrated against anything.
    const violation = await expectViolation(pool, () =>
      insertApplication({ external_role: null, job_posting_id: null }),
    );
    expect(violation.constraint).toBe('ck_applications__identifies_role');
  });

  it('refuses a predicted score with no scorer version', async () => {
    // Without it, nothing records which code produced the number, so it can never be calibrated.
    const violation = await expectViolation(pool, () =>
      insertApplication({ predicted_score: 0.72, scorer_version: null }),
    );
    expect(violation.constraint).toBe('ck_applications__predicted');
  });

  it('accepts a predicted score that names its scorer', async () => {
    await expect(
      insertApplication({ predicted_score: 0.72, scorer_version: 'skill-gap@1.2.0' }),
    ).resolves.toBeTypeOf('string');
  });

  it('refuses a status outside the closed set', async () => {
    const violation = await expectViolation(pool, () => insertApplication({ status: 'ghosted' }));
    expect(violation.constraint).toBe('ck_applications__status');
  });

  it('has no foreign key on job_posting_id — that table is M4', async () => {
    // The column exists so the data has somewhere to go; the constraint arrives with `job_postings`.
    await expect(insertApplication({ job_posting_id: uuidv7() })).resolves.toBeTypeOf('string');
  });
});

describe('outcomes', () => {
  it('refuses a month that is not the truncated instant', async () => {
    // Aggregation reads `occurred_month`. If it disagrees with `occurred_at`, every period total is
    // wrong in a way no reader can see.
    const violation = await expectViolation(pool, () =>
      insertOutcome({ occurred_at: new Date('2026-04-15T00:00:00Z'), occurred_month: '2026-05-01' }),
    );
    expect(violation.constraint).toBe('ck_outcomes__month');
  });

  it('refuses a predicted score with no scorer version', async () => {
    const violation = await expectViolation(pool, () =>
      insertOutcome({ predicted_score: 0.61, scorer_version: null }),
    );
    expect(violation.constraint).toBe('ck_outcomes__predicted');
  });

  it('refuses a row that is attributed and anonymized at once', async () => {
    const violation = await expectViolation(pool, () =>
      insertOutcome({ user_id: userId, anonymized_at: new Date() }),
    );
    expect(violation.constraint).toBe('ck_outcomes__anonymized');
  });

  it('refuses a row that is neither attributed nor anonymized', async () => {
    // A row with no subject and no detachment date is a privacy claim nobody can verify.
    const violation = await expectViolation(pool, () =>
      insertOutcome({ user_id: null, anonymized_at: null }),
    );
    expect(violation.constraint).toBe('ck_outcomes__anonymized');
  });

  it.each(['applied', 'offered', 'relocated', 'course_completed', 'assessment_passed'])(
    'accepts the lifecycle kind %s',
    async (kind) => {
      await expect(insertOutcome({ kind })).resolves.toBeTypeOf('string');
    },
  );

  it('refuses a kind outside the closed set', async () => {
    const violation = await expectViolation(pool, () => insertOutcome({ kind: 'profile_created' }));
    // The kind ADR-0019 specifically refused to add.
    expect(violation.constraint).toBe('ck_outcomes__kind');
  });
});

describe('erasure detaches an outcome rather than deleting it', () => {
  it('keeps the row, drops the subject, and records when', async () => {
    const application = await insertApplication();
    await insertOutcome({
      application_id: application,
      predicted_score: 0.72,
      scorer_version: 'skill-gap@1.2.0',
    });

    const report = await eraseUser(db, userId);
    expect(report.outcomesDetached).toBe(1);
    expect(report.applicationsDeleted).toBe(1);

    const { rows } = await pool.query<{
      user_id: string | null;
      anonymized_at: Date | null;
      predicted_score: string;
      scorer_version: string;
    }>('SELECT user_id, anonymized_at, predicted_score, scorer_version FROM outcomes');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBeNull();
    expect(rows[0]?.anonymized_at).toBeInstanceOf(Date);
    // The contribution survives: this is what makes a predicted score checkable, and it is no
    // longer personal data.
    expect(Number(rows[0]?.predicted_score)).toBeCloseTo(0.72);
    expect(rows[0]?.scorer_version).toBe('skill-gap@1.2.0');
  });

  it('leaves no application behind', async () => {
    await insertApplication();
    await eraseUser(db, userId);

    const { rows } = await pool.query('SELECT id FROM applications WHERE user_id = $1', [userId]);
    expect(rows).toEqual([]);
  });

  it('reports the user as having no personal data afterwards', async () => {
    // The audit must not fail forever on rows the erasure is designed to keep.
    await insertApplication();
    await insertOutcome();

    expect(await hasPersonalData(db, userId)).toBe(true);
    await eraseUser(db, userId);
    expect(await hasPersonalData(db, userId)).toBe(false);
  });

  it('does not touch another persons outcomes', async () => {
    const other = await insertUser();
    await insertOutcome({ user_id: other });
    await insertOutcome();

    await eraseUser(db, userId);

    const { rows } = await pool.query('SELECT user_id FROM outcomes WHERE user_id IS NOT NULL');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(other);
  });
});
