# Development

> **Purpose:** Dev docs index.

## Documents

| Document | Read it when |
|---|---|
| [`getting-started.md`](getting-started.md) | first clone — setup and the only thing there is to run |
| [`environment.md`](environment.md) | adding configuration or handling a secret |
| [`conventions.md`](conventions.md) | writing anything — naming, types, errors, commits |
| [`branching.md`](branching.md) | starting a branch or opening a PR |
| [`contributing.md`](contributing.md) | before opening a PR, and when reviewing one |
| [`testing.md`](testing.md) | writing a test, or deciding which level it belongs at |
| [`ci-cd.md`](ci-cd.md) | understanding what CI enforces, and what it does not yet |
| [`connector-guide.md`](connector-guide.md) | adding a data source |
| [`ai-service-guide.md`](ai-service-guide.md) | adding or changing a service under `ai/` |
| [`observability.md`](observability.md) | instrumenting anything |

## The short version

```bash
corepack enable && pnpm install --frozen-lockfile
pip install -r requirements-dev.txt
pnpm lint:all                      # exactly what CI runs
```

Branch off `main`, one logical change, doc in the same commit, PR states how it was verified.

## Five rules that catch most mistakes

1. **The doc is the specification.** Write it first where behaviour is being defined; reconcile it with
   what you built. Code contradicting its doc is broken.
2. **Absence is `null`, and `unknown` is a real answer.** Never a default standing in for a missing fact.
3. **Every number carries its evidence and its versions.** A score with no provenance is a bug.
4. **Configuration comes from `packages/config`; nothing else reads the environment.** Enforced by lint.
5. **No PII in a log, an error, an event, or a fixture.** Ever.

## What exists today

Real: the documentation, ADRs 0001–0006, boundary enforcement (`eslint.config.mjs`, `ruff.toml`), CI, and
the prompt-eval harness.

Not real yet: any application code, a database, migrations, a dev server, a test framework, a deployed
environment. So most of these documents describe the contract the first implementation adopts rather than
one it already follows. Each says so where it applies — if you find one that reads as though something
exists when it does not, that is a bug worth fixing immediately.

## Decisions: settled, and still open

**Settled** — ADRs Accepted 2026-07-28. The decision is binding; **the follow-up work is not done.**

| Decision | Next action |
|---|---|
| ADR-0007 Vitest + pytest | install it — no test runner is present |
| ADR-0008 OpenTelemetry, backend deferred | instrument — nothing is instrumented |
| ADR-0009 eval delta report as a review artifact | write the `promptVersion` check |
| ADR-0011 require the `ci` check | observe a green run, then configure branch protection |

**Still open:**

| Decision | Blocks |
|---|---|
| Origin-side immigration rules (ADR-0010, reserved) | any verdict for regulated professions |
| MVP feature scope, and which node inside software / IT | Phase 1 — `../roadmap/mvp-scope-options.md` |
| Observability backend | dashboards and alert routing |

## Related

- `../architecture/overview.md` — layers and boundaries
- `../roadmap/phases.md` — what gets built, in what order
- `.claude/skills/` — the rules per kind of work
- `../09_AI_SKILLS/AI_SKILLS.md` — how Claude works in this repo
