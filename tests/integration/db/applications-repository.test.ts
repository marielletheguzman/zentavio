/**
 * Recording an attempt and its result, against a real database.
 *
 * What only a real database proves here: that `ck_outcomes__month` agrees with the month this
 * repository stores (it is computed by PostgreSQL for exactly that reason), that
 * `ck_outcomes__predicted` accepts what `recordApplication` wrote, and that the status the
 * timeline implies and the status column actually agree after a write.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { eraseUser, hasPersonalData } from '../../../packages/db/src/repositories/erasure.ts';
import {
  UnknownApplicationError,
  applicationOutcomes,
  recordApplication,
  recordOutcome,
  userApplications,
} from '../../../packages/db/src/repositories/applications.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

/**
 * The ISO date pg actually stored.
 *
 * `String(date).slice(0, 10)` yields `'Mon Jun 01'`, and `toISOString()` shifts a `date` column
 * back a day anywhere east of UTC — pg returns it as a `Date` at *local* midnight. Local parts are
 * what the column holds. Both traps are documented in `requirement-ingest.test.ts`, and both were
 * live in the first draft of this file.
 */
function isoDate(value: unknown): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(value.getFullYear())}-${month}-${day}`;
}

let pool: Pool;
let db: Kysely<Database>;
let userId: string;

const PREDICTION = { score: 0.1523, scorerVersion: 'skill-gap@1.0.0' };

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
  await pool.query('DELETE FROM users');

  userId = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
    userId,
    `apps-${userId.slice(0, 8)}@example.invalid`,
  ]);
});

describe('recording an application', () => {
  it('stores what was predicted at the moment it was recorded', async () => {
    // ADR-0019's whole argument: calibration data cannot be backfilled, so the prediction is
    // written with the application rather than looked up when the outcome arrives.
    const row = await recordApplication(db, {
      userId,
      externalRole: 'Senior Backend Engineer at Acme',
      countryCode: 'DE',
      requiredSponsorship: true,
      prediction: PREDICTION,
    });

    expect(row.status).toBe('applied');
    expect(Number(row.predicted_score)).toBeCloseTo(0.1523, 4);
    expect(row.scorer_version).toBe('skill-gap@1.0.0');
    expect(row.source).toBe('user-recorded');
  });

  it('records an absent prediction as absent, never as zero', async () => {
    // Somebody who applied before they had a profile has no readiness score. A zero would be a
    // number nobody predicted, in the table that exists to check numbers.
    const row = await recordApplication(db, {
      userId,
      externalRole: 'Anything at all',
      prediction: null,
    });

    expect(row.predicted_score).toBeNull();
    expect(row.scorer_version).toBeNull();
  });

  it('refuses a score with no scorer, at the database', async () => {
    // `ck_applications__predicted`. A number nobody can attribute to a version of the code cannot
    // be calibrated, so it is not worth storing.
    await expect(
      pool.query(
        `INSERT INTO applications (id, user_id, external_role, status, source, predicted_score)
         VALUES ($1, $2, 'x', 'applied', 'user-recorded', 0.5)`,
        [uuidv7(), userId],
      ),
    ).rejects.toThrow(/ck_applications__predicted/);
  });

  it('lists a person their own applications and nobody elses', async () => {
    const other = uuidv7();
    await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
      other,
      `other-${other.slice(0, 8)}@example.invalid`,
    ]);

    await recordApplication(db, { userId, externalRole: 'Mine' });
    await recordApplication(db, { userId: other, externalRole: 'Theirs' });

    const mine = await userApplications(db, userId);
    expect(mine.map((row) => row.external_role)).toEqual(['Mine']);
  });
});

describe('recording an outcome', () => {
  async function anApplication(appliedAt = new Date('2026-06-01T09:00:00Z')) {
    return recordApplication(db, {
      userId,
      externalRole: 'Senior Backend Engineer at Acme',
      countryCode: 'DE',
      appliedAt,
      prediction: PREDICTION,
    });
  }

  it('carries the prediction the application was recorded with', async () => {
    // The pairing is the entire reason this table exists. Copied from the application rather than
    // supplied by the caller, so nothing can record a prediction it never made.
    const application = await anApplication();
    const outcome = await recordOutcome(db, {
      userId,
      applicationId: application.id,
      kind: 'rejected',
      occurredAt: new Date('2026-06-15T09:00:00Z'),
    });

    expect(Number(outcome.predicted_score)).toBeCloseTo(0.1523, 4);
    expect(outcome.scorer_version).toBe('skill-gap@1.0.0');
    expect(outcome.predicted_kind).toBe('readiness');
  });

  it('leaves predicted_kind null when there was no prediction', async () => {
    // Naming a kind for a score that does not exist would describe a prediction nobody made.
    const application = await recordApplication(db, {
      userId,
      externalRole: 'x',
      prediction: null,
    });
    const outcome = await recordOutcome(db, {
      userId,
      applicationId: application.id,
      kind: 'rejected',
    });

    expect(outcome.predicted_score).toBeNull();
    expect(outcome.predicted_kind).toBeNull();
  });

  it('stores a month PostgreSQL agrees with', async () => {
    // `ck_outcomes__month` compares against `date_trunc('month', occurred_at)::date` as the server
    // evaluates it. A month truncated in JavaScript disagrees east of UTC in the first hours of a
    // month — the same timezone class that shifted `effective_to` back a day in PR #63. The
    // constraint passing *is* the assertion; this pins the value too.
    const application = await anApplication();
    const outcome = await recordOutcome(db, {
      userId,
      applicationId: application.id,
      kind: 'interviewed',
      occurredAt: new Date('2026-06-15T09:00:00Z'),
    });

    expect(isoDate(outcome.occurred_month)).toBe('2026-06-01');
  });

  it('measures the days from the application', async () => {
    const application = await anApplication();
    const outcome = await recordOutcome(db, {
      userId,
      applicationId: application.id,
      kind: 'interviewed',
      occurredAt: new Date('2026-06-15T09:00:00Z'),
    });

    expect(outcome.elapsed_days).toBe(14);
  });

  it('records an impossible span as unknown rather than as a negative number', async () => {
    // An outcome before its application is bad input, not a duration. Null says "we do not know",
    // which is true; -3 would be a measurement nobody can interpret.
    const application = await anApplication();
    const outcome = await recordOutcome(db, {
      userId,
      applicationId: application.id,
      kind: 'rejected',
      occurredAt: new Date('2026-05-01T09:00:00Z'),
    });

    expect(outcome.elapsed_days).toBeNull();
  });

  it('moves the application to the stage the outcome implies', async () => {
    const application = await anApplication();

    await recordOutcome(db, { userId, applicationId: application.id, kind: 'interviewed' });
    const [afterInterview] = await userApplications(db, userId);
    expect(afterInterview?.status).toBe('interviewing');
    expect(afterInterview?.closed_at).toBeNull();

    await recordOutcome(db, { userId, applicationId: application.id, kind: 'rejected' });
    const [afterRejection] = await userApplications(db, userId);
    expect(afterRejection?.status).toBe('rejected');
    expect(afterRejection?.closed_at).not.toBeNull();
  });

  it('leaves the status alone for something that happened to the person', async () => {
    // `relocated` is not a stage of this application, and forcing it onto one would make the
    // status column mean two different things.
    const application = await anApplication();
    await recordOutcome(db, { userId, applicationId: application.id, kind: 'relocated' });

    const [row] = await userApplications(db, userId);
    expect(row?.status).toBe('applied');
  });

  it('keeps every outcome — a correction is another row, not an edit', async () => {
    // What we believed at the time is itself the data. There is deliberately no update path.
    const application = await anApplication();
    await recordOutcome(db, { userId, applicationId: application.id, kind: 'interviewed' });
    await recordOutcome(db, { userId, applicationId: application.id, kind: 'offered' });
    await recordOutcome(db, { userId, applicationId: application.id, kind: 'rejected' });

    const timeline = await applicationOutcomes(db, application.id);
    expect(timeline.map((row) => row.kind)).toEqual(['interviewed', 'offered', 'rejected']);
  });

  it('refuses an outcome recorded against another persons application', async () => {
    // Scoped to the person as well as the id, and the same answer either way — this route must not
    // be usable to discover that another person's application exists.
    const other = uuidv7();
    await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1, $2, 'password')`, [
      other,
      `other-${other.slice(0, 8)}@example.invalid`,
    ]);
    const theirs = await recordApplication(db, { userId: other, externalRole: 'Theirs' });

    await expect(
      recordOutcome(db, { userId, applicationId: theirs.id, kind: 'rejected' }),
    ).rejects.toThrow(UnknownApplicationError);
  });

  it('writes no outcome at all when the application is not theirs', async () => {
    await expect(
      recordOutcome(db, { userId, applicationId: uuidv7(), kind: 'rejected' }),
    ).rejects.toThrow(UnknownApplicationError);

    const { rows } = await pool.query('SELECT id FROM outcomes');
    expect(rows).toEqual([]);
  });

  it('holds no free text, because the table has nowhere to put it', async () => {
    // The deliberate absence in `docs/database/entities/outcome.md`: a notes field here would be
    // the most sensitive and least controllable column in the schema.
    const application = await anApplication();
    const outcome = await recordOutcome(db, { userId, applicationId: application.id, kind: 'rejected' });

    // Every column that may hold a string, named. Anything outside this set arriving as text is a
    // free-text column somebody added, which is the thing being guarded against. `predicted_score`
    // is `numeric` and arrives from pg as a string, so it is listed here rather than being caught
    // by a `typeof` check that cannot tell a number from a note.
    const MAY_BE_TEXT = new Set([
      'id',
      'user_id',
      'application_id',
      'kind',
      'source',
      'confidence',
      'predicted_kind',
      'predicted_score',
      'scorer_version',
      'country_code',
      'seniority',
    ]);

    const unexpectedText = Object.entries(outcome)
      .filter(([column, value]) => typeof value === 'string' && !MAY_BE_TEXT.has(column))
      .map(([column]) => column);

    expect(unexpectedText).toEqual([]);
    expect(outcome.skill_snapshot).toEqual([]);
  });
});

describe('erasure, now that something real writes these rows', () => {
  it('detaches the outcome and deletes the application', async () => {
    // The one table that survives erasure. Destroying it would destroy the calibration the
    // platform's honesty depends on, and the contribution is no longer personal once detached
    // (`docs/database/data-retention.md`). Asserted here against rows a real write path produced,
    // rather than against ones a test inserted by hand.
    const application = await recordApplication(db, {
      userId,
      externalRole: 'Senior Backend Engineer at Acme',
      prediction: PREDICTION,
    });
    await recordOutcome(db, { userId, applicationId: application.id, kind: 'rejected' });

    const report = await eraseUser(db, userId);

    expect(report.applicationsDeleted).toBe(1);
    expect(report.outcomesDetached).toBe(1);

    const { rows } = await pool.query(
      'SELECT user_id, application_id, anonymized_at, predicted_score, kind FROM outcomes',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBeNull();
    expect(rows[0]?.application_id).toBeNull();
    expect(rows[0]?.anonymized_at).not.toBeNull();
    // The pattern survives whole: what happened, and what we had predicted about it.
    expect(rows[0]?.kind).toBe('rejected');
    expect(Number(rows[0]?.predicted_score)).toBeCloseTo(0.1523, 4);
  });

  it('leaves no personal data behind afterwards', async () => {
    // `hasPersonalData` must ignore detached rows, or the audit fails forever on exactly the rows
    // erasure is designed to keep.
    const application = await recordApplication(db, { userId, externalRole: 'x' });
    await recordOutcome(db, { userId, applicationId: application.id, kind: 'rejected' });

    expect(await hasPersonalData(db, userId)).toBe(true);
    await eraseUser(db, userId);
    expect(await hasPersonalData(db, userId)).toBe(false);
  });
});
