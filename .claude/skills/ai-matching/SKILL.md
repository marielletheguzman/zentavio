---
name: ai-matching
description: How Zentavio scores and ranks — resume analysis, job match scoring, career matching, skill gap computation, the evidence bundle every score carries, calibration, and the ai/ service contract. Load when working in ai/resume-parser, ai/skill-gap, ai/embeddings, services/matching, when defining or changing a score, when ranking anything, or when a score needs to be explained.
---

# AI Matching

## Purpose

Scores are the product. This skill defines how a Zentavio score is computed, what it must
carry with it, and how it stays honest — so that "0.72" means the same thing next month, can
be reproduced from recorded inputs, and can be shown to a user with the reasons that produced
it.

## Scope

**Applies to:** `ai/resume-parser`, `ai/skill-gap`, `ai/embeddings`, `ai/shared`, the scoring
paths in `services/matching`, and any ranking surfaced to a user.

**Does not apply to:** career trajectory and readiness modeling (`career-intelligence`),
learning plans (`learning-paths`), the facts being scored over (`knowledge-engine`), the
delivery of suggestions (`recommendations`).

## The scores, kept distinct

| Score | Question | Subject |
|---|---|---|
| **Job Match Score** | fit for **this posting** | person × posting |
| **Career Score** | employability for a **career track** | person × career |
| **Career Readiness Score** | closeness to a **target**, forward-looking | person × target |
| **Opportunity Score** | attractiveness of a market/career | career × market |
| **Resume Score** | quality of the **document** | document |

Never compute one and label it another. `docs/GLOSSARY.md` is binding here — this is the most
common source of confusion in the product.

## Output contract

Every score, without exception:

```json
{
  "score": 0.72,
  "confidence": "medium",
  "evidence": [
    { "kind": "skill_match",   "label": "Kubernetes",       "weight": 0.18, "detail": "evidenced: 2 roles, 3 yrs", "factIds": ["…"] },
    { "kind": "skill_missing", "label": "Terraform",        "weight": 0.12, "detail": "required by posting" },
    { "kind": "skill_transfer","label": "Docker→Kubernetes", "weight": 0.08, "detail": "graph edge 0.8" },
    { "kind": "constraint",    "label": "visa required",    "weight": null, "detail": "DE, no current pathway match" }
  ],
  "missing": ["salary band unknown for this market"],
  "scorerVersion": "job-match-v3",
  "promptVersion": "job-match-2026-07-01",
  "knowledgeAsOf": "2026-07-28T00:00:00Z",
  "computedAt": "2026-07-28T09:14:02Z"
}
```

- **`evidence` is not optional and not generated prose.** It is the actual contributing
  factors with their actual weights. Weights must reconcile to the score.
- **`missing` is a product feature.** It tells the user what to supply and tells us which
  source to add.
- **Versions make it reproducible.** Same inputs + same versions = same score, forever.

## How a score is computed

1. **Retrieve** — the person's profile facts and the target's requirement facts from
   `knowledge-engine`, with provenance.
2. **Resolve** — map both sides through the skill/career/company registries. Never compare raw
   strings.
3. **Match** — for each requirement: evidenced hold, claimed hold, transfer via a weighted
   graph edge, or absent. Record which.
4. **Weight** — requirement importance comes from knowledge (posting emphasis, market
   frequency), not from a hand-tuned constant per skill.
5. **Constrain** — apply hard constraints (eligibility, language, location) as **named
   constraints**, not as silent multipliers.
6. **Aggregate** — deterministic, documented function. Emit the evidence as you aggregate.
7. **Degrade** — confidence falls to the weakest input; missing critical facts means `low`,
   or `unknown` if the core inputs are absent.

**Semantic similarity retrieves candidates; it does not score them.** Embeddings choose what
to consider. Explicit, explainable factors decide the number. A cosine distance is not an
explanation a user can act on.

## The LLM's actual job

| LLM does | LLM must not do |
|---|---|
| extract structure from a resume | supply a market fact |
| normalize a phrase to a known skill | invent a skill that isn't in the graph |
| write the human-readable explanation **from the computed evidence** | produce the score |
| summarize a requirement | decide a requirement's weight |

The number is arithmetic over retrieved facts. If a model produces the score, it is not
reproducible, not calibratable, and not defensible — which is the whole product.

## Resume analysis

- Parse to structure; keep the source span for every extracted claim so it can be shown back.
- Distinguish **evidenced** from **claimed**. "Led a Kubernetes migration" evidences more than
  a skills-list mention, and they carry different weights.
- Never infer seniority from years alone; years are a proxy for skills we measure directly.
- Never infer anything from name, nationality, age, gender, or institution prestige — see
  `.claude/context/career-philosophy.md`. This is a hard constraint, not a preference.
- Extraction confidence is per field. A garbled PDF section yields `low` on those fields, not a
  confident guess.

## Calibration

- A score is meaningless without a distribution. Track score distributions and compare against
  recorded outcomes (`knowledge-engine/outcomes`).
- Changing a scorer bumps `scorerVersion` and requires an eval run
  (`docs/prompts/evals.md`) with the delta recorded.
- Never tune a score to look encouraging. If the honest number is 0.31, ship 0.31 with the gap.
- Prefer being under-confident to over-confident. An over-stated match costs a person weeks.

## Constraints

- **No score without evidence, confidence, and versions.**
- **No LLM-produced score.** Structure and prose from the model; arithmetic from code.
- **No fact invented to fill a gap** — not a market average, not a default, not "typically".
- **No score from embedding distance alone.**
- **No hidden penalty.** Every negative contribution appears in `evidence`.
- **No protected-attribute proxy in any feature.**
- **No state in `ai/`.** No tables, no cache of record.
- **No comparison of unresolved strings.**
- **No cross-score substitution.** A Job Match Score is never displayed as a Career Score.
- **No silent scorer change.** Version it, eval it, record it.

## Examples

**Bad — LLM as the scorer.**

```python
prompt = f"Rate this candidate for this job 0-100:\n{resume}\n{job}"
score = float(await llm.complete(prompt))
return {"score": score / 100}
```

Unreproducible, uncalibratable, unexplainable, and free to invent requirements the posting
never stated.

**Good.**

```python
profile = await knowledge.profile_facts(user_id)              # with provenance
reqs    = await knowledge.requirements(posting_id)            # with provenance
matched = resolve_and_match(profile, reqs, skill_graph)       # deterministic

score, evidence = aggregate(matched, weights=reqs.weights)    # weights from knowledge
constraints     = evaluate_constraints(profile, posting)      # named, not multiplied silently
explanation     = await llm.explain(evidence, constraints)    # prose from computed evidence

return Explained(
    score=score, confidence=confidence_of(profile, reqs),
    evidence=evidence, constraints=constraints, explanation=explanation,
    scorer_version=SCORER_VERSION, prompt_version=PROMPT_VERSION,
    knowledge_as_of=knowledge.as_of, computed_at=utcnow(),
)
```

## Best Practices

- Make the aggregation function readable. A score a reviewer cannot follow on paper is a score
  we cannot defend to a user.
- Weights belong in knowledge, not in code constants. A hardcoded `KUBERNETES_WEIGHT = 0.3` is
  a market fact frozen at the moment someone typed it.
- Show the top negative factors, not only the positive ones. Users act on gaps.
- Round for display only. Store full precision; never round mid-pipeline.
- When two candidates tie, break the tie on something explainable and say what it was.
- If a score cannot be explained in one sentence plus three factors, it is measuring too many
  things at once — split it.
