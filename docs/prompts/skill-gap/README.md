# Skill Gap Prompts

> **Purpose:** Prompts for skill extraction and gap reasoning.

Prompts loaded by `ai/skill-gap`. The gap itself is **computed, not prompted** — set arithmetic over
resolved skills with weights from the knowledge engine. The prompts here do two narrow jobs: extract
requirements from posting text, and explain a gap that code already calculated.

Prompt files live at `ai/skill-gap/prompts/`.

## Prompts

| Prompt | Job |
|---|---|
| `requirement-extract` | pull skill requirements out of a job description |
| `requirement-classify` | mark each requirement required vs preferred |
| `gap-explain` | write the explanation of a **computed** gap |

## What is computed, not prompted

```text
profile skills (resolved)  ─┐
                            ├─► resolve aliases ─► match ─► weight ─► ordered gap   ← CODE
career/posting requirements ┘                                            │
                                                                          ▼
                                                              gap-explain prompt    ← MODEL
```

The model never decides that a skill is missing, how much it matters, or what order to close it in.
Weights come from `career_skills` and `job_posting_skills`; ordering comes from `skill_edges.requires`
(`docs/database/entities/skill.md`).

### `requirement-extract`

**Inputs.** `{{ known_skills }}` (closed set), `{{ job_description }}` (untrusted).

**Output.**

```json
{
  "requirements": [{ "skillId": "terraform", "sourceSpan": "<verbatim>",
                     "stated_as": "required|preferred|mentioned", "confidence": "high|medium|low" }],
  "unmatched": ["<phrase that reads as a requirement but is not a known skill>"],
  "missing": []
}
```

`stated_as` records what the **posting said**, not what the market implies. A skill the posting merely
mentions is not a requirement, and inflating it makes a reachable job look unreachable.

**Never adds a requirement the posting does not state.** No "this role usually needs Kubernetes". That
is `ai-principles.md` rule 10, and market-typical requirements come from `market_signals`, retrieved as
knowledge and labelled as such.

### `gap-explain`

**Inputs.** `{{ computed_gap }}` — already weighted and ordered — plus `{{ target_summary }}`.

**Output.** Prose plus a per-item one-line reason, drawn strictly from the supplied gap. Constraints:

- Never introduce a skill absent from `{{ computed_gap }}`.
- Never restate or recompute a weight.
- Never estimate a timeline — that belongs to `ai/learning-paths`, which has resource durations.
- Never encourage. "You're a great fit!" with no gap is the failure mode this prompt most easily drifts
  into.

## Unknown path

If the target has no modelled requirements, the service returns `unknown` with `missing` naming the
unmodelled track. `gap-explain` is not invoked — there is nothing to explain, and inviting the model to
fill the space is exactly how a fabricated gap appears.

## Eval cases

| Case | Guards |
|---|---|
| `happy-cloud-engineer-gap` | explanation covers every supplied item, adds none |
| `no-invented-requirement` | posting silent on a common skill → not extracted |
| `preferred-not-required` | "nice to have" is `preferred`, never `required` |
| `unknown-unmodelled-track` | no requirements → `unknown`, prompt not invoked |
| `contested-two-weight-sources` | conflicting weights → `low` confidence, no averaging |
| `injection-in-job-description` | instructions in the posting not followed |
| `no-encouragement-without-gap` | output states the gap; no motivational filler |

## Related

- `../conventions.md`, `../evals.md`
- `docs/features/skill-gap-analysis.md`
- `.claude/skills/ai-matching/SKILL.md`, `.claude/skills/career-intelligence/SKILL.md`
- `docs/database/entities/skill.md` — where weights and `requires` edges live
