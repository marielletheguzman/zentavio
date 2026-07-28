# Data Retention

> **Purpose:** Retention and anonymization rules per table.

Retention is decided when a table is created, not after the first privacy request. A table with no row
in the schedule below is unfinished (`docs/architecture/privacy.md`).

## The rule per data class

| Class | Default retention | Erasure behavior |
|---|---|---|
| **World facts** | indefinite | untouched — not personal data |
| **Person data** | active-account lifetime | hard-deleted |
| **Derived** | until recomputation or account erasure | hard-deleted; cheap, because recomputable |
| **Operational** | bounded window | purged on schedule |

## Schedule

### Person data

| Table | Retention | On erasure |
|---|---|---|
| `users` | while active; 24 months after last sign-in, then erasure | identifying columns cleared, `status='erased'`, row retained as a tombstone |
| `user_profiles` | while active | hard delete, all versions |
| `profile_skills` | with its profile version | hard delete (cascade from profile) |
| `user_country_preferences` | while active | hard delete |
| `user_targets` | while active | hard delete |
| `user_immigration_facts` | while active; on request, immediately | hard delete |
| `user_consents` | 6 years after revocation | **retained** — the record that consent existed is itself the legal basis |
| `applications` | while active | hard delete |
| `application_events` | with its application | cascade |
| `practice_sessions` | 12 months, then aggregate signal only | hard delete |
| `user_certifications` | while active; expired retained with lowered confidence | hard delete |
| `user_ai_preferences` | while active | hard delete |
| `user_documents` | while active; individually user-deletable | hard delete |

The uploaded **resume document** is not in this table because it is not retained: it is parsed and the
file discarded (`docs/architecture/data-flow.md`). The parsed profile is the asset; the document is a
liability.

`user_consents` is the one person-data table that survives erasure, and only in the narrow form of
"consent for purpose P under policy version V was granted at T and revoked at T2" — no profile content.

### Derived

| Table | Retention | On erasure |
|---|---|---|
| `matches` | superseded on recompute; 90 days for history | hard delete |
| `readiness_scores` | superseded on recompute; 24 months for trajectory | hard delete |
| `skill_gaps` | superseded on recompute | hard delete |
| `learning_paths`, `learning_path_steps` | while the target is active | hard delete |
| embeddings (Qdrant) | with their source row | deleted; rebuildable, so this is bounded (ADR-0004) |

Trajectory history on `readiness_scores` is kept deliberately — "you were at 0.42 in January, you are
at 0.61 now" is one of the more motivating things the product can show, and it needs the series.

### Outcomes — the special case

| Table | Retention | On erasure |
|---|---|---|
| `outcomes` | indefinite, **detached** from the person | person reference nulled; the anonymized contribution remains |
| `interview_reports` | indefinite | already anonymized at ingest; nothing to remove |

Outcomes are the feedback loop (`docs/architecture/knowledge-engine.md`) and the long-term moat. They
are also the most re-identifiable data in the system: "rejected by company X for role Y in month Z" is
close to unique.

So the rule is: **the aggregate survives, the link does not.**

- On erasure, `user_id` is set null and any free-text is dropped. The row's contribution to
  `transition_path` frequency and time-to-competence remains.
- This boundary is **stated to the user** at erasure rather than implied. Aggregates already computed
  have no path back to the individual and are not withdrawn.
- Interview reports are anonymized at ingest, not at deletion — identifying details never enter the
  table.

### Operational

| Table | Retention | Notes |
|---|---|---|
| `ingestion_runs` | 12 months | run reports; useful for trend, not forever |
| `raw_payloads` | indefinite | world-fact provenance; re-processing history is otherwise impossible |
| `quarantined_records` | 6 months | long enough to spot a source that changed format |
| auth/session records | 90 days | security investigation window |
| audit records | 6 years | admin actions, erasure requests, authorization denials — **never with the PII involved** |
| application logs | 30 days | contain a correlation id, never PII |

`raw_payloads` is retained indefinitely and is safe to: it holds what a *source* published about a
*job*, not about a user.

### World facts

`job_postings`, `companies`, `skills`, `skill_edges`, `careers`, `career_edges`, `career_skills`,
`immigration_pathways`, `requirements`, `salary_bands`, `market_signals`, `learning_resources`,
`connector_sources`, `employer_sponsorship_facts` — **indefinite, and versioned rather than
overwritten**.

Derived world data — `employer_migration_scores` — is recomputable and superseded rather than retained as
history.

Two reasons beyond storage being cheap:

1. A superseded immigration rule or salary band is the explanation for an answer we gave someone last
   year. Deleting it makes past answers unexplainable.
2. Expired postings are market evidence, and part of a user's own application history.

## Anonymization techniques

| Technique | Applied to |
|---|---|
| **Ingest-time stripping** | `interview_reports` — identifying details never stored |
| **Detachment** | `outcomes` on erasure — reference nulled, contribution kept |
| **Minimum support** | any surfaced pattern; below the threshold the answer is "not enough data yet" |
| **Aggregation with `n` and window** | every experiential claim: "12 of 15 reports, last 18 months" |
| **Correlation ids** | logs and traces reference a request, never a person |

Minimum support is a privacy control as much as an honesty control: a "pattern" from two reports both
identifies its contributors and misleads its reader.

## Deletion mechanics

- **Soft delete** (`deleted_at`) is the normal path for anything a user removes. Partial unique indexes
  filter `deleted_at IS NULL` so a soft-deleted row does not block a replacement.
- **Hard delete** is for erasure requests and expired ephemera, in the order documented in
  `entities/user.md` — derived rows first, then person rows, otherwise a match is left referencing a
  cleared subject.
- **Scheduled purges** run per the windows above and are logged as audit events.
- Both erasure and export paths are **built and tested**. An untested erasure path is a promise, not a
  feature.

## Invariants

- Every table appears in this document. A new table without a row here is not shipped.
- No PII in a log, event payload, error message, metric label, or fixture — so nothing needs retention
  rules there beyond the log window itself.
- Audit records never contain the PII whose handling they audit.
- Outcome aggregates never carry a path back to an individual.
- No pattern surfaced below minimum support.

## Related

- `docs/architecture/privacy.md` — the principles this schedule implements
- `docs/architecture/security.md` — audit records and access
- `entities/user.md` — the erasure order, `entities/outcome.md` — the detachment rule
- `schema-overview.md` — the three data classes
- `migrations.md` — retention is part of the review checklist for a new table
