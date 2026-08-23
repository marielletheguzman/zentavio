# Job Matching

> **Purpose:** AI user-to-job matching: signals, scoring, ranking.

Fit between one person and one posting, plus the ranking that decides what is worth their attention.
Deliberately **downstream** of readiness and viability: matching only ranks what is realistically
reachable, which is the difference between career intelligence and a filtered feed.

**User question:** *which of these jobs is worth my time?*

## Job Match Score, and what it is not

Fit for **one posting**. It is not Career Score (employability for a track), not Career Readiness
(closeness to a target), not Opportunity Score (market attractiveness). `docs/GLOSSARY.md` is binding —
those six scores get confused precisely because they are close.

## Signals

| Signal | Source | Contribution |
|---|---|---|
| Skill match, evidenced | `profile_skills` × `job_posting_skills` | full weight |
| Skill match, claimed | same | reduced weight |
| Skill transfer | `skill_edges.transfers_to` | edge weight × requirement weight |
| Skill missing | requirement with no cover | negative, named |
| Seniority fit | profile vs posting level | small, and visible |
| Location / remote fit | preferences vs posting | constraint, not a multiplier |
| Language | posting market vs profile languages | constraint |
| Work authorization | eligibility (`immigration-tracking.md`) | **hard constraint** |
| Visa sponsorship status | posting, sponsor registries, our outcomes | named factor; `unknown` ranked below stated, never treated as unavailable |
| Relocation / immigration support | posting or careers page | named factor |
| Settlement pathway | destination PR and citizenship pathways | named factor — a *destination* property, never an employer's |
| Freshness | posting age vs staleness window | ranking only, never the score |

Migration feasibility is reported **alongside** the Job Match Score, not merged into it, so a
strong-fit / no-sponsorship job reads as exactly that. Full specification:
[`migration-friendly-jobs.md`](migration-friendly-jobs.md).

## The score is arithmetic

Retrieved facts → resolve → match → weight → aggregate. Deterministic and reproducible from
`scorerVersion` + `knowledgeAsOf`. The model writes the explanation from the computed evidence and never
produces the number — given a number, a model reliably justifies it, including when it is wrong
(`docs/prompts/matching/README.md`).

Semantic search retrieves *candidates* to consider. It never scores them: a cosine distance is not an
explanation anyone can act on.

## Constraints are named, never silent

A posting the person cannot legally take is not quietly down-ranked. It carries a named constraint with
`binding: true`, and the UI leads with it. Silently burying an ineligible job as "a weaker match" is
misleading in a way that costs money.

`undetermined` eligibility stays `undetermined` — never collapsed toward yes or no.

## Ranking ≠ scoring

Score answers "how well does this fit?". Ranking answers "what should they see first?" and includes
expected value: achievability, freshness decay, diversity caps so five roles at one company become one
entry with alternatives, and horizon mix (`.claude/skills/recommendations/SKILL.md`).

Never ranked by commercial interest. The product is trust in the ordering.

## What the user sees

Score, confidence, and the top positive **and negative** factors, with evidence reachable inline. An
explanation of only the positives makes a 0.4 read like a 0.8.

| State | Shown |
|---|---|
| **Loading** | skeleton in the final card shape |
| **Empty** | why nothing matched, and the nearest widening ("no matches in Germany yet — widen to remote?") |
| **Unknown** | what is known, what is missing, and what to supply |
| **Error** | what failed and whether retrying helps |
| **Success** | ranked matches, each with evidence and any binding constraint |

## Unknown path

Missing market facts produce `status: "unknown"` with `missing` populated and **no score** — never
`0.0`, which reads as "bad fit" rather than "not computed"
(`docs/database/entities/match.md` enforces this in schema).

The explanation still runs over whatever was determined, because "we can't check the visa threshold
until you add your expected salary" is the most actionable thing we have.

**A posting with no `job_posting_skills` rows is two different situations, and matching must not
collapse them** (ADR-0036). `job_postings.extracted_version` is what separates them:

| Marker | Rows | What it means | What matching does |
|---|---|---|---|
| null | none | never read — extraction has not reached this posting | `status: "unknown"`, `missing` names the extraction |
| set | none | read, and this posting asks for nothing the graph curates | a real skill comparison over an empty requirement set |

Reading the second as the first re-queues work that is already done; reading the first as the second
scores somebody against a posting nobody has read yet, and shows a confident result built on nothing.
The whole current corpus is in the second state — three Lever demo postings whose qualifications read
*"be smart"* — so this is the common case today, not an edge one.

## Recomputation

Matches are records of a judgment at a point in time, not a cache. A match whose `knowledgeAsOf`
predates a relevant fact change is stale, and serving it confidently is the failure mode. Recomputation
writes a new value with new versions, so "why did my score change?" is answerable.

## Dependencies

`services/matching` · `ai/skill-gap`, `ai/embeddings` · knowledge engine (postings, requirements,
market intel, eligibility) · `docs/prompts/matching/`

## Related

- `skill-gap-analysis.md`, `country-preferences.md`, `immigration-tracking.md`
- `docs/database/entities/match.md`, `docs/GLOSSARY.md`
- `.claude/skills/ai-matching/SKILL.md`, `.claude/skills/recommendations/SKILL.md`
