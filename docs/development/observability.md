# Observability

> **Purpose:** Logging, metrics, tracing, alerts.

**Nothing is instrumented yet** — there are no services. This is the contract the first one adopts, and
the constraint below already governs everything written about logging elsewhere.

## The constraint that shapes all of it

> **No PII in a log line, a metric label, a trace attribute, or an error message. Ever.**

Not a résumé fragment, not an email, not a salary, not immigration status, not a skill list. This is
`docs/architecture/privacy.md`, and it means observability is built around **identifiers**, not
subjects.

Debugging is harder this way. That is the accepted cost, stated plainly.

## Logging

Structured JSON through `packages/logger`. Every line carries:

```json
{
  "level": "info",
  "ts": "2026-07-28T09:14:02.123Z",
  "service": "matching",
  "correlationId": "01J8Z...",
  "subjectId": "01J8Y...",
  "event": "match.computed",
  "scorerVersion": "job-match-v3",
  "durationMs": 412
}
```

`subjectId` is an opaque id. It lets us follow one person's request through the system without knowing
anything about them — which is exactly the right amount.

| Level | For |
|---|---|
| `error` | broken invariant, or a failure a user saw |
| `warn` | degraded but handled — breaker opened, source quarantining heavily |
| `info` | state changes worth reconstructing later |
| `debug` | development only, never enabled in production |

**Never logged:** résumé text, prompt inputs or outputs, immigration facts, salary figures, tokens,
credentials, or a stack trace sent to a client.

## Correlation

One `correlationId` per request, propagated **across the TypeScript↔Python boundary** — a trace that stops
at the language boundary is useless precisely where the interesting work happens (ADR-0003).

Ingestion uses `runId` instead, and every persisted fact links to it, so "why did this posting change on
Tuesday?" is answerable from data rather than from logs.

## Metrics

Grouped by the questions they answer.

**Is the platform healthy?** Request rate, error rate, and p50/p95/p99 latency per route. Saturation:
pool usage, queue depth.

**Is the data healthy?** Per source: fetched, accepted, flagged, **rejected**, deduped, expired. Breaker
state. Freshness — age of the newest fact per source. Quarantine table growth.

**Is the reasoning healthy?** Scores computed, and the **`unknown` rate** per surface. Evidence-completeness
failures, which should be zero. Confidence distribution. Prompt schema-validation failures. Model latency.

**Is the product working?** Recommendations shown versus acted on, outcome capture rate, dismissal reasons.
Aggregate only, minimum support, never per person.

The `unknown` rate deserves its own attention: rising means coverage is degrading, and falling sharply
means something started guessing.

## Cardinality

Never a label with unbounded values — no `subjectId`, no `jobPostingId`, no free text. `sourceId`,
`countryCode`, `route`, and `scorerVersion` are bounded and useful. High-cardinality debugging goes in a
log line, not a metric.

## Tracing

Spans across gateway → service → knowledge → `ai/`, with `correlationId` as the trace id. Attributes carry
ids and versions only.

Worth tracing because the paths are genuinely multi-hop and inference-latency dominated — a slow answer
needs to distinguish retrieval from arithmetic from model time.

## Alerts

Alert on **user-visible harm** or **silent degradation**. Not on every anomaly.

| Alert | Why it matters |
|---|---|
| Error rate above baseline | users are seeing failures |
| p99 latency breach on a user path | the product feels broken |
| A source's breaker open beyond one run window | coverage is degrading unnoticed |
| Rejection rate spiking for a source | its format changed |
| **Ingestion volume dropping sharply** | alert on *rate of change*, never an absolute — 400 postings becoming 40 is the signal; 40 was never a threshold |
| Immigration rules past their refresh window | we may be serving stale rules on irreversible decisions |
| Evidence-completeness failures above zero | a score shipped without its evidence |
| Erasure job failure | a legal obligation is unmet |

The last three are Zentavio-specific and matter more here than generic infrastructure alerts: each one
means the product is quietly lying rather than visibly broken.

**No alert without an owner and a runbook.** An alert nobody acts on trains everyone to ignore the channel.

## Decided, not yet implemented

**ADR-0008 (Accepted): OpenTelemetry as the instrumentation layer, with the backend deferred** as a
separate, later, reversible choice. Auto-instrumentation is opt-in per library, never blanket.

Nothing is instrumented yet: no SDK is installed, `packages/logger` does not exist, and there is no
collector. The backend — and therefore dashboards and alert routing — remains an open follow-up ADR, so
this decision unblocks instrumentation but not alerting.

## Related

- `docs/architecture/privacy.md`, `security.md`
- `ci-cd.md`, `.claude/skills/backend-service/SKILL.md`
- `docs/features/job-aggregation.md` — the data-health metrics in context
