/**
 * `@zentavio/ingestion` — runs connectors and persists what they return.
 *
 * The persistence half of the plugin architecture. A connector fetches and returns data; this
 * service decides what to store, supersedes what changed, and rejects what fails validation
 * (ADR-0002, `docs/architecture/connectors.md`).
 */

export {
  dayBefore,
  planIngest,
  summarize,
  toRow,
  type ExistingRequirement,
  type IngestAction,
  type IngestDecision,
  type IngestPlan,
  type IngestSummary,
} from './requirement-ingest.ts';
