# Schema Overview

> **Purpose:** Entity list and relationships summary.

The schema outlives every service that reads it. This document is the map; each entity has its own
document under `entities/`, and the naming and migration rules live in
`.claude/skills/database/SKILL.md`.

## The three data classes

Every table belongs to exactly one, and the class decides its rules.

| Class | Contains | Rules |
|---|---|---|
| **World facts** | jobs, skills, companies, immigration rules, salary bands, learning resources, market intel | provenance required; versioned not mutated; not personal data; retained indefinitely |
| **Person data** | users, profiles, profile skills, preferences, applications, outcomes | subject-predicated on every query; retention policy at creation; erasable |
| **Derived** | matches, scores, embeddings, aggregates | recomputable from the two above; carries the versions that produced it; never authoritative |

Confusing the classes is the most expensive mistake available here. A derived row treated as
authoritative cannot be recomputed when the scorer changes; a world fact treated as person data gets
deleted on erasure and takes market intelligence with it.

## Entity map

```text
  ┌──────────── person data ────────────┐        ┌────────── world facts ──────────┐

  users                                          connector_sources
    │ 1:1                                          │ 1:N
  user_profiles                                  job_postings ──────┐
    │ 1:N            │ 1:N                         │ N:M            │ N:1
  profile_skills     user_country_preferences     job_posting_skills │  companies
    │ N:1                                          │ N:1            │    │ 1:N
  skills ◄───────────────────────────────────────┘                  │  company_aliases
    │ N:M (self)                                                    │
  skill_edges                                                       │
    │                                                              │
  careers ── career_edges (N:M self)                               │
    │ N:M                                                          │
  career_skills                                                    │
                                                                    │
  immigration_pathways ── immigration_rules (1:N, versioned)        │
  salary_bands · market_signals · learning_resources                │
  interview_reports (anonymized at ingest)                          │
                                                                    │
  └──────────── derived ────────────┐                              │
                                                                    │
  matches ◄──────────────────────────────────────────────────────────┘
    │ (user_id, job_posting_id, score, evidence, scorer_version)
  readiness_scores · skill_gaps · learning_paths
  outcomes  ── the only derived-adjacent table that is also a source of truth for the loop
```

## Tables by area

### Identity and profile — person data

| Table | Holds |
|---|---|
| `users` | account, auth identity, locale, consent state |
| `user_profiles` | parsed resume result, seniority, availability |
| `profile_skills` | skill per user with `evidenced` / `claimed` status and source span |
| `user_country_preferences` | target markets, ranked |
| `user_targets` | target careers, with the readiness they are pursuing |

### Sources and postings — world facts

| Table | Holds |
|---|---|
| `connector_sources` | one row per connector: tier, reliability, rate limit, health |
| `ingestion_runs` | one row per run: counts, rejects, breaker states, timings |
| `raw_payloads` | exactly what a source returned, kept forever |
| `quarantined_records` | rejected records with their reasons |
| `job_postings` | the canonical normalized posting |
| `job_posting_sources` | which sources contributed to one reconciled posting |
| `job_posting_skills` | requirement per posting, with weight |
| `companies`, `company_aliases` | company registry and alias resolution |

### Graphs — world facts

| Table | Holds |
|---|---|
| `skills` | canonical skill, with aliases |
| `skill_edges` | typed weighted edges: `requires`, `adjacent_to`, `transfers_to`, `subsumes`, `tooling_of` |
| `careers` | career track |
| `career_edges` | `adjacent_to`, `transition_path` (with observed frequency), `seniority_of` |
| `career_skills` | skill requirement per career, with weight and cluster |

### Markets and mobility — world facts

| Table | Holds |
|---|---|
| `immigration_pathways` | named route per jurisdiction |
| `immigration_rules` | one requirement per row, versioned and dated |
| `salary_bands` | compensation by career, seniority, market, with `asOf` |
| `market_signals` | demand, hiring difficulty, trend, per market |
| `learning_resources` | course, doc, book, lab, certification |
| `interview_reports` | anonymized experiential reports, tier 4 |

### Derived

| Table | Holds |
|---|---|
| `matches` | person × posting score with `evidence` and `scorer_version` |
| `readiness_scores` | person × target readiness with its remainder |
| `skill_gaps` | computed gap per person and target |
| `learning_paths`, `learning_path_steps` | generated plan and its ordered steps |
| `outcomes` | applied, interviewed, offered, rejected, relocated, completed |

## Conventions every table follows

```sql
id          uuid        primary key,              -- UUIDv7, generated in the application
created_at  timestamptz not null default now(),
updated_at  timestamptz not null default now(),
deleted_at  timestamptz                           -- soft delete; null = live
```

- `snake_case` plural tables, singular columns; `<singular_table>_id` foreign keys.
- Named constraints: `fk_<table>__<ref>`, `idx_<table>__<cols>`, `uq_`, `ck_`.
- `timestamptz`, always UTC. No PostgreSQL `enum` types — `text` plus a `CHECK`.
- Money is `numeric(14,2)` with a `currency char(3)` beside it.
- Partial indexes on `deleted_at IS NULL`, because that is what every query filters.

Full rules and the reasoning: `.claude/skills/database/SKILL.md`.

## Provenance and versioning

**Every world fact** carries `source_id`, `source_tier`, `source_url`, `retrieved_at`, and where it
can change over time, `effective_from` / `effective_to` / `supersedes`. A fact is never updated in
place — a new version supersedes the old.

**Every derived row** carries the evidence and versions that produced it: `evidence jsonb`,
`scorer_version`, `prompt_version`, `knowledge_as_of`. A `score` column with no evidence beside it is
a bug, not a smaller feature.

## Stores

| Store | Role | Rule |
|---|---|---|
| **PostgreSQL** | system of record | everything authoritative lives here |
| **Redis** | cache, rate limits, event transport | nothing authoritative; loss costs latency only |
| **Qdrant** | vector index | derived and rebuildable; dropping a collection costs compute (ADR-0004) |
| **Object storage** | uploaded resume documents | shortest viable retention — parse, keep the profile, discard the file |

## Related

- `relationships.md` — the ER detail behind the map above
- `entities/*` — one document per entity, written **before** its migration
- `migrations.md`, `data-retention.md`, `vector-store.md`
- `.claude/skills/database/SKILL.md`, `docs/architecture/knowledge-engine.md`
