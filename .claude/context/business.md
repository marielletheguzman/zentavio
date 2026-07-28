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

**The origin is specific: the Philippines.** Not a segment we happen to serve first — it is the fact
the product is designed around, and it changes the architecture (see below).

**Primary — the Filipino professional planning an international move.** Mid-career, wants to work in
Germany, Luxembourg, New Zealand, or Switzerland, and does not know whether they are eligible,
employable, or competitive there. Currently reading forum threads, Facebook groups, and agency sales
pages, and guessing. High willingness to pay, because the alternative is an expensive, sometimes
exploitative, mistake.

**Primary — the Filipino student or recent graduate.** Choosing what to study or which first role to
take *with the international move already in mind*. Needs to know which qualifications and licences
actually transfer, and what the realistic timeline is. Low ability to pay now, high lifetime value, and
the group most damaged by bad information early.

**Secondary — the skilled worker planning a career change alongside the move.** Two hard problems at
once: a new track and a new country. Needs to know which order to do them in, and whether doing both is
realistic at all.

All of them ask the same question — *what should I do next?* — and all of them are badly served both by
keyword matching and by the incumbent alternative, which is a recruitment agency whose incentive is
placement rather than the person's best outcome.

## What being Philippines-origin changes

Not marketing copy. Four concrete design consequences:

1. **Two jurisdictions per answer.** Viability depends on origin-side requirements — overseas
   employment regulation, professional-licence recognition, credential evaluation, document
   authentication — as much as on destination rules. Destination-only platforms miss half the problem.
   Our rule model does not express this yet, and that is a tracked gap
   (`.claude/context/countries.md`).
2. **Recognition is often the binding constraint, not the visa.** For regulated professions, a
   destination may be visa-accessible while the licence is not transferable without re-assessment.
   Reporting eligibility without recognition would be actively misleading.
3. **English is an asset, and it is not sufficient.** It genuinely opens New Zealand and much of remote
   work. It does not make German, Luxembourgish, or Swiss workplace-language requirements disappear, and
   pretending otherwise is the most common error in this market.
4. **Remote is frequently the right answer.** Earning in a stronger currency without relocating is often
   the fastest real improvement available, so `REMOTE` is a first-class target rather than a fallback.

## Who we are not for

Undocumented or irregular migration routes. Anything requiring us to advise on circumventing a rule.
We report sourced requirements and name who to consult — that boundary is in
`.claude/context/ai-principles.md` and it is not negotiable, because the users most likely to be
harmed by getting it wrong are exactly our users.

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
