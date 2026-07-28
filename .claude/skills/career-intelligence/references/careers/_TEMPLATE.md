# <Career Track Name> (`<track-id>`)

> **Purpose:** Career model for <track>. Defines the skill set, ladder, entry points,
> adjacency, and evidence standards. **Weights, demand, and salary values live in
> `knowledge-engine`, not here.**

_Status: placeholder — content to be authored._

---

## What this track is

One paragraph. What the work actually is, and what it is commonly confused with.

**Not:** <the adjacent track people mistake this for, and why>.

## Skill set

Grouped by cluster. Skill ids must exist in the skill graph.

| Cluster | Skills | Role |
|---|---|---|
| Core | | required — absence blocks |
| Supporting | | expected at most levels |
| Differentiating | | separates senior from mid |
| Peripheral | | nice to have, rarely decisive |

**Method for this list:** (e.g. co-occurrence across N ingested postings for this track,
window, minimum support). Record the method — the weights themselves are measured in
`knowledge-engine`.

## Prerequisites

The `requires` edges that make a learning path orderable. Be strict: an edge here means the
second skill is genuinely hard to learn without the first.

```text
docker      requires  linux-fundamentals
kubernetes  requires  docker
terraform   requires  cloud-fundamentals
```

## Seniority ladder

| Level | What changes | Typical evidence |
|---|---|---|
| Entry | | |
| Mid | | |
| Senior | | |
| Staff/Lead | | |

Levels are distinguished by scope of judgment, not by years. Years are a proxy for skills we
measure directly.

## Entry points

Where people realistically come from into this track, and what carries over.

| From | Transfers | Usually missing |
|---|---|---|
| | | |

Prefer entry points with **observed** transition frequency in
`knowledge-engine/outcomes` over merely plausible ones.

## Adjacent careers

| Adjacent track | Direction | What transfers | What does not |
|---|---|---|---|
| | | | |

Transfer weights come from skill-graph edges, with their provenance. Do not write numbers here.

## Evidence standards

What actually demonstrates competence in this track, so `evidenced` vs `claimed` is decidable:

- **Strong:** (artifacts, systems operated at scale, contributions)
- **Moderate:** (recognized certifications — with what each actually proves)
- **Weak:** (course completion, self-report)

## Verification

How a claimed skill in this track can be verified in-platform — assessment, project artifact,
or certification. Feeds `learning-paths` verification.

## Interview shape

Typical stages and themes for this track, role-generic. Company-specific patterns live in
`knowledge-engine/interview-reports` — see the `interviews` skill.

## Market notes

Qualitative, sourced observations that do not fit a number: where demand concentrates, which
sub-specializations are emerging, which skills are declining. Every claim carries its source and
date.

## Sub-specializations

Named variants and how they differ. An unmodeled sub-specialization returns `unknown`, not the
generic track's answer.

## Related

- `.claude/context/career-philosophy.md`
- `.claude/skills/career-intelligence/SKILL.md` · `learning-paths` · `ai-matching`
