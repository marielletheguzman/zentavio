# Prompt Evals

> **Purpose:** How prompts are evaluated, test cases, regression policy.

Evals are a **blocking CI gate**, not a quality report. No prompt change ships without one
(`docs/development/ci-cd.md`).

> **Status: policy defined, runner not built.** Everything below is binding from the moment the first
> prompt exists, and none of it is automated yet — the `pnpm eval` commands, the grader, the baseline
> store, and the CI job are unbuilt, because `ai/` has no code and therefore no prompt to evaluate.
> Do not read the command examples as available today.

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
└── expected/
    └── <same names>.json
```

Every case file states **why it exists**:

```json
{
  "why": "Resume lists Kubernetes under Skills only, never in a described role. Must be CLAIMED, not EVIDENCED — the distinction drives readiness weighting.",
  "knowledge": { "known_skills": ["kubernetes", "docker"] },
  "input": { "resume_text": "…" },
  "expect": {
    "skills": [{ "skillId": "kubernetes", "status": "CLAIMED" }],
    "unmatched": []
  }
}
```

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

The intended interface, once the runner exists:

```bash
pnpm eval <prompt-name>        # one prompt against its dataset
pnpm eval --all                # everything, on CI
pnpm eval <name> --baseline    # record a new baseline for a new promptVersion
```

Evals need a live model, so they run against the pinned local Ollama model. They are **not** in the
default test suite — that suite must stay fast enough to run on every save
(`.claude/skills/testing/SKILL.md`).

## CI wiring

**Not yet implemented** — no eval job exists in `.github/workflows/ci.yml`. The design, for when it is
built: triggered when a change touches `ai/**/prompts/**`, `docs/prompts/**`, or the model routing
config.

- Non-skippable once triggered.
- The delta report is posted to the pull request.
- The prompt's version must have been bumped: an unchanged `promptVersion` with changed content fails
  the gate before evals even run, because it makes past outputs unreproducible.

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
