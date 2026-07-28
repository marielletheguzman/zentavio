# Business Context

> **Purpose:** Who Zentavio is for, what it is worth to them, and how that constrains what
> gets built. Read before prioritizing, scoping, or pricing anything.

## What Zentavio is

An AI career intelligence platform. It reasons about a person's career trajectory —
transitions, readiness, skill gaps, learning paths, relocation viability — using structured
knowledge rather than keyword matching.

**Not a job board.** A job board's product is listings; ours is judgment. That distinction
decides the architecture (knowledge engine before features), the moat (accumulated knowledge
and outcomes), and the pricing (a decision is worth paying for; a list is not).

## Who it is for

**Primary — the international mover.** A mid-career professional who wants to work in another
country and does not know whether they are eligible, employable, or competitive there. They
are currently reading forum threads and guessing. High willingness to pay, because the
alternative is an expensive mistake.

**Secondary — the career switcher.** Someone in an adjacent role who wants to move into a
better track and does not know what the gap actually is. They need an honest number and an
ordered plan, not encouragement.

**Tertiary — the level-upper.** Someone happy in their track who wants the next rung: what
they are missing, what the market pays, whether they are interview-ready.

All three ask the same question — *what should I do next?* — and all three are badly served
by keyword matching, which is why they are the same product.

## What they will pay for

In rough order of demonstrated value:

1. **A defensible verdict.** "You are eligible for this pathway, employable at this level,
   here is the evidence." Replaces weeks of unreliable research.
2. **An ordered plan.** The specific gap, in dependency order, with real resources and a
   realistic timeline.
3. **Country comparison.** Eligibility and employability across markets side by side.
4. **Interview readiness.** What this company actually asks, and whether they can answer it.
5. **Monitoring.** The market, the rules, and their own readiness change; being told when is
   worth a subscription.

Free tier exists to prove the reasoning is real: one honest assessment with visible evidence
is a better ad than any marketing page.

## Business model shape

Subscription, individual-first. Billing lives in `services/billing`. Anything that spends
money is idempotent and audited (`backend-service`).

Later, in order of fit: employer-side market intelligence (aggregate, never individual
data); relocation and education partners (disclosed, never allowed to influence ranking).

**Never:** selling user data, letting a paying partner change a recommendation, or ranking by
commission. The product is trust in a number. Monetizing the number destroys the asset.

## What compounds

- **Knowledge.** Every rule, salary band, company fact, and graph edge makes every future
  answer better. Features are copyable; a maintained, versioned knowledge base is not.
- **Outcomes.** Recorded results — applied, interviewed, offered, relocated — turn
  descriptive scores into predictive ones. This is the long-term moat and the reason
  `knowledge-engine/outcomes` exists before it is needed.
- **Explainability.** Being the platform that shows its work is a durable position in a
  market full of confident guessing.

## Constraints this puts on engineering

1. **Correctness over coverage.** One country answered honestly beats ten answered vaguely.
   A wrong visa answer is not a bug — it is a person's relocation.
2. **Evidence is the product.** A number without provenance cannot be shipped, cannot be
   trusted, and cannot be charged for.
3. **Additive breadth.** New countries, tracks, and sources must be data and plugins, never
   rewrites. Growth is the plan; a rewrite at country five kills it.
4. **Honest unknowns.** "We don't know yet, here's what's missing" retains users. A confident
   wrong answer loses them permanently and is a liability.
5. **Privacy by construction.** Resumes and immigration status are among the most sensitive
   data a person has. See `docs/architecture/privacy.md`.

## Related

- `vision.md` · `product-principles.md` · `feature-philosophy.md`
- `docs/roadmap/mvp.md`, `docs/roadmap/phases.md`, `docs/roadmap/milestones.md`
