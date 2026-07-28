# Feature Philosophy

> **Purpose:** Decide whether a feature belongs in Zentavio. Every feature must answer at
> least one real user question, and every question must route to the capability that owns it.

## The rule

**A feature that answers no user question is not a feature.** If it cannot be stated as a
question a person would actually ask about their career, it does not ship — however
interesting it is to build.

## The question map

| The user asks | Answered by | Reads from |
|---|---|---|
| Where can I work? | Country Intelligence | immigration rules and pathways, market intel, language and salary data |
| What career should I pursue? | Career Intelligence | career graph, skill graph, opportunity data |
| What should I learn? | Learning Engine | skill gap + learning resources |
| Am I ready? | Career Score · Career Readiness · Interview Readiness · Resume Score | the person's profile against target requirements |
| Which of these jobs is worth my time? | Job Matching | postings + the person's profile and constraints |
| What will they ask me? | Interview Prep | interview reports, company intelligence |
| How do I present what I have? | Resume Intelligence | parsed resume + target requirements |
| Do I actually know it? | Knowledge Verification | skill graph + assessment outcomes |
| Where should I go? | Country Comparison | Country Intelligence across markets |
| Will this actually work? | Outcome Prediction | recorded outcomes |

New feature, one required sentence:

> This feature answers **"<question>"** for **<which user>** by reading **<which knowledge>**,
> and shows its evidence as **<what>**.

If any blank cannot be filled, the feature is not ready to design.

## The chain

Features are not independent — they compose into one answer:

```text
resume → parsed profile
       → skill gap        (against a target career)
       → learning path    (ordered, resourced, timed)
       → readiness        (honest number + remaining gap)
       → relocation viability (eligibility × employability)
       → job matching     (only for what is realistically reachable)
       → interview prep   (for what was actually applied to)
       → outcome recorded → improves every step above
```

A feature that does not read from or feed into this chain is probably a different product.
Outcomes closing the loop is what turns description into prediction.

## Tests before building

1. **Question test.** Which question does it answer? Whose?
2. **Vision test.** Does it help answer "what should I do next?" (`vision.md`)
3. **Knowledge test.** Which knowledge-engine facts back it? What happens when they are
   missing — does it degrade honestly or start guessing?
4. **Evidence test.** What does the user see as the *why*?
5. **Chain test.** Where does it sit in the chain above? What feeds it, what does it feed?
6. **Breadth test.** Does it still work at country ten and track fifty, without a rewrite?
7. **Honesty test.** What is the answer when we do not know? If there isn't a designed
   unknown state, the feature is not designed.

Failing 1 or 2 means don't build it. Failing 3–7 means don't build it *yet*.

## Anti-features

Recognizable by the question they answer being nobody's:

- **A job feed.** Answers "what exists?" — a job board's question, not ours.
- **A resume keyword optimizer.** Answers "how do I game the filter?"
- **A course catalog.** Answers "what could I buy?" A learning path answers "what should I
  learn next, and why that order?"
- **A chatbot with no retrieval.** Answers confidently and sources nothing. Violates
  `ai-principles.md` rules 1, 3, and 5.
- **A vanity score.** A number with no gap, no evidence, and no next action.
- **A country list.** Data without eligibility or employability reasoning is a Wikipedia
  table.

Each of these is the shallow version of a real Zentavio feature. The difference is always the
same: reasoning over sourced knowledge, with the evidence shown.

## Prioritization

Between two features that both pass the tests, prefer the one that:

1. deepens the chain rather than widening the surface,
2. produces outcomes we can learn from,
3. makes an existing answer more honest,
4. and can be explained end to end today.

Depth first. One country and one track answered completely is worth more than ten answered
vaguely — and it is the only version we can charge for.

## Related

- `vision.md` · `business.md` · `product-principles.md` · `career-philosophy.md`
- `docs/features/*` — the specified behavior of each capability
- `docs/roadmap/mvp.md`, `docs/roadmap/backlog.md`
