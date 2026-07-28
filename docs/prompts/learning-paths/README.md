# Learning Path Prompts

> **Purpose:** Prompts for resource recommendation.

Prompts loaded by `ai/learning-paths`. The plan is **computed**: steps come from the gap, ordering from
`skill_edges.requires`, resources from ingested rows, estimates from resource durations and recorded
outcomes. These prompts describe that plan and match a resource to a step — they never name a resource
that does not exist.

Prompt files live at `ai/learning-paths/prompts/`.

## Prompts

| Prompt | Job |
|---|---|
| `resource-select` | choose among **candidate** resources already retrieved for a step |
| `step-explain` | say why this step, in this position, in one line |
| `syllabus-extract` | extract which skills a resource covers, from its own page |
| `path-summarize` | summarize a computed plan |

## The hard rule

> **Never invent a course, book, URL, provider, or certification.**

This is the single most common failure mode of a learning feature, and the reason `resource-select`
receives candidates rather than being asked what to learn from.

```text
gap item ─► knowledge-engine query (language, budget, format filters)
                    │
                    ▼
          candidate resources (real rows, real URLs)
                    │
                    ▼   resource-select                    ← MODEL chooses among these
              chosen resource + reason
```

If the query returns nothing, the step is emitted with `resources: []` and
`no_resource_note: "no verified resource for this skill yet"`
(`docs/database/entities/learning-resource.md`). **The prompt is not invoked.** Inviting a model to fill
that gap is exactly how a fabricated course title reaches a user.

### `resource-select`

**Inputs.** `{{ candidate_resources }}` (rows with id, title, provider, format, level, duration, cost,
language), `{{ skill }}`, `{{ learner_context }}` (stated level, hours per week, budget, language).

**Output.**

```json
{
  "resourceId": "<id from candidate_resources>",
  "reason": "<one line, referencing supplied attributes>",
  "alternatives": ["<id>", "<id>"],
  "unsuitable": [{ "resourceId": "<id>", "why": "advanced; learner is beginner" }]
}
```

- `resourceId` **must** be one of the supplied ids. A value outside the set fails schema validation.
- The reason cites supplied attributes only — never a quality judgment the model has no basis for
  ("highly rated", "the best course").
- **Prefer one strong choice over five options.** Choice paralysis is a real failure mode; alternatives
  exist but sit behind the primary.

### `step-explain`

**Inputs.** `{{ step }}` (skill, gap weight, prerequisites, position), `{{ target }}`.

Says why this skill and why now, referencing the prerequisite that placed it. "Docker before Kubernetes"
because the graph says so — users who understand the dependency follow the plan; users who don't reorder
it.

Never states a duration. That comes from `estimated_effort`, computed, and rendered separately.

### `path-summarize`

Receives the computed plan including its ranged estimates and assumptions. Constraints:

- **Never compress a range into a point.** "4–8 weeks at 6 hours per week", never "about a month".
- **Always carry the hours-per-week assumption.** Thirty hours is three weeks or three months depending
  on availability.
- **Never optimize the estimate downward for motivation.** If mastery takes a year, say a year — people
  reorganize their lives around these numbers, and an optimistic plan that fails is worse than an honest
  one that is hard (`.claude/skills/learning-paths/SKILL.md`).
- **Never imply that completion equals competence.** Only assessed verification promotes a skill to
  `evidenced`, and the summary says so where relevant.

### `syllabus-extract`

Extraction from a resource's own page. Returns covered skill ids from a closed set, with
`coverage: primary | partial | mentioned`. A course that merely *mentions* Terraform does not close a
Terraform gap, so `mentioned` is a real and frequently correct answer.

## Unknown path

- No candidate resources → step carries the note, prompt not invoked.
- No duration data → `estimated_effort` is `null` with `basis: null`; the summary says the timeline is
  unknown rather than guessing one.
- Unmodelled skill → the gap item cannot be planned; surfaced as unknown with the missing coverage
  named.

## Eval cases

| Case | Guards |
|---|---|
| `happy-terraform-step` | chosen id is from candidates; reason cites supplied attributes |
| `no-invented-resource` | empty candidate list → prompt not invoked, note emitted |
| `id-outside-candidate-set` | a hallucinated id fails schema validation |
| `range-not-point` | summary preserves the range and the hours-per-week assumption |
| `no-optimistic-compression` | a 12-month estimate is not softened |
| `coverage-mentioned-not-primary` | a passing mention is `mentioned` |
| `unknown-no-duration-data` | missing durations → timeline stated as unknown |
| `no-quality-claims` | no "highly rated" or "best" language |

## Related

- `.claude/skills/learning-paths/SKILL.md` — ordering, estimates, verification
- `docs/features/learning-paths.md`, `docs/database/entities/learning-resource.md`
- `../conventions.md`, `../evals.md`
