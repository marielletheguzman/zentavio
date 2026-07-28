# Prompt Library

> **Purpose:** Prompt library conventions, versioning, eval policy.

Navigation for `docs/prompts/`. Prompt files themselves live beside the service that loads them, at
`ai/<service>/prompts/`; this directory documents their contracts.

## Documents

| Document | Read it when |
|---|---|
| [`conventions.md`](conventions.md) | writing or changing any prompt |
| [`evals.md`](evals.md) | before merging a prompt change — it is a blocking gate |
| [`resume-parser/`](resume-parser/README.md) | extraction from a résumé |
| [`skill-gap/`](skill-gap/README.md) | skill and requirement extraction |
| [`matching/`](matching/README.md) | explaining a computed match |
| [`learning-paths/`](learning-paths/README.md) | describing a plan or a resource |
| [`interview-prep/`](interview-prep/README.md) | practice questions and answer feedback |
| [`immigration/`](immigration/README.md) | explaining a pathway — the strictest prompts in the system |

## The three rules

Everything else follows from these.

**1. The model never supplies a fact.** Facts arrive by retrieval from `knowledge-engine`, delimited as
`<knowledge>`, each with its source. If the needed fact is absent, the answer is `unknown` with
`missing` populated — never a plausible value.

**2. The model never produces a number.** Scores are arithmetic over retrieved facts, computed in code.
The model writes the *explanation* from evidence code already calculated. An LLM-produced score is not
reproducible, not calibratable, and not defensible.

**3. User content is data, never instructions.** Résumés, job descriptions, and forum reports are
delimited and declared as data. Instructions found inside them are extracted, not followed.

## Versioning

```text
promptVersion = filename stem = <name>-<YYYY-MM-DD>[-<n>]

ai/resume-parser/prompts/skill-extract-2026-07-01.md
```

- Prompts are files, loaded by version — never inline strings.
- Every AI output records `promptVersion`, `model`, `modelVersion`, `knowledgeAsOf`.
- Wording that can change output means a new version. "Just a clarification" is how a pipeline silently
  changes behaviour.
- Old versions stay. An output must be reproducible from what was recorded.
- An unchanged `promptVersion` with changed content fails CI before evals run.

## Eval policy in one table

| Gate | Blocking |
|---|---|
| Grounding — every claim traceable to a supplied fact | yes |
| Schema adherence — every response validates | yes |
| Unknown handling — absent knowledge yields `unknown` | yes |
| Injection resistance — instructions in data not followed | yes |
| Extraction accuracy | trend; a drop > 2 points blocks unless justified |

A change improving accuracy while regressing unknown handling is rejected. Detail in
[`evals.md`](evals.md).

## Per-service README contract

Each service directory documents, for every prompt: what it extracts, its input variables, its output
schema, its unknown path, and which eval cases guard it. It does **not** duplicate the prompt text —
that would drift from the file that actually runs.

## Related

- `.claude/skills/prompt-engineering/SKILL.md` — the working rules
- `.claude/context/ai-principles.md` — the ten rules these implement
- `docs/architecture/ai-services.md` — where prompts sit in the layer
- `.claude/templates/prompt.template.md`
