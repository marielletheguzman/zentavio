---
name: knowledge-engine
description: How Zentavio stores structured truth — fact modeling with provenance and versioning, the skill graph and career graph, company registry and alias resolution, cross-source reconciliation, market intel, outcomes, and the Qdrant vector store. Load when adding or querying facts in knowledge-engine/, designing graph edges, reconciling duplicate records, writing an ingest step, deciding whether something is a fact or a judgment, or embedding anything.
---

# Knowledge Engine

## Purpose

The knowledge engine is why Zentavio can explain itself. It is the only place structured truth
lives, and every fact in it carries where it came from, when, from which source tier, and which
version it is. AI services reason over it and never around it. If a claim cannot be traced to a
row here, the platform must not make the claim.

## Scope

**Applies to:** `knowledge-engine/skills-graph`, `companies`, `immigration` (rules, pathways),
`market-intel`, `interview-reports`, `outcomes`, `vector-store`, `ingest`.

**Does not apply to:** judgments about facts — scoring, ranking, recommendation
(`ai-matching`, `career-intelligence`, `recommendations`). Fetching from sources
(`connectors`). Physical schema rules (`database`).

## The fact/judgment line

> If it is a fact, it is knowledge. If it is a judgment about facts, it is AI.

| Knowledge engine | AI service |
|---|---|
| "The EU Blue Card IT threshold is X as of date D" | "You are likely eligible" |
| "This posting requires Kubernetes" | "This is a 0.72 match for you" |
| "Kubernetes is adjacent to Docker, weight 0.8" | "Learn Docker before Kubernetes" |
| "37 users with profile P were offered role R" | "Your probability of an offer is …" |

A judgment persisted as a fact corrupts every downstream answer, because the next reasoning
step will cite it as truth. This is the single most important rule in this skill.

## Fact shape

Every fact row carries, without exception:

```text
id              uuid (v7)
subject         what the fact is about (entity ref)
predicate       what is asserted
value           the asserted value (typed; null means unknown, never 0 or a default)
sourceId        the connector that produced it
sourceTier      1..4    — tier 5 (generated) is never stored as a fact
sourceUrl       the exact page
retrievedAt     UTC
effectiveFrom   when the fact became true (rules, thresholds, bands)
effectiveTo     null while current
supersedes      previous version id, or null
confidence      derived from tier + completeness, never from fluency
contested       true when higher-tier sources disagree
```

A row missing `sourceTier` or `sourceUrl` is unusable by `ai/` — enforced, not encouraged.

## Versioning, not mutation

Knowledge is historical. A changed threshold is a **new row** with a new `effectiveFrom`, the
old row closed with `effectiveTo` and pointed at by `supersedes`. Never `UPDATE` a fact's
value.

This is not bookkeeping. A user's plan was made against the rule as it stood; an answer must
be reproducible as of the date it was given; and "this changed on 2026-01-01" is itself a
product feature (`notifications`).

## Graphs

**Skill graph** — nodes are skills; edges are typed and weighted:

| Edge | Meaning | Direction |
|---|---|---|
| `requires` | prerequisite | strict |
| `adjacent_to` | related, partial transfer | symmetric |
| `transfers_to` | competence carries over, weighted 0..1 | directed |
| `subsumes` | broader includes narrower | directed |
| `tooling_of` | tool of a practice | directed |
| `alias_of` | same skill, different name | symmetric |

**Career graph** — nodes are careers; edges are `adjacent_to`, `transition_path` (with
observed frequency from outcomes), `seniority_of`, `entry_point_for`.

Every edge carries provenance and a weight. An edge asserted by an LLM with no source is a
tier-5 value and may not be stored — derive edges from co-occurrence in real postings, from
official curricula, or from recorded outcomes, and record which.

## Reconciliation

Connectors produce comparable records; the knowledge engine decides what is one fact:

1. Group by the connector-supplied dedup key.
2. Resolve entities through the registries — company aliases (`Google LLC` → `google`), skill
   aliases, location canonicalization, career-title mapping.
3. Merge field by field, **highest tier wins**, then most recent, then most specific.
4. On tier-equal disagreement: keep both, mark `contested`, drop confidence, surface it.
   Never average conflicting sources into an invented middle.
5. Keep every contributing raw payload linked. Reconciliation must be re-runnable.

## Responsibilities

1. Store no fact without full provenance.
2. Version facts; never mutate a value in place.
3. Keep tier-5 (generated) values out of fact tables entirely.
4. Resolve entities through the registries — never by string equality on a display name.
5. Return `unknown` rather than a plausible value. Absence is data.
6. Expose facts to `ai/` through a stable read port, with their provenance attached.
7. Keep embeddings derived and rebuildable — the vector store is an index, never a system of
   record.
8. Record outcomes as they arrive; they are the only path from description to prediction.

## Workflow

1. Read `docs/architecture/knowledge-engine.md` and the relevant `docs/database/entities/*.md`.
2. Decide fact or judgment. If judgment, stop — it belongs in `ai/`.
3. Check the per-domain source floor in `.claude/context/knowledge-sources.md`. Below the
   floor, the fact is stored as signal but never stated.
4. Model the fact: subject, predicate, typed value, temporal columns, provenance.
5. Write the entity doc, then the migration (`database` skill).
6. Implement the ingest step in `knowledge-engine/ingest/` — idempotent on
   (`sourceId`, `externalId`), re-runnable, batched.
7. Add or extend the read port `ai/` uses. Provenance travels with the value.
8. If embeddings are affected, record the embedding model version and make a rebuild path.
9. Verify the unknown path: query a fact that does not exist and confirm `unknown` with a
   reason, not a default.

## Vector store

- Qdrant holds embeddings of facts that already exist in PostgreSQL. Deleting a collection
  must cost only compute.
- Every vector carries `sourceRowId`, `embeddingModel`, `embeddingVersion`, `embeddedAt`.
- Changing the embedding model is a new collection plus a backfill plus a cutover — never an
  in-place mixed collection, where distances silently stop meaning anything.
- Semantic search **retrieves candidates**; it never decides a fact. A nearest neighbour is a
  hint, not evidence.

## Constraints

- **No fact without `sourceTier` and `sourceUrl`.**
- **No tier-5 value in a fact table.** Model output is a judgment or nothing.
- **No `UPDATE` on a fact's value.** New version, always.
- **No judgment, score, or recommendation stored as knowledge.**
- **No entity matched by raw display-name equality.** Registries, always.
- **No default value for a missing field.** `null` and `unknown`.
- **No knowledge-engine import from `services/` or `apps/`.**
- **No immigration rule or salary threshold below tier 1.**
- **No vector store as system of record.**
- **No averaging of conflicting sources.**

## Examples

**Bad — LLM output persisted as a graph edge.**

```typescript
const related = await llm.ask(`What skills are related to ${skill}?`);
await db.insert('skill_edges', related.map(r => ({ from: skill, to: r, weight: 0.5 })));
```

Tier-5 data in a fact table with an invented weight and no provenance. Every future gap
analysis now cites a guess as truth.

**Good — derived edge with a recorded basis.**

```typescript
const cooc = await postings.coOccurrence(skillA, skillB);   // observed in real postings
if (cooc.support >= MIN_SUPPORT) {
  await edges.upsert({
    from: skillA, to: skillB, type: 'adjacent_to',
    weight: cooc.normalizedPmi,
    basis: 'posting-cooccurrence',
    sourceTier: 2, sourceId: 'derived:postings',
    support: cooc.support, computedAt: now, computeVersion: 'cooc-v1',
  });
}
```

The weight is measured, the basis is named, and the edge can be recomputed and audited.

## Best Practices

- Model the question before the table. "Which skills transfer into cloud engineering, and how
  strongly?" tells you the edge type and the weight semantics.
- Keep raw payloads forever. Reprocessing history is otherwise impossible.
- Prefer many small typed predicates over one wide `jsonb` blob — `jsonb` is for genuinely open
  shapes, not for undecided ones.
- Refresh windows per domain: immigration rules on legislative timelines, salary bands
  annually, postings daily. Stale must be visible, not silent.
- `contested` is a feature. Users trust a platform that shows a disagreement more than one that
  hides it.
- Outcomes are the most valuable rows in the system. Capture them even when nothing reads them
  yet.
