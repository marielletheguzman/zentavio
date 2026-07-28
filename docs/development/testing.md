# Testing

> **Purpose:** Test strategy: unit, integration, eval.

**No test framework is installed and no application tests exist**, because there is no application code.
What *does* run today is `pnpm lint:all` and the offline half of the prompt-eval gate.

This document is the strategy the first tests must follow. Full rules and reasoning:
`.claude/skills/testing/SKILL.md`.

## What gets tested where

| Layer | Level | Asserts |
|---|---|---|
| `connectors/*` | unit, golden-file | `normalize` maps a captured payload to an exact expected record |
| `connectors/*` | unit | `validate` rejects malformed cases, with reasons |
| `knowledge-engine` | unit | versioning, supersede, and merge rules |
| `knowledge-engine` | integration | reconciliation over fixtures is idempotent |
| `ai/*` | unit | scoring arithmetic is deterministic; evidence reconciles to the score |
| `ai/*` | eval | prompts ground, refuse, and return `unknown` correctly |
| `services/*` | unit | use cases against fake ports |
| `services/*` | integration | routes, DTO validation, error envelope, real PostgreSQL |
| `apps/*` | component | the four states render; keyboard path works |
| `apps/*` | e2e | one journey per feature, no more |

Cost rises down the table; count falls.

## The invariants tests must enforce

These are the properties review misses, and they are why the strategy exists at all:

1. **Determinism** — same inputs plus same versions produce a byte-identical score. A test tolerating a
   range is hiding non-determinism.
2. **Evidence completeness** — every score carries evidence whose weights reconcile to it. Asserted
   generically, once, across every scorer.
3. **Provenance** — no fact persists without `source_tier` and `source_url`. Asserted at the repository
   level so it cannot be bypassed.
4. **No tier-5 in fact tables** — an attempt to write a generated value must fail.
5. **Unknown paths** — every AI surface has a test where knowledge is absent and the output is `unknown`
   with `missing` populated, never a default.
6. **Idempotency** — an ingestion run twice produces zero new facts; a billing operation twice charges
   once.
7. **Purity** — `normalize` called twice returns the same result, with clock and network stubbed to
   *throw*.
8. **Injection resistance** — a résumé containing instructions produces a normal extraction.

## Golden-file connector tests

The only trustworthy way to test a connector:

```text
tests/fixtures/connectors/<sourceId>/
├── search-page-1.json          captured raw response
├── job-normal.json
├── job-missing-salary.json
└── expected/
    └── job-normal.normalized.json
```

`normalize(fixture)` must equal the expected file **exactly**. A changed mapping should show up as a
reviewed diff, not as a loose assertion that still passes. Absent source fields are `null` in the
expected file — a test accepting a default legitimizes invented data.

## Never mocked

- **PostgreSQL** in an integration test. A mocked database proves the mock works; dialect differences are
  where the bugs are.
- **Score arithmetic** — that is the code under test.
- **Immigration rule evaluation** — deterministic and cheap, so test it for real.
- **The error envelope** — assert the shape a client actually receives.

## Always faked

- **LLM calls** in unit tests — canned responses. Real model behaviour belongs in evals.
- **External HTTP** — fixtures. A suite that hits a job board is a rate-limit incident and a flake
  generator.
- **Time** — inject a clock. Never `Date.now()` in a path under test.
- **Randomness** — seeded.

## Evals are a separate gate

Prompt evals are not unit tests: they run a real model against a fixed dataset, and they have their own
policy and thresholds (`docs/prompts/evals.md`). Today the **offline half runs in CI** — fixture
integrity, all six required case kinds present, no prompt without fixtures. Graded runs need an Ollama
host and happen locally.

Evals stay out of the default suite, which must remain fast enough to run on every save.

## Flakiness

A flaky test is a failing test. Fix it or delete it — never retry it into green. The usual causes, all
avoidable by construction: real time, real network, shared mutable fixtures, test-order dependence,
unseeded randomness.

## Fixtures

Live in `tests/fixtures/`, organized by domain. Realistic, minimal, and named for what they exercise
(`job-missing-salary.json`). **Never real personal data** — synthetic profiles only, and never a real
person's immigration status, salary, or contact details, even scrubbed
(`docs/architecture/privacy.md`). Shared fixtures are read-only.

## Conventions

- Name the test after the invariant, not the function: `returns unknown when market facts are absent`.
- One assertion subject per test.
- Test the boundary and the absence, not the middle — bugs live where data is missing.
- A bug fix ships with the test that would have caught it, at the cheapest level that could have.

## Not decided yet

The test runner is unchosen. It is a dependency, so it needs an ADR
(`.claude/context/tech-stack.md`) — with the constraints that it must run TypeScript without a
build step, support a real containerized PostgreSQL for integration tests, and stay fast enough for
watch mode. The Python side will use `pytest` under the uv workspace (ADR-0006).

## Related

- `.claude/skills/testing/SKILL.md` — the full strategy
- `docs/prompts/evals.md` — the eval gate
- `ci-cd.md` — what runs where
