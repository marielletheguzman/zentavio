# Knowledge Engine

> **Purpose:** Learning layer: skills-graph, market-intel, embeddings, feedback loop.

The knowledge engine is why Zentavio can explain itself. It is the only place structured truth lives,
and it is what makes the platform improve rather than merely operate: facts accumulate, graphs
densify, and outcomes turn described scores into predicted ones.

## The line it defends

> If it is a fact, it belongs here. If it is a judgment about facts, it belongs in `ai/`.

| Knowledge engine | AI service |
|---|---|
| "The EU Blue Card IT threshold is X as of 2026-01-01" | "You are likely eligible" |
| "This posting requires Kubernetes" | "This is a 0.72 match for you" |
| "Kubernetes is adjacent to Docker, weight 0.8, from posting co-occurrence" | "Learn Docker before Kubernetes" |
| "37 users with profile P were offered role R" | "Your probability of an offer is …" |

A judgment persisted as a fact corrupts every answer downstream, because the next reasoning step
cites it as truth. This is the most consequential rule in the layer.

## Modules

| Module | Holds |
|---|---|
| `skills-graph` | skills and their typed, weighted relationships |
| `companies` | company registry, aliases, size, locations, stack |
| `immigration` | versioned, dated, tier-1 rules and the pathways composed of them |
| `market-intel` | demand, salary bands, hiring difficulty, trends, by market |
| `interview-reports` | aggregated experiential reports (tier 4, counted and dated) |
| `outcomes` | recorded real-world results — the feedback signal |
| `vector-store` | Qdrant collections; derived, rebuildable embeddings |
| `ingest` | idempotent write paths from connector output to facts |

## Every fact carries its provenance

```text
id             uuid (v7)
subject        entity the fact is about
predicate      what is asserted
value          typed; null means unknown — never 0, never a default
sourceId       the connector that produced it
sourceTier     1..4    (tier 5 = generated is never stored as fact)
sourceUrl      the exact page
retrievedAt    UTC
effectiveFrom  when the fact became true
effectiveTo    null while current
supersedes     previous version id
confidence     derived from tier + completeness, never from fluency
contested      true when equal-tier sources disagree
```

A row missing `sourceTier` or `sourceUrl` is unusable by `ai/`. Enforced at the repository level so
it cannot be bypassed.

**Versioning, not mutation.** A changed threshold is a new row with a new `effectiveFrom`; the old
row is closed and pointed at by `supersedes`. Never `UPDATE` a fact's value. Users planned against
the old rule, answers must be reproducible as of the date they were given, and "this changed on
2026-01-01" is itself a product feature.

## The graphs

**Skill graph** — nodes are skills, edges are typed and weighted:

| Edge | Meaning | Direction |
|---|---|---|
| `requires` | prerequisite | strict |
| `adjacent_to` | related, partial transfer | symmetric |
| `transfers_to` | competence carries over (0..1) | directed |
| `subsumes` | broader includes narrower | directed |
| `tooling_of` | tool of a practice | directed |
| `alias_of` | same skill, different name | symmetric |

`requires` edges make a learning path orderable. `transfers_to` weights make career transitions
computable rather than asserted.

**Career graph** — nodes are careers; edges are `adjacent_to`, `transition_path` (carrying observed
frequency from `outcomes`), `seniority_of`, `entry_point_for`.

**Edges are derived, never invented.** A weight comes from posting co-occurrence, an official
curriculum, or recorded outcomes — and the row records which, with `basis`, `support`, and
`computeVersion`, so it can be recomputed and audited. An LLM-asserted edge is a tier-5 value and may
not be stored.

## Embeddings

Qdrant holds embeddings of rows that already exist in PostgreSQL. Every vector carries
`sourceRowId`, `embeddingModel`, `embeddingVersion`, `embeddedAt`.

- **The vector store is an index, never a system of record** (ADR-0004). Dropping a collection costs
  only compute, and the rebuild path exists before the first production collection.
- Changing the embedding model is a new collection, a backfill, and a cutover — never a mixed
  collection, where distances silently stop meaning anything.
- **Semantic search retrieves candidates; it never decides a fact or a score.** A nearest neighbour is
  a hint. Evidence comes from PostgreSQL facts with provenance.

## Reconciliation

Connectors produce comparable records; this layer decides what is one fact.

1. Group by the connector-supplied dedup key.
2. Resolve entities through the registries — company aliases (`Google LLC` → `google`), skill aliases,
   location canonicalization, career-title mapping. Never by raw string equality.
3. Merge field by field: **highest source tier wins**, then most recent, then most specific.
4. On equal-tier disagreement: keep both, mark `contested`, drop confidence, surface it. Never average
   conflicting sources into an invented middle.
5. Keep every contributing raw payload linked, so reconciliation is re-runnable after a rule change.

## The feedback loop

This is what makes the layer a *learning* layer rather than a database.

```text
recommendation shown  →  user acts  →  outcome recorded
        ▲                                    │
        │                                    ▼
  ranking, weights,          ┌────────────────────────────────┐
  timelines, reliability  ◄──┤ outcomes: applied, interviewed, │
                             │ offered, rejected, relocated,   │
                             │ course completed                │
                             └────────────────────────────────┘
```

Outcomes feed four things:

- **`transition_path` frequency** — a proposed transition can prefer a route people actually took over
  one that is merely adjacent.
- **Time-to-competence** — estimates move from assumed (resource durations) to observed.
- **Source reliability** — observed from validation pass rate plus outcome feedback, so a tier-2 source
  that repeatedly yields dead postings is treated as worse than its tier.
- **Score calibration** — versioned scores can be compared against what actually happened.

Outcomes are captured from the start, before anything reads them. Deliberate ordering: the data cannot
be backfilled, and it is the long-term moat.

## Freshness

Every domain has a refresh window — immigration rules on legislative timelines, salary bands annually,
postings daily. Past its window a fact's confidence drops and the UI says so. Stale must be visible,
never silent.

## Constraints

- No fact without `sourceTier` and `sourceUrl`.
- No tier-5 (generated) value in a fact table.
- No `UPDATE` on a fact's value — new version, always.
- No judgment, score, or recommendation stored as knowledge.
- No entity matched by raw display-name equality.
- No default value for a missing field. `null` and `unknown`.
- No import from `services/` or `apps/` — enforced by `eslint.config.mjs`.
- No immigration rule or salary threshold below tier 1.
- No vector store as system of record.
- No averaging of conflicting sources.

## Related

- `overview.md`, `principles.md`, `data-flow.md`
- `immigration.md` — the highest-stakes fact domain
- `docs/database/entities/*`, `docs/database/vector-store.md`
- `.claude/skills/knowledge-engine/SKILL.md` — the working rules
- `.claude/context/knowledge-sources.md` — tiers and per-domain floors
- ADR-0004 (vector store choice)
