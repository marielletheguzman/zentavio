# Database

> **Purpose:** Data model overview and stores used (Postgres, vector, object).

Navigation for `docs/database/`. The schema itself lives in `packages/db`; the rules for changing it
live in `.claude/skills/database/SKILL.md`.

## Documents

| Document | Read it when |
|---|---|
| [`schema-overview.md`](schema-overview.md) | you need the entity map, or which data class a table belongs to |
| [`relationships.md`](relationships.md) | you need cardinalities or a delete policy |
| [`migrations.md`](migrations.md) | you are changing the schema |
| [`data-retention.md`](data-retention.md) | you are adding a table, or handling deletion |
| [`vector-store.md`](vector-store.md) | you are touching embeddings or Qdrant |
| [`entities/`](entities/) | you need column-level detail for one entity |

## Stores

| Store | Role | Loss means |
|---|---|---|
| **PostgreSQL** | system of record — everything authoritative | data loss |
| **Redis** | cache, rate limits, event transport | latency, never data |
| **Qdrant** | vector index, derived from PostgreSQL rows | recompute (ADR-0004) |
| **Object storage** | archived source documents (official immigration pages) | provenance for claims already made |

Uploaded résumé documents are **not** a store here: they are parsed and discarded. The parsed profile
is the asset; the document is a liability (`docs/architecture/privacy.md`).

## The three data classes

Every table is exactly one, and the class decides its rules:

| Class | Rules |
|---|---|
| **World facts** | provenance required; versioned not mutated; retained indefinitely; not personal data |
| **Person data** | subject-predicated on every query; retention set at creation; erasable |
| **Derived** | recomputable; carries the versions that produced it; never authoritative |

Detail in `schema-overview.md`. Confusing the classes is the expensive mistake here.

## The rules worth knowing before you open anything else

- **UUIDv7 primary keys**, generated in the application.
- **`snake_case`** plural tables, singular columns; named constraints (`fk_`, `idx_`, `uq_`, `ck_`).
- **`timestamptz`, always UTC.** No PostgreSQL `enum` — `text` plus a `CHECK`.
- **Every table** has `created_at`, `updated_at`, `deleted_at`.
- **Partial indexes** filter `deleted_at IS NULL`, because that is what every query filters.
- **Never mutate a fact.** A changed rule, threshold, or band is a new version superseding the old.
- **Never persist a score without its evidence.** A `score` column with no `evidence` beside it is a
  bug, not a smaller feature.
- **Absence is `null`.** Never a default, never a market average.
- **Entity document first**, then the migration. The document is the specification.

## Entity documents

| Entity | Class | Covers |
|---|---|---|
| [`user.md`](entities/user.md) | person | `users`, profiles, `profile_skills`, consents, preferences, immigration facts |
| [`job.md`](entities/job.md) | world | `job_postings`, `job_posting_sources`, `job_posting_skills` |
| [`skill.md`](entities/skill.md) | world | `skills`, aliases, `skill_edges`, `career_skills` |
| [`immigration-rule.md`](entities/immigration-rule.md) | world | `immigration_rules`, `immigration_pathways` |
| [`learning-resource.md`](entities/learning-resource.md) | world | resources, skill coverage, path steps |
| [`connector-source.md`](entities/connector-source.md) | world | sources, runs, quarantine, raw payloads |
| [`match.md`](entities/match.md) | derived | `matches` and its sibling score tables |
| [`outcome.md`](entities/outcome.md) | special | `outcomes` — detached on erasure, never deleted |

## Related

- `docs/architecture/knowledge-engine.md` — what the world-fact tables are for
- `docs/architecture/privacy.md` — what constrains the person-data tables
- `.claude/skills/database/SKILL.md` — the working rules and their reasoning
