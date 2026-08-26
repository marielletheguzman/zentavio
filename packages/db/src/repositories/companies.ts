/**
 * Employer identity: resolution, creation, and the board-to-employer binding (ADR-0040).
 *
 * ## The order is the entity document's, and it is not negotiable
 *
 * `docs/database/entities/company.md` fixes it: exact `primary_domain`, then
 * `company_aliases.normalized`, then no match. **Never fuzzy.** A similarity threshold that merges
 * "Acme Health" into "Acme Healthcare" eventually merges two real employers, and the resulting
 * outcome data is wrong in a way no later check can find. An unresolved company is a visible gap; a
 * wrongly merged one is not.
 *
 * ## What this module will not do
 *
 * **Turn a board slug into a name.** `bindBoardToCompany` takes a `companyId` that a caller already
 * resolved or created deliberately, and touches `company_aliases` never. A slug is a vendor's name
 * for a tenant, and `uq_company_aliases__normalized` is global — storing `apple` as an alias would
 * resolve a small employer's whole board onto Apple, and the row would look correct
 * (ADR-0040 rule 2, asserted by `tests/unit/invariants/no-board-slug-alias.test.ts`).
 *
 * **Invent a binding.** Every binding carries the URL, tier and date somebody checked it against.
 * Those columns are NOT NULL in the schema so the omission fails at write time rather than becoming
 * an unattributable claim later.
 */

import { sql, type Kysely, type Selectable } from 'kysely';

import type { CompaniesTable, Database, JobBoardEmployersTable } from '../schema.ts';
import { normalizeCompanyAlias } from '../seed.ts';
import { uuidv7 } from '../uuid.ts';

export type CompanyRow = Selectable<CompaniesTable>;
export type JobBoardEmployerRow = Selectable<JobBoardEmployersTable>;

/** How a company was found, so a caller can tell a domain match from an alias match from a miss. */
export type CompanyResolutionBasis = 'primary-domain' | 'alias' | 'unresolved';

export interface CompanyResolution {
  readonly companyId: string | null;
  readonly basis: CompanyResolutionBasis;
}

/** What a caller knows about an employer. Both optional — a source may supply either or neither. */
export interface CompanyIdentityInput {
  /** Host only, as `companies.primary_domain` stores it: `zoox.com`, never a URL, never `www.`. */
  readonly primaryDomain?: string | null;
  /** As the source wrote it. Normalized here, by the one shared function. */
  readonly name?: string | null;
}

/**
 * Resolve an employer from what a source said about it.
 *
 * Returns `unresolved` rather than throwing: a posting whose employer is unknown is a stored posting
 * with a null `company_id`, which is the documented gap, not an error path.
 */
export async function resolveCompany(
  db: Kysely<Database>,
  identity: CompanyIdentityInput,
): Promise<CompanyResolution> {
  const domain = identity.primaryDomain?.trim().toLowerCase() ?? '';

  if (domain !== '') {
    const byDomain = await db
      .selectFrom('companies')
      .select('id')
      .where('primary_domain', '=', domain)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (byDomain !== undefined) return { companyId: byDomain.id, basis: 'primary-domain' };
  }

  const normalized = normalizeCompanyAlias(identity.name ?? '');

  if (normalized !== '') {
    const byAlias = await db
      .selectFrom('company_aliases')
      .select('company_id')
      .where('normalized', '=', normalized)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (byAlias !== undefined) return { companyId: byAlias.company_id, basis: 'alias' };
  }

  return { companyId: null, basis: 'unresolved' };
}

export interface CreateCompanyInput {
  readonly slug: string;
  readonly canonicalName: string;
  readonly legalName?: string | null;
  readonly primaryDomain?: string | null;
  readonly countryCode?: string | null;
  readonly sourceTier: number;
  readonly sourceUrl?: string | null;
  readonly retrievedAt?: Date | null;
  /**
   * Names this employer is known by. The canonical name is added automatically; a **board slug is
   * not a name** and must not be passed here.
   */
  readonly aliases?: readonly string[];
}

/**
 * Create a company and its aliases in one statement, so no row exists without the names that resolve
 * to it.
 *
 * Duplicate suppression is the database's: `uq_companies__domain` and `uq_company_aliases__normalized`
 * refuse a second live row, which is what makes "one row means one employer" structural rather than
 * intended. An alias already pointing at another company is left alone rather than repointed —
 * silently moving an alias is the wrong-merge failure wearing an upsert's clothing.
 */
export async function createCompany(db: Kysely<Database>, input: CreateCompanyInput): Promise<string> {
  const id = uuidv7();

  await db
    .insertInto('companies')
    .values({
      id,
      slug: input.slug,
      canonical_name: input.canonicalName,
      legal_name: input.legalName ?? null,
      primary_domain: input.primaryDomain ?? null,
      country_code: input.countryCode ?? null,
      source_tier: input.sourceTier,
      source_url: input.sourceUrl ?? null,
      retrieved_at: input.retrievedAt ?? null,
    })
    .execute();

  const names = [input.canonicalName, ...(input.aliases ?? [])];
  const seen = new Set<string>();

  for (const name of names) {
    const normalized = normalizeCompanyAlias(name);
    if (normalized === '' || seen.has(normalized)) continue;
    seen.add(normalized);

    await db
      .insertInto('company_aliases')
      .values({ id: uuidv7(), company_id: id, alias: name, normalized, source_tier: input.sourceTier })
      // `uq_company_aliases__normalized` is **partial** (`WHERE deleted_at IS NULL`), so the conflict
      // target must repeat that predicate or PostgreSQL matches no index and rejects the statement.
      .onConflict((oc) => oc.columns(['normalized']).where('deleted_at', 'is', null).doNothing())
      .execute();
  }

  return id;
}

export interface BoardBindingInput {
  /** The connector's `meta.id`, matching `job_postings.source_id`. */
  readonly sourceId: string;
  /** The board. Empty string for a source with one global namespace (ADR-0034). */
  readonly sourceScope: string;
  readonly companyId: string;
  /** 1–3. Tier 4 is refused by CHECK — an employer identity is not an anecdote. */
  readonly sourceTier: number;
  /** The page that states the board belongs to this employer. Re-openable, so re-checkable. */
  readonly sourceUrl: string;
  /** When it was checked. Not `now()` by default: a caller that did not check must say so. */
  readonly retrievedAt: Date;
}

/**
 * State that a board is operated by an employer.
 *
 * **Rebinding supersedes rather than rewrites.** A board that changes hands gets a new row and the
 * old one is soft-deleted, because that row is the evidence for every posting resolved under it —
 * the same reason `companies` keeps a merged row and points it forward. The partial unique index
 * keeps exactly one live binding per board, so this is two statements and not an `UPDATE`.
 */
export async function bindBoardToCompany(
  db: Kysely<Database>,
  input: BoardBindingInput,
): Promise<{ readonly id: string; readonly action: 'created' | 'unchanged' | 'rebound' }> {
  const live = await db
    .selectFrom('job_board_employers')
    .select(['id', 'company_id'])
    .where('source_id', '=', input.sourceId)
    .where('source_scope', '=', input.sourceScope)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (live !== undefined && live.company_id === input.companyId) {
    // Same employer, re-checked. The claim is unchanged; when it was last verified is not.
    await db
      .updateTable('job_board_employers')
      .set({
        source_tier: input.sourceTier,
        source_url: input.sourceUrl,
        retrieved_at: input.retrievedAt,
        updated_at: sql`now()`,
      })
      .where('id', '=', live.id)
      .execute();

    return { id: live.id, action: 'unchanged' };
  }

  if (live !== undefined) {
    await db
      .updateTable('job_board_employers')
      .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
      .where('id', '=', live.id)
      .execute();
  }

  const id = uuidv7();

  await db
    .insertInto('job_board_employers')
    .values({
      id,
      source_id: input.sourceId,
      source_scope: input.sourceScope,
      company_id: input.companyId,
      source_tier: input.sourceTier,
      source_url: input.sourceUrl,
      retrieved_at: input.retrievedAt,
    })
    .execute();

  return { id, action: live === undefined ? 'created' : 'rebound' };
}

/**
 * The employer operating a board, or `null` when nobody has stated one.
 *
 * `null` is the documented outcome, not a failure: the postings are stored, extracted and scored
 * exactly as before, with a visible gap where the employer would be (ADR-0040 rule 3).
 */
export async function employerForBoard(
  db: Kysely<Database>,
  sourceId: string,
  sourceScope: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('job_board_employers')
    .select('company_id')
    .where('source_id', '=', sourceId)
    .where('source_scope', '=', sourceScope)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  return row?.company_id ?? null;
}

/** Every live binding, for the backfill and for reading what has actually been curated. */
export async function liveBoardBindings(db: Kysely<Database>): Promise<readonly JobBoardEmployerRow[]> {
  return db
    .selectFrom('job_board_employers')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('source_id')
    .orderBy('source_scope')
    .execute();
}

/**
 * Attach a resolved employer to the postings already stored for its board.
 *
 * Ingest resolves at write time (ADR-0040 rule 5), which leaves every posting stored before a binding
 * existed with a null `company_id` and no cheap way to re-fetch it. This is that repair, and it is
 * deliberately narrow: it touches only rows whose `company_id` is still null, so it can never move a
 * posting from one employer to another.
 *
 * **It does not recompute `dedup_key`.** A stored posting's key was derived under
 * `source-identity` and rewriting it here would rewrite identity for rows that `matches`,
 * `applications` and `outcomes` already point at. The next sighting from the source recomputes it
 * through `upsertPostingFromSource`, which refuses the change when it would collide.
 */
export async function backfillPostingEmployer(
  db: Kysely<Database>,
  sourceId: string,
  sourceScope: string,
  companyId: string,
): Promise<number> {
  const result = await db
    .updateTable('job_postings')
    .set({ company_id: companyId, updated_at: sql`now()` })
    .where('company_id', 'is', null)
    .where('deleted_at', 'is', null)
    .where(({ exists, selectFrom }) =>
      exists(
        selectFrom('job_posting_sources')
          .select('job_posting_sources.id')
          .whereRef('job_posting_sources.job_posting_id', '=', 'job_postings.id')
          .where('job_posting_sources.source_id', '=', sourceId)
          .where('job_posting_sources.source_scope', '=', sourceScope),
      ),
    )
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0n);
}
