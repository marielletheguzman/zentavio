# src

> **Purpose:** Ingestion service source: connector run orchestration, normalization, persistence.

| Module | Holds |
|---|---|
| `requirement-ingest.ts` | `planIngest` — pure; decides insert / supersede / unchanged / reject |
| `posting-ingest.ts` | `planPostingIngest` — pure; decides store / reject, and whether this run may expire anything |
| `posting-executor.ts` | applies a posting plan and its sweep in one transaction |
| `executor.ts` | applies a requirement plan |
| `posting-runner.ts` | `runJobBoards` — every board in the registry, scope by scope |
| `scheduled-run.ts` | `runDueJobBoards` — which sources are due, per their own refresh window |
| `skill-extraction.ts` | the alias scan — pure; text and a vocabulary in, rows out (ADR-0035) |
| `extraction-run.ts` | `extractDuePostings` — the pass over postings behind the current version (ADR-0036) |
| `composition.ts` | real dependencies assembled from configuration |
| `archive.ts` | the bytes a payload is stored from (ADR-0021) |
| `index.ts` | the public surface |

Design rationale is in [`../README.md`](../README.md). Planning is separated from execution so the
interesting behaviour is testable without PostgreSQL — including the one that matters most for
postings: **whether a run is allowed to expire what it did not list** (ADR-0034). Expiry needs the
source to be capable of listing everything *and* this run to have finished; the declaration alone is
not evidence.

**Two entry points, neither of them a daemon.** `runDueJobBoards` and `extractDuePostings` are
functions; what calls them is a deployment decision and nothing is deployed (ADR-0015, ADR-0021).
They are deliberately separate passes: ingest reads a connector, extraction reads the skill graph,
and putting extraction inside the ingest transaction would let a skill-graph query failure roll back
a board (ADR-0036).
