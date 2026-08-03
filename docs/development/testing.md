# Testing

> **Purpose:** Test strategy: unit, integration, eval.

**Vitest and pytest are installed (ADR-0007) and run in `lint:all` and CI.** What exists today:

| Suite | Command | Covers |
|---|---|---|
| Vitest `unit` | `pnpm test:unit` | the boundary-disable audit script — 9 tests |
| Vitest `integration` | `pnpm test:integration` | **nothing yet** — needs `packages/db` and migrations |
| pytest | `pnpm test:py` | the prompt-eval runner — 43 tests |

**No application tests exist, because there is no application code.** The rest of this document is the
strategy the first ones must follow. Full rules: `.claude/skills/testing/SKILL.md`.

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

## Installed, and what is still missing

**ADR-0007 (Accepted): Vitest for TypeScript, `pytest` for `ai/`.** Configured in `vitest.config.ts`
(`unit` and `integration` projects) and `pytest.ini`.

Settled from the ADR's follow-up list:

- ~~The `integration` project has no tests and no PostgreSQL container helper.~~ It has **11 files
  and 139 tests**, and `tests/integration/db/database.ts` is the helper. They arrived with
  `packages/db` and the migrations, as the ADR expected.
- ~~No integration CI job.~~ `Integration tests (PostgreSQL)` runs on every pull request against a
  `postgres:17-alpine` service container, pinned to the same tag as
  `infra/docker/docker-compose.dev.yml` — a CI database on a different major than the developer's
  would make a green run evidence about the wrong server.
- **Docker IS a local prerequisite.** The integration suite needs a real PostgreSQL, and this
  document forbids mocking it: what a CHECK actually rejects and what a partial unique index
  actually permits is the whole point of those tests, and neither is knowable from a fake.

Still outstanding:

- **pytest config stays in `pytest.ini`** rather than moving into the uv workspace. CI runs
  `uv run --project ai --all-packages --frozen pytest` from the repository root, so `testpaths = ai`
  still resolves; a second configuration in `ai/pyproject.toml` would be drift waiting to happen.
- **Graded prompt evals do not run in CI** (ADR-0009): the runner has no model host. The offline
  gate — fixture integrity, all six required case kinds, no prompt without fixtures — runs on every
  pull request, and the graded delta report is attached to the PR by the author instead.

## Related

- `.claude/skills/testing/SKILL.md` — the full strategy
- `docs/prompts/evals.md` — the eval gate
- `ci-cd.md` — what runs where
