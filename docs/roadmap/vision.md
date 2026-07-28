# Vision

> **Purpose:** Long-term product vision and north-star.

## North star

Become the most intelligent career platform in the world — the system a professional
consults when the question is not "what jobs exist?" but **"what should I do next?"**

Zentavio is not a job board. A job board matches strings and leaves the judgment to the
user. Zentavio reasons about a career: where this person can realistically work, what they
would have to become, how long that takes, and whether it is worth it.

## The question that defines the product

> **"What should I do next?"**

Every feature exists to answer that question with a defensible answer. If a feature cannot
be traced to it, it is not a Zentavio feature — it is a feature that happens to be in
Zentavio.

## What the platform should eventually do

| Capability | The user's question |
|---|---|
| Discover careers | What could I do? |
| Transition careers | How do I get from here to there? |
| Learn missing skills | What should I learn, in what order? |
| Verify knowledge | Do I actually know it, or do I think I do? |
| Build resumes | How do I present what I have? |
| Prepare interviews | What will they ask, and am I ready? |
| Understand immigration | Am I eligible to work there? |
| Compare countries | Where should I go? |
| Predict hiring success | Will this work? |

Together these are one product, not nine. The skill gap feeds the learning path; the
learning path feeds readiness; readiness feeds the country comparison, because eligibility
without employability is not an option. The connective tissue is the knowledge engine —
which is why it exists before the features do.

## The design test

Whenever anything is designed — a table, an endpoint, a prompt, a screen, an ADR — it must
pass:

1. **Does this move us toward the vision?** Does it help answer "what should I do next?"
2. **Can it explain itself?** Would a user see *why*, with evidence, not just *what*?
3. **Does it read facts rather than invent them?** Which knowledge-engine facts back it?
4. **Would it survive the tenth country and the fiftieth source?** Or does it hardcode
   today's scope?
5. **Is the documentation part of the change?** If the doc does not describe it, it is
   not done.

A "yes" to 1 and a "no" to any of 2–5 is not a shortcut. It is debt with interest, because
every later feature inherits the shortcut.

## Horizon

**Near** — one career track, one country, end to end, fully explainable: resume in, gap out,
learning path out, honest readiness number with its evidence.

**Middle** — breadth. More tracks, more countries, more sources; the career and skill graphs
dense enough that transitions are discovered rather than declared. Outcomes start feeding
back.

**Long** — prediction. With enough recorded outcomes, Zentavio stops describing the market
and starts anticipating it: which transitions actually succeed, from which starting points,
in which markets, and how long they really take. That is the point at which "what should I
do next?" gets an answer with a track record behind it.

## What we will not become

- A job aggregator with an AI summary bolted on.
- A source of confident answers about visas, salaries, or requirements that we cannot cite.
- A course marketplace.
- A resume keyword optimizer.

## Related

- `.claude/context/business.md` — who this is for and what it charges for
- `.claude/context/feature-philosophy.md` — the question each capability answers
- `.claude/context/ai-principles.md` — the rules the reasoning layer obeys
- `docs/roadmap/phases.md`, `docs/roadmap/mvp.md`, `docs/roadmap/milestones.md`
- `docs/GLOSSARY.md` — the terminology this vision uses
