/**
 * Job postings: identity, upsert, deduplication and expiry (ADR-0034).
 *
 * ## What this module owns that a connector must not
 *
 * **`dedup_key`.** A connector sees exactly one source. Deduplication is the claim that two postings
 * from two feeds are the same job, and nothing that can see one feed is in a position to make it.
 * `tests/unit/invariants/no-connector-dedup-key.test.ts` keeps that true by inspection rather than
 * by hope.
 *
 * ## The two things it refuses to do
 *
 * **It never merges on a guess.** A posting whose source supplies no employer identity gets a key
 * derived from its source identity, which by construction matches nothing else. That is recorded as
 * `dedup_basis = 'source-identity'`, so "we did not merge this" is distinguishable from "there was
 * nothing to merge it with" — a distinction a reader cannot recover from a key alone.
 *
 * **It never expires a posting because a feed came back short.** Absence is evidence only when the
 * listing was exhaustive, and only after more than one such run. A truncated response, a quota, or
 * an outage is our failure, and retiring somebody's tracked posting on our failure is the outcome
 * `docs/architecture/data-flow.md` names as unacceptable.
 */

import { createHash } from 'node:crypto';

import { sql, type Kysely, type Selectable } from 'kysely';

import type { Database, DedupBasisColumn, JobPostingsTable } from '../schema.ts';
import { uuidv7 } from '../uuid.ts';

export type JobPostingRow = Selectable<JobPostingsTable>;

/** Where a posting lives in its source's namespace. The scope is **not** an employer. */
export interface SourceIdentity {
  readonly sourceId: string;
  /** A Lever board slug, an ATS tenant, a country site. Empty when the source has one namespace. */
  readonly sourceScope: string;
  /** The source's own identifier, verbatim. */
  readonly externalId: string;
}

/** The posting itself, as a connector normalized it. Every field the source omitted is null. */
export interface PostingFields {
  readonly title: string;
  readonly companyId?: string | null;
  readonly companyNameRaw?: string | null;
  readonly description?: string | null;
  readonly locationRaw?: string | null;
  readonly countryCode?: string | null;
  readonly region?: string | null;
  readonly city?: string | null;
  /** `null` means the source did not say. It does not mean on-site. */
  readonly isRemote?: boolean | null;
  readonly remoteScope?: string | null;
  readonly employmentType?: string | null;
  readonly seniority?: string | null;
  readonly commitmentRaw?: string | null;
  readonly departmentRaw?: string | null;
  readonly teamRaw?: string | null;
  readonly salaryMin?: string | number | null;
  readonly salaryMax?: string | number | null;
  readonly currency?: string | null;
  readonly salaryPeriod?: string | null;
  readonly salaryIsStated?: boolean;
  readonly postedAt?: Date | null;
  readonly sourceExpiresAt?: Date | null;
}

/** What the run that produced this posting knew about itself. */
export interface SourceObservation {
  readonly sourceTier: number;
  readonly sourceUrl: string;
  readonly retrievedAt: Date;
  readonly connectorVersion: string;
  readonly runId: string;
  /** The archived board payload — many postings per document, never this posting's bytes. */
  readonly documentId?: string | null;
}

export type UpsertAction = 'inserted' | 'updated' | 'refused-lower-tier';

export interface UpsertResult {
  readonly jobPostingId: string;
  readonly action: UpsertAction;
  readonly dedupKey: string;
  readonly dedupBasis: DedupBasisColumn;
  /** True when a recomputed key would have collided with another live posting and was not applied. */
  readonly collisionRefused: boolean;
}

/** Casefold, strip punctuation, collapse whitespace — the guide's `norm()`, unchanged. */
function norm(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Month precision. A posting re-listed a day later is the same job; a day is not identity. */
function coarse(at: Date | null | undefined): string {
  return at === null || at === undefined ? 'unknown' : at.toISOString().slice(0, 7);
}

function sha256(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * The key, and the basis that says what it means.
 *
 * An employer identity is what makes cross-source matching possible at all: two feeds agreeing on
 * title and location without agreeing on the employer are as likely to be two jobs as one.
 */
export function dedupKeyFor(
  identity: SourceIdentity,
  fields: PostingFields,
): { readonly key: string; readonly basis: DedupBasisColumn } {
  const employer = fields.companyId ?? fields.companyNameRaw ?? null;

  if (employer !== null && norm(employer) !== '') {
    return {
      key: sha256([norm(employer), norm(fields.title), norm(fields.locationRaw ?? ''), coarse(fields.postedAt)]),
      basis: 'employer-title-location',
    };
  }

  // No employer, so no cross-source claim is available. Deriving the key from the source identity
  // makes it unique by construction rather than accidentally collidable.
  return {
    key: sha256(['source-identity', identity.sourceId, identity.sourceScope, identity.externalId]),
    basis: 'source-identity',
  };
}

/**
 * Tier decides the ceiling; staleness is read at query time from `stale_after`.
 *
 * Tier 2 is `medium` even when it is the only source we have — `knowledge-sources.md` reserves
 * `high` for an authority's own publication of record, and a job board is not one (ADR-0033).
 */
function confidenceForTier(tier: number): 'high' | 'medium' | 'low' {
  if (tier === 1) return 'high';
  if (tier === 2) return 'medium';
  return 'low';
}

/** `retrieved_at` plus the source's own refresh window, computed by the database that stores it. */
function staleAfter(sourceId: string, retrievedAt: Date) {
  return sql<Date>`${retrievedAt}::timestamptz + (SELECT refresh_window FROM connector_sources WHERE id = ${sourceId})`;
}

function columnsFrom(fields: PostingFields) {
  return {
    title: fields.title,
    company_id: fields.companyId ?? null,
    company_name_raw: fields.companyNameRaw ?? null,
    description: fields.description ?? null,
    location_raw: fields.locationRaw ?? null,
    country_code: fields.countryCode ?? null,
    region: fields.region ?? null,
    city: fields.city ?? null,
    is_remote: fields.isRemote ?? null,
    remote_scope: fields.remoteScope ?? null,
    employment_type: fields.employmentType ?? null,
    seniority: fields.seniority ?? null,
    commitment_raw: fields.commitmentRaw ?? null,
    department_raw: fields.departmentRaw ?? null,
    team_raw: fields.teamRaw ?? null,
    salary_min: fields.salaryMin ?? null,
    salary_max: fields.salaryMax ?? null,
    currency: fields.currency ?? null,
    salary_period: fields.salaryPeriod ?? null,
    salary_is_stated: fields.salaryIsStated ?? false,
    posted_at: fields.postedAt ?? null,
    source_expires_at: fields.sourceExpiresAt ?? null,
  };
}

/**
 * Write one posting from one source, by its source identity.
 *
 * Re-ingesting the same identity **updates** — the unique index on
 * `(source_id, source_scope, external_id)` is what makes that structural rather than intended.
 *
 * An update from a **worse tier than the one that wrote the fields is refused**: the posting keeps
 * what the better source said, and the source row still records that this source saw it, because
 * "who listed it" and "whose words these are" are different facts.
 */
export async function upsertPostingFromSource(
  db: Kysely<Database>,
  input: {
    readonly identity: SourceIdentity;
    readonly fields: PostingFields;
    readonly observation: SourceObservation;
  },
): Promise<UpsertResult> {
  const { identity, fields, observation } = input;
  const derived = dedupKeyFor(identity, fields);

  const existingSource = await db
    .selectFrom('job_posting_sources')
    .select(['id', 'job_posting_id'])
    .where('source_id', '=', identity.sourceId)
    .where('source_scope', '=', identity.sourceScope)
    .where('external_id', '=', identity.externalId)
    .executeTakeFirst();

  if (existingSource === undefined) {
    const id = uuidv7();

    await db
      .insertInto('job_postings')
      .values({
        id,
        dedup_key: derived.key,
        dedup_basis: derived.basis,
        ...columnsFrom(fields),
        first_seen_at: observation.retrievedAt,
        last_seen_at: observation.retrievedAt,
        stale_after: staleAfter(identity.sourceId, observation.retrievedAt),
        authority_tier: observation.sourceTier,
        confidence: confidenceForTier(observation.sourceTier),
      })
      .execute();

    await db
      .insertInto('job_posting_sources')
      .values({
        id: uuidv7(),
        job_posting_id: id,
        source_id: identity.sourceId,
        source_scope: identity.sourceScope,
        external_id: identity.externalId,
        source_tier: observation.sourceTier,
        source_url: observation.sourceUrl,
        retrieved_at: observation.retrievedAt,
        connector_version: observation.connectorVersion,
        run_id: observation.runId,
        document_id: observation.documentId ?? null,
      })
      .execute();

    return { jobPostingId: id, action: 'inserted', dedupKey: derived.key, dedupBasis: derived.basis, collisionRefused: false };
  }

  const posting = await db
    .selectFrom('job_postings')
    .select(['id', 'dedup_key', 'dedup_basis', 'authority_tier', 'flags'])
    .where('id', '=', existingSource.job_posting_id)
    .executeTakeFirstOrThrow();

  // A source that listed the posting again has seen it, whatever its tier — so the source row is
  // refreshed and its missed-run count reset before any decision about the fields.
  await db
    .updateTable('job_posting_sources')
    .set({
      source_tier: observation.sourceTier,
      source_url: observation.sourceUrl,
      retrieved_at: observation.retrievedAt,
      connector_version: observation.connectorVersion,
      run_id: observation.runId,
      document_id: observation.documentId ?? null,
      missed_runs: 0,
      updated_at: sql`now()`,
    })
    .where('id', '=', existingSource.id)
    .execute();

  if (observation.sourceTier > posting.authority_tier) {
    // A worse tier may not overwrite a better one's words (entities/job.md). It still counts as the
    // posting being seen, which the source row above already recorded.
    await db
      .updateTable('job_postings')
      .set({ last_seen_at: observation.retrievedAt, updated_at: sql`now()` })
      .where('id', '=', posting.id)
      .execute();

    return {
      jobPostingId: posting.id,
      action: 'refused-lower-tier',
      dedupKey: posting.dedup_key,
      dedupBasis: posting.dedup_basis,
      collisionRefused: false,
    };
  }

  let key = posting.dedup_key;
  let basis = posting.dedup_basis;
  let collisionRefused = false;

  if (derived.key !== posting.dedup_key) {
    const collision = await db
      .selectFrom('job_postings')
      .select('id')
      .where('dedup_key', '=', derived.key)
      .where('deleted_at', 'is', null)
      .where('id', '!=', posting.id)
      .executeTakeFirst();

    if (collision === undefined) {
      key = derived.key;
      basis = derived.basis;
    } else {
      // Two rows that now look like one job. Merging them is destructive — matches, applications and
      // outcomes already point at both — so this records the collision and refuses to decide.
      collisionRefused = true;
    }
  }

  await db
    .updateTable('job_postings')
    .set({
      ...columnsFrom(fields),
      dedup_key: key,
      dedup_basis: basis,
      last_seen_at: observation.retrievedAt,
      stale_after: staleAfter(identity.sourceId, observation.retrievedAt),
      authority_tier: observation.sourceTier,
      confidence: confidenceForTier(observation.sourceTier),
      contested: collisionRefused ? true : undefined,
      flags: collisionRefused && !posting.flags.includes('dedup-collision-unmerged')
        ? [...posting.flags, 'dedup-collision-unmerged']
        : undefined,
      updated_at: sql`now()`,
    })
    .where('id', '=', posting.id)
    .execute();

  return { jobPostingId: posting.id, action: 'updated', dedupKey: key, dedupBasis: basis, collisionRefused };
}

export interface ExpirySweep {
  readonly identity: Pick<SourceIdentity, 'sourceId' | 'sourceScope'>;
  /** Every external id this run listed. */
  readonly seenExternalIds: readonly string[];
  /**
   * Whether the run listed **everything live** in this scope.
   *
   * A Lever board is exhaustive by construction; a keyword search is not, and a run that returned
   * fewer results than last time may mean a ranking change, a quota, or an outage.
   */
  readonly listingIsExhaustive: boolean;
  /** How many consecutive exhaustive runs must miss a posting before it expires. */
  readonly requiredMissedRuns?: number;
}

export interface ExpiryResult {
  readonly expired: readonly string[];
  readonly counted: number;
  /** Set when the sweep did nothing, and why. */
  readonly skipped: 'listing-not-exhaustive' | null;
}

/**
 * Expire what an exhaustive listing stopped listing.
 *
 * **A non-exhaustive run expires nothing and counts nothing** — not even towards a future expiry,
 * because a count built from runs that were never evidence is not evidence either.
 *
 * Nothing is deleted. An expired posting is evidence about the market and about a person's own
 * application history, and `entities/job.md` sets retention at indefinite.
 */
export async function expireMissing(db: Kysely<Database>, sweep: ExpirySweep): Promise<ExpiryResult> {
  if (!sweep.listingIsExhaustive) return { expired: [], counted: 0, skipped: 'listing-not-exhaustive' };

  const threshold = sweep.requiredMissedRuns ?? 2;

  const rows = await db
    .selectFrom('job_posting_sources as jps')
    .innerJoin('job_postings as jp', 'jp.id', 'jps.job_posting_id')
    .select(['jps.id as source_row_id', 'jps.external_id', 'jps.missed_runs', 'jp.id as job_posting_id'])
    .where('jps.source_id', '=', sweep.identity.sourceId)
    .where('jps.source_scope', '=', sweep.identity.sourceScope)
    .where('jp.expired_at', 'is', null)
    .where('jp.deleted_at', 'is', null)
    .execute();

  const seen = new Set(sweep.seenExternalIds);
  const missing = rows.filter((row) => !seen.has(row.external_id));
  const expired: string[] = [];

  for (const row of missing) {
    const missedRuns = row.missed_runs + 1;

    await db
      .updateTable('job_posting_sources')
      .set({ missed_runs: missedRuns, updated_at: sql`now()` })
      .where('id', '=', row.source_row_id)
      .execute();

    if (missedRuns < threshold) continue;

    await db
      .updateTable('job_postings')
      .set({ expired_at: sql`now()`, expiry_reason: 'source-delisted', updated_at: sql`now()` })
      .where('id', '=', row.job_posting_id)
      .execute();

    expired.push(row.job_posting_id);
  }

  return { expired, counted: missing.length, skipped: null };
}

/**
 * Expire because **we** stopped fetching a source, which is a different fact.
 *
 * Kept separate from `expireMissing` so the reason cannot be written by accident: a posting retired
 * this way was never delisted by anybody, and a person tracking it deserves to see which of the two
 * happened.
 */
export async function expireBecauseNotFetched(
  db: Kysely<Database>,
  identity: Pick<SourceIdentity, 'sourceId' | 'sourceScope'>,
): Promise<readonly string[]> {
  const rows = await db
    .selectFrom('job_posting_sources as jps')
    .innerJoin('job_postings as jp', 'jp.id', 'jps.job_posting_id')
    .select('jp.id as job_posting_id')
    .where('jps.source_id', '=', identity.sourceId)
    .where('jps.source_scope', '=', identity.sourceScope)
    .where('jp.expired_at', 'is', null)
    .where('jp.deleted_at', 'is', null)
    .execute();

  for (const row of rows) {
    await db
      .updateTable('job_postings')
      .set({ expired_at: sql`now()`, expiry_reason: 'source-not-fetched', updated_at: sql`now()` })
      .where('id', '=', row.job_posting_id)
      .execute();
  }

  return rows.map((row) => row.job_posting_id);
}

/** Postings somebody could still act on. Expired rows are retained and excluded here, never deleted. */
export function livePostings(
  db: Kysely<Database>,
  scope: { readonly countryCode?: string; readonly isRemote?: boolean } = {},
) {
  let query = db
    .selectFrom('job_postings')
    .selectAll()
    .where('deleted_at', 'is', null)
    .where('expired_at', 'is', null);

  if (scope.countryCode !== undefined) query = query.where('country_code', '=', scope.countryCode);
  // `is_remote` is nullable, so this asks for what a source *stated* — a silent source is not a
  // negative answer and must not be returned as one.
  if (scope.isRemote !== undefined) query = query.where('is_remote', '=', scope.isRemote);

  return query.orderBy('posted_at', 'desc');
}

/** Every source that has described one posting, for showing where a claim came from. */
export function sourcesForPosting(db: Kysely<Database>, jobPostingId: string) {
  return db
    .selectFrom('job_posting_sources')
    .selectAll()
    .where('job_posting_id', '=', jobPostingId)
    .orderBy('source_tier')
    .orderBy('retrieved_at', 'desc');
}
