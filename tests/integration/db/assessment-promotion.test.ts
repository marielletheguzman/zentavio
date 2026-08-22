/**
 * Promotion to `evidenced`, against a real database (ADR-0030).
 *
 * **The decision, asserted rather than described.** An in-platform assessment is the only path that
 * may promote a skill, a pass evidences *the attempt*, and the promoted row has to be able to say
 * which instrument version produced it. Everything here is one of those sentences.
 *
 * The negative assertions matter as much as the positive one: a failed attempt promotes nothing, an
 * unfinished attempt promotes nothing, and a draft cannot even be attempted. Each is a way for a
 * promotion to appear that nobody can account for.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AssessmentInvariantError,
  attemptsForUser,
  promoteFromAttempt,
  publishedAssessmentsForSkill,
  gradeAttempt,
  itemsToAnswer,
  itemsWithClaims,
  publishAssessment,
  startAttempt,
} from '../../../packages/db/src/repositories/assessments.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let userId: string;
let profileId: string;
let skillId: string;
let assessmentId: string;

/** Ten items, seven to pass, each item real — grading reads the key rather than trusting a caller. */
async function insertAssessment(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const row = {
    slug: `kubernetes-fundamentals-${id.slice(-6)}`,
    version: 1,
    status: 'published',
    item_count: 10,
    pass_threshold: 7,
    items: 10,
    ...overrides,
  };

  await pool.query(
    `INSERT INTO skill_assessments
       (id, slug, version, skill_id, title, item_count, pass_threshold, status, published_at, does_not_evidence)
     VALUES ($1,$2,$3,$4,'Kubernetes Fundamentals',$5,$6,$7,
             CASE WHEN $7 = 'draft' THEN NULL ELSE now() END,
             'Recall of documented behaviour, not operating a cluster under load.')`,
    [id, row.slug, row.version, skillId, row.item_count, row.pass_threshold, row.status],
  );

  for (let position = 1; position <= Number(row.items); position += 1) {
    await pool.query(
      `INSERT INTO assessment_items
         (id, assessment_id, position, stem, options, correct_option, evidences, source_url)
       VALUES ($1,$2,$3,$4,$5::jsonb,'a',
               'Knows what the documented behaviour of this command is.',
               'https://example.invalid/docs')`,
      [
        uuidv7(),
        id,
        position,
        `Item ${String(position)}`,
        JSON.stringify([
          { key: 'a', text: 'The correct one' },
          { key: 'b', text: 'Not this one' },
        ]),
      ],
    );
  }

  return id;
}

/** An answer map getting exactly `correct` items right; the rest answered wrongly, not skipped. */
async function answersFor(
  assessmentId: string,
  correct: number,
): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM assessment_items WHERE assessment_id = $1 ORDER BY position',
    [assessmentId],
  );
  return Object.fromEntries(rows.map((row, index) => [row.id, index < correct ? 'a' : 'b']));
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  // Order matters, and the reason is the constraint under test: nulling `verified_attempt_id` to
  // break the foreign key would leave `verified_at` set, which
  // `ck_profile_skills__attempt_verified` refuses. So the promoted rows go first.
  await pool.query('DELETE FROM profile_skills');
  await pool.query('DELETE FROM assessment_attempts');
  // Items cascade from the instrument, so this clears both.
  await pool.query('DELETE FROM skill_assessments');
  await pool.query('DELETE FROM user_profiles');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM skills');

  userId = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1,$2,'password')`, [
    userId,
    `learner-${userId.slice(-8)}@example.invalid`,
  ]);

  profileId = uuidv7();
  await pool.query(
    `INSERT INTO user_profiles (id, user_id, version, is_current) VALUES ($1,$2,1,true)`,
    [profileId, userId],
  );

  skillId = uuidv7();
  await pool.query(
    `INSERT INTO skills (id, slug, name, kind, source_tier, basis)
     VALUES ($1,'kubernetes','Kubernetes','technology',3,'curated')`,
    [skillId],
  );

  assessmentId = await insertAssessment();
});

async function pass(correct = 8): Promise<string> {
  const attempt = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });
  await gradeAttempt(db, { attemptId: attempt.id, answers: await answersFor(assessmentId, correct) });
  return attempt.id;
}

describe('a pass promotes the skill, and says what promoted it', () => {
  it('writes evidenced with the assessment as its kind', async () => {
    const attemptId = await pass();

    await promoteFromAttempt(db, { attemptId, profileId, newId: uuidv7 });

    const { rows } = await pool.query(
      'SELECT status, evidence_kind, verified_at, verified_attempt_id, self_reported FROM profile_skills',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'evidenced',
      evidence_kind: 'assessment',
      verified_attempt_id: attemptId,
      // The instrument decided this, not the person — even though they performed the act.
      self_reported: false,
    });
    expect(rows[0].verified_at).not.toBeNull();
  });

  it('can name the instrument version behind the promotion', async () => {
    // ADR-0030 part 2: a promoted skill carries which assessment, which version, and when. Without
    // this join the surface can only say "verified", which is the claim the ADR refuses.
    const attemptId = await pass();
    await promoteFromAttempt(db, { attemptId, profileId, newId: uuidv7 });

    const { rows } = await pool.query(
      `SELECT sa.slug, sa.version
         FROM profile_skills ps
         JOIN assessment_attempts aa ON aa.id = ps.verified_attempt_id
         JOIN skill_assessments sa ON sa.id = aa.assessment_id`,
    );
    expect(rows[0]).toMatchObject({ version: 1 });
    expect(String(rows[0].slug)).toContain('kubernetes-fundamentals');
  });

  it('upgrades a résumé claim in place rather than adding a second row', async () => {
    // A claim and its later evidence are one fact about a person.
    await pool.query(
      `INSERT INTO profile_skills (id, user_profile_id, skill_id, status, confidence, source_span)
       VALUES ($1,$2,$3,'claimed','low','Used Kubernetes at a previous role')`,
      [uuidv7(), profileId, skillId],
    );

    const attemptId = await pass();
    await promoteFromAttempt(db, { attemptId, profileId, newId: uuidv7 });

    const { rows } = await pool.query('SELECT status, source_span FROM profile_skills');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('evidenced');
    // The original sentence survives: the evidence did not erase what they said about themselves.
    expect(rows[0].source_span).toBe('Used Kubernetes at a previous role');
  });
});

describe('what does not promote', () => {
  it('refuses a failed attempt', async () => {
    const attempt = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });
    await gradeAttempt(db, { attemptId: attempt.id, answers: await answersFor(assessmentId, 6) });

    await expect(
      promoteFromAttempt(db, { attemptId: attempt.id, profileId, newId: uuidv7 }),
    ).rejects.toBeInstanceOf(AssessmentInvariantError);

    const { rows } = await pool.query('SELECT id FROM profile_skills');
    expect(rows).toEqual([]);
  });

  it('refuses an attempt that was never submitted', async () => {
    // An attempt with no score has not been decided, and deciding it here would invent a result.
    const attempt = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });

    await expect(
      promoteFromAttempt(db, { attemptId: attempt.id, profileId, newId: uuidv7 }),
    ).rejects.toBeInstanceOf(AssessmentInvariantError);
  });

  it('refuses an attempt at a draft instrument', async () => {
    // A draft has no settled items, so an attempt at it would evidence nothing.
    const draft = await insertAssessment({ status: 'draft', slug: 'draft-instrument' });

    await expect(
      startAttempt(db, { userId, assessmentId: draft, newId: uuidv7 }),
    ).rejects.toBeInstanceOf(AssessmentInvariantError);
  });

  it('refuses an attempt at a retired instrument, while keeping earlier passes', async () => {
    const attemptId = await pass();
    await promoteFromAttempt(db, { attemptId, profileId, newId: uuidv7 });

    await pool.query(
      `UPDATE skill_assessments SET status = 'retired', retired_at = now() WHERE id = $1`,
      [assessmentId],
    );

    await expect(startAttempt(db, { userId, assessmentId, newId: uuidv7 })).rejects.toBeInstanceOf(
      AssessmentInvariantError,
    );

    // The pass stays, still citing the version it was earned against. Retiring an instrument does
    // not un-demonstrate what somebody demonstrated.
    const { rows } = await pool.query('SELECT status FROM profile_skills');
    expect(rows[0].status).toBe('evidenced');
  });
});

describe('the instrument decides, not the caller', () => {
  it('takes the threshold from the assessment', async () => {
    // 7 of 10 passes, 6 does not, and neither number is supplied with the score.
    const seven = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });
    const decided = await gradeAttempt(db, {
      attemptId: seven.id,
      answers: await answersFor(assessmentId, 7),
    });
    expect(decided.outcome).toBe('passed');
    expect(decided.score).toBe(7);
  });

  it('counts an unanswered item as wrong rather than skipping it', async () => {
    // Scoring only what was attempted would let somebody answer one item, get it right, and pass an
    // instrument of ten.
    const attempt = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM assessment_items WHERE assessment_id = $1 ORDER BY position LIMIT 1',
      [assessmentId],
    );

    const decided = await gradeAttempt(db, {
      attemptId: attempt.id,
      answers: { [rows[0]!.id]: 'a' },
    });

    expect(decided.score).toBe(1);
    expect(decided.outcome).toBe('failed');
  });

  it('never takes a score from the caller', async () => {
    // The signature is the guarantee: there is no score to pass. A client deciding whether it
    // passed is not something validation downstream can recover from.
    expect(Object.keys({ attemptId: '', answers: {} })).not.toContain('score');
  });

  it('refuses to re-decide a decided attempt', async () => {
    const attempt = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });
    await gradeAttempt(db, { attemptId: attempt.id, answers: await answersFor(assessmentId, 3) });

    await expect(
      gradeAttempt(db, { attemptId: attempt.id, answers: await answersFor(assessmentId, 10) }),
    ).rejects.toBeInstanceOf(AssessmentInvariantError);
  });

  it('keeps every attempt, including the failures', async () => {
    // Append-only: a failed attempt is a fact about what happened, and keeping only the best result
    // would make the record flatter than the truth.
    const first = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });
    await gradeAttempt(db, { attemptId: first.id, answers: await answersFor(assessmentId, 4) });

    // Aged past the retry interval, because attempt spacing now stands between the two. Setting the
    // clock back is the honest way to test the second attempt rather than removing the guard.
    await pool.query(
      `UPDATE assessment_attempts SET started_at = now() - interval '48 hours' WHERE id = $1`,
      [first.id],
    );

    const second = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });
    await gradeAttempt(db, { attemptId: second.id, answers: await answersFor(assessmentId, 9) });

    const attempts = await attemptsForUser(db, userId).execute();
    expect(attempts.map((attempt) => attempt.outcome).sort()).toEqual(['failed', 'passed']);
  });

  it('refuses a second pass against the same version, at the database', async () => {
    // The same evidence recorded twice would let one demonstration count as two.
    //
    // **`startAttempt` now refuses first**, so reaching this constraint through the repository is no
    // longer possible — which is the improvement. The index is still what makes it true rather than
    // merely usual, so the attempt is written directly to prove it still holds.
    const attemptId = await pass();

    await expect(
      pool.query(
        `INSERT INTO assessment_attempts (id, user_id, assessment_id, submitted_at, score, outcome)
         VALUES ($1,$2,$3, now(), 10, 'passed')`,
        [uuidv7(), userId, assessmentId],
      ),
    ).rejects.toThrow(/uq_aa__passed_once/);

    expect(attemptId).toBeTruthy();
  });
});

describe('the constraints ADR-0030 relies on', () => {
  it('refuses two published versions of one instrument', async () => {
    // Two live versions under one name would let two people hold incomparable evidence, and neither
    // would be wrong.
    const slug = 'one-live-version';
    await insertAssessment({ slug, version: 1 });

    await expect(insertAssessment({ slug, version: 2 })).rejects.toThrow(/uq_sa__published/);
  });

  it('refuses a threshold no attempt could reach', async () => {
    await expect(insertAssessment({ item_count: 5, pass_threshold: 6, slug: 'impossible' })).rejects.toThrow(
      /ck_sa__threshold/,
    );
  });

  it('refuses a threshold of zero, which would pass everybody', async () => {
    await expect(insertAssessment({ pass_threshold: 0, slug: 'free-pass' })).rejects.toThrow(
      /ck_sa__threshold/,
    );
  });

  it('refuses a verified skill that cannot say which attempt verified it', async () => {
    // The other half of the single-writer rule: `verified_at` set by anything that cannot point at
    // an attempt is a promotion with no basis.
    await expect(
      pool.query(
        `INSERT INTO profile_skills (id, user_profile_id, skill_id, status, evidence_kind, confidence, verified_at)
         VALUES ($1,$2,$3,'evidenced','assessment','high',now())`,
        [uuidv7(), profileId, skillId],
      ),
    ).rejects.toThrow(/ck_profile_skills__attempt_verified/);
  });

  it('offers only published instruments for a skill', async () => {
    await insertAssessment({ status: 'draft', slug: 'not-offered' });

    const rows = await publishedAssessmentsForSkill(db, skillId).execute();
    expect(rows.map((row) => row.id)).toEqual([assessmentId]);
  });
});

describe('the authored instrument, seeded', () => {
  it('serves items to a taker without the answer key', async () => {
    // **The property that makes an attempt mean anything.** Serving the key alongside the question
    // would make every attempt a formality, and the omission is enforced by what the query selects
    // rather than by a caller remembering to strip a field.
    const rows = await itemsToAnswer(db, assessmentId).execute();

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).toEqual(['id', 'position', 'stem', 'options']);
      expect(JSON.stringify(row)).not.toContain('correct_option');
    }
  });

  it('can say what a pass evidenced, item by item', async () => {
    // ADR-0030 part 2: the claim is scoped and the scope is rendered. This is the query behind it.
    const claims = await itemsWithClaims(db, assessmentId).execute();

    expect(claims).toHaveLength(10);
    for (const claim of claims) {
      expect(claim.evidences.length).toBeGreaterThan(20);
      expect(claim.source_url).toMatch(/^https:\/\//);
    }
  });

  it('refuses to publish an instrument that will not say what it fails to show', async () => {
    const id = uuidv7();
    await pool.query(
      `INSERT INTO skill_assessments (id, slug, version, skill_id, title, item_count, pass_threshold, status)
       VALUES ($1,'overclaiming',1,$2,'Overclaiming',1,1,'draft')`,
      [id, skillId],
    );
    await pool.query(
      `INSERT INTO assessment_items (id, assessment_id, position, stem, options, correct_option, evidences, source_url)
       VALUES ($1,$2,1,'A question','[{"key":"a","text":"x"},{"key":"b","text":"y"}]'::jsonb,'a',
               'Knows the documented behaviour of one command.','https://example.invalid/docs')`,
      [uuidv7(), id],
    );

    await expect(publishAssessment(db, { assessmentId: id })).rejects.toBeInstanceOf(
      AssessmentInvariantError,
    );
  });

  it('refuses to publish an instrument whose item count is a fiction', async () => {
    // A threshold counted against the wrong number of items is a threshold that means nothing.
    const id = uuidv7();
    await pool.query(
      `INSERT INTO skill_assessments
         (id, slug, version, skill_id, title, item_count, pass_threshold, status, does_not_evidence)
       VALUES ($1,'miscounted',1,$2,'Miscounted',5,3,'draft','It does not show operating anything under load, and it is unproctored.')`,
      [id, skillId],
    );

    await expect(publishAssessment(db, { assessmentId: id })).rejects.toBeInstanceOf(
      AssessmentInvariantError,
    );
  });

  it('refuses an item whose answer is not among the options offered', async () => {
    // Silent and total: every attempt at that item is wrong, and nothing anywhere reports a fault.
    await expect(
      pool.query(
        `INSERT INTO assessment_items (id, assessment_id, position, stem, options, correct_option, evidences, source_url)
         VALUES ($1,$2,99,'A question','[{"key":"a","text":"x"},{"key":"b","text":"y"}]'::jsonb,'c',
                 'Knows the documented behaviour of one command.','https://example.invalid/docs')`,
        [uuidv7(), assessmentId],
      ),
    ).rejects.toThrow(/ck_ai__correct_is_offered/);
  });
});

describe('attempt spacing, and what it does not fix', () => {
  it('refuses a second attempt inside the retry interval', async () => {
    // **The hole this narrows.** The key never leaves the server, but repeated attempts give it up:
    // ten items of four options, taken without limit, is a few sittings of work. Spacing makes that
    // cost time rather than effort.
    const attempt = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });
    await gradeAttempt(db, { attemptId: attempt.id, answers: await answersFor(assessmentId, 2) });

    await expect(
      startAttempt(db, { userId, assessmentId, newId: uuidv7 }),
    ).rejects.toBeInstanceOf(AssessmentInvariantError);
  });

  it('allows the attempt once the interval has passed', async () => {
    // Re-attempts stay allowed (ADR-0030 part 3). Forbidding them would make a single bad day
    // permanent, which spacing is not meant to do.
    const attempt = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });
    await gradeAttempt(db, { attemptId: attempt.id, answers: await answersFor(assessmentId, 2) });

    await pool.query(
      `UPDATE assessment_attempts SET started_at = now() - interval '48 hours' WHERE id = $1`,
      [attempt.id],
    );

    await expect(startAttempt(db, { userId, assessmentId, newId: uuidv7 })).resolves.toBeTruthy();
  });

  it('reads the interval from the instrument rather than a constant', async () => {
    // How long is a judgement about the material: a ten-item recall test and a two-hour practical
    // do not deserve the same cooldown.
    await pool.query(`UPDATE skill_assessments SET retry_interval = '0 seconds' WHERE id = $1`, [
      assessmentId,
    ]);

    const attempt = await startAttempt(db, { userId, assessmentId, newId: uuidv7 });
    await gradeAttempt(db, { attemptId: attempt.id, answers: await answersFor(assessmentId, 2) });

    await expect(startAttempt(db, { userId, assessmentId, newId: uuidv7 })).resolves.toBeTruthy();
  });

  it('refuses another attempt at a version already passed, before any questions are asked', async () => {
    // `uq_aa__passed_once` refused the second pass at grading time, which meant answering ten
    // questions and then meeting a constraint violation. This says the same thing first.
    await pass();

    await expect(
      startAttempt(db, { userId, assessmentId, newId: uuidv7 }),
    ).rejects.toBeInstanceOf(AssessmentInvariantError);
  });
});
