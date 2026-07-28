# Prompt eval runner

> **Purpose:** The implementation of the eval policy in `docs/prompts/evals.md`. Policy lives there;
> this describes the code.

## Why it is Python and lives here

It loads prompt files from `ai/*/prompts/`, calls the same model host `ai/` services will call, and
grades their output. All three belong on the Python side of the boundary (ADR-0003). `pnpm eval` is a
thin alias in `package.json` so the documented interface matches.

**Stdlib only**, deliberately: the runner must be usable before the uv workspace exists, so it cannot
become a reason to rush ADR-0006.

## Modules

| File | Owns |
|---|---|
| `cases.py` | fixture discovery, case loading and validation, the six required kinds |
| `grader.py` | structural comparison, grounding check, prose assertions, summary |
| `baselines.py` | baseline read/write per promptVersion, regression comparison |
| `model.py` | minimal Ollama client, `{{ variable }}` rendering |
| `run_evals.py` | CLI, offline checks, orchestration, reporting |

## Two modes

```bash
python ai/shared/evals/run_evals.py --offline    # no model needed — what CI runs
python ai/shared/evals/run_evals.py              # offline checks, then grade
```

**Offline** enforces what is checkable without a model, and treats each as a hard failure:

- a prompt file with no fixture directory (an unevaluated prompt cannot ship)
- a fixture directory with no matching prompt file
- a fixture set missing any of the six required case kinds
- a malformed case, or one with an empty `why`

**Graded** renders each case's prompt, calls the model at temperature 0, and grades the response.

Exit codes: `0` pass · `1` gate failure or blocked regression · `2` fixture or usage error.

## Design notes

**No LLM judges grounding or schema.** Grounding is checked by verifying every returned id came from a
closed set the case supplied — cheap, deterministic, auditable. Only prose assertions are subjective,
and those are `must_mention` / `must_not_mention` claims rather than a diff against a reference
paragraph.

**Missing model is a skip, not a failure.** Every case reports `skip` and the run exits 0, which is
what lets CI run the offline half on a runner with no Ollama. `--require-model` inverts this where a
skip should be a failure.

**Zero prompts is success.** The current state of the repository. The gate becomes meaningful the moment
the first prompt and its fixtures land, and until then the CI step is a real check that no-ops.

**`print` is the interface.** `T201` is per-file-ignored for `run_evals.py` in `ruff.toml` and remains
banned everywhere else in `ai/`.

## Verification

Behaviour was probed with throwaway fixtures and then removed: orphan prompt detected, missing case
kinds detected, complete set passing, model-absent skipping, and `--require-model` failing. Graded
output has **not** been verified against a real model — there is no prompt to grade yet, and no model
was reachable in this environment.

## Related

- `docs/prompts/evals.md` — the policy, the metrics, and the regression rules
- `docs/prompts/conventions.md` — the prompt contract being graded
- `docs/development/ci-cd.md` — which half runs in CI
