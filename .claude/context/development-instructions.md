# Development Instructions

> **Purpose:** Execution rules for AI-assisted development in this repository. Read before starting any
> task. Deliberately short and link-heavy — restating rules that live elsewhere is how they drift apart.

The repository is in the **architecture and foundation phase**. The priority is a reliable, explainable,
privacy-aware platform — not speed of implementation.

## The critical rule

> **Never claim something exists when it does not.**

Do not:

- describe unfinished functionality as complete
- reference a file, API, service, or module that does not exist
- invent an infrastructure decision
- report "implemented", "completed", or "production ready" without verification

When something is missing, say so in exactly that shape:

```text
This does not exist yet.
  Current limitation: …
  Required decision:  …
  Implementation path: …
```

Two documents in this repository previously described a CI gate that did not exist. It was caught by
audit, not by review. That is why this rule is first.

## Path corrections

The source version of these instructions referenced five paths that do not exist here. Corrected, since a
document about not referencing missing files should not do it:

| Referenced | Actual |
|---|---|
| `docs/adr/` | [`docs/architecture/decisions/`](../../docs/architecture/decisions/) |
| `docs/FEATURES.md` | [`docs/features/`](../../docs/features/) — a directory of 12 documents |
| `docs/ROADMAP-2.0.md` | [`docs/roadmap/`](../../docs/roadmap/) |
| `docs/DATABASE.md` | [`docs/database/`](../../docs/database/) |
| `memory-policy.md` | [`ai-memory-policy.md`](ai-memory-policy.md) |

## Workflow per task

**1 — Context.** Read `docs/` and `.claude/context/` for the area you are touching. Identify the existing
architecture, the current limitations, the related ADRs, and the dependencies. The documentation is the
source of truth; assume nothing exists unless a document says it does.

**2 — Blockers.** Check whether the change depends on an undecided question. If it does, **stop and report
`BLOCKED`** — do not implement around it, and do not resolve it by picking something convenient. Full
protocol, including the report format: [`decision-gate.md`](decision-gate.md).

Work genuinely independent of the blocked decision may continue. Writing an entity document does not need
the test runner; writing a test does.

ADRs 0007, 0008, 0009, and 0011 were Accepted on 2026-07-28, so those four decisions are settled —
but **none of their follow-up work is done**. Current state and what remains:
[`decision-gate.md`](decision-gate.md).

| Still blocked | Blocks |
|---|---|
| Origin-side immigration rules (ADR-0010, reserved) | any verdict for regulated professions |
| Observability backend | dashboards and alert routing |

**3 — Build**, doc first where behaviour is being defined, then reconcile the doc with what was built.

**4 — Verify.** `pnpm lint:all`. Report what the output actually showed, in the four-part format from
[`decision-gate.md`](decision-gate.md): completed · verified · **not verified** · blocked.

## Output requirements

Every recommendation the platform produces is **explainable** and **evidence-based**:

```text
Bad:   You should apply for this job.

Good:  Recommended because AWS experience matches requirement X and Python covers
       requirement Y. Gap: Terraform. Confidence: medium. Missing: salary band for
       this market.
```

Reasoning · confidence · missing information · source. Contract:
`.claude/skills/ai-matching/SKILL.md`.

## Agent boundaries

Five agents, mapped to the services that implement them in
[`memory-manager.md`](memory-manager.md). Each obeys
[`ai-memory-policy.md`](ai-memory-policy.md).

| Agent | Must not |
|---|---|
| **Career** | guarantee employment · promise immigration approval · make legal decisions |
| **Résumé** | invent experience · create fake projects · add unsupported certifications |
| **Job Matching** | hide a gap · rank by commercial interest · treat `unknown` sponsorship as unavailable |
| **Immigration / Sponsorship** | give legal advice · guarantee eligibility · state a final decision · say an employer grants residency or citizenship |
| **Interview Coach** | pretend to be a real interviewer · misrepresent an evaluation · score the person rather than the answer |

The immigration agent provides **pathways, requirements, official source references, and what still needs
verification** — never a verdict dressed as advice
([`docs/architecture/immigration.md`](../../docs/architecture/immigration.md)).

## Memory

Before storing anything, three questions — and any "no" means do not store:

```text
Career related?  ·  Useful in a future interaction?  ·  Allowed by the privacy policy?
```

Full rules: [`ai-memory.md`](ai-memory.md) · [`ai-session.md`](ai-session.md) ·
[`ai-memory-policy.md`](ai-memory-policy.md) · [`memory-manager.md`](memory-manager.md).

## Observability

Every production AI service supports request tracing, agent execution tracking, error monitoring, and
performance metrics.

| Never logged | Allowed |
|---|---|
| personal identifiers · résumé contents · any private user information | `agent_name` · `execution_time` · `request_type` · `success_status` · `correlation_id` |

Detail: [`docs/development/observability.md`](../../docs/development/observability.md). **OpenTelemetry is
the instrumentation layer (ADR-0008); nothing is instrumented yet**, and the backend remains deferred.

## Testing

`pnpm lint:all` before merging. New features need unit tests, integration tests where applicable, and
their documentation updated in the same change.

**Vitest and pytest are the runners (ADR-0007), both installed and blocking in CI.** Unit and
integration are separate Vitest projects; `pytest` covers `ai/`. Integration needs a real PostgreSQL
and must not be mocked — what a CHECK rejects and what a partial unique index permits is the whole
point of those tests, and neither is knowable from a fake, so **Docker is a local prerequisite**
([`docs/development/testing.md`](../../docs/development/testing.md)).

**Graded prompt evals do not run in CI** (ADR-0009) — the CI runner has no model host. The offline gate
runs on every pull request; the graded delta report is attached to the PR by the author.

This paragraph previously said neither runner was installed and there was no application code. It
was wrong for several milestones, and it is the kind of thing an agent reads and believes before
looking at anything.

## Documentation

When behaviour changes, update the directory that owns it — `docs/features/`,
`docs/roadmap/`, `docs/database/` — in the **same change**. One home per fact; link rather than
restate.

**Never document a future idea as a completed feature** — and never leave a built one marked
unbuilt. `docs/features/README.md` carries an explicit status legend for exactly this reason.
`resume-parsing` and `skill-gap-analysis` are `partial`, with each document naming which parts; the
rest are `specified`.

## Reviewing AI-generated work

1. Does every referenced file exist?
2. Does the feature actually work — was it run?
3. Are assumptions written down?
4. Are the privacy rules followed?
5. Are tests included?

Never accept "implemented" / "completed" / "production ready" without verification. Also worth
distrusting: round numbers, precise-sounding estimates, and confident prose about work that was not
executed.

## Definition of done

- Code exists
- Tests pass
- Documentation updated in the same change
- Architecture remains consistent — no boundary crossed without an ADR
- No unsupported claims anywhere
- Privacy rules followed

## Related

- [`../../CLAUDE.md`](../../CLAUDE.md) — the five non-negotiable principles
- [`ai-principles.md`](ai-principles.md) — the ten rules for AI-produced claims
- [`product-principles.md`](product-principles.md) — the eight per-feature criteria
- [`../../docs/development/contributing.md`](../../docs/development/contributing.md) — review expectations
- [`decisions.md`](decisions.md) — when an ADR is required
