# shared

> **Purpose:** Shared AI assets: prompt templates, model clients, guardrails, retrieval helpers.

Today this is the **prompt eval harness** (ADR-0009) — the gate every prompt change passes.

```text
evals/
├── cases.py                  fixture discovery; the six required case kinds
├── grader.py                 structural and prose grading
├── baselines.py              per-promptVersion baselines and the regression policy
├── model.py                  a minimal Ollama client
├── run_evals.py              the runner: --offline, --baseline, --require-model
└── check_prompt_versions.py  promptVersion integrity
```

**Stdlib only, deliberately.** The runner must be installable with nothing but Python.

**Grounding and schema are never judged by a model.** An id outside the supplied closed set is a
fabrication detectable without a judge, and a judge that cannot be audited is not evidence. Prose is
graded on claims, never string equality — diffing paragraphs tests style and blocks harmless
rewording.

**Six case kinds are required per prompt**: happy, unknown, contested, injection, malformed,
out-of-scope. The unknown and injection cases are why the gate exists — they are the two failure
modes invisible in normal use and harmful when they regress, so they block regardless of how much
extraction accuracy improved.

**`promptVersion` is the filename stem**, so the workflow is **copy, not move**: a `git mv` removes
the old version just as a delete does, and `check_prompt_versions.py` fails a modification, a
deletion and a move alike.

Graded runs need a model host and so do not run in CI; the offline gate does, on every pull request.
Two cautions learned by running it: graded results are **not** reproducible even at temperature 0
with a fixed seed, and a prompt's worked examples must never reuse its fixture text — one prompt
scored 100% that way and 50% once the examples were rewritten.

## Not here

Shared prompt templates, a production model client, retrieval helpers. Each arrives with its second
caller — `ai/resume-parser` owns its own client until something else needs one.
