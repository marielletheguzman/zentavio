/**
 * The pure mapping from stored rows onto the wire, split out the way `comparison/compose.ts` is.
 *
 * These functions carry every rule the discovery surface inherits, and none of them touches a
 * database — which is what makes the rules assertable rather than clickable. The service does the
 * querying; this decides what a row means.
 */

import type { JobPostingRow, MatchRow } from '@zentavio/db';
import type {
  JobPostingWire,
  SkillFitWire,
  SponsorshipSignalWire,
  SponsorshipSignalsWire,
} from '@zentavio/types';

/** The best-authority sighting for a posting, as `job_posting_sources` stores it. */
export interface Sighting {
  readonly source_id: string;
  readonly source_scope: string;
}

/**
 * `numeric(5,4)` arrives from pg as a string. Converted once, here — the rule the applications and
 * gap routes already follow.
 */
export function score(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function instant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? null : String(value);
}

/**
 * One signal and its span.
 *
 * The span is returned **only for a stated status**, mirroring `ck_job_postings__sponsorship_span`.
 * An `unknown` row has no sentence by construction, and returning an empty string for it would
 * invite a surface to render a quotation mark around nothing.
 */
export function signal(status: string, span: string | null): SponsorshipSignalWire {
  const stated = status === 'stated_available' || status === 'stated_unavailable';
  return {
    status: status as SponsorshipSignalWire['status'],
    span: stated ? span : null,
  };
}

export function sponsorshipOf(row: JobPostingRow): SponsorshipSignalsWire {
  return {
    visaSponsorship: signal(row.visa_sponsorship, row.visa_sponsorship_span),
    relocationSupport: signal(row.relocation_support, row.relocation_support_span),
    immigrationAssistance: signal(row.immigration_assistance, row.immigration_assistance_span),
    extractorVersion: row.sponsorship_extracted_version,
  };
}

/**
 * Skill Fit for one posting, from the match `services/matching` computed.
 *
 * **No match row means `not-computed`, and a null score means `no-requirements`.** Both are
 * `unscored`, and they are different facts: nobody has looked, versus we looked and the posting
 * states no requirements to look at. `ck_matches__score_iff_scored` keeps them apart in the
 * database; this keeps them apart on the wire.
 */
export function skillFitOf(match: MatchRow | undefined): SkillFitWire {
  if (match === undefined) return { status: 'unscored', reason: 'not-computed' };

  const value = score(match.score);
  if (value === null) return { status: 'unscored', reason: 'no-requirements' };

  const evidence = Array.isArray(match.evidence) ? match.evidence : [];
  return {
    status: 'scored',
    score: value,
    scorerVersion: match.scorer_version,
    evidence: evidence.map((item) => {
      const entry = item as { skillSlug?: unknown; basis?: unknown; contribution?: unknown };
      return {
        skillSlug: String(entry.skillSlug ?? ''),
        basis: String(entry.basis ?? ''),
        contribution: Number(entry.contribution ?? 0),
      };
    }),
  };
}


/** One stored posting as the discovery surface shows it. */
export function toJobWire(
  row: JobPostingRow,
  match: MatchRow | undefined,
  sighting: Sighting | undefined,
): JobPostingWire {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: { id: sighting?.source_id ?? '', scope: sighting?.source_scope ?? '' },
    employer: {
      companyId: row.company_id,
      // Resolved names arrive with the company join once a binding exists (ADR-0040). Until then
      // this is null for every posting, and the surface is required to show that as a gap.
      name: null,
      nameRaw: row.company_name_raw,
    },
    location: {
      raw: row.location_raw,
      countryCode: row.country_code,
      isRemote: row.is_remote,
      remoteScope: row.remote_scope,
    },
    postedAt: instant(row.posted_at),
    sponsorship: sponsorshipOf(row),
    skillFit: skillFitOf(match),
  };
}
