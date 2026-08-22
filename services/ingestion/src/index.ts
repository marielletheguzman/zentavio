/**
 * `@zentavio/ingestion` — runs connectors and persists what they return.
 *
 * The persistence half of the plugin architecture. A connector fetches and returns data; this
 * service decides what to store, supersedes what changed, and rejects what fails validation
 * (ADR-0002, `docs/architecture/connectors.md`).
 */

export {
  archiveDerivedSources,
  archiveSource,
  type ArchiveDeps,
  type ArchiveOutcome,
  type ArchivedInstrument,
  type DerivedArchiveOutcome,
} from './archive.ts';

export { executePlan, type ExecutionReport } from './executor.ts';

export { executePostingPlan, type PostingExecutionReport } from './posting-executor.ts';

export {
  expiryLicenceFor,
  planPostingIngest,
  summarizePostings,
  type ExpiryLicence,
  type PostingAction,
  type PostingCandidate,
  type PostingDecision,
  type PostingIngestInput,
  type PostingPlan,
  type PostingPlanSummary,
  type RunOutcome,
} from './posting-ingest.ts';

export {
  dayBefore,
  planIngest,
  summarize,
  toRow,
  type Evidence,
  type ExistingRequirement,
  type IngestAction,
  type IngestDecision,
  type IngestPlan,
  type IngestSummary,
} from './requirement-ingest.ts';
