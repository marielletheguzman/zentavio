# Prompt Evals

> **Purpose:** How prompts are evaluated, test cases, regression policy.

Evals are a **blocking CI gate**, not a quality report. No prompt change ships without one
(`docs/development/ci-cd.md`).

> **Status — read this before relying on any claim below.**
>
> | Part | Built | In CI |
> |---|---|---|
> | Runner, fixture loader, grader, baseline store (`ai/shared/evals/`) | **yes** | — |
> | **Offline checks** — fixture integrity, all six case kinds present, no prompt without fixtures | **yes** | **yes**, every PR |
> | **Graded runs** — cases executed against a real model | **yes** | **no** — needs an Ollama host the CI runner does not have |
>
> So the *coverage* gate is enforced today: a prompt cannot merge without fixtures, and its fixtures
> cannot merge missing the unknown or injection case. The *grading* gate is implemented but must be
> run where a model is reachable. With zero prompts in the repository, the CI step passes trivially —
> a real check that is currently a no-op, not a claim that grading is happening.

They are separate from unit tests: unit tests use canned model responses to check the code around a
prompt; evals check the prompt against a real model on a fixed dataset.

## What is measured

Four things, and they are not weighted equally.

| Metric | Question | Failure means |
|---|---|---|
| **Grounding** | is every claim traceable to a supplied fact? | the prompt is inventing — a correctness failure |
| **Schema adherence** | does every response validate? | the output cannot be used at all |
| **Unknown handling** | does absent knowledge produce `unknown` + `missing`? | the system guesses confidently |
| **Extraction accuracy** | do extracted ids and statuses match expected? | quality, improvable incrementally |

Grounding, schema adherence, and unknown handling are **gates**. Extraction accuracy is a **trend**.
A change that improves accuracy by 4 points while regressing unknown handling is rejected — a confident
wrong answer costs a user more than a missed skill.

## Required cases per prompt

Every prompt has all six. A prompt with only happy-path cases has not been evaluated.

| Case | Input | Expected |
|---|---|---|
| **Happy path** | complete, well-formed | correct extraction, `high` confidence |
| **Missing knowledge** | the fact needed is absent from `<knowledge>` | `status: "unknown"`, `missing` populated, no value |
| **Contradictory knowledge** | two sources disagree | `contested` or `low` confidence, never an averaged middle |
| **Prompt injection** | user data contains instructions | normal extraction; instruction not followed; flagged if possible |
| **Malformed input** | garbled PDF text, truncated section | per-field `low` confidence, no invention |
| **Out of scope** | asks for legal or immigration advice | the refusal shape, no answer |

The injection and unknown cases are why this gate exists. They are the two failure modes that are
invisible in normal use and harmful when they occur.

## Dataset

```text
tests/fixtures/prompts/<prompt-name>/
├── cases/
│   ├── happy-senior-backend.json
│   ├── unknown-no-salary-band.json
│   ├── contested-two-sources.json
│   ├── injection-instruction-in-resume.json
│   ├── malformed-truncated-pdf.json
│   └── out-of-scope-visa-advice.json
└── baseline.<promptVersion>.json
```

`<prompt-name>` must match a prompt file at `ai/*/prompts/<prompt-name>-<YYYY-MM-DD>.md`. A mismatch
in either direction is an offline failure: fixtures with no prompt, or a prompt with no fixtures.

Each case is **self-contained** — expectations live in the case file, not a parallel `expected/`
directory, so a case and its expectation cannot drift apart. Required fields: `why`, `kind`, `input`,
`expect`.

```json
{
  "why": "Resume lists Kubernetes under Skills only, never in a described role. Must be CLAIMED, not EVIDENCED — the distinction drives readiness weighting.",
  "kind": "happy",
  "knowledge": { "known_skills": ["kubernetes", "docker"] },
  "input": { "resume_text": "…" },
  "expect": {
    "skills.0.skillId": "kubernetes",
    "skills.0.status": "CLAIMED",
    "unmatched": [],
    "_grounded_ids": ["skills.0.skillId"]
  }
}
```

`kind` is one of the six required kinds and decides whether the case is a gate. Keys in `expect` are
dotted paths (`skills.0.status`), compared exactly. Three directives start with `_`:

| Directive | Checks |
|---|---|
| `_absent` | listed paths must be null/absent — how the unknown gate is expressed, so a missing computation never arrives as `0` |
| `_grounded_ids` | listed paths must contain only ids from a closed set supplied in `knowledge` — the grounding gate, no judge required |
| `_prose` | `must_mention` / `must_not_mention` over a named field — claims, never wording |

An empty `why` is a fixture error, enforced by the loader.

A case without a `why` gets deleted during the first refactor, because nobody knows what breaking it
would mean.

**Fixtures are synthetic.** No real résumés, no real personal data, even scrubbed
(`docs/architecture/privacy.md`).

## Grading

| Field kind | Graded by |
|---|---|
| ids, enums, booleans, counts | exact match |
| source spans | exact substring of the input |
| numbers | exact — they come from code, not the model |
| explanation prose | assertions about content, never string equality |

Prose is graded on **claims, not wording**: does it mention the binding constraint, does it avoid
naming a fact absent from `<knowledge>`, does it avoid advice framing. Never diffed against a reference
paragraph — that tests style and blocks harmless rewording.

**LLM-as-judge is used only for prose assertions**, never for grounding or schema, and its verdicts are
themselves spot-checked. A judge that cannot be audited is not evidence.

## Regression policy

```text
run evals → compare against the recorded baseline for the previous promptVersion → report delta
```

| Delta | Outcome |
|---|---|
| Any gate case fails (grounding, schema, unknown, injection) | **blocked** |
| Extraction accuracy down > 2 points | **blocked** unless justified in the pull request |
| Accuracy down ≤ 2 points, gates pass | allowed, recorded |
| Accuracy up, gates pass | ship |

Baselines are committed per `promptVersion`, so the comparison is against a specific recorded run
rather than against a moving average.

**A model or route change is a prompt change** for this purpose. Swapping to a smaller model requires
the same gate — a cheaper model that fails the unknown cases is not shippable at any saving
(`conventions.md`).

## Running

```bash
pnpm eval:offline                    # fixture + coverage checks, no model. What CI runs.
pnpm eval                            # offline checks, then grade every prompt
pnpm eval -- <prompt-name>           # one prompt
pnpm eval -- <name> --baseline       # record a baseline for this promptVersion
pnpm eval -- --require-model         # fail instead of skipping when no model is reachable
```

The runner lives at `ai/shared/evals/run_evals.py`; `pnpm eval` is a thin alias so the documented
interface matches the polyglot reality. **It is Python, not TypeScript** — it loads prompt files from
`ai/`, calls the same model host `ai/` services will, and therefore belongs on that side of the
boundary (ADR-0003). Stdlib only, so it runs before the uv workspace exists (ADR-0006).

Exit codes: `0` pass · `1` gate failure or blocked regression · `2` fixture or usage error.

Graded runs need a live model (`OLLAMA_HOST`, default `http://127.0.0.1:11434`; model via
`ZENTAVIO_EVAL_MODEL`). Without one, every case reports `skip` and the run exits 0 — deliberate, so
the offline checks remain usable in CI. Use `--require-model` where a skip should be a failure.

Evals are **not** in the default test suite; that suite must stay fast enough to run on every save
(`.claude/skills/testing/SKILL.md`).

## CI wiring

**Implemented, partially.** `.github/workflows/ci.yml` runs `--offline` in the `python` job on every
pull request. That enforces:

- every prompt has a fixture directory (an unevaluated prompt cannot merge)
- every fixture set covers all six required kinds
- every case file is valid, and states why it exists

**Not in CI:** graded runs, because the runner has no model host. **ADR-0009 (Accepted)** settles the
approach: the author runs graded evals locally against the pinned model and **attaches the delta report to
the pull request**, which is a required review artifact rather than a mechanised gate. A self-hosted runner
with Ollama follows when there is a second contributor or the first paying user.

**The `promptVersion` check is implemented and runs in CI** (`pnpm check:prompt-versions`,
`ai/shared/evals/check_prompt_versions.py`). It fails a change that:

- modifies a prompt's content without changing its filename
- deletes a prompt version
- **moves** a prompt version — a `git mv` removes the old version just as a delete does

So the workflow is **copy, not move**:

```bash
cp ai/x/prompts/name-2026-07-01.md ai/x/prompts/name-2026-08-01.md
# edit the copy; leave the old version untouched
```

Still to build: posting the delta report to the pull request.

## Adding a prompt

1. Write the prompt per `conventions.md`.
2. Write all six required cases **before** tuning wording. The cases define what right means.
3. Run, inspect failures, fix the retrieval or the schema first — wording is the last resort and the
   least durable fix.
4. Record the baseline.
5. Document the prompt's contract in `docs/prompts/<service>/README.md`.

## What evals do not cover

- Whether the score is correct — that is arithmetic, unit-tested deterministically.
- Whether the facts are correct — that is the knowledge engine's provenance.
- Whether the feature is useful — that is outcomes (`docs/features/outcomes-learning.md`).

Evals cover exactly one thing: that the model does its narrow job and refuses the rest.

## Related

- `conventions.md` — the prompt contract being evaluated
- `.claude/skills/prompt-engineering/SKILL.md`, `.claude/skills/testing/SKILL.md`
- `docs/development/ci-cd.md` — the gate table
- `.claude/context/ai-principles.md`
