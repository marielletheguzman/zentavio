/**
 * Pure mapping of one Lever posting into storage shape.
 *
 * ## The rule this file exists to hold
 *
 * **Structured fields are authoritative; prose is not read.** Lever gives `country` and
 * `workplaceType` as fields, and gives location as free text. Parsing `"Arlington, TX"` into a
 * country would be inventing a fact the source already states properly, and would be wrong exactly
 * where it matters — somebody deciding whether they can take a job.
 *
 * So the free-text location is carried verbatim for display and never mined.
 */

import type { JobPosting } from '@zentavio/types';

/** One posting as the API returns it. Only the fields this connector reads are declared. */
export interface LeverPosting {
  readonly id?: string;
  readonly text?: string;
  readonly hostedUrl?: string;
  readonly applyUrl?: string;
  readonly createdAt?: number;
  /** ISO-3166-1 alpha-2, given by the source. Never derived from the location string. */
  readonly country?: string | null;
  readonly workplaceType?: string | null;
  readonly categories?: {
    readonly department?: string | null;
    readonly team?: string | null;
    readonly commitment?: string | null;
    readonly location?: string | null;
  } | null;
}

export interface PostingContext {
  readonly board: string;
  readonly fetchedAt: string;
  readonly sourceId: string;
}

/** `null` when the posting cannot be linked to or named — never a row with a placeholder. */
export function toPosting(posting: LeverPosting, context: PostingContext): JobPosting | null {
  const externalId = typeof posting.id === 'string' && posting.id !== '' ? posting.id : null;
  const title = typeof posting.text === 'string' && posting.text.trim() !== '' ? posting.text.trim() : null;
  // `hostedUrl` is the posting page; `applyUrl` is the form. Either lets somebody act on it, and a
  // posting with neither is one they could only read about here, which is worse than not listing it.
  const url = posting.hostedUrl ?? posting.applyUrl ?? null;

  if (externalId === null || title === null || url === null) return null;

  const country =
    typeof posting.country === 'string' && /^[A-Za-z]{2}$/.test(posting.country)
      ? posting.country.toUpperCase()
      : null;

  return {
    sourceId: context.sourceId,
    // A board slug is a namespace, never an employer.
    sourceScope: context.board,
    externalId,
    title,
    url,
    // Lever names no employer. Deriving one from the board slug is the invention this refuses.
    companyNameRaw: null,
    countryCode: country,
    // Carried for display, never mined. The country above came from the field that states it.
    locationText: posting.categories?.location ?? null,
    isRemote: posting.workplaceType === 'remote',
    // Nothing in the payload says worldwide, country or region — see the module docs on `index.ts`.
    remoteScope: null,
    department: posting.categories?.department ?? null,
    team: posting.categories?.team ?? null,
    commitment: posting.categories?.commitment ?? null,
    // Lever publishes no structured pay. The flag says "the source was silent" rather than leaving a
    // reader guessing whether we failed to parse one.
    salaryIsStated: false,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    salaryPeriod: null,
    postedAt:
      typeof posting.createdAt === 'number' && Number.isFinite(posting.createdAt)
        ? new Date(posting.createdAt).toISOString()
        : null,
    sourceTier: 2,
    sourceUrl: `https://api.lever.co/v0/postings/${context.board}?mode=json`,
    retrievedAt: context.fetchedAt,
  };
}
