# Object Storage — Rollout

> **Purpose:** The order ADR-0021 is introduced in, and what must be true before each step. The
> requirements are in `object-storage.md`; the decision is ADR-0021; this is the sequencing.

- **Status:** Reviewed
- **Owner:** project lead
- **Last verified:** 2026-08-04

## Summary

ADR-0021 changes an ingestion guarantee: a requirement whose source cannot be archived becomes
rejected rather than stored. Flipping that before storage works would stop ingestion entirely, so
enforcement comes last and every phase before it is additive. Two phases need the project lead and
cannot be done by an agent: **accepting the ADR** and **provisioning the R2 account**.

## Phase 0 — Accept ADR-0021

**Nothing below may start first.** ADR-0021 is `Proposed`, and `.claude/context/decisions.md` says
Proposed means "under discussion, not binding". `decision-gate.md` is blunter: *"Implementing around
an undecided question is how the decision gets made silently by whoever typed first — which is
exactly what an ADR exists to prevent."*

Building the port and the table would settle the provider by momentum. Acceptance is the gate.

**Owner: project lead. Not automatable.**

## Current state

```text
Connector ──► download ──► extract rules ──► insert requirements
                                                    │
                                          warning if no archive
```

`de-bundesanzeiger.validate()` emits `no-archived-document` on every row, and the row is stored
anyway. That is acceptable only until this lands.

## Target state

```text
download ──► archive ──► verify checksum ──► parse ──► insert requirements
                 │
        failure stops ingestion
```

## Phases

| # | Phase | Owner | Blocked by |
|---|---|---|---|
| 0 | Accept ADR-0021 | **project lead** | — |
| 1 | Provision R2 | **project lead** | 0 |
| 2 | MinIO for local development | agent | 0 |
| 3 | `DocumentStore` port | agent | 0 |
| 4 | `documents` table and `document_id` | agent | 0 |
| 5 | Ingestion integration | agent | 2, 3, 4 |
| 6 | Enforcement | agent | 1, 5 |

Phases 2–4 are independent of each other and of R2 — all three can be built and tested against
MinIO before the production account exists. **Only Phase 6 requires Phase 1**, because flipping the
warning to an error with no production bucket would fail every real ingest.

### Phase 1 — Provision R2

Account, production bucket, API tokens, object versioning, encryption, lifecycle policies, **EU
jurisdictional restriction** to match ADR-0015's region decision, monitoring.

### Phase 2 — MinIO locally

A service in `infra/docker/docker-compose.dev.yml`, development buckets, local credentials.
**No filesystem-backed implementation.** A stub in development and a real client in production means
the production path is exercised for the first time in production.

### Phase 3 — The `DocumentStore` port

`put` · `get` · `exists` · `delete` · `createSignedUrl` · metadata retrieval. Business logic depends
on the interface; no provider SDK type escapes the implementation.

### Phase 4 — `documents` and `document_id`

The table from `object-storage.md`. `requirements.source_document` (text) becomes `document_id`
referencing it. A **new** migration — the existing one is applied and checksummed, so it cannot be
edited.

### Phase 5 — Ingestion integration

```text
services/ingestion:  fetch via connector ──► archive ──► verify ──► insert document row
                                                                          │
                                            connector.normalize() ──► insert requirements
```

> **Correction against the source plan.** The draft said *"each connector must archive the original
> source, compute the checksum, create the document record, and reference `document_id`."` That
> breaks the connector contract: **"No persistence in a connector — they return data, never write"**
> (`docs/architecture/connectors.md:140`, and the same rule in the connectors skill).
>
> A connector that writes to storage and the database is no longer a plugin — it is a pipeline with
> a plugin's interface, and the property ADR-0002 exists to protect is that adding a source touches
> one folder plus a registry line. Archiving is `services/ingestion`'s job. The connector returns
> the fetched bytes on its raw payload, exactly as `BekanntmachungRaw` already carries
> `documentText` and `fetchedAt`.
>
> ADR-0021's follow-up list already says this; the plan is aligned to it rather than the reverse.

### Phase 6 — Enforcement

`no-archived-document` becomes an error. **Do not start until** storage is deployed, the port is
implemented, ingestion archives successfully, and document records are being written correctly.

## Timestamp semantics

Two timestamps, deliberately.

| Column | Records |
|---|---|
| `retrieved_at` | the connector obtained the source |
| `archived_at` | the object reached storage |

A document can be retrieved and fail to archive. Keeping both is what makes that state visible and
retryable rather than a silent gap — which is the whole reason the pair exists rather than one
`created_at`.

## Immutability

Never modified in place; a changed source is a new object; history is preserved.

**Immutability does not prohibit deletion.** Lifecycle expiry is permitted for temporary cache,
generated reports, and development artifacts. Evidence supporting an imported requirement is never
automatically deleted.

## Risks

| Risk | Mitigation |
|---|---|
| Storage unavailable | fail ingestion rather than store incomplete provenance |
| Provider outage | retry uploads; monitor archival failure rate |
| Future provider migration | depend only on `DocumentStore`; the S3 protocol is the portable interface |
| Schema evolution | new migrations; never modify an applied one |
| Documentation drift | update the architecture doc and both ADR indexes in the same change |
| **Enforcement flipped too early** | Phase 6 is gated on Phase 1; a warning-to-error change with no bucket stops all ingestion |

## Acceptance criteria

- ADR-0021 is Accepted.
- R2 is operational; MinIO is operational locally.
- `DocumentStore` exists and no provider SDK type escapes it.
- `services/ingestion` archives before parsing; connectors still persist nothing.
- Documents are recorded; requirements reference them.
- A missing archived document fails ingestion.
- Development and production share the same protocol.

## Deferred

Résumé persistence, user-uploaded document retention, personal file storage, CDN configuration,
public asset hosting. Each needs its own architectural and privacy decision — see
`object-storage.md`, "Non-goals".

## Related

- `object-storage.md` — the requirements
- ADR-0021 — the decision
- ADR-0002 — why archiving belongs to ingestion rather than to a connector
- `.claude/context/decision-gate.md` — why Phase 0 is a gate rather than a formality
