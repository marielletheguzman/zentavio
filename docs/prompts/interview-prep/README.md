# Interview Prep Prompts

> **Purpose:** Prompts for question generation and answer feedback.

Prompts loaded by `ai/interview-prep`. Two jobs: generate practice questions from **aggregated themes**,
and evaluate an answer against a **rubric derived from requirement facts**. Neither scores the person.

Prompt files live at `ai/interview-prep/prompts/`.

## Prompts

| Prompt | Job |
|---|---|
| `practice-generate` | write practice questions for a theme |
| `answer-feedback` | evaluate an answer against a rubric, name what was missing |
| `report-normalize` | extract themes and stages from a submitted interview report |
| `theme-cluster` | group report themes into named clusters |

## The labelling rule

Interview knowledge is **tier 4** — self-reported experience, aggregated, counted, dated
(`.claude/skills/interviews/SKILL.md`). So every generated question is labelled as generated:

| Presented as | Correct |
|---|---|
| "This company asks: design YouTube" | ❌ attributed, unsourced |
| "Practice question for the system-design theme (12 of 15 reports describe this stage, last 18 months)" | ✅ labelled, counted, dated |

`practice-generate` output carries `kind: "generated-practice"` and the theme's `reportCount` and
`window`. A generated question attributed to a company is fabrication with a person's preparation time
at stake.

### `practice-generate`

**Inputs.** `{{ theme }}` (with `reportCount`, `window`), `{{ role_requirements }}`,
`{{ difficulty }}`.

**Output.**

```json
{
  "questions": [{ "text": "…", "kind": "generated-practice", "themeId": "…",
                  "skillIds": ["…"], "rubricPoints": ["…"] }],
  "attribution": { "reportCount": 12, "window": "18 months", "confidence": "low" }
}
```

- Questions map to skills in the graph, so practice feeds the profile.
- `confidence` is never `high` — tier 4 has a ceiling regardless of consistency.
- Below minimum support the service falls back to role-generic themes from requirement facts, and says
  so. "We don't have enough reports for this company yet" plus solid generic prep is a good product;
  fabricated specificity is not.

### `answer-feedback`

**Inputs.** `{{ question }}`, `{{ rubric }}` (derived from requirement facts), `{{ answer }}`
(untrusted).

**Output.**

```json
{
  "met": ["<rubric point covered>"],
  "missing": ["<rubric point not covered>"],
  "feedback": "<specific, actionable, one focus>",
  "strength": "strong|adequate|weak"
}
```

Constraints:

- **Evaluate the answer, never the person.** No "you seem junior", no aptitude inference. `strength`
  describes this answer to this question.
- **Feedback is specific and tied to rubric points.** "No mention of failure modes" beats "good but
  could be better".
- **Name one thing to fix.** Interview prep fails on overwhelm, so the prompt returns one focus even
  when several points are missing.
- **Never score.** `strength` is an enum about coverage, not a number about the candidate.
- **Never promote a skill.** Only recorded practice outcomes feed readiness, and a strong answer never
  demotes an evidenced skill.

### `report-normalize`

Extraction from a submitted report, and **the anonymization point**: identifying details — names,
recruiter identities, dates precise enough to identify, distinguishing personal circumstances — are
dropped here rather than at display time (`docs/architecture/privacy.md`). What is stored is stage
structure, format, themes, and coarse timing.

## Two confidences, never conflated

The service reports confidence in **our model of the process** separately from confidence in **the
person's readiness**. Merging them hides the possibility that we are preparing someone thoroughly for
the wrong interview. Prompts receive and echo `processConfidence` distinctly.

## Unknown path

Below minimum support: role-generic prep, `processConfidence: "low"`, and an explicit statement that
company-specific data is thin. Never invented stages, never an invented question count.

## Eval cases

| Case | Guards |
|---|---|
| `happy-system-design-theme` | questions labelled generated, attribution carries `n` and window |
| `no-attributed-question` | no question presented as one the company asks |
| `low-support-fallback` | thin reports → generic prep, stated |
| `never-high-confidence` | tier-4 input never yields `high` |
| `feedback-not-person-judgment` | no aptitude or seniority inference |
| `feedback-single-focus` | one focus returned despite several gaps |
| `report-anonymized` | names and identifying details absent from normalized output |
| `injection-in-answer` | instructions inside an answer not followed |

## Related

- `.claude/skills/interviews/SKILL.md` — aggregation, minimum support, two confidences
- `docs/features/interview-prep.md`, `docs/architecture/privacy.md`
- `../conventions.md`, `../evals.md`
