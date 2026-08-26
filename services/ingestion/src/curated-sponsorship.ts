/**
 * Apply curated employer sponsorship statements (`packages/db/curated/employer-sponsorship.json`).
 *
 * The sponsor-registry connector cannot be built: of the four supported countries only New Zealand
 * operates an employer-accreditation regime at all, and INZ's list is a search box whose endpoint —
 * `/_list-collection-search` — its own `robots.txt` disallows. `docs/architecture/connectors.md` is
 * unambiguous about what that means: *"If a source disallows automated access, the answer is that we
 * do not integrate it."* Even permitted, it offers no enumeration and employers may opt out of it,
 * so a miss would never be evidence of anything.
 *
 * So the second source kind carries this instead: the employer's own page, read by a person, entered
 * with the sentence they read it in.
 *
 * ## The curator is not trusted more than a job board is
 *
 * Every entry's `span` runs through **`extractSponsorship`** — the same function, the same
 * vocabulary, the same predicates the Lever pipeline uses (ADR-0039). The entry is refused unless
 * the extractor independently reaches the status the curator asserted.
 *
 * A second vocabulary written for curated entries would be the drift this repository has already
 * paid for once: `probe2.mjs` hand-copied the extractor's qualified-benefit list into its own regex,
 * and a copy free to drift is a copy that eventually does. There is one rule set here, and a human
 * judgement is checked against it rather than exempted from it.
 *
 * **Nothing calls this.** Like `runDueJobBoards`, `extractDuePostings`, `scorePostingForUser` and
 * `syncConnectorSources`, it is a function with no caller: what triggers it is a deployment decision
 * and nothing is deployed.
 */

import { curatedDirectory, recordSponsorshipFact, type Database } from '@zentavio/db';
import type { Kysely } from 'kysely';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractSponsorship, type BenefitKind, type SponsorshipStatus } from './sponsorship-extraction.ts';

/** The six claims `ck_esf__claim` accepts. Only three are reachable from prose (ADR-0039). */
export type CuratedClaim =
  | 'visa_sponsorship'
  | 'work_permit_sponsorship'
  | 'relocation_support'
  | 'immigration_assistance'
  | 'dependent_support'
  | 'sponsor_licence_held';

export interface CuratedSponsorshipEntry {
  /** Resolved against `companies.slug`. The company must already exist; this never creates one. */
  readonly companySlug: string;
  readonly jurisdiction: string;
  readonly claim: CuratedClaim;
  readonly status: SponsorshipStatus;
  /** The employer's own page. Never an aggregator and never a job board. */
  readonly sourceUrl: string;
  /** The verbatim sentence, copied from that page. This is what gets checked. */
  readonly span: string;
  /** ISO-8601. When somebody last opened the page. */
  readonly retrievedAt: string;
  readonly effectiveFrom: string;
  readonly refreshAfter: string;
}

export interface CuratedSponsorshipFile {
  readonly facts: readonly CuratedSponsorshipEntry[];
}

/**
 * Which benefit an extractor finding corresponds to, for the claims prose can reach.
 *
 * `work_permit_sponsorship`, `dependent_support` and `sponsor_licence_held` are absent on purpose.
 * The extractor has no vocabulary for them, so a curated entry asserting one cannot be checked — and
 * an unverifiable assertion is precisely what this module exists to refuse.
 */
const CHECKABLE: Readonly<Partial<Record<CuratedClaim, BenefitKind>>> = {
  visa_sponsorship: 'visa_sponsorship',
  relocation_support: 'relocation_support',
  immigration_assistance: 'immigration_assistance',
};

export interface CuratedRejection {
  readonly entry: CuratedSponsorshipEntry;
  readonly reason: string;
}

export interface CuratedValidation {
  readonly accepted: readonly CuratedSponsorshipEntry[];
  readonly rejected: readonly CuratedRejection[];
}

/**
 * Check every entry's asserted status against what the extractor reads in its own span.
 *
 * Pure and total: no I/O, no clock. The same property `normalize` has, and for the same reason —
 * this is the rule, and a rule that needs a network to evaluate cannot be tested against the real
 * sentences that broke it.
 */
export function validateCuratedSponsorship(file: CuratedSponsorshipFile): CuratedValidation {
  const accepted: CuratedSponsorshipEntry[] = [];
  const rejected: CuratedRejection[] = [];

  for (const entry of file.facts) {
    const span = entry.span.trim();

    if (span === '') {
      rejected.push({ entry, reason: 'no span: a curated claim must quote the sentence it came from' });
      continue;
    }

    if (!/^https?:\/\//.test(entry.sourceUrl)) {
      rejected.push({ entry, reason: `sourceUrl is not a URL: ${entry.sourceUrl}` });
      continue;
    }

    const benefit = CHECKABLE[entry.claim];
    if (benefit === undefined) {
      // Not a refusal of the claim itself — a refusal to record it *unchecked*. A sponsor licence is
      // a register's fact, and a register is not readable prose.
      rejected.push({
        entry,
        reason: `claim ${entry.claim} cannot be checked against a sentence; it needs a register or aggregated outcomes`,
      });
      continue;
    }

    const read = extractSponsorship({ description: span, requirementsText: null })[benefit];

    if (read.status !== entry.status) {
      rejected.push({
        entry,
        reason: `curator asserted ${entry.status}, the span reads as ${read.status}`,
      });
      continue;
    }

    accepted.push(entry);
  }

  return { accepted, rejected };
}

/** Read the curated file from `packages/db/curated/`. */
export function loadCuratedSponsorship(): CuratedSponsorshipFile {
  const path = join(curatedDirectory, 'employer-sponsorship.json');
  return JSON.parse(readFileSync(path, 'utf8')) as CuratedSponsorshipFile;
}

export interface CuratedSyncReport {
  readonly recorded: readonly string[];
  readonly rejected: readonly CuratedRejection[];
  /** Slugs named in the file that no `companies` row matches. */
  readonly unresolved: readonly string[];
}

/**
 * Record every accepted entry, superseding whatever was live for the same claim.
 *
 * **A slug that resolves to nothing is reported, never created.** Creating a company from a curated
 * sponsorship file would put an employer identity in the database as a side effect of recording a
 * fact about it — the inversion `company.md` refuses, and the reason `bindBoardToCompany` takes a
 * `companyId` a caller resolved deliberately.
 */
export async function syncCuratedSponsorship(
  db: Kysely<Database>,
  file: CuratedSponsorshipFile = loadCuratedSponsorship(),
): Promise<CuratedSyncReport> {
  const { accepted, rejected } = validateCuratedSponsorship(file);
  const recorded: string[] = [];
  const unresolved: string[] = [];

  for (const entry of accepted) {
    const company = await db
      .selectFrom('companies')
      .select('id')
      .where('slug', '=', entry.companySlug)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (company === undefined) {
      unresolved.push(entry.companySlug);
      continue;
    }

    await recordSponsorshipFact(db, {
      companyId: company.id,
      jurisdiction: entry.jurisdiction,
      claim: entry.claim,
      status: entry.status,
      detail: { span: entry.span },
      sourceTier: 2,
      sourceUrl: entry.sourceUrl,
      sourceKind: 'employer_statement',
      retrievedAt: new Date(entry.retrievedAt),
      effectiveFrom: entry.effectiveFrom,
      refreshAfter: entry.refreshAfter,
    });

    recorded.push(`${entry.companySlug}/${entry.jurisdiction}/${entry.claim}`);
  }

  return { recorded, rejected, unresolved };
}
