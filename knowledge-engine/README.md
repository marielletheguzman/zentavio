# knowledge-engine

> **Purpose:** Learning and intelligence layer. Turns raw sources into structured knowledge AI reasons from.

_Structure placeholder — no implementation yet._ Thirteen READMEs, zero implementation files, since
2026-07-28.

**It does not store anything, and that is the decision rather than the backlog** (ADR-0020,
Proposed). Structured knowledge is stored in `packages/db` — schema, seeds, repositories — because a
skill graph queried on every gap request has to be in the database. What belongs here is what earns
a fact the right to be stored: ingest and reconciliation, source tier and provenance, conflict
resolution, outcome collection and aggregation.

**The seeded skill graph is not here.** It is `packages/db/seeds/cloud-platform-engineering.json`,
loaded by `packages/db/src/seed.ts` into `skills`, `skill_aliases`, `skill_edges` and
`career_skills`. `skills-graph/` below is empty and stays empty — filling it would be building a
second copy of something that already runs.

The line this layer defends is unchanged and lives in `docs/architecture/knowledge-engine.md`: if it
is a fact, it is knowledge; if it is a judgment about facts, it belongs in `ai/`.
