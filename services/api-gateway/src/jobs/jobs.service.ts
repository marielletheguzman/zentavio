/**
 * The jobs discovery surface's read side.
 *
 * `docs/roadmap/backlog.md` states the consumer this exists for: **not a job board** — a
 * cross-country discovery surface for IT, software and engineering roles, filtered toward
 * opportunities with immigration or relocation value. Until this module, 239 stored postings and
 * their matches were reachable by no route.
 *
 * ## The rules it inherits, and where each one lives
 *
 * Every rule below is enforced by the **shape** in `@zentavio/types` rather than by care taken here,
 * because a rule that depends on every future caller remembering it is not enforced at all:
 *
 * - **Skill Fit, never a Job Match Score** (ADR-0037), and `score: 0` is not `unknown`. A caller has
 *   to read `status` before it can reach a number, so the two cannot collapse into `0%`.
 * - **Three sponsorship signals, never merged.** Each carries its own status and the sentence that
 *   stated it. A composite would be unfalsifiable and, once shipped, un-splittable.
 * - **`unknown` sponsorship is not `no`.** The four-valued status passes through untouched; nothing
 *   here maps it onto a boolean.
 * - **`is_remote: null` is not `false`.** A silent source is not a negative answer (ADR-0033).
 * - **The employer may be absent, and says so.** `company_id` is null on every stored posting, so
 *   this is the common path; the surface shows a gap rather than hiding the field.
 *
 * ## What it will not do
 *
 * **Compute anything.** Skill Fit is read from `matches`, where `services/matching` wrote it with
 * its scorer version and evidence. A gateway that recomputed a score would produce a second number
 * with no version, and the two would disagree the first time the scorer changed.
 *
 * **Rank by anything but what it was given.** `matchesForUser` already orders by score with unknown
 * rows last rather than as zeros; this preserves that order instead of imposing its own.
 */

import { Inject, Injectable } from '@nestjs/common';
import { livePostings, matchesForUser, type Database } from '@zentavio/db';
import type { JobPostingWire } from '@zentavio/types';
import type { Kysely } from 'kysely';

import { DATABASE } from '../tokens.ts';
import { toJobWire, type Sighting } from './to-wire.ts';

export interface ListJobsScope {
  readonly countryCode?: string;
  readonly isRemote?: boolean;
  /** Show only postings whose visa sponsorship is stated available. Opt-in, and it hides most. */
  readonly statedSponsorshipOnly?: boolean;
  readonly limit: number;
}

@Injectable()
export class JobsService {
  readonly #db: Kysely<Database>;

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.#db = db;
  }

  /**
   * Live postings for one person, each carrying whatever Skill Fit exists for them.
   *
   * The match lookup is one query for the subject rather than one per posting: a listing of fifty
   * postings must not become fifty-one round trips, and a person has few enough matches that
   * fetching them whole is cheaper than joining per row.
   */
  async list(userId: string, scope: ListJobsScope): Promise<readonly JobPostingWire[]> {
    const postings = await livePostings(this.#db, {
      ...(scope.countryCode === undefined ? {} : { countryCode: scope.countryCode }),
      ...(scope.isRemote === undefined ? {} : { isRemote: scope.isRemote }),
    })
      .limit(scope.limit)
      .execute();

    const filtered = scope.statedSponsorshipOnly
      ? postings.filter((row) => row.visa_sponsorship === 'stated_available')
      : postings;

    if (filtered.length === 0) return [];

    const matches = await matchesForUser(this.#db, userId).execute();
    const byPosting = new Map(matches.map((match) => [match.job_posting_id, match]));

    // A posting carries no source of its own — sightings live on `job_posting_sources`, because one
    // posting can be described by several boards (ADR-0034). The best-authority sighting is the one
    // this surface attributes it to, and they are fetched for the whole page in one query rather
    // than one per row.
    const sources = await this.#db
      .selectFrom('job_posting_sources')
      .select(['job_posting_id', 'source_id', 'source_scope', 'source_tier'])
      .where(
        'job_posting_id',
        'in',
        filtered.map((row) => row.id),
      )
      .orderBy('source_tier')
      .execute();

    const bySource = new Map<string, Sighting>();
    for (const sighting of sources) {
      // `orderBy source_tier` puts the strongest first, and the first write wins.
      if (!bySource.has(sighting.job_posting_id)) bySource.set(sighting.job_posting_id, sighting);
    }

    return filtered.map((row) => toJobWire(row, byPosting.get(row.id), bySource.get(row.id)));
  }
}
