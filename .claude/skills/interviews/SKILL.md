---
name: interviews
description: How Zentavio prepares people for interviews — interview reports as tier-4 aggregated experience, company and role-specific process modeling, question banks, practice and feedback, and Interview Readiness scoring. Load when working in ai/interview-prep, knowledge-engine/interview-reports, modeling a company's interview process, generating practice questions, or scoring interview readiness.
---

# Interviews

## Purpose

Interview preparation is where Zentavio's knowledge becomes immediately usable: what this
company actually asks, in what format, and whether this person can answer it. The data here is
mostly experiential — reported by people, not published by companies — which makes handling its
confidence correctly the central discipline of this skill.

## Scope

**Applies to:** `ai/interview-prep`, `knowledge-engine/interview-reports`, company interview
process modeling, question banks, practice sessions, Interview Readiness.

**Does not apply to:** whether to apply at all (`career-intelligence`), skill gap closure
(`learning-paths`), company facts like size and stack (`knowledge-engine`).

## The confidence problem

Interview knowledge comes from tier 4 — self-reported experience. It is genuinely valuable
*because* it is experiential, and it must never be presented as a company's stated policy.

| Presented as | Correct |
|---|---|
| "This company asks system design in round 3." | ❌ stated as fact |
| "12 of 15 reports (last 18 months) describe a system-design round at stage 3." | ✅ aggregated, counted, dated |

Rules:
- **Always aggregated, never a single report.** One person's experience is an anecdote; a
  pattern across reports is signal. Minimum support before surfacing a pattern.
- **Always counted and dated.** `n`, and the time window. Interview processes change; a
  three-year-old pattern is history.
- **Always `low`/`medium` confidence.** Tier 4 never reports `high`, however consistent.
- **Labeled as reported experience** in the UI, every time.
- **Official published process, when it exists, is tier 1** and outranks reports — companies
  that document their process should be cited directly.

## Interview process model

```text
companyId / roleFamily
stages[]         ordered: { name, format, typicalDuration, focus[], interviewerRole,
                            reportCount, window, confidence }
questionThemes[] { theme, frequency, exampleFormulations[], reportCount }
signals[]        what reports say is evaluated at each stage
logistics        remote/onsite, language of the interview, timezone reality, take-home policy
lastReportAt     freshness of the underlying data
```

A process model with no `reportCount` per stage is not usable — the count *is* the confidence.

## Question banks

- Themes come from aggregated reports and from the role's requirement facts, not from a
  generic list.
- **Never present an invented question as one the company asks.** A generated practice question
  is labeled as practice, generated from a theme. The distinction is the difference between
  preparation and fiction.
- Questions map back to skills in the skill graph, so practice feeds the profile.
- Company-specific and role-generic questions are visually and structurally distinct.

## Practice and feedback

- The model's job: pose the question, evaluate the answer against a **rubric derived from the
  role's requirement facts**, and give specific, actionable feedback. Not a score of the person.
- Feedback references what was missing in the answer, tied to skills. "No mention of failure
  modes" beats "good but could be better".
- Practice outcomes are recorded: which theme, which skill, evaluated strength. They feed
  Interview Readiness and, with enough volume, the outcome model.
- **A practice answer promotes nothing to `evidenced`** (ADR-0030): only a passed in-platform
  assessment may, and a rubric we wrote is coaching rather than an instrument. Practice moves
  Interview Readiness, and never `profile_skills`.

## Interview Readiness

Distinct from Career Readiness. It answers: for **this role at this company**, is the person
prepared for the **process**?

```json
{
  "target": { "companyId": "…", "roleFamily": "backend-engineer" },
  "readiness": 0.54,
  "confidence": "low",
  "byStage": [
    { "stage": "system-design", "readiness": 0.3, "basis": "2 practice sessions, both weak on tradeoffs" },
    { "stage": "coding",        "readiness": 0.7, "basis": "6 sessions, consistent" }
  ],
  "remaining": ["system-design tradeoff articulation", "company-specific product context"],
  "processConfidence": "low",
  "processBasis": "12 reports, last 18 months, n per stage 3-7",
  "computedAt": "2026-07-28T09:14:02Z"
}
```

Two confidences travel separately: confidence in **the person's readiness** and confidence in
**our model of the process**. Conflating them hides the fact that we may be preparing someone
for the wrong interview.

## Responsibilities

1. Aggregate reports; never surface one as fact. Enforce a minimum support threshold.
2. Attach `n`, time window, and confidence to every pattern.
3. Prefer an officially published process (tier 1) over reports, and cite it.
4. Label generated practice questions as generated.
5. Build rubrics from the role's requirement facts, not from generic interview wisdom.
6. Record practice outcomes so readiness is measured, not asserted.
7. Report process confidence separately from person readiness.
8. Age out stale reports; a process pattern has a shelf life.

## Workflow

1. Read `docs/features/interview-prep.md`.
2. Retrieve the company/role process model with report counts and window.
3. If support is below threshold, say so: "we don't have enough reports for this company yet"
   plus role-generic preparation. That is an honest, useful answer.
4. Assemble themes from reports plus the role's requirement facts.
5. Generate practice questions per theme, labeled as practice.
6. Build the rubric from requirement facts.
7. Run the session; record per-theme outcomes.
8. Compute readiness per stage, with basis, and both confidences.

## Constraints

- **No single report presented as a company fact.**
- **No pattern without `reportCount` and a time window.**
- **No `high` confidence on tier-4 data.**
- **No invented question attributed to a company.**
- **No scoring the person** — evaluate answers against a rubric, report gaps.
- **No stale process model served as current.** Age it out and say so.
- **No PII from a report.** Reports are anonymized at ingest; never surface an identifiable
  detail.
- **No demotion of an evidenced skill from one weak practice answer.**
- **No conflation of process confidence with person readiness.**
- **No state in `ai/`.**

## Examples

**Bad.**

```python
return {"message": "Google asks 4 rounds: 2 coding, 1 system design, 1 behavioral.",
        "questions": ["Design YouTube", "Reverse a linked list"]}
```

Presented as fact with no source, no counts, no date, and invented questions attributed to a
company.

**Good.**

```python
proc = await knowledge.interview_process(company_id, role_family, window_months=18)
if proc.report_count < MIN_SUPPORT:
    return GenericPrep(reason=f"only {proc.report_count} reports for this company",
                       basis="role-generic themes from requirement facts",
                       confidence="low")

themes = proc.question_themes + role_requirement_themes(role_family)
return Prep(
    stages=[Stage(**s, confidence=confidence_from_support(s.report_count)) for s in proc.stages],
    themes=themes,                                   # each with reportCount + window
    practice=[generate_practice(t, labeled="generated-practice") for t in themes],
    process_confidence=confidence_from_support(proc.report_count),
    process_basis=f"{proc.report_count} reports, {proc.window}, n per stage {proc.support_range}",
    last_report_at=proc.last_report_at,
)
```

## Best Practices
 
- "We don't have enough data on this company yet" plus solid role-generic prep is a good
  product. Fabricated specificity is not.
- Reported experience is most reliable about **format and logistics** (how many rounds, remote
  or onsite, take-home or live) and least reliable about **exact questions**. Weight accordingly.
- Feedback should name one thing to fix, not five. Interview prep fails on overwhelm.
- Encourage report contribution after a real interview — the outcome loop is what makes this
  knowledge better than a forum thread.
- Language of the interview is a first-class fact for international users, and often the
  binding constraint nobody warned them about.
- Never let practice performance leak into the person's Career Score. Different question,
  different score.
