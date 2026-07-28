# ADR 0008: Observability stack

- **Status:** Accepted
- **Accepted:** 2026-07-28
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** `packages/logger`, every service, `ai/*`, `infra/monitoring`, `infra/ci`

## Context

Nothing is instrumented, so this blocks the first service. `docs/development/observability.md` defines
what to log, what to measure, and what to alert on; it does not name a stack.

Three constraints, and the first is unusual enough to drive the whole decision.

**PII must never leave the process.** No résumé fragment, salary, immigration status, or personal
identifier in a log line, metric label, or trace attribute (`docs/architecture/privacy.md`). Most
observability vendors are, functionally, "ship everything and query it later" — which is exactly the model
this constraint forbids. So the stack must be usable while carrying only ids and versions, and it must not
require sending data to a third party to be useful.

**Tracing must cross the TypeScript↔Python boundary.** A trace that stops where `services/matching` calls
`ai/skill-gap` is useless precisely where the interesting latency is (ADR-0003).

**AI-specific telemetry has no off-the-shelf equivalent.** The metrics that matter here — `unknown` rate per
surface, evidence-completeness failures, confidence distribution, prompt schema-validation failures, model
latency by prompt version — are product invariants, not infrastructure ones. A rising `unknown` rate means
coverage is degrading; a falling one may mean something started guessing.

## Options considered

### Option A — OpenTelemetry as the instrumentation layer, backend chosen separately

Instrument once against the OTel API; export to whatever backend is configured.

**Advantages.** Vendor-neutral, so the backend becomes a configuration decision rather than an architectural
one — and reversible without touching instrumentation. First-class SDKs for both Node and Python with
context propagation across the boundary, which is the second constraint solved directly. Structured logs,
metrics, and traces under one context. Locally: a collector plus open-source backends, so development needs
no external service and no PII leaves the machine.

**Disadvantages.** Genuinely heavy — the Node SDK's auto-instrumentation is broad and needs pruning, and its
configuration surface is large. Adds a collector to run. The API has churned historically, particularly for
logs. Over-engineered for the two services that exist today.

### Option B — Structured logs only, no metrics or tracing yet

`packages/logger` emits JSON to stdout; the platform aggregates. Metrics and tracing deferred.

**Advantages.** Nearly free, and honest about the current scale. Logs with a correlation id already answer
most questions when there are two services. Zero new infrastructure, zero new dependency, no collector.
Defers a real decision until there is traffic to reason about.

**Disadvantages.** The AI-specific metrics are the ones most likely to catch the product *lying quietly* —
stale rules served, evidence missing, `unknown` rate drifting — and they are metrics, not log lines.
Retrofitting instrumentation across a codebase is markedly more expensive than adding it as services are
written. Cross-language tracing becomes impossible to add cleanly later, because correlation ids will have
been threaded ad hoc.

### Option C — A single vendor SDK (Datadog, New Relic, or similar)

**Advantages.** One agent, dashboards included, minimal setup, mature cross-language support.

**Disadvantages.** Instrumentation becomes vendor-shaped, so switching later means reinstrumenting. Their
default posture is to collect broadly, which fights the PII constraint — every integration becomes a review
of what it captures by default. Cost scales with volume for a pre-revenue product. And it puts telemetry
about a population of Filipino jobseekers on a third party's infrastructure, which is a decision that
deserves its own scrutiny rather than arriving as a side effect of picking a dashboard.

### Option D — Do nothing until the first service needs it

**Advantages.** No work now.

**Disadvantages.** "The first service" is when it is cheapest to instrument and most tempting to skip.
Deferring means the first two services get instrumented differently and neither matches the document.

## Decision

**Option A — OpenTelemetry as the instrumentation layer, with the backend deferred and pinned
as a separate, later, reversible choice.**

Concretely: `packages/logger` and its Python counterpart wrap the OTel API; auto-instrumentation is
**opt-in per library**, not blanket; a collector runs locally and in deployment; the backend is configuration
and starts as an open-source local stack.

The reasoning is the first constraint. Because PII cannot be shipped, the value here comes from
instrumenting *deliberately* — a small number of chosen metrics and spans carrying ids and versions only.
OTel supports exactly that, and it makes the backend a decision we can defer and reverse, which is the
correct shape for a decision we do not yet have the traffic to make well.

Option B is the strongest alternative and its argument is real. It loses because the AI-specific metrics are
product-correctness signals, and threading correlation ids ad hoc across a language boundary is the part
that cannot be cleanly retrofitted.

## Consequences

**Accepted costs.**

- A real dependency in every service, with a large configuration surface and a collector to operate.
- Heavier than the current scale justifies. Mitigated by opt-in instrumentation: no blanket
  auto-instrumentation, and every span and metric is added on purpose.
- Two SDKs to keep in step across the polyglot boundary, and version pinning for both.
- The backend decision is deferred, not avoided. Dashboards and alert routing remain undone until it is made,
  which means this ADR unblocks instrumentation but not alerting.
- Local development gains a collector. `getting-started.md` changes when this is accepted.

**Follow-up work.**

- `packages/logger`: structured JSON, correlation id, and the field allowlist — a logger that *cannot* emit
  PII is better than one that must be used carefully.
- The Python counterpart in `ai/shared`, propagating the same correlation id across the HTTP boundary.
- The AI metric set as named instruments: `unknown` rate, evidence-completeness failures, confidence
  distribution, schema-validation failures, model latency by prompt version.
- Cardinality guard: no `subjectId`, `jobPostingId`, or free text as a label. Enforceable by a lint rule on
  the metric helpers.
- Collector config in `infra/monitoring`; a follow-up ADR for the backend.
- Alert definitions with owners and runbooks — an alert nobody acts on trains everyone to ignore the channel.

**Reversal cost.** Low for the backend, by construction — that is the point of the layer. Moderate for OTel
itself: removing it means rewriting instrumentation call sites, though the field allowlist and metric names
would survive.

## Compliance

- **A lint rule forbids PII field names** in logger and metric calls, and the logger accepts only allowlisted
  fields. The rule is the enforcement; review is not.
- No unbounded metric label — asserted by a test over the metric helper.
- `correlationId` present on every log line and propagated across the language boundary — asserted by an
  integration test that follows one id through a gateway → service → `ai/` call.
- `/health/ready` checks real dependencies; a probe that always returns 200 fails review.
- Every alert has a named owner and a runbook link, or it is not added.

## Related

- `docs/development/observability.md`, `docs/architecture/privacy.md`, `security.md`
- ADR-0003 (the boundary tracing must cross)
- `.claude/skills/backend-service/SKILL.md`
