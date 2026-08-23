/**
 * Storing what an employer states about helping somebody take a job from abroad (ADR-0039).
 *
 * Mirrors `posting-skills.ts` in shape and differs in one way that matters: **the marker is its own**.
 * Skill extraction and sponsorship extraction are independent deterministic passes over the same
 * text, so each answers "processed by this version of this pipeline" separately.
 *
 * ## What this module will not do
 *
 * **Write `inferred_likely`.** It belongs to sponsor registries and aggregated outcomes — employer-level
 * sources with no table and, `company_id` being null on every posting, no join key. The column admits
 * the value for the day such a source exists; nothing here may produce it, and a CHECK refuses it.
 *
 * **Store a status without its span.** A claim about somebody's right to work that cannot be shown
 * back to them is not storable, which is `ck_jpsk__extracted_has_span`'s rule applied where the cost
 * is highest.
 */

import { sql, type Kysely } from 'kysely';

import type { Database, SponsorshipStatusColumn } from '../schema.ts';

/** A posting the sponsorship pass has selected, with the only two fields it reads. */
export interface PostingDueForSponsorship {
  readonly id: string;
  readonly description: string | null;
  readonly requirementsText: string | null;
}

/** One benefit's decided status and the sentence that carries it. */
export interface BenefitOutcome {
  readonly status: SponsorshipStatusColumn;
  readonly span: string | null;
}

export interface SponsorshipOutcome {
  readonly visaSponsorship: BenefitOutcome;
  readonly relocationSupport: BenefitOutcome;
  readonly immigrationAssistance: BenefitOutcome;
}

/**
 * Live postings whose recorded sponsorship version is not the current one.
 *
 * `IS DISTINCT FROM` rather than `<>`, for the reason ADR-0036 recorded: a never-processed posting has
 * a null version, and `null <> 'x'` is null, which selects nothing — exactly the rows a first run must
 * find.
 */
export async function postingsDueForSponsorship(
  db: Kysely<Database>,
  extractorVersion: string,
  limit: number,
): Promise<readonly PostingDueForSponsorship[]> {
  const rows = await db
    .selectFrom('job_postings')
    .select(['id', 'description', 'requirements_text'])
    .where('sponsorship_extracted_version', 'is distinct from', extractorVersion)
    .where('deleted_at', 'is', null)
    .where('expired_at', 'is', null)
    .orderBy('first_seen_at')
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    requirementsText: row.requirements_text,
  }));
}

/**
 * Record one sponsorship extraction: the three statuses, their spans, and that the posting was read.
 *
 * **Stamped even when every status is `unknown`**, which is nearly always. A posting whose text says
 * nothing about sponsorship has been processed and is finished; leaving it unstamped would re-select
 * it forever, which is the non-convergence ADR-0036 exists to prevent — here kept per pipeline rather
 * than shared.
 *
 * One statement, so a reader never sees a status without the span that justifies it.
 */
export async function recordSponsorship(
  db: Kysely<Database>,
  jobPostingId: string,
  outcome: SponsorshipOutcome,
  extraction: { readonly version: string; readonly at: Date },
): Promise<void> {
  await db
    .updateTable('job_postings')
    .set({
      visa_sponsorship: outcome.visaSponsorship.status,
      visa_sponsorship_span: outcome.visaSponsorship.span,
      relocation_support: outcome.relocationSupport.status,
      relocation_support_span: outcome.relocationSupport.span,
      immigration_assistance: outcome.immigrationAssistance.status,
      immigration_assistance_span: outcome.immigrationAssistance.span,
      sponsorship_extracted_at: extraction.at,
      sponsorship_extracted_version: extraction.version,
      updated_at: sql`now()`,
    })
    .where('id', '=', jobPostingId)
    .execute();
}

/** What a posting states, for a surface that must show the source or say `unknown` on every row. */
export function sponsorshipForPosting(db: Kysely<Database>, jobPostingId: string) {
  return db
    .selectFrom('job_postings')
    .select([
      'visa_sponsorship',
      'visa_sponsorship_span',
      'relocation_support',
      'relocation_support_span',
      'immigration_assistance',
      'immigration_assistance_span',
      'sponsorship_extracted_at',
      'sponsorship_extracted_version',
    ])
    .where('id', '=', jobPostingId);
}
