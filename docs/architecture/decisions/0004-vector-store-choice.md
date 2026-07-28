# ADR 0004: Vector Store Choice

> **Purpose:** Vector store selection for embeddings.

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** `knowledge-engine/vector-store`, `ai/embeddings`, `packages/db`, `infra/docker`, `infra/terraform`

## Context

Zentavio needs semantic retrieval: given a resume, a skill phrase, or a career description, find
candidate skills, careers, postings, and learning resources worth reasoning about. That is
embedding search over a corpus that grows with every ingestion run.

Two constraints shape the choice, and both come from existing decisions rather than from
preference.

First, **the vector store is an index, never a system of record**
(`.claude/skills/knowledge-engine/SKILL.md`). PostgreSQL holds the facts; every vector is derived
from a row and carries `sourceRowId`, `embeddingModel`, `embeddingVersion`, `embeddedAt`. Dropping
a collection must cost only compute. This removes durability and backup from the decision, which
would otherwise dominate it.

Second, **semantic search retrieves candidates; it never decides a fact or a score**
(`.claude/skills/ai-matching/SKILL.md`). A nearest neighbour is a hint. So recall matters more
than precision at the top, and exact-tie behavior does not matter at all.

Third, an operational constraint: changing the embedding model means a new collection plus a
backfill plus a cutover, never a mixed collection — distances across two models are meaningless.
Whatever is chosen must make running two collections side by side and swapping them cheap.

The tension: PostgreSQL is already in the stack and adding a datastore is exactly what
`.claude/context/tech-stack.md` says requires an ADR. A second store must earn its operational
cost.

## Options considered

### Option A — pgvector in the existing PostgreSQL

**Pros.** No new datastore, no new deployment, no new backup story, no new failure mode. Vectors
and facts live in one database, so a filtered search ("skills in this cluster, ordered by
similarity") is one SQL query with a join — genuinely valuable, since most Zentavio searches are
filtered by country, track, or freshness. Transactional consistency between a fact and its
embedding for free. One connection pool, one migration path, one thing to monitor.

**Cons.** Index build and recall tuning are coupled to the database that also serves every
transactional query. A large HNSW rebuild competing with production queries is a real operational
risk, and the mitigation is a read replica — which is itself new infrastructure. Running two
collections during a model migration means two tables plus swapping which one queries read, which
is workable but manual. Scaling vector search independently of transactional load is not possible
without splitting the database anyway.

### Option B — Qdrant as a dedicated vector store

**Pros.** Purpose-built: named collections make the "new collection, backfill, cutover" migration
path a first-class operation rather than a manual table swap, which matters because embedding
model changes are expected, not exceptional. Payload filtering supports the filtered-search
pattern without joining back to PostgreSQL for the common cases. Vector workload is isolated from
transactional load, so an index rebuild cannot slow down a user's dashboard. Scales independently.
Runs as a container locally and in `infra/docker`, so development parity is straightforward. The
Python client is first-class, which matches `ai/embeddings` (ADR-0003).

**Cons.** A new datastore: another deployment, another health check, another set of credentials,
another failure mode, another thing in Terraform. Consistency between a fact and its vector
becomes eventual — a fact can exist without its embedding, so the ingest path must handle that
state explicitly. Filtering that needs data not copied into the payload requires a round trip to
PostgreSQL. Payload duplication means the filterable fields exist in two places and can drift.

### Option C — A hosted vector database

**Pros.** No operational burden, managed scaling and upgrades.

**Cons.** Ruled out by `.claude/context/tech-stack.md`: a hosted third-party service for a
capability the stack can cover is not the default path. It also puts derived user data — embeddings
of resume content — outside our infrastructure, which is a poor fit for
`docs/architecture/privacy.md` given how sensitive resumes and immigration status are. Cost scales
with a corpus that is expected to grow indefinitely.

### Option D — Do nothing: brute-force cosine similarity in the application

**Pros.** Zero infrastructure. Entirely adequate for a seeded skill graph of a few thousand
vectors, which is the near-term phase.

**Cons.** Does not survive the first real posting corpus. Honest as a temporary implementation
detail behind the port, not as a decision — and building the port against it is exactly what makes
the eventual swap cheap.

## Decision

Qdrant is Zentavio's vector store, accessed only through a port in `knowledge-engine/vector-store`
so the implementation is swappable; PostgreSQL remains the sole system of record and every vector
stays derived and rebuildable.

## Consequences

**Accepted costs.**

- A new datastore to deploy, monitor, credential, and represent in Terraform. It is now a
  readiness-check dependency for anything that does semantic retrieval.
- Fact-to-vector consistency is eventual. The ingest path must tolerate a fact with no embedding
  yet, and any surface using retrieval must not assume completeness.
- Filterable fields are duplicated into Qdrant payloads and can drift from PostgreSQL. The
  rebuild path is the mitigation, and it must actually be exercised.
- Filters needing data outside the payload cost a round trip to PostgreSQL.
- One more client library in `ai/` and in `knowledge-engine/`.

**Follow-up work.**

- Define the vector-store port in `knowledge-engine/vector-store`: `upsert`, `search`, `delete`,
  `createCollection`, `swapAlias`. Nothing outside this module talks to Qdrant.
- Implement a brute-force in-memory adapter behind the same port for tests and for the seeded
  early phase. This is what keeps the decision reversible and keeps tests off a container.
- Enforce vector metadata on write: `sourceRowId`, `embeddingModel`, `embeddingVersion`,
  `embeddedAt`. A vector missing these is unusable and must be rejected.
- Build the rebuild-from-PostgreSQL job before the first production collection exists. A rebuild
  path that has never been run is not a rebuild path.
- Document the model-migration runbook: new collection → backfill → verify recall → cutover →
  retire old.
- Add Qdrant to `infra/docker` for local parity and to `infra/terraform` for deployment, plus a
  readiness check in every service that depends on retrieval.

**Reversal cost.** Low, and kept low deliberately — the reason for the port. Switching to pgvector
means one new adapter plus a rebuild from PostgreSQL; no fact is lost, because no fact lives here.
The signal to revisit: if filtered search dominates real usage and the round trips to PostgreSQL
outweigh the isolation benefit, pgvector becomes the simpler answer and the swap is an adapter.

## Compliance

- **Port isolation:** the Qdrant client is imported only inside `knowledge-engine/vector-store`.
  Enforced in `eslint.config.mjs` (`@qdrant/*` restricted everywhere except that directory) and in
  `ruff.toml` (`qdrant_client` banned under `ai/`). This is what makes the reversal cost claim true.
- **Metadata check:** a test asserts that upsert rejects a vector missing `sourceRowId`,
  `embeddingModel`, `embeddingVersion`, or `embeddedAt`.
- **Rebuild test:** an integration test drops a test collection, rebuilds it from PostgreSQL, and
  asserts the vector count and a sample of recalled ids. This proves the index-not-record claim.
- **No-mixed-model check:** a test asserts a collection contains exactly one
  `embeddingModel`/`embeddingVersion` pair.
- **Reviewer check:** no user-facing surface treats a vector search result as evidence. Evidence
  comes from PostgreSQL facts with provenance — see `.claude/skills/ai-matching/SKILL.md`.

## Related

- ADR-0001 (monorepo), ADR-0003 (Python for AI services)
- `.claude/skills/knowledge-engine/SKILL.md` — the vector-store rules
- `.claude/context/tech-stack.md`, `.claude/context/knowledge-sources.md`
- `docs/database/vector-store.md`, `docs/architecture/knowledge-engine.md`
