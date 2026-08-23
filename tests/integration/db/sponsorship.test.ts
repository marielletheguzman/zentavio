/**
 * ADR-0039 against a real database: what a sponsorship row may claim, enforced by constraint.
 *
 * **The forbidden rows are inserted directly**, never through the repository or the extractor. A rule
 * that lives only in a pure function is a rule the next writer bypasses with an `INSERT`, and this is
 * the field where that costs somebody an application and possibly a move.
 *
 * The extractor's own judgement — qualified benefit, adjacency, the four real Zoox spans — is unit
 * tested and pure. What is tested here is the schema, and the convergence of the pass that writes it.
 */

import { postingsDueForSponsorship, sponsorshipForPosting } from '@zentavio/db';
import type { Database } from '@zentavio/db';
import { SPONSORSHIP_EXTRACTOR_VERSION, extractSponsorshipForDuePostings } from '@zentavio/ingestion';
import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../../packages/db/src/uuid.ts';
import { migratedTestPool } from './database.ts';

let pool: Pool;
let db: Kysely<Database>;

const DEPS = { now: () => new Date('2026-08-23T15:00:00Z') };

beforeAll(async () => {
  pool = await migratedTestPool();
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM job_posting_skills');
  await pool.query('DELETE FROM job_posting_sources');
  await pool.query('DELETE FROM job_postings');
});

async function givenPosting(description: string | null, requirementsText: string | null = null): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO job_postings
       (id, dedup_key, dedup_basis, title, url, first_seen_at, last_seen_at, stale_after,
        authority_tier, confidence, description, requirements_text)
     VALUES ($1,$2,'source-identity','Embedded Software Engineer','https://jobs.example.invalid/e',
             now(), now(), now() + interval '1 day', 2, 'medium', $3, $4)`,
    [id, uuidv7(), description, requirementsText],
  );
  return id;
}

function setStatus(id: string, column: string, value: string, span: string | null) {
  return pool.query(`UPDATE job_postings SET ${column} = $2, ${column}_span = $3 WHERE id = $1`, [id, value, span]);
}

describe('the schema refuses what ADR-0039 forbids', () => {
  it('refuses a status other than unknown with no span', async () => {
    const id = await givenPosting('Visa sponsorship is available.');
    await expect(
      pool.query(`UPDATE job_postings SET visa_sponsorship = 'stated_available' WHERE id = $1`, [id]),
    ).rejects.toThrow(/ck_job_postings__visa_sponsorship_span/);
  });

  it('refuses a relocation status with no span', async () => {
    const id = await givenPosting(null);
    await expect(
      pool.query(`UPDATE job_postings SET relocation_support = 'stated_unavailable' WHERE id = $1`, [id]),
    ).rejects.toThrow(/ck_job_postings__relocation_support_span/);
  });

  it('refuses an immigration-assistance status with no span', async () => {
    const id = await givenPosting(null);
    await expect(
      pool.query(`UPDATE job_postings SET immigration_assistance = 'stated_available' WHERE id = $1`, [id]),
    ).rejects.toThrow(/ck_job_postings__immigration_assistance_span/);
  });

  it('refuses inferred_likely on every benefit, even with a span', async () => {
    // ADR-0039 rule 3. It belongs to registries and aggregated outcomes — no table, and with
    // company_id null on every posting, no join key either. A span does not buy the value in.
    const id = await givenPosting(null);
    for (const column of ['visa_sponsorship', 'relocation_support', 'immigration_assistance']) {
      await expect(setStatus(id, column, 'inferred_likely', 'we sponsor lots of people')).rejects.toThrow(
        /ck_job_postings__no_inferred_sponsorship/,
      );
    }
  });

  it('refuses a value outside the four', async () => {
    const id = await givenPosting(null);
    await expect(setStatus(id, 'visa_sponsorship', 'probably', 'a span')).rejects.toThrow(
      /ck_job_postings__visa_sponsorship/,
    );
  });

  it('refuses a half-set marker', async () => {
    const id = await givenPosting(null);
    await expect(
      pool.query(`UPDATE job_postings SET sponsorship_extracted_version = 'x' WHERE id = $1`, [id]),
    ).rejects.toThrow(/ck_job_postings__sponsorship_marker_paired/);
  });

  it('accepts a status that carries its span', async () => {
    const id = await givenPosting('Visa sponsorship is available.');
    await setStatus(id, 'visa_sponsorship', 'stated_available', 'Visa sponsorship is available.');

    const [row] = await sponsorshipForPosting(db, id).execute();
    expect(row?.visa_sponsorship).toBe('stated_available');
    expect(row?.visa_sponsorship_span).toBe('Visa sponsorship is available.');
  });

  it('defaults every benefit to unknown with no span', async () => {
    const id = await givenPosting('We are hiring an embedded engineer.');
    const [row] = await sponsorshipForPosting(db, id).execute();

    expect(row?.visa_sponsorship).toBe('unknown');
    expect(row?.relocation_support).toBe('unknown');
    expect(row?.immigration_assistance).toBe('unknown');
    expect(row?.visa_sponsorship_span).toBeNull();
  });
});

describe('the pass converges, on its own marker', () => {
  it('selects a never-processed posting, which a plain <> would not', async () => {
    await givenPosting('We are hiring.');
    expect(await postingsDueForSponsorship(db, SPONSORSHIP_EXTRACTOR_VERSION, 10)).toHaveLength(1);
  });

  it('does not re-select a posting whose text said nothing', async () => {
    // The dominant case, and the one that must converge: saying nothing is a result, not a pending state.
    const id = await givenPosting('We are looking for a strong embedded engineer.');

    const first = await extractSponsorshipForDuePostings(db, DEPS);
    expect(first.considered).toBe(1);
    expect(first.saidNothing).toBe(1);
    expect(first.withAnyStatement).toBe(0);

    const [row] = await sponsorshipForPosting(db, id).execute();
    expect(row?.visa_sponsorship).toBe('unknown');
    expect(row?.sponsorship_extracted_version).toBe(SPONSORSHIP_EXTRACTOR_VERSION);

    const second = await extractSponsorshipForDuePostings(db, DEPS);
    expect(second.considered).toBe(0);
  });

  it('re-selects when the version moves', async () => {
    const id = await givenPosting('We are hiring.');
    await extractSponsorshipForDuePostings(db, DEPS);
    await pool.query(`UPDATE job_postings SET sponsorship_extracted_version = 'sponsorship-statement@0.9.0' WHERE id = $1`, [id]);

    expect(await postingsDueForSponsorship(db, SPONSORSHIP_EXTRACTOR_VERSION, 10)).toHaveLength(1);
  });

  it('is independent of the skill marker — neither pass moves the other', async () => {
    // The whole reason for two marker pairs. A sponsorship run must not mark a posting as
    // skill-extracted, and must not be re-selected because the skill extractor moved.
    const id = await givenPosting('We are hiring an embedded engineer.');
    await extractSponsorshipForDuePostings(db, DEPS);

    const [row] = await db
      .selectFrom('job_postings')
      .select(['extracted_version', 'sponsorship_extracted_version'])
      .where('id', '=', id)
      .execute();

    expect(row?.sponsorship_extracted_version).toBe(SPONSORSHIP_EXTRACTOR_VERSION);
    expect(row?.extracted_version).toBeNull();
  });

  it('skips expired and soft-deleted postings', async () => {
    const expired = await givenPosting('We are hiring.');
    const deleted = await givenPosting('We are hiring.');
    await pool.query(`UPDATE job_postings SET expired_at = now(), expiry_reason = 'source-delisted' WHERE id = $1`, [expired]);
    await pool.query(`UPDATE job_postings SET deleted_at = now() WHERE id = $1`, [deleted]);

    expect((await extractSponsorshipForDuePostings(db, DEPS)).considered).toBe(0);
  });

  it('says when the batch cap hid remaining work', async () => {
    await givenPosting('We are hiring.');
    await givenPosting('We are hiring.');

    const report = await extractSponsorshipForDuePostings(db, { ...DEPS, batchSize: 1 });
    expect(report.considered).toBe(1);
    expect(report.moreRemaining).toBe(true);
  });
});

describe('a real statement, stored end to end', () => {
  it('stores the status and the sentence that justifies it', async () => {
    const id = await givenPosting('Visa sponsorship is available for this role. Relocation assistance is not offered.');

    const report = await extractSponsorshipForDuePostings(db, DEPS);
    expect(report.withAnyStatement).toBe(1);
    expect(report.statedAvailable).toBe(1);
    expect(report.statedUnavailable).toBe(1);

    const [row] = await sponsorshipForPosting(db, id).execute();
    expect(row?.visa_sponsorship).toBe('stated_available');
    expect(row?.visa_sponsorship_span).toContain('Visa sponsorship is available');
    expect(row?.relocation_support).toBe('stated_unavailable');
  });

  it('stores unknown for the real Zoox span that mentions the topic without stating it', async () => {
    // Verbatim from the board, 2026-08-23. The genuine one, and still not a statement.
    const id = await givenPosting(
      'Company visa sponsorship and relocation assistance details will be provided during the interview process.',
    );

    await extractSponsorshipForDuePostings(db, DEPS);

    const [row] = await sponsorshipForPosting(db, id).execute();
    expect(row?.visa_sponsorship).toBe('unknown');
    expect(row?.relocation_support).toBe('unknown');
    // Processed, not pending. That distinction is the point.
    expect(row?.sponsorship_extracted_version).toBe(SPONSORSHIP_EXTRACTOR_VERSION);
  });

  it('writes no inferred_likely from any prose the extractor can see', async () => {
    await givenPosting('We sponsor many international employees every year and most of our engineers relocated.');
    await extractSponsorshipForDuePostings(db, DEPS);

    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM job_postings
        WHERE 'inferred_likely' IN (visa_sponsorship, relocation_support, immigration_assistance)`,
    );
    expect(rows[0].n).toBe(0);
  });
});
