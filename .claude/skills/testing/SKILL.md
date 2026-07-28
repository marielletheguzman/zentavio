---
name: testing
description: Zentavio's testing strategy — the test pyramid per layer, golden-file connector tests, deterministic scoring tests, prompt evals, fixtures, integration and e2e boundaries, and what must never be mocked. Load when writing or changing tests, adding a fixture, setting up a test for a connector/score/prompt, when a test is flaky, or when deciding what level a test belongs at.
---

# Testing

## Purpose

Zentavio's correctness claims are load-bearing: a wrong visa threshold or an unreproducible
score is a product failure, not a bug ticket. This skill defines what gets tested at which
level, and the properties that must be enforced by tests rather than by review.

## Scope

**Applies to:** unit and integration tests across the monorepo, `tests/e2e`,
`tests/integration`, `tests/fixtures`, prompt evals, and CI test configuration.

**Does not apply to:** what the code should do (the layer's own skill), eval prompt design
(`prompt-engineering`).

## What to test where

| Layer | Level | Test the fact that… |
|---|---|---|
| `connectors/*` | unit, golden-file | `normalize` maps a captured payload to an exact expected record |
| `connectors/*` | unit | `validate` rejects the malformed cases, with reasons |
| `connectors/*` | integration (gated) | pagination and backoff work against a recorded session |
| `knowledge-engine` | unit | versioning, supersede, and merge rules behave |
| `knowledge-engine` | integration | reconciliation over real fixtures is idempotent |
| `ai/*` | unit | scoring arithmetic is deterministic and evidence reconciles to the score |
| `ai/*` | eval | prompts ground, refuse, and return `unknown` correctly |
| `services/*` | unit | use cases with fake ports |
| `services/*` | integration | routes, DTO validation, error envelope, DB against a real Postgres |
| `apps/*` | component | the four states render; keyboard path works |
| `apps/*` | e2e | one full user journey per feature, no more |

Cost rises down the table; count falls. Many unit tests, few integration tests, a handful of
e2e journeys.

## The properties tests must enforce

These are the invariants that reviews miss and tests must not:

1. **Determinism.** Same inputs + same versions → identical score, byte for byte. A scoring
   test that tolerates a range is hiding non-determinism.
2. **Evidence completeness.** Every score carries evidence whose weights reconcile to the
   score. Assert this generically, once, over every scorer.
3. **Provenance.** No fact can be persisted without `sourceTier` and `sourceUrl`. Assert at the
   repository level so it cannot be bypassed.
4. **No tier-5 in fact tables.** A test that attempts to write a generated value must fail.
5. **Unknown paths.** Every AI surface has a test where knowledge is absent and the output is
   `unknown` with `missing` populated — never a default.
6. **Idempotency.** Ingestion run twice produces zero new facts. Billing operations run twice
   charge once.
7. **Purity.** `normalize` called twice with the same payload returns the same result, with no
   I/O — fail the test if the clock or network is touched.
8. **Injection resistance.** A resume containing instructions produces a normal extraction.

## Golden-file connector tests

The only trustworthy way to test a connector:

```text
tests/fixtures/connectors/<sourceId>/
├── search-page-1.json          captured raw response
├── search-page-2.json
├── job-normal.json
├── job-missing-salary.json
├── job-malformed.json
└── expected/
    ├── job-normal.normalized.json
    └── job-missing-salary.normalized.json
```

- Capture real payloads once; commit them (scrubbed of credentials and PII).
- `normalize(fixture)` must equal the expected file exactly. Diff failures are the point — a
  changed mapping should be a visible, reviewed diff, not a passing loose assertion.
- Absent fields must be `null` in the expected file. A test that accepts a default value
  legitimizes invented data.
- When the source changes shape, capture a new fixture; keep the old one. It documents history.

## Prompt evals

Not unit tests — a separate gate (`docs/prompts/evals.md`, `prompt-engineering`).

Required cases per prompt: happy path, missing knowledge (`unknown`), contradictory knowledge
(`contested`/`low`), prompt injection in user data, malformed input, out-of-scope request.

A regression on the unknown-handling or injection cases blocks the change regardless of average
score improvement. Those are the cases that protect users.

## What must never be mocked

- **PostgreSQL** in an integration test. Use a real instance (containerized). A mocked database
  proves your mock works.
- **The score arithmetic.** Never assert against a stubbed scorer; that is the code under test.
- **Immigration rule evaluation.** Deterministic and cheap — test it for real.
- **The error envelope.** Assert the actual shape a client receives.

## What should always be faked

- **LLM calls in unit tests.** Deterministic canned responses; real model behavior belongs in
  evals.
- **External HTTP** in unit tests. Fixtures, not live sources — a test suite that hits a job
  board is a rate-limit incident and a flake generator.
- **Time.** Inject a clock. Never `Date.now()` in a code path under test.
- **Randomness.** Seeded, always.

## Flakiness

A flaky test is treated as a failing test. Fix or delete it — never retry it into green.

Usual causes, in order: real time, real network, shared mutable fixtures, test-order
dependence, and unseeded randomness. All four are avoidable by construction.

## Fixtures

- Live in `tests/fixtures/`, organized by domain (`connectors/`, `prompts/`, `profiles/`,
  `knowledge/`).
- Realistic, minimal, and named for what they exercise (`job-missing-salary.json`).
- **Never contain real personal data.** Synthetic resumes and profiles only, and never a real
  person's immigration status, salary, or contact details — even scrubbed.
- Shared fixtures are read-only. A test that mutates a shared fixture creates order dependence.

## Constraints

- **No test asserting a range on a deterministic score.**
- **No connector test hitting a live source in the default suite.**
- **No mocked database in an integration test.**
- **No real PII in a fixture.**
- **No flaky test retried into passing.**
- **No prompt change merged without its eval run.**
- **No new score, connector, or knowledge type without its invariant tests** (determinism,
  evidence, provenance, unknown path).
- **No e2e test asserting styling or copy.** Assert behavior; copy changes.
- **No test depending on another test's state or on run order.**

## Examples

**Bad.**

```typescript
it('scores a match', async () => {
  const result = await matcher.score(user, job);
  expect(result.score).toBeGreaterThan(0.5);          // range on deterministic output
  expect(result).toBeDefined();                        // asserts nothing
});
```

Passes when evidence is missing, when versions are absent, and when the score is wrong by 0.4.

**Good.**

```typescript
it('scores a match deterministically with reconciling evidence', async () => {
  const result = await matcher.score(profileFixture, postingFixture);

  expect(result.score).toBe(0.72);                                  // exact
  expect(result.scorerVersion).toBe('job-match-v3');
  expect(sum(result.evidence.map(e => e.weight ?? 0))).toBeCloseTo(result.score, 6);
  expect(result.evidence.map(e => e.kind)).toContain('skill_missing');
  expect(await matcher.score(profileFixture, postingFixture)).toEqual(result);   // stable
});

it('returns unknown when the market facts are absent', async () => {
  const result = await matcher.score(profileFixture, postingWithNoMarketData);
  expect(result.status).toBe('unknown');
  expect(result.missing).toContain('salary band unknown for this market');
  expect(result.score).toBeNull();                                  // never a default
});
```

## Best Practices

- Write the fixture before the code. The shape of real data decides the design.
- One assertion subject per test; name the test after the invariant, not the function.
- Test the boundary and the absence, not the middle. Bugs live where data is missing.
- Prefer a real Postgres in a container over any in-memory substitute — dialect differences are
  exactly where the bugs are.
- When a bug ships, the fix includes the test that would have caught it, at the cheapest level
  that could have caught it.
- Keep the default suite fast enough to run on every save. A slow suite is an unrun suite.
