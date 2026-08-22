/**
 * Preparation built from a role's requirements, against a real database (M8).
 *
 * **This is the path most people will take.** ADR-0031's floors mean almost every company shows a
 * shortfall for a long time, so this is what they get instead — and the tests treat it as the main
 * case rather than the consolation one.
 *
 * The assertions that matter are about what it will not do: no company anywhere in it, no invented
 * weight, and `evidenced` never collapsed into `claimed`.
 */

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MAX_THEMES, rolePreparation } from '../../../packages/db/src/repositories/role-preparation.ts';
import type { Database } from '../../../packages/db/src/schema.ts';
import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;
let careerId: string;
let userId: string;
let profileId: string;

/** A skill the track requires, at a stated weight and cluster. */
async function requirement(
  slug: string,
  weight: number,
  cluster: 'core' | 'supporting' | 'differentiating' | 'peripheral' = 'core',
): Promise<string> {
  const skillId = uuidv7();
  await pool.query(
    `INSERT INTO skills (id, slug, name, kind, source_tier, basis)
     VALUES ($1,$2,$3,'technology',3,'curated')`,
    [skillId, slug, slug],
  );
  await pool.query(
    `INSERT INTO career_skills (id, career_id, skill_id, weight, cluster, basis, source_tier)
     VALUES ($1,$2,$3,$4,$5,'curated',3)`,
    [uuidv7(), careerId, skillId, weight, cluster],
  );
  return skillId;
}

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM profile_skills');
  await pool.query('DELETE FROM user_profiles');
  // Reports before their reporters: `fk_ir__users` is RESTRICT, because a report outlives the
  // account that made it (erasure detaches rather than deletes).
  await pool.query('DELETE FROM interview_report_stages');
  await pool.query('DELETE FROM interview_reports');
  await pool.query('DELETE FROM companies');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM career_skills');
  await pool.query('DELETE FROM skills');
  await pool.query('DELETE FROM careers');

  careerId = uuidv7();
  await pool.query(
    `INSERT INTO careers (id, slug, name, family, source_tier, basis)
     VALUES ($1,'platform-engineer','Platform Engineer','software-it',3,'curated')`,
    [careerId],
  );

  userId = uuidv7();
  await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1,$2,'password')`, [
    userId,
    `prep-${userId.slice(-10)}@example.invalid`,
  ]);

  profileId = uuidv7();
  await pool.query(
    `INSERT INTO user_profiles (id, user_id, version, is_current) VALUES ($1,$2,1,true)`,
    [profileId, userId],
  );
});

describe('what it prepares somebody for', () => {
  it('returns the track’s requirements, heaviest first', async () => {
    await requirement('kubernetes', 0.95);
    await requirement('terraform', 0.8);
    await requirement('bash', 0.4, 'supporting');

    const prep = await rolePreparation(db, { careerId });

    expect(prep.themes.map((theme) => theme.slug)).toEqual(['kubernetes', 'terraform', 'bash']);
    expect(prep.requirementCount).toBe(3);
  });

  it('carries the stored weight rather than an adjective', async () => {
    // Weights live on `career_skills`, never as a constant in code, and a theme this cannot ground
    // is a theme it does not return.
    await requirement('kubernetes', 0.95);

    const [theme] = (await rolePreparation(db, { careerId })).themes;
    expect(theme?.weight).toBeCloseTo(0.95, 2);
    expect(theme?.cluster).toBe('core');
  });

  it('caps the list, and says how many requirements there are in total', async () => {
    // Thirty themes is a syllabus, not preparation. The total is returned so a capped list never
    // reads as the whole set.
    for (let i = 0; i < MAX_THEMES + 4; i += 1) await requirement(`skill-${String(i)}`, 0.5);

    const prep = await rolePreparation(db, { careerId });

    expect(prep.themes).toHaveLength(MAX_THEMES);
    expect(prep.requirementCount).toBe(MAX_THEMES + 4);
  });
});

describe('where the person stands', () => {
  it('keeps evidenced and claimed apart', async () => {
    // The distinction is what makes readiness honest everywhere else here; collapsing it into
    // "you have it" would make this the one surface that lies about it.
    const evidenced = await requirement('kubernetes', 0.95);
    const claimed = await requirement('terraform', 0.9);
    await requirement('bash', 0.8);

    await pool.query(
      `INSERT INTO profile_skills (id, user_profile_id, skill_id, status, evidence_kind, confidence)
       VALUES ($1,$2,$3,'evidenced','role','high')`,
      [uuidv7(), profileId, evidenced],
    );
    await pool.query(
      `INSERT INTO profile_skills (id, user_profile_id, skill_id, status, confidence)
       VALUES ($1,$2,$3,'claimed','low')`,
      [uuidv7(), profileId, claimed],
    );

    const prep = await rolePreparation(db, { careerId, profileId });

    expect(prep.themes.map((theme) => [theme.slug, theme.standing])).toEqual([
      ['kubernetes', 'evidenced'],
      ['terraform', 'claimed'],
      ['bash', 'missing'],
    ]);
  });

  it('says missing rather than guessing when there is no profile', async () => {
    // Without a profile we do not know they lack these — and we do not claim they have them.
    await requirement('kubernetes', 0.95);

    const prep = await rolePreparation(db, { careerId });
    expect(prep.themes[0]?.standing).toBe('missing');
  });
});

describe('what it refuses to be', () => {
  it('says the same thing whatever any company’s reports say', async () => {
    // **The property that makes this usable below the support floor.** It is about the role, and
    // nothing in it reads a company, a report or a pairing.
    await requirement('kubernetes', 0.95);
    await requirement('terraform', 0.8);

    const before = await rolePreparation(db, { careerId, profileId });

    const companyId = uuidv7();
    await pool.query(
      `INSERT INTO companies (id, slug, canonical_name, status, source_tier)
       VALUES ($1,'acme','Acme','active',3)`,
      [companyId],
    );
    for (let i = 0; i < 6; i += 1) {
      const reporter = uuidv7();
      await pool.query(`INSERT INTO users (id, email, auth_provider) VALUES ($1,$2,'password')`, [
        reporter,
        `r-${reporter.slice(-10)}@example.invalid`,
      ]);
      const reportId = uuidv7();
      await pool.query(
        `INSERT INTO interview_reports (id, user_id, company_id, role_family, interviewed_on)
         VALUES ($1,$2,$3,'software-it', current_date - 30)`,
        [reportId, reporter, companyId],
      );
      await pool.query(
        `INSERT INTO interview_report_stages (id, report_id, position, kind)
         VALUES ($1,$2,1,'system-design')`,
        [uuidv7(), reportId],
      );
    }

    const after = await rolePreparation(db, { careerId, profileId });

    expect(after).toEqual(before);
  });

  it('returns no questions, only themes', async () => {
    // Generated questions belong to `ai/interview-prep`, which does not exist. A question invented
    // here and shown beside a company's name is the fabrication M8 is written against.
    await requirement('kubernetes', 0.95);

    const [theme] = (await rolePreparation(db, { careerId })).themes;
    expect(Object.keys(theme ?? {}).sort()).toEqual([
      'cluster',
      'name',
      'skillId',
      'slug',
      'standing',
      'weight',
    ]);
  });
});
