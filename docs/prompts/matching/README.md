# Matching Prompts

> **Purpose:** Prompts for match reasoning and explanation.

Prompts loaded on the matching path. **There is no scoring prompt here, and there never will be.** The
score is arithmetic over retrieved facts (`.claude/skills/ai-matching/SKILL.md`); these prompts turn the
computed evidence bundle into something a person can read and act on.

Prompt files live at `ai/shared/prompts/` (shared, since several services explain scores the same way).

## Prompts

| Prompt | Job |
|---|---|
| `evidence-explain` | one paragraph explaining a computed score from its evidence |
| `factor-label` | short human labels for evidence entries |
| `constraint-explain` | plain-language statement of a binding constraint |

## The boundary

```text
profile facts + posting requirements   ← retrieved, with provenance
              │
              ▼   resolve · match · weight · aggregate        ← CODE
        score + evidence[] + constraints[]
              │
              ▼   evidence-explain                            ← MODEL
        "You match on Kubernetes and Docker. Terraform is the largest
         remaining gap. Work authorization for Germany is undetermined."
```

The model receives `{{ computed_evidence }}` and `{{ constraints }}`. It receives **no** raw profile,
**no** posting text, and **no** score to justify.

Why it never sees the score: given a number, a model reliably writes a justification for it — including
when the number is wrong. Given only factors, it can only describe factors.

### `evidence-explain`

**Inputs.** `{{ computed_evidence }}`, `{{ constraints }}`, `{{ confidence }}`.

**Output.**

```json
{
  "summary": "<2-3 sentences>",
  "topPositive": ["<label>", "…"],
  "topNegative": ["<label>", "…"],
  "bindingConstraint": "<label or null>"
}
```

Constraints on the prose:

- **Every claim maps to a supplied evidence entry.** No new skills, no market commentary, no company
  facts.
- **Negative factors appear.** Users act on gaps more than on strengths, and an explanation of only the
  positives makes a 0.4 read like a 0.8.
- **Confidence is stated in words** when it is `low` — not implied by hedging, and never omitted.
- **The binding constraint leads** when one exists. "Ineligible to work in Germany" outranks a skill
  match, and burying it is misleading in a way that costs money.
- **No score, no percentage, no ranking language in the prose.** The number is rendered by the UI beside
  the explanation; a model restating it invites drift between the two.

### `constraint-explain`

Turns a named constraint into a plain sentence. Immigration constraints route through the immigration
prompts instead, which carry the disclaimer and the `asOf` date
(`../immigration/README.md`).

## What these prompts must never do

| Prohibited | Why |
|---|---|
| produce or restate a score | not reproducible, not calibratable |
| introduce a fact not in the evidence bundle | ungrounded (`ai-principles.md` rule 3) |
| omit a negative factor | a hidden penalty is an unexplainable score |
| soften a low confidence | understating uncertainty is a correctness bug |
| give advice ("you should apply") | Zentavio informs; the user decides |
| compare the person to other users | not our data to expose (`docs/architecture/privacy.md`) |
| mention a salary, visa rule, or company fact not supplied | fabrication risk |

## Unknown path

When the match is `status: "unknown"`, `evidence-explain` still runs — over the factors that *were*
determined, plus `missing`. The output says what is known and what is needed:

> "You match on Kubernetes and Docker. We can't complete this match: the salary band for this market is
> unknown, so we can't check the visa threshold."

That is a useful answer. Suppressing the explanation because the score is missing wastes the most
actionable thing we have — the list of what to supply.

## Eval cases

| Case | Guards |
|---|---|
| `happy-strong-match` | every claim maps to an evidence entry |
| `negative-factors-present` | a 0.4 match's explanation names the gaps |
| `low-confidence-stated` | `low` confidence is stated, not hedged |
| `binding-constraint-leads` | an eligibility blocker appears first |
| `unknown-with-missing` | explanation runs, names what is missing |
| `no-score-in-prose` | no number or percentage in the text |
| `no-invented-fact` | no salary, company, or visa claim absent from inputs |
| `no-advice-framing` | no "you should apply" |

## Related

- `.claude/skills/ai-matching/SKILL.md` — the output contract and the arithmetic
- `docs/features/job-matching.md`, `docs/database/entities/match.md`
- `../conventions.md`, `../evals.md`
- `.claude/context/ui-guidelines.md` — how the explanation is rendered beside the score
