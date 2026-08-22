# Interview Prep

> **Purpose:** Question generation, mock interview, feedback.

Where the platform's knowledge becomes immediately usable: what this company's process actually looks
like, and whether this person can answer it. The data is mostly experiential, which makes handling its
confidence the central discipline.

**User question:** *what will they ask, and am I ready?*

## Where the data comes from

Interview knowledge is **tier 4** — self-reported experience. Valuable *because* it is experiential, and
never presentable as company policy.

| Wrong | Right |
|---|---|
| "This company asks system design in round 3." | "12 of 15 reports (last 18 months) describe a system-design round at stage 3." |

So every surfaced pattern carries `n`, its time window, and a confidence that is capped below `high` —
tier 4 has a ceiling no amount of consistency raises. An officially published process, where one exists,
is tier 1 and outranks reports.

### Published processes are not modelled, and that is an evidence limit

**What would qualify.** A process published by the employer itself, or by an authority speaking for
it — a careers page setting out the stages, a public hiring handbook, a regulator's description of a
statutory selection process. Attributable, dated, and retrievable at a stable URL, like every other
tier-1 source this product reads.

**No such source is currently identified for the roles this product serves.** Software and IT
employers overwhelmingly do not publish their interview stages; where something exists it is a
recruiting blog post that changes without notice and describes intent rather than practice, which is
not tier 1 whatever its author's job title.

**So it is not modelled.** There is no table, no connector, and no `published_process` field
anywhere — because storage built for data nobody can supply is false completeness: it reads as
coverage, it queries as empty, and the absence looks like a gap in the data rather than a gap in the
world.

**This is a limitation of our evidence, not a claim about reality.** Some employers do publish, and
some regulated selection processes are published by statute. We have not found an ingestible source
for the roles in scope; that is a different sentence from "there is none", and this section exists so
nobody later reads the missing model as the stronger claim.

**Revisit when a concrete source is found** — a named employer or authority, publishing at a stable
URL, for a role family this product actually serves. That is the trigger, and until it fires the
report-derived process (capped at `medium`, ADR-0031) is the best available and says so.

## Below minimum support

> "We don't have enough reports for this company yet."

Plus solid role-generic preparation built from the role's requirement facts. That is a good product.
Fabricated specificity, with a person's preparation time at stake, is not.

## Practice

Questions are generated **from aggregated themes** and labelled as generated. A generated question
attributed to a company is fabrication.

Each question maps to skills in the graph, so practice feeds the profile rather than sitting beside it.

## Feedback

Evaluated against a rubric derived from the role's requirement facts — not from generic interview wisdom.

- **The answer is evaluated, never the person.** No aptitude inference, no "you seem junior".
- **Specific and tied to rubric points.** "No mention of failure modes" beats "good but could be
  better".
- **One focus at a time.** Interview prep fails on overwhelm, so one thing to fix is returned even when
  several points are missing.
- **A practice answer promotes nothing** (ADR-0030). It is unproctored, ungraded against a fixed
  instrument, and marked by us against a rubric we wrote — which is a coaching signal, not evidence.
  A strong answer moves **Interview Readiness**, which is about this process at this company; a weak
  one never demotes an evidenced skill, because nothing here touches `profile_skills` at all.

## Interview Readiness

Distinct from Career Readiness: this is about **the process**, for this role at this company.

```json
{
  "readiness": 0.54,
  "confidence": "low",
  "byStage": [
    { "stage": "system-design", "readiness": 0.3, "basis": "2 sessions, both weak on tradeoffs" },
    { "stage": "coding", "readiness": 0.7, "basis": "6 sessions, consistent" }
  ],
  "remaining": ["system-design tradeoff articulation"],
  "processConfidence": "low",
  "processBasis": "12 reports, last 18 months, n per stage 3-7"
}
```

**Two confidences travel separately** — confidence in the person's readiness, and confidence in our model
of the process. Merging them hides the possibility that we are preparing someone thoroughly for the wrong
interview.

## Contributing a report

Requested after a real interview, because the outcome loop is what makes this knowledge better than a
forum thread. **Anonymized at ingest**, not at display: names, recruiter identities, and identifying
circumstances are dropped before storage (`docs/architecture/privacy.md`).

## What reports are reliable about

Most reliable on **format and logistics** — how many rounds, remote or onsite, take-home or live, and the
language of the interview, which is often the binding constraint nobody warned an international candidate
about. Least reliable on exact questions. Weighted accordingly.

## States

| State | Shown |
|---|---|
| **Loading** | skeleton per stage |
| **Empty** | no target role yet |
| **Thin data** | role-generic prep, with process confidence stated as low |
| **Stale** | pattern shown with its window, flagged as possibly outdated |
| **Success** | stages with counts, themes, practice, and readiness per stage |

## What it never does

- Never presents a single report as fact.
- Never reports `high` confidence on tier-4 data.
- Never invents a question and attributes it.
- Never scores the person.
- Never lets practice performance leak into Career Score — different question, different score.
- Never surfaces an identifiable detail from a report.

## Dependencies

`ai/interview-prep` · `knowledge-engine/interview-reports` · company intelligence ·
`docs/prompts/interview-prep/`

## Related

- `job-matching.md` — prep follows what was actually applied to
- `outcomes-learning.md`, `docs/GLOSSARY.md`
- `.claude/skills/interviews/SKILL.md`
