# Skill Gap Analysis

> **Purpose:** Compare user skills vs job requirements, gap output.

Turns a profile plus a target into a weighted, dependency-ordered list of what is missing. Everything
downstream — learning paths, readiness, viability — reads this.

**User question:** *what am I missing, and which piece matters most?*

## Not a set difference

A gap is not "requirements minus skills". Four things separate the two:

1. **Resolution.** Both sides map through the skill registry first. "K8s" and "Kubernetes" are one
   skill; two "Analysts" may share almost nothing.
2. **Partial credit.** A held skill can partially cover a missing one through a `transfers_to` edge.
   Docker held, Kubernetes missing, edge weight 0.8 — that is not a full gap.
3. **Weights.** Each requirement carries importance from `career_skills` or `job_posting_skills`, so a
   core gap and a peripheral one are not equal.
4. **Order.** `requires` edges impose dependency order. An unordered gap list is not actionable.

## Output

```json
{
  "target": { "kind": "career", "id": "cloud-engineer" },
  "items": [
    { "skillId": "terraform", "weight": 0.14, "position": 1, "partial": null,
      "reason": "required in 71% of DE postings for this track (n=340)" },
    { "skillId": "kubernetes", "weight": 0.11, "position": 2, "partial": 0.5,
      "reason": "Docker held; transfers_to edge 0.8", "prerequisites": ["docker"] }
  ],
  "held": [{ "skillId": "docker", "status": "evidenced" }],
  "confidence": "medium",
  "missing": ["market frequency unknown for 2 requirements"],
  "scorerVersion": "gap-v2",
  "knowledgeAsOf": "2026-07-28T00:00:00Z"
}
```

Every item states **why it is a gap and why it is in that position**. A gap the user cannot interpret is
a gap they will not close.

## Computed, not generated

The gap is arithmetic over retrieved facts. The model's only role is writing the explanation from the
computed result (`docs/prompts/skill-gap/README.md`). It never decides that a skill is missing, how much
it matters, or what order to close it in.

## Targets

| Target | Requirements from |
|---|---|
| A career track | `career_skills`, optionally scoped to a market |
| A specific posting | `job_posting_skills` |
| A seniority step | `career_skills` filtered by ladder level |

Market scoping matters: German for a Berlin role is a real requirement and absent elsewhere.

## Weights come from knowledge

Never from code constants. A hardcoded weight freezes a market fact at the moment someone typed it, and
markets move. Weights are derived from posting frequency, official curricula, or recorded outcomes, and
each states which (`docs/database/entities/skill.md`).

## States

| State | What the user sees |
|---|---|
| **Loading** | skeleton matching the final list shape |
| **Empty** | no target selected yet — pick one, with suggestions from the career graph |
| **No gap** | genuinely qualified: say so plainly, and point at readiness and matching |
| **Error** | what failed, retryable or not |
| **Partial** | the gap computed so far, plus which requirements could not be weighted |
| **Success** | ordered items, each with weight, reason, and partial credit |

## Unknown path

An unmodelled target returns `unknown` with the missing coverage named — never a generic gap. A
requirement with no weight available is listed as unweighted rather than assigned a default, because a
default weight is an invented market fact.

## What it never does

- Never a keyword diff.
- Never orders by difficulty or popularity instead of prerequisites.
- Never invents a requirement the posting or track does not state.
- Never pads with adjacent nice-to-haves — the gap is the scope, and padding makes a reachable target
  look unreachable.
- Never encourages instead of answering. "You're a great fit!" with no gap is a failure.

## Dependencies

`ai/skill-gap` · skill graph (`requires`, `transfers_to`) · `career_skills` /
`job_posting_skills` · `docs/prompts/skill-gap/`

## Related

- `resume-parsing.md` — supplies the profile side
- `learning-paths.md` — consumes the ordered gap
- `job-matching.md` — same machinery, one posting at a time
- `.claude/skills/career-intelligence/SKILL.md`
