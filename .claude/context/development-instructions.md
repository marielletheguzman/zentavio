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

**2 — Blockers.** Check whether the change depends on an undecided question. **Do not bypass an unresolved
architectural decision** — implement around it and say what is blocked, or resolve it with an ADR first.

Current blockers, and what each one stops:

| Blocked decision | Blocks | Where |
|---|---|---|
| Test runner | the first test | `docs/development/testing.md` |
| Observability stack | the first instrumented service | `docs/development/observability.md` |
| Origin-side immigration rules | any verdict for regulated professions | `docs/architecture/immigration.md` |
| Graded evals in CI | the eval gate being fully blocking | `docs/prompts/evals.md` |
| MVP career track | Phase 1 | `docs/roadmap/mvp.md` |
| `ci` as a required check | ADR-0005 being enforced rather than advisory | `docs/development/branching.md` |

**3 — Build**, doc first where behaviour is being defined, then reconcile the doc with what was built.

**4 — Verify.** `pnpm lint:all`. Report what the output actually showed.

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

Detail: [`docs/development/observability.md`](../../docs/development/observability.md). **The stack itself
is undecided** — see blockers.

## Testing

`pnpm lint:all` before merging. New features need unit tests, integration tests where applicable, and
their documentation updated in the same change.

**No test framework is installed yet** and no application tests exist, because there is no application
code. Choosing the runner is a blocker, not an oversight
([`docs/development/testing.md`](../../docs/development/testing.md)).

## Documentation

When behaviour changes, update the directory that owns it — `docs/features/`,
`docs/roadmap/`, `docs/database/` — in the **same change**. One home per fact; link rather than
restate.

**Never document a future idea as a completed feature.** `docs/features/README.md` carries an explicit
status legend for exactly this reason, and everything in it is currently `specified`.

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
