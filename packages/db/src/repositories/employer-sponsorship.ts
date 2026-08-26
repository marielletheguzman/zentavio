/**
 * What is known about an employer's migration support, per country, versioned.
 *
 * Specified by `docs/database/entities/employer-sponsorship.md`, deferred by ADR-0039 for want of a
 * key and given one by ADR-0040. This module is the writer that table was waiting for.
 *
 * ## Recording is superseding, never updating
 *
 * A sponsor licence lapses and a policy changes, but the old fact stays true of the date it
 * described — and an `applications` row created while it was live was created on that belief.
 * `recordSponsorshipFact` closes the previous live row and inserts a new one pointing back at it, in
 * one transaction, because `uq_esf__current` permits exactly one live row per claim and a caller
 * that closed the old row separately could crash between the two writes and leave the claim silently
 * absent.
 *
 * ## What this module will not do
 *
 * **Write a status the source does not support.** The constraints refuse a stated claim with no URL,
 * an inference with no sample size, and — `ck_esf__inferred_source_kind` — an inference from prose,
 * which is ADR-0039 rule 3 in the table the value was reserved for. Those rules live in the schema
 * rather than here on purpose: a rule enforced only by a function is bypassed by the next writer's
 * UPDATE, which is the reason ADR-0039's own tests exercise the constraints by direct INSERT.
 *
 * **Decide a score.** `employer_migration_scores` does not exist, and a composite over these facts
 * needs its factor list and scorer version decided first — the question ADR-0022 and ADR-0037 each
 * answered with an ADR rather than a migration.
 */

import { sql, type Kysely, type Selectable } from 'kysely';

import type {
  Database,
  EmployerSponsorshipFactsTable,
  SponsorshipClaimColumn,
  SponsorshipSourceKindColumn,
  SponsorshipStatusColumn,
} from '../schema.ts';
import { uuidv7 } from '../uuid.ts';

export type SponsorshipFactRow = Selectable<EmployerSponsorshipFactsTable>;

export interface RecordSponsorshipFactInput {
  readonly companyId: string;
  /** ISO-3166-1 alpha-2. Part of the key: an employer sponsors in a country, not in general. */
  readonly jurisdiction: string;
  readonly claim: SponsorshipClaimColumn;
  readonly status: SponsorshipStatusColumn;
  readonly detail?: Record<string, unknown>;
  /** The connector that ingested it. Absent when a person curated the fact by hand. */
  readonly sourceId?: string | null;
  readonly sourceTier: number;
  /** Required by the schema for any stated status, and the reason the claim can be re-checked. */
  readonly sourceUrl?: string | null;
  readonly sourceKind: SponsorshipSourceKindColumn;
  readonly retrievedAt: Date;
  /** Sample size and window behind an `inferred_likely` row. Both required for that status. */
  readonly supportCount?: number | null;
  readonly supportWindow?: string | null;
  /** ISO date. The day the fact began being true, which is rarely the day it was read. */
  readonly effectiveFrom: string;
  /** ISO date. When to re-check, because a licence lapses without announcing it. */
  readonly refreshAfter: string;
}

/** Everything currently believed about one employer, across countries and claims. */
export function liveSponsorshipFacts(db: Kysely<Database>, companyId: string) {
  return db
    .selectFrom('employer_sponsorship_facts')
    .selectAll()
    .where('company_id', '=', companyId)
    .where('effective_to', 'is', null)
    .orderBy('jurisdiction')
    .orderBy('claim');
}

/**
 * The one live fact for a claim, or `undefined`.
 *
 * `undefined` means **nobody has recorded anything**, which is not the same as a recorded `unknown`
 * — that one is a claim somebody looked into and could not settle. Callers that flatten the two
 * lose the distinction the four-valued status exists to carry.
 */
export async function liveSponsorshipFact(
  db: Kysely<Database>,
  companyId: string,
  jurisdiction: string,
  claim: SponsorshipClaimColumn,
): Promise<SponsorshipFactRow | undefined> {
  return db
    .selectFrom('employer_sponsorship_facts')
    .selectAll()
    .where('company_id', '=', companyId)
    .where('jurisdiction', '=', jurisdiction)
    .where('claim', '=', claim)
    .where('effective_to', 'is', null)
    .executeTakeFirst();
}

/** Live facts due a re-check on or before `asOf`, oldest first. */
export function staleSponsorshipFacts(db: Kysely<Database>, asOf: string) {
  return db
    .selectFrom('employer_sponsorship_facts')
    .selectAll()
    .where('effective_to', 'is', null)
    .where('refresh_after', '<=', asOf)
    .orderBy('refresh_after');
}

/**
 * Record a fact, superseding whatever was live for the same `(company, jurisdiction, claim)`.
 *
 * Returns the new row. The superseded row keeps its evidence and gains an `effective_to` of the new
 * row's `effective_from`, so the two abut rather than overlap and a reader asking "what did we
 * believe on this date" gets one answer.
 *
 * **Both writes are one transaction.** `uq_esf__current` is partial on `effective_to IS NULL`, so
 * inserting before closing would violate it — and closing before inserting, in two statements,
 * leaves a window where the claim has no live row at all. A reader in that window sees "nobody has
 * recorded anything", which is a different and more permissive answer than the one being replaced.
 */
export async function recordSponsorshipFact(
  db: Kysely<Database>,
  input: RecordSponsorshipFactInput,
): Promise<SponsorshipFactRow> {
  return db.transaction().execute(async (trx) => {
    const previous = await trx
      .selectFrom('employer_sponsorship_facts')
      .select('id')
      .where('company_id', '=', input.companyId)
      .where('jurisdiction', '=', input.jurisdiction)
      .where('claim', '=', input.claim)
      .where('effective_to', 'is', null)
      .executeTakeFirst();

    if (previous !== undefined) {
      await trx
        .updateTable('employer_sponsorship_facts')
        .set({ effective_to: input.effectiveFrom, updated_at: sql`now()` })
        .where('id', '=', previous.id)
        .execute();
    }

    return trx
      .insertInto('employer_sponsorship_facts')
      .values({
        id: uuidv7(),
        company_id: input.companyId,
        jurisdiction: input.jurisdiction,
        claim: input.claim,
        status: input.status,
        detail: JSON.stringify(input.detail ?? {}),
        source_id: input.sourceId ?? null,
        source_tier: input.sourceTier,
        source_url: input.sourceUrl ?? null,
        source_kind: input.sourceKind,
        retrieved_at: input.retrievedAt,
        support_count: input.supportCount ?? null,
        support_window: input.supportWindow ?? null,
        effective_from: input.effectiveFrom,
        effective_to: null,
        supersedes: previous?.id ?? null,
        refresh_after: input.refreshAfter,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}
