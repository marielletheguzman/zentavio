/**
 * Running the job boards: registry → search → archive → plan → execute.
 *
 * **No source is named here.** The runner asks the registry for connectors of kind `job-board` and
 * works from `connector.meta` and the shared `JobPosting` shape. Adding a second board requires no
 * edit to this file, which is the claim ADR-0002 makes and this is where it is easiest to break.
 *
 * ## Why the run outcome is computed here and not declared
 *
 * A connector says whether its source *can* list everything (`meta.listing`). Only the thing driving
 * the pagination knows whether this run actually got all of it — and that is this module. A page
 * that threw, a cursor abandoned, a scope that errored halfway: each makes the listing incomplete,
 * and `planPostingIngest` refuses to expire anything for that scope (ADR-0034's amendment).
 *
 * **Per scope, not per run.** One board failing must not suppress expiry for a board that succeeded,
 * and must not license expiry for itself. Scopes are independent, so their outcomes are too.
 *
 * ## What a failure does not do
 *
 * It does not stop the run. One dead source must never stall the others
 * (`docs/architecture/connectors.md`), so a throw is caught, recorded against its scope, and the run
 * continues — with that scope's postings still written and its sweep withheld.
 */

import type { AnyConnector, ConnectorRegistry } from '@zentavio/connectors-core';
import { employerForBoard, type Database, type SourceObservation } from '@zentavio/db';
import type { JobPosting } from '@zentavio/types';
import type { Kysely } from 'kysely';

import { archiveSource, type ArchiveDeps } from './archive.ts';
import { executePostingPlan, type PostingExecutionReport } from './posting-executor.ts';
import { planPostingIngest, type RunOutcome } from './posting-ingest.ts';

export interface RunnerDeps {
  readonly db: Kysely<Database>;
  /** UUIDv7, injected so a run is reproducible in a test. */
  readonly newId: () => string;
  /** Injected so `retrievedAt` is not read from a global clock inside the pipeline. */
  readonly now: () => Date;
  /**
   * Archiving (ADR-0021). Optional: a run without it stores postings and records no document, which
   * is what a development environment with no object storage does. Its absence is reported per
   * scope rather than passed over, because "not archived" and "archived" must not look alike.
   */
  readonly archive?: ArchiveDeps;
  /** Upper bound on pages per connector, so a broken cursor cannot loop forever. */
  readonly maxPages?: number;
}

export interface ScopeReport extends PostingExecutionReport {
  /** Whether this scope's listing was complete, and why not when it was not. */
  readonly run: RunOutcome;
  /** `archived`, `nothing-to-archive`, `failed: …`, or `not-configured` when no store was supplied. */
  readonly archive: string;
  /**
   * The employer this board is bound to, or `null` when nobody has stated one (ADR-0040).
   *
   * Reported rather than left implicit: a run that stores 239 postings with no employer has done
   * something different from one that resolved them, and a report that does not say so reads the
   * same either way.
   */
  readonly employerCompanyId: string | null;
}

export interface RunReport {
  readonly runId: string;
  readonly startedAt: Date;
  readonly scopes: readonly ScopeReport[];
  /** Sources that threw before producing anything. A run reports what it could not read. */
  readonly unreadable: readonly { readonly sourceId: string; readonly reason: string }[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Postings grouped by the namespace they were listed under; one plan and one sweep per scope. */
function byScope(postings: readonly JobPosting[]): Map<string, JobPosting[]> {
  const scopes = new Map<string, JobPosting[]>();
  for (const posting of postings) {
    const existing = scopes.get(posting.sourceScope);
    if (existing === undefined) scopes.set(posting.sourceScope, [posting]);
    else existing.push(posting);
  }
  return scopes;
}

function observationFor(posting: JobPosting, runId: string, documentId: string | null): SourceObservation {
  return {
    sourceTier: posting.sourceTier,
    sourceUrl: posting.sourceUrl,
    retrievedAt: new Date(posting.retrievedAt),
    connectorVersion: '',
    runId,
    documentId,
  };
}

/**
 * Read every page a connector offers, archiving each payload as it arrives.
 *
 * Returns what it managed to read **and** whether it read all of it. A partial result is still
 * written — postings we did see are real — and it is the completeness flag, not the postings, that
 * decides whether anything may be retired.
 */
async function readAll(
  connector: AnyConnector,
  deps: RunnerDeps,
): Promise<{
  readonly postings: readonly JobPosting[];
  readonly outcome: RunOutcome;
  readonly archive: string;
}> {
  const maxPages = deps.maxPages ?? 50;
  const postings: JobPosting[] = [];
  let archive = deps.archive === undefined ? 'not-configured' : 'nothing-to-archive';
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    let batch;
    try {
      batch = await connector.search({}, cursor);
    } catch (error) {
      return { postings, outcome: { completed: false, reason: describeError(error) }, archive };
    }

    for (const raw of batch.items) {
      if (deps.archive !== undefined) {
        const outcome = await archiveSource(connector, raw, connector.meta.id, deps.now().toISOString(), deps.archive);
        // A failed archive does not discard the postings: refusing to store a real job because we
        // could not keep a copy of the page helps nobody. It is reported, and ADR-0021's enforcement
        // phase is where that becomes a rejection.
        archive = outcome.kind === 'failed' ? `failed: ${outcome.reason}` : outcome.kind;
      }

      try {
        postings.push(...(connector.normalize(raw) as readonly JobPosting[]));
      } catch (error) {
        // `normalize` is contractually total, so this is a connector defect rather than a bad page.
        // The scope loses its sweep because what we hold is no longer a complete listing.
        return { postings, outcome: { completed: false, reason: `normalize threw: ${describeError(error)}` }, archive };
      }
    }

    if (batch.nextCursor === undefined) return { postings, outcome: { completed: true }, archive };
    cursor = batch.nextCursor;
  }

  // The cursor never ended. Whatever we have is not a complete listing, and saying so is the
  // difference between a stale board and a board we quietly emptied.
  return { postings, outcome: { completed: false, reason: `stopped after ${maxPages} pages` }, archive };
}

/**
 * Run every registered job board.
 *
 * Each scope is planned and executed independently, so one board's failure neither stops another nor
 * licenses expiry for itself.
 */
export async function runJobBoards(registry: ConnectorRegistry, deps: RunnerDeps): Promise<RunReport> {
  const runId = deps.newId();
  const startedAt = deps.now();
  const scopes: ScopeReport[] = [];
  const unreadable: { sourceId: string; reason: string }[] = [];

  for (const connector of registry.byKind('job-board')) {
    const read = await readAll(connector, deps);

    if (read.postings.length === 0) {
      if (!read.outcome.completed) {
        unreadable.push({ sourceId: connector.meta.id, reason: read.outcome.reason ?? 'unstated' });
      }
      continue;
    }

    for (const [scope, postings] of byScope(read.postings)) {
      // Resolved once per board, not per posting: the employer is a property of the namespace, and
      // it cannot change within a run (ADR-0040 rule 5). `null` when nothing is bound, which stores
      // the postings with a visible gap rather than an invented employer.
      const employerCompanyId = await employerForBoard(deps.db, connector.meta.id, scope);

      const plan = planPostingIngest({
        meta: connector.meta,
        sourceScope: scope,
        observation: observationFor(postings[0]!, runId, null),
        postings: postings.map((posting) => ({
          externalId: posting.externalId,
          fields: {
            title: posting.title,
            url: posting.url,
            companyId: employerCompanyId,
            // Still whatever the source said, which for an ATS board is nothing. The binding is the
            // evidence for `companyId`; this column is the evidence for a source that names one.
            companyNameRaw: posting.companyNameRaw,
            description: posting.description,
            requirementsText: posting.requirementsText,
            countryCode: posting.countryCode,
            locationRaw: posting.locationText,
            isRemote: posting.isRemote,
            remoteScope: posting.remoteScope,
            departmentRaw: posting.department,
            teamRaw: posting.team,
            commitmentRaw: posting.commitment,
            salaryIsStated: posting.salaryIsStated,
            salaryMin: posting.salaryMin,
            salaryMax: posting.salaryMax,
            currency: posting.currency,
            salaryPeriod: posting.salaryPeriod,
            postedAt: posting.postedAt === null ? null : new Date(posting.postedAt),
          },
        })),
        validation: connector.validate(postings as never),
        run: read.outcome,
      });

      const report = await executePostingPlan(deps.db, plan, {
        ...observationFor(postings[0]!, runId, null),
        connectorVersion: connector.meta.version,
      });

      scopes.push({ ...report, run: read.outcome, archive: read.archive, employerCompanyId });
    }
  }

  return { runId, startedAt, scopes, unreadable };
}
