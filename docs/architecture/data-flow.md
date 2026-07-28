# Data Flow

> **Purpose:** End-to-end lifecycle of a job listing and a user profile.

Two lifecycles carry almost all of Zentavio's data. Both are traced here from arrival to the point
where they produce something a user sees, with the state transitions and the failure paths named.

---

## Lifecycle 1 — a job listing

### Stages

```text
 source                                          state after the stage
 ──────────────────────────────────────────────────────────────────────
 1  discover     connector.search(query, cursor)   raw payload, untouched
 2  normalize    connector.normalize(raw)          normalized record (pure)
 3  validate     connector.validate(normalized)    accept | flag | reject
 4  reconcile    knowledge-engine, by dedup key    one fact, many sources
 5  persist      facts + raw + provenance          durable, versioned
 6  embed        ai/embeddings → vector-store      index (rebuildable)
 7  announce     job.posting.normalized.v1         downstream may react
 8  expire       unseen for N runs                 expired, never deleted
```

### What each stage guarantees

**1. Discover.** Cursor-paginated, rate-limited per source, cursor persisted per page so a crash
resumes rather than restarts. Raw payloads are returned untouched — no normalization here.

**2. Normalize.** A pure function: no clock, no network, no randomness. Absent source fields stay
`null`. Company resolution does **not** happen here — `normalize` has no I/O, so alias mapping is
deferred to reconciliation (`connectors.md`).

**3. Validate.** Three outcomes, each with a destination:

| Outcome | Meaning | Destination |
|---|---|---|
| accept | complete and coherent | persisted normally |
| flag | usable but suspect (no salary, odd location) | persisted, marked, lower confidence |
| reject | unusable (no title, company, or URL) | **quarantine with the reason** |

Quarantine is not `/dev/null`. A source whose reject rate spikes has changed format, and the
quarantine table is where that becomes visible.

**4. Reconcile.** Group by dedup key, resolve entities through the registries, then merge field by
field: highest source tier wins, then most recent, then most specific. Equal-tier conflicts are kept
both, marked `contested`, and surfaced — never averaged into an invented middle.

**5. Persist.** Facts with full provenance (`sourceId`, `sourceTier`, `sourceUrl`, `retrievedAt`,
`connectorVersion`), plus every contributing raw payload, all linked to the run id. Idempotent on
(`sourceId`, `externalId`), so re-running a run produces zero new facts.

**6. Embed.** Derived vectors with `sourceRowId`, `embeddingModel`, `embeddingVersion`. Rebuildable
from PostgreSQL at any time.

**7. Announce.** `job.posting.normalized.v1`. Versioned, permanent name.

**8. Expire.** `firstSeenAt`, `lastSeenAt`, `sourceExpiresAt`, derived `staleAfter`. Not seen in N
consecutive runs of a source that should still list it → `expired`, with the reason. Never
hard-deleted: an expired posting is evidence about the market and about the user's own application
history. **"The source stopped listing it" and "we stopped fetching that source" are distinguished** —
the second is our bug and must not expire anyone's postings.

### Failure paths

| Failure | Behavior |
|---|---|
| upstream `429`/`5xx` | retry with backoff and full jitter, capped |
| upstream `4xx` (not 429) | terminal — never retried, because retrying hides the bug |
| repeated terminal failures | per-source circuit breaker opens; run continues; breaker state reported |
| malformed payload | quarantined with reason; never "fixed" with an invented value |
| knowledge engine behind | discovery slows (backpressure); queues stay bounded |

A run that partially succeeded is a success with a named gap, never a silent one.

---

## Lifecycle 2 — a user profile

### Stages

```text
 1  upload        resume file            → apps/web → api-gateway (validated, size-capped)
 2  parse         ai/resume-parser       → structured profile + source spans
 3  resolve       skill/career registries → canonical skill ids
 4  classify      per skill              → EVIDENCED | CLAIMED
 5  persist       packages/db            → profile facts, person-scoped
 6  discard       the original file      → parsed profile retained, document not
 7  compute       ai/* on demand         → gap, readiness, viability, matches
 8  record        outcomes               → the feedback loop
```

### What each stage guarantees

**1. Upload.** Validated and size-capped at the gateway. Parsed in a constrained context — a crafted
PDF is a threat (`security.md`).

**2. Parse.** The model extracts structure only. Every extracted claim keeps its **source span**, so
the profile can show the user the sentence it came from. Extraction confidence is per field: a garbled
PDF section yields `low` on those fields rather than a confident guess.

**3. Resolve.** Phrases map to canonical skill ids from a **closed set** supplied in the prompt.
Unrecognized phrases go to `unmatched` — never invented as new skill ids. `unmatched` is also the
backlog for skill-graph coverage.

**4. Classify.** `EVIDENCED` (used in a described role or project) versus `CLAIMED` (listed only).
They carry different weights in every downstream score, and the distinction is why "led a Kubernetes
migration" counts for more than a skills-list mention.

**5. Persist.** Person-scoped, always queried with the subject as a predicate.

**6. Discard.** The original document is not retained beyond parsing (`privacy.md`). The parsed
profile is the asset; the file is a liability.

**7. Compute.** On demand, never cached as a verdict — knowledge moves, and a stale verdict is a wrong
verdict served confidently. Each result carries evidence, confidence, and versions.

**8. Record.** Applied, interviewed, offered, rejected, relocated, course completed. This closes the
loop that turns descriptive scores into predictive ones (`knowledge-engine.md`).

### Where the two lifecycles meet

```text
 profile facts ──┐
                 ├──► ai/skill-gap ──► gap ──► ai/learning-paths ──► plan
 requirement ────┘                      │
 facts (from                            └──► ai/career-roadmap ──► readiness
 listings)                                        │
                                                  ├──► + immigration rules ──► viability
                                                  └──► services/matching ──► ranked postings
                                                                                   │
                                                                    ai/interview-prep
                                                                                   │
                                                                              outcomes
                                                                                   │
                                                              ◄────────────────────┘
                                                              back into the knowledge engine
```

Matching only ranks what is realistically reachable, so readiness and viability come before ranking
rather than after. That ordering is the difference between career intelligence and a filtered feed.

## Invariants across both lifecycles

- **Provenance travels with the value.** A fact without `sourceTier` and `sourceUrl` cannot be used by
  `ai/`.
- **Absence is data.** Missing knowledge yields `unknown` plus what is missing — never a default.
- **Nothing derived is authoritative.** Vectors, aggregates, and scores are recomputable from
  PostgreSQL.
- **Every write path is idempotent**, keyed so a replay is a no-op.
- **Every stage is attributable** to a run id or a request correlation id.
- **PII never enters an event payload** — events carry ids (`privacy.md`).

## Related

- `overview.md` — the component map these flows traverse
- `connectors.md`, `knowledge-engine.md`, `ai-services.md`, `system-diagram.md`
- `docs/features/job-aggregation.md`, `docs/features/resume-parsing.md`,
  `docs/features/outcomes-learning.md`
- `.claude/skills/job-aggregation/SKILL.md`, `.claude/skills/knowledge-engine/SKILL.md`
