# src

> **Purpose:** Ingestion service source: connector run orchestration, normalization, persistence.

| Module | Holds |
|---|---|
| `requirement-ingest.ts` | `planIngest` — pure; decides insert / supersede / unchanged / reject |
| `posting-ingest.ts` | `planPostingIngest` — pure; decides store / reject, and whether this run may expire anything |
| `posting-executor.ts` | applies a posting plan and its sweep in one transaction |
| `executor.ts` | applies a requirement plan |
| `archive.ts` | the bytes a payload is stored from (ADR-0021) |
| `index.ts` | the public surface |

Design rationale is in [`../README.md`](../README.md). Planning is separated from execution so the
interesting behaviour is testable without PostgreSQL — including the one that matters most for
postings: **whether a run is allowed to expire what it did not list** (ADR-0034). Expiry needs the
source to be capable of listing everything *and* this run to have finished; the declaration alone is
not evidence.
