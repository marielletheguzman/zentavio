# Job Aggregation

> **Purpose:** Multi-source aggregation, dedupe, normalization goals.

Keeps the knowledge engine fed without letting any single source degrade the platform. Mostly invisible
to users, and the quality of everything they *do* see depends on it.

**User question served indirectly:** *are these openings real, current, and complete?*

## Goals, in priority order

1. **Correctness over coverage.** A wrong or dead posting costs a user an application. More postings do
   not compensate.
2. **Additive growth.** Adding a source is one folder plus one registry line (ADR-0002). If ingestion
   changes, the design is wrong.
3. **Isolation.** One source changing its HTML must not stop the other nineteen.
4. **Freshness, honestly labelled.** A stale posting is never shown as live.
5. **Reprocessability.** Raw payloads kept forever, so a reconciliation change can be re-run over
   history.

## The run

```text
plan → discover → normalize → validate → reconcile → persist → expire → report
```

Each run has an id; every fact links to it, so "why did this posting change on Tuesday?" is answerable.
Runs are **resumable** (cursors persisted per page) and **idempotent** (keyed on source + external id, so
a re-run produces zero new facts).

Per-source cadence, not one global cron: a daily board and an hourly ATS feed are different schedules.

## Normalization goals

One canonical shape regardless of source. Two rules do the work:

- **Absent stays absent.** A field the source does not provide is `null`. Never a default, never a market
  average — every score derived from an invented salary inherits the invention.
- **Raw is kept.** `company_name_raw`, `location_raw`, and the full payload survive, because parsing will
  be wrong sometimes and the original is what makes it fixable retroactively.

## Deduplication

One opening posted to five boards is **one posting with five sources**, reconciled by a derived dedup
key. Field-by-field merge: highest source tier wins, then most recent, then most specific. Equal-tier
disagreement is marked `contested` and surfaced — never averaged into an invented middle.

## Validation and quarantine

| Outcome | Destination |
|---|---|
| accept | persisted |
| flag | persisted, marked, lower confidence |
| reject | **quarantine, with the reason** |

Quarantine is not `/dev/null`. A source whose reject rate spikes has changed format, and this is where
that becomes visible before data quality quietly degrades. A rejected record is never repaired by
inventing the missing field.

## Freshness and expiry

Postings carry `firstSeenAt`, `lastSeenAt`, `sourceExpiresAt`, and a derived `staleAfter`. Not seen in N
consecutive runs of a source that should still list it → expired, with a reason, never hard-deleted.

**"The source delisted it" and "we stopped fetching that source" are distinguished.** The second is our
failure and must not expire anyone's tracked postings.

## Source reliability

Observed, never declared: validation pass rate, uptime, freshness accuracy, and outcome feedback. The
tier bounds the ceiling; observation sets the value. A source whose postings repeatedly turn out dead
loses reliability through the outcome loop, regardless of how official it looks.

## Failure behaviour

Retry only what is retryable, with backoff and jitter. Per-source circuit breakers; an open breaker is
reported, never silently skipped — that is how a source dies unnoticed for a month. A run that partially
succeeded is a success with a named gap.

## Legal

Terms of service and `robots.txt` checked **before** a connector is written, with the legal basis
recorded. No bypassing rate limits, no scraping behind a login. If automated access is disallowed, we do
not integrate the source.

## Dependencies

`services/ingestion` · `connectors/core` and every connector · `knowledge-engine/ingest`

## Related

- `docs/architecture/connectors.md`, `docs/architecture/data-flow.md`
- `docs/database/entities/job.md`, `docs/database/entities/connector-source.md`
- `.claude/skills/job-aggregation/SKILL.md`, ADR-0002
