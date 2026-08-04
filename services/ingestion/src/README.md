# src

> **Purpose:** Ingestion service source: connector run orchestration, normalization, persistence.

| Module | Holds |
|---|---|
| `requirement-ingest.ts` | `planIngest` — pure; decides insert / supersede / unchanged / reject |
| `index.ts` | the public surface |

Design rationale is in [`../README.md`](../README.md). Nothing here writes to the database yet:
planning is separated from execution so the interesting behaviour is testable without PostgreSQL.
