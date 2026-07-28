# Decision Gate Protocol

> **Purpose:** Stop implementation work from starting before the architectural decisions it depends on are
> resolved. Read with [`development-instructions.md`](development-instructions.md) (workflow) and
> [`decisions.md`](decisions.md) (when an ADR is required).

If a decision affects **architecture, dependencies, security, data handling, or production behaviour**, it
needs an ADR **before** implementation.

## The rule

Do not:

- pick a technology because it is convenient
- introduce a dependency without documentation
- **implement around an unresolved architectural decision**
- convert a proposal into an assumed decision

When a decision is unresolved, stop and report:

```text
Status:   BLOCKED
Reason:   Architectural decision required
Required: Create or approve ADR — <which one>
```

### This supersedes an earlier instruction

`development-instructions.md` previously said to "implement around it and say what is blocked". **That was
wrong and is now corrected.** Implementing around an undecided question is how the decision gets made
silently by whoever typed first — which is exactly what an ADR exists to prevent. The correct response is
to stop and report `BLOCKED`.

The narrow exception: work that is genuinely independent of the blocked decision may continue. Writing an
entity document does not require the test runner. Writing a test does.

## Current blockers

**Decided** (ADRs Accepted 2026-07-28) — the decision is settled; the follow-up work is not done:

| Was blocked on | Decision | Still to do |
|---|---|---|
| Test runner | ADR-0007 — Vitest + pytest | install it; nothing is installed |
| Observability stack | ADR-0008 — OpenTelemetry, backend deferred | instrument; nothing is instrumented |
| AI evaluation | ADR-0009 — delta report as a review artifact | write the `promptVersion` check |
| CI required checks | ADR-0011 — require the `ci` check | observe a green run, then configure protection |

**Still blocked:**

| Decision | Blocks | Needs |
|---|---|---|
| Origin-side authorities per domain | any verdict for a regulated profession | **research, not a decision** — ADR-0010 is Accepted and the schema exists; no recognition rule is sourced |
| Observability **backend** | dashboards and alert routing | follow-up ADR (ADR-0008 deferred it deliberately) |

Where each is documented: `docs/architecture/immigration.md` (origin-side data) ·
`docs/development/observability.md` (backend).

**All twelve ADRs are Accepted and the MVP is settled** — modified Option A, cloud / platform engineering,
Germany. What remains is implementation and research, not decisions.

**Accepted is not implemented.** An Accepted ADR authorises work; it does not perform it. Claiming a
capability exists because its ADR was accepted is the same error as claiming a gate blocks because it is
documented.

## Never assume a path

Verify a path exists before referencing it. Current structure:

```text
docs/
├── architecture/
│   └── decisions/          ← ADRs live here, not docs/adr/
├── features/
├── roadmap/
├── database/
└── development/

.claude/context/
├── ai-memory.md
├── ai-session.md
├── ai-memory-policy.md
└── memory-manager.md
```

A referenced file that does not exist is the most common failure in AI-assisted work, and it is cheap to
check.

## Readiness checklist

**Repository** — documentation paths exist · the related ADR exists · feature scope is defined ·
dependencies are approved.

**Code** — tests exist or a testing strategy exists · observability requirements are defined · security
implications reviewed · memory and privacy impact reviewed.

**AI features** — agent responsibility is defined · memory access is justified · output explainability
exists · hallucination risk is considered.

Any unchecked box on the first list is a `BLOCKED` report, not a judgment call.

## Reviewing a claim

```text
Claim  →  Evidence  →  Verification
```

Never accept **implemented · completed · production ready · fixed** without all three.

| Invalid | Valid |
|---|---|
| "CI blocking is implemented." | "Branch protection requires the `ci` check, verified in GitHub settings." |
| "Tests pass." | "`pnpm lint:all` exited 0; output showed 4 steps clean." |
| "The connector works." | "`normalize` matches 3 golden fixtures; live fetch not run." |

The first row is a real error from this repository's history: a CI gate was described as blocking while no
such job existed. It was caught by audit, not review — which is why verification is a protocol rather
than an expectation.

Also distrust: round numbers, precise-sounding estimates, and confident prose about work that was not
executed.

## Change reporting format

Every completed piece of work reports in four parts:

```text
Completed:     what changed
Verified:      what was checked, and how
Not verified:  what still needs confirmation
Blocked:       decisions preventing progress
```

**"Not verified" is mandatory and is usually non-empty.** Omitting it turns a partial result into an
implied complete one. A change with an empty "Not verified" section should be viewed with suspicion, not
satisfaction.

## Core principle

> **A smaller truthful system is better than a larger imaginary system.**

Never optimize for appearing complete. Optimize for correctness, traceability, explainability, and trust.

The practical test: if a reader acts on this work and it turns out to be wrong, would they have been
warned? If not, the report is incomplete regardless of how much was built.

## Related

- [`development-instructions.md`](development-instructions.md) — the per-task workflow
- [`decisions.md`](decisions.md) — when an ADR is required, and the ADR format
- [`ai-principles.md`](ai-principles.md) — the same discipline applied to product output
- [`../../docs/development/contributing.md`](../../docs/development/contributing.md) — review expectations
- [`../../docs/architecture/decisions/`](../../docs/architecture/decisions/) — ten Accepted ADRs; 0010 reserved
