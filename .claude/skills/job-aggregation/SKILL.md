---
name: job-aggregation
description: How Zentavio aggregates job postings at scale — ingestion run orchestration, scheduling and backoff, deduplication and cross-source reconciliation, data validation and quarantine, source reliability tracking, and freshness/expiry. Load when working in services/ingestion, scheduling connector runs, debugging duplicate or stale postings, tuning validation, or tracking source reliability.
---

# Job Aggregation

## Purpose

Aggregation is the plumbing that keeps the knowledge engine fed without letting any single
source degrade the platform. This skill owns the **run** — scheduling, orchestration,
validation, quarantine, dedup, freshness, reliability — while `connectors` owns each source and
`knowledge-engine` owns the resulting facts.

## Scope

**Applies to:** `services/ingestion`, run scheduling and orchestration, validation and
quarantine, dedup/reconciliation coordination, source reliability tracking, posting freshness
and expiry.

**Does not apply to:** a source's internals (`connectors`), fact modeling and merge rules
(`knowledge-engine`), scoring postings (`ai-matching`).

## The prime directive

> **`services/ingestion` never learns a source's name.**

It iterates the registry. If a change to ingestion is needed to add a source, the design is
wrong — that is ADR-0002, and it is the thing that makes coverage growth cheap.

## Run anatomy

```text
run
├── plan          which connectors, which queries, which cursors (resumed)
├── discover      connector.search() → raw payloads, paginated
├── normalize     connector.normalize() → normalized records (pure)
├── validate      connector.validate() → accept | flag | reject
├── reconcile     dedup key → knowledge-engine merge
├── persist       facts + raw payloads + provenance
├── expire        postings no longer seen, past their window
└── report        per-source counts, rejects, timings, breaker state
```

Every run has an id, and every persisted record links to it. "Why did this posting change on
Tuesday?" must be answerable.

## Scheduling

- Per-source cadence from the source's own rate of change and its rate limit — not one global
  cron. A daily board and an hourly ATS feed are different schedules.
- Stagger starts. Never fire every connector at the same minute.
- Runs are **resumable**: cursors persisted per source, so a crash resumes rather than
  restarts. Restarting a paginated crawl wastes the source's quota and ours.
- Runs are **idempotent**: re-running produces the same facts, not duplicates. Keyed on
  (`sourceId`, `externalId`).
- One run per source at a time. Overlap is a bug, and it doubles the rate-limit pressure.
- Backpressure: if the knowledge engine is behind, slow discovery. Never queue unboundedly.

## Validation and quarantine

`validate()` returns accept / flag / reject, and each outcome has a defined destination:

| Outcome | Meaning | Destination |
|---|---|---|
| **accept** | complete and coherent | persisted normally |
| **flag** | usable but suspect (missing salary, odd location, very short body) | persisted, marked, lower confidence |
| **reject** | unusable (no title, no company, no URL, expired on arrival) | quarantine with the reason |

**Quarantine is not `/dev/null`.** Rejected records are stored with their reason so the pattern
is visible. A source whose rejects spike broke its format — that is a monitoring signal, and
the quarantine table is where it shows up first.

Never "fix" a rejected record by filling in a plausible value. Reject, count, and surface it.

## Deduplication and reconciliation

- The connector supplies the dedup key; ingestion groups by it; the knowledge engine merges
  (`knowledge-engine`, "Reconciliation").
- Merge is **highest tier wins**, then most recent, then most specific. Conflicts at equal tier
  are marked `contested`, never averaged.
- Every contributing raw payload stays linked. Reconciliation must be re-runnable from raws
  after a rule change.
- Cross-posting is normal: one job on five boards is one posting with five sources and a
  reliability-weighted view of its fields.

## Freshness and expiry

- Every posting carries `firstSeenAt`, `lastSeenAt`, `sourceExpiresAt` (when the source says
  so), and a derived `staleAfter`.
- Not seen in N consecutive runs of a source that should still list it → `expired`, with the
  reason. Never hard-deleted: an expired posting is evidence about the market and about the
  user's own application history.
- A stale posting is never shown as live. Freshness is visible in the UI
  (`.claude/context/ui-guidelines.md`).
- Distinguish "source stopped listing it" from "we stopped fetching that source". The second is
  our bug and must not expire the user's postings.

## Source reliability

`reliability` is **observed, never declared**:

```text
reliability = f(validation pass rate, uptime, freshness accuracy, outcome feedback)
```

- Recomputed per run window and stored on the source.
- Feeds merge tie-breaks and per-source confidence.
- A tier-2 source failing validation 30% of the time is treated as worse than its tier — the
  tier bounds the ceiling, the observation sets the value.
- Outcome feedback closes the loop: postings from a source that repeatedly turn out to be dead
  or misrepresented lose reliability.

## Circuit breaking

Per source, never global. Repeated terminal failures open the breaker; `healthCheck()` closes
it. An open breaker is reported in the run report and surfaced in monitoring — never silently
skipped, which is how a source dies unnoticed for a month.

One dead source must never stall a run or fail it. A run that partially succeeded is a success
with a named gap.

## Responsibilities

1. Iterate the registry; never reference a source by name.
2. Persist cursors and make runs resumable and idempotent.
3. Route every record to accept / flag / quarantine, with a reason.
4. Group by dedup key and hand reconciliation to the knowledge engine.
5. Track freshness and expire postings honestly, distinguishing our failures from the source's.
6. Recompute source reliability from observation.
7. Break circuits per source and report breaker state.
8. Emit a run report and versioned events for downstream consumers.

## Workflow

1. Read `docs/features/job-aggregation.md` and `docs/architecture/connectors.md`.
2. Plan the run from the registry and persisted cursors.
3. Discover with per-source rate limiting and backoff (`connectors`).
4. Normalize and validate; quarantine with reasons.
5. Group by dedup key; hand to the knowledge engine to merge.
6. Persist facts, raw payloads, and provenance, linked to the run id.
7. Expire what should be expired; leave the rest.
8. Recompute reliability; emit `job.posting.normalized.v1` and the run report.
9. Verify: re-run the same run and confirm zero new facts.

## Constraints

- **No source-specific branch in `services/ingestion`.**
- **No non-resumable or non-idempotent run.**
- **No silent discard.** Every reject is stored with its reason.
- **No invented field to pass validation.**
- **No global circuit breaker, and no run failed by one dead source.**
- **No unbounded queue and no unbounded retry.**
- **No hard delete of an expired posting.**
- **No declared reliability.** Observed only.
- **No overlapping runs for the same source.**
- **No ingestion write to another service's tables.**

## Examples

**Bad.**

```typescript
for (const c of connectors) {
  const jobs = await c.search(query);                 // no cursor, no rate limit
  for (const j of jobs) {
    const n = c.normalize(j);
    if (!n.company) n.company = 'Unknown';            // invented to pass validation
    if (!n.salaryMin) continue;                       // silent discard
    await db.insert('job_postings', n);               // no dedup, no provenance, no run id
  }
}
```

Loses data silently, invents data, cannot resume, ignores rate limits, and produces duplicates
on every run.

**Good.**

```typescript
const run = await runs.start();
for (const connector of registry.enabled()) {
  if (breakers.isOpen(connector.meta.id)) { run.note('breaker-open', connector.meta.id); continue; }

  let cursor = await cursors.load(run, connector.meta.id);
  do {
    const page = await limiter.run(connector.meta.rateLimit, () => connector.search(query, cursor));
    for (const raw of page.items) {
      const normalized = connector.normalize(raw);           // pure
      const result     = connector.validate(normalized);
      if (result.rejected) { await quarantine.put(run, connector.meta.id, raw, result.reasons); continue; }
      await staging.put(run, { normalized, raw, flags: result.warnings, dedupKey: dedupKeyOf(normalized) });
    }
    cursor = page.nextCursor;
    await cursors.save(run, connector.meta.id, cursor);       // resumable
  } while (cursor);
}
await knowledge.reconcile(run);      // merge by dedup key, tier-aware
await postings.expireUnseen(run);
await reliability.recompute(run);
await run.finish();                  // report: counts, rejects, breakers, timings
```

## Best Practices

- Measure everything per source: fetched, accepted, flagged, rejected, deduped, expired, plus
  p50/p99 latency. Aggregate numbers hide the one broken source.
- Alert on **rate of change**, not absolutes. A source dropping from 400 postings to 40 is the
  signal; 40 was never the threshold.
- Keep the raw payload forever. Every reconciliation rule change wants to be re-run over
  history.
- Prefer more frequent small runs over nightly monoliths — smaller blast radius, fresher data,
  gentler on sources.
- Quarantine review is real work. Schedule it; a growing quarantine table is a broken connector
  nobody looked at.
- Never let a user-visible surface depend on a run completing. Read from persisted facts, always.
