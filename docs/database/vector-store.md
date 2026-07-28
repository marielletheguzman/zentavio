# Vector Store

> **Purpose:** Embedding collections, dimensions, indexes.

Qdrant, reached only through the port in `knowledge-engine/vector-store` (ADR-0004). Everything here
is **derived**: every vector comes from a PostgreSQL row and can be rebuilt from it.

## The two rules everything else follows from

**1. The vector store is an index, never a system of record.** Dropping a collection costs compute,
never knowledge. That is what removes durability and backup from the design, and what keeps GDPR
erasure bounded — deleting a person's vectors is a recompute, not a data loss.

**2. Semantic search retrieves candidates; it never decides.** A nearest neighbour is a hint about what
to consider. The score and the evidence come from PostgreSQL facts with provenance
(`.claude/skills/ai-matching/SKILL.md`). A cosine distance is not an explanation a user can act on.

## Collections

Named `<entity>__<model>__v<n>` so the model is visible in the name and a migration is a new collection
rather than an in-place change.

| Collection | Source rows | Payload (filterable) | Used for |
|---|---|---|---|
| `job_postings__<model>__v1` | live `job_postings` | `country_code`, `is_remote`, `career_id`, `posted_at`, `expired`, `seniority` | candidate retrieval before scoring |
| `skills__<model>__v1` | `skills` (+ aliases in the text) | `kind` | resolving an unrecognized phrase to candidate skills |
| `careers__<model>__v1` | `careers` | — | career discovery from a free-text description |
| `learning_resources__<model>__v1` | `learning_resources` | `skill_id`, `language`, `format`, `cost_band`, `level` | resource lookup for a gap item |
| `interview_reports__<model>__v1` | anonymized reports | `company_id`, `role_family`, `reported_at` | theme clustering |

No `user_profiles` collection. Profile matching runs against structured facts, not embeddings — the
score must be explainable factor by factor, and an embedding of a résumé is neither explainable nor
something worth persisting given `docs/architecture/privacy.md`.

## Vector metadata — required on every point

```text
sourceRowId       uuid   the PostgreSQL row this was derived from
sourceTable       text   which table
embeddingModel    text   e.g. 'nomic-embed-text'
embeddingVersion  text   model revision, not just family
embeddedAt        ts     UTC
textHash          text   hash of the exact embedded text
```

Upsert **rejects** a point missing any of these. Enforced in the port and asserted by a test
(`.claude/skills/testing/SKILL.md`), because a vector whose provenance is unknown cannot be
invalidated, rebuilt, or trusted.

`textHash` is what makes re-embedding cheap: if the source text has not changed, the vector does not
need regenerating.

## Dimensions and distance

| Property | Value | Reason |
|---|---|---|
| Dimensions | fixed per collection by the model | never mixed within a collection |
| Distance | cosine | text embeddings are direction-carrying; magnitude is noise |
| Index | HNSW | recall matters more than precision-at-1, since results are candidates |
| Normalization | at write time | so cosine is a dot product at query time |

Dimensions are a property of `embeddingModel`, recorded in the collection name and in every point.
Changing them is a new collection by definition.

## Filtering strategy

Most Zentavio searches are filtered — country, track, freshness. So the filterable fields are copied
into the Qdrant payload and the search runs as a filtered vector query, avoiding a round trip.

The tradeoff, recorded in ADR-0004: **payload fields are duplicated from PostgreSQL and can drift.**
The mitigation is that the rebuild path exists and is exercised, not that the duplication is avoided.
A filter needing a field not in the payload costs a PostgreSQL round trip — acceptable, and the reason
the payload list is deliberately short.

## Model migration

Never a mixed collection. Distances across two models are meaningless, and a partially re-embedded
collection silently returns nonsense rather than failing.

```text
1  create      job_postings__<newmodel>__v1
2  backfill    embed every source row into the new collection
3  verify      recall check against a fixed query set; compare against the old collection
4  cutover     the port switches reads (config, one place)
5  observe     keep the old collection until the new one is trusted
6  retire      drop the old collection
```

The port exposes `createCollection` and `swapAlias` precisely so steps 1 and 4 are operations rather
than code changes.

## Rebuild

```text
truncate collection → stream source rows from PostgreSQL → embed → upsert with metadata → verify count
```

Built **before** the first production collection exists. A rebuild path that has never been run is not
a rebuild path, and the whole "index, not record" claim depends on it. An integration test drops a test
collection, rebuilds it, and asserts the count plus a sample of recalled ids.

## Erasure

Person-derived vectors (currently only via `interview_reports`, which are anonymized at ingest) are
deleted by `sourceRowId`. Because everything is derived, erasure here is bounded and verifiable —
delete by source row, then confirm zero points match.

## Constraints

- Qdrant client imported only inside `knowledge-engine/vector-store` — a lint rule fails any other
  import (ADR-0005).
- No point without full metadata.
- One `embeddingModel`/`embeddingVersion` pair per collection, asserted by test.
- No vector as a system of record.
- No score derived from distance alone.
- No embedding of resume documents.
- No collection without a rebuild path.

## Related

- ADR-0004 — the decision, its rejected alternatives (pgvector, hosted), and the reversal cost
- `docs/architecture/knowledge-engine.md` — where vectors sit relative to facts
- `docs/architecture/ai-services.md` — `ai/embeddings` produces, the port persists
- `schema-overview.md`, `data-retention.md`
