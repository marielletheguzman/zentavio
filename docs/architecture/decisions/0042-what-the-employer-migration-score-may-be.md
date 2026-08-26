# ADR-0042: Employer migration support is reported as its factors, and no composite score is computed

- **Status:** Proposed
- **Date:** 2026-08-26
- **Deciders:** project lead
- **Affects:** `packages/db` (`employer_migration_scores`), `docs/database/entities/employer-sponsorship.md`, `docs/features/migration-friendly-jobs.md`, `docs/GLOSSARY.md`, `services/api-gateway` (`jobs`), `apps/web` (`/jobs`)

## Context

`employer_sponsorship_facts` shipped in #171 with its rules enforced and no rows. The table beside it
in the same entity document — `employer_migration_scores` — was deliberately left unbuilt, because a
derived composite needs its factor list and its scorer version decided before a migration can be
written. This is that decision.

**The DDL is not the gap.** `docs/database/entities/employer-sponsorship.md` specifies the table in
full, and `docs/features/migration-friendly-jobs.md` specifies the six factors and three rules that
were meant to keep the number honest:

| Factor | Source | If unknown |
|---|---|---|
| Visa/work-permit sponsorship | registry, posting, outcomes | omitted, and lowers confidence |
| Sponsorship history | aggregated outcomes | omitted |
| Relocation support | posting or careers page | omitted |
| Immigration assistance | posting or careers page | omitted |
| Dependent/family support | posting, or destination rule if statutory | omitted |
| Employment stability | company facts | omitted |

- Factors are **omitted, never defaulted** — a zero is a claim the employer does not offer it.
- The score **reports how much of it is known**: `62/100 · 3 of 6 factors known · confidence low`.
- **Below three known factors, no score is produced** and the factors are listed instead.

Those rules are good and they are not the problem.

### The problem is a decision this repository already made

ADR-0022 asked whether relocation viability could be one number and answered:

> **No composite viability score is computed, stored, or rendered.** … a single number cannot carry a
> refusal. `undetermined` and `unknown` are not low values — they are statements that an answer does
> not exist yet — and any arithmetic that admits them has to invent a magnitude for "we do not know".

The three rules above answer the *`unknown`* half of that argument completely: omission is not a
zero, and coverage is disclosed. **They do not answer the refusal half at all.**

`employer_sponsorship_facts.status` has four values, and one of them is `stated_unavailable` — the
employer said, in its own words, that it does not sponsor. For a non-EU applicant that is not a low
factor. It is a **disqualifier**: the role is not available to them, whatever the relocation package
is. A composite lets an employer that states *"we do not offer visa sponsorship"* reach a
comfortable-looking score on the strength of relocation support, immigration assistance and
employment stability — five factors outvoting the one that decides whether the job exists for this
person at all.

That is the same failure ADR-0022 refused, arriving through a different table.

### What makes this genuinely arguable

ADR-0022 was about an **eligibility verdict** — a government's decision, where `undetermined` means a
rule exists and has not been answered. Employer support is not a verdict. It is a bundle of
independent benefits an employer may or may not offer, and averaging benefits is an ordinary,
defensible thing to do. Nothing about "does this employer help with relocation" resembles a legal
determination.

So the question is not settled by pointing at ADR-0022. It has to be decided on whether **one of the
six factors is categorically different from the other five**, and the answer is that it is: work
authorization gates the job, and the rest modify its comfort.

### The surface that would consume it already exists and does not want it

`GET /v1/jobs` (#173) and `/jobs` render sponsorship as **three separate signals**, each with the
employer's own sentence, on the rule that five merged signals cannot be un-merged. A composite added
now would be a second, contradictory presentation of the same facts on the same screen.

## Options considered

### Option A — Build it as designed: a composite with coverage disclosure

`score`, `factors_known`, `factors_total`, `confidence`, per-factor `evidence`, and the ≥3 floor.

**Advantages.** It is specified, the schema exists on paper, and the disclosure rules are real
protection against the `unknown` failure. A single sortable number is genuinely useful: the discovery
surface has 239 postings and no ordering that reflects migration support, and "sort by how much this
employer helps" is a question a person actually has. It is also what `GLOSSARY.md` currently promises.

**Cons.** It cannot carry `stated_unavailable`. Every weighting that admits a refusal as a low value
tells somebody an employer is worth applying to when that employer has said in writing that it will
not sponsor them — the single most expensive wrong answer this product can give, because the cost is
an application and a plan rather than a mis-sorted list. The ≥3 floor does not help: three known
factors including a refusal still produces a number.

### Option B — Report the factors, compute nothing

No `employer_migration_scores` table. The employer panel lists the six factors with their statuses,
their sources and their sentences, exactly as the posting panel already lists three.

**Advantages.** Nothing can be averaged away, and a refusal stays a refusal. It matches what the
jobs surface already does, so the product has one presentation of sponsorship rather than two. It is
also the cheapest thing to be right about: no scorer version, no weights to defend, no recomputation,
no calibration debt.

**Cons.** **No ordering.** A person looking at fifty roles gets fifty panels and no way to say "show
me the employers that help most", which is a real question this leaves unanswered. It also
contradicts `GLOSSARY.md` and `migration-friendly-jobs.md` as written, so both must change — and the
feature document has promised this score since before the pipeline existed.

### Option C — A composite, gated on the disqualifier

Compute a score over the five comfort factors, but any `stated_unavailable` on visa or work-permit
sponsorship forces the row to a distinct state — `excluded`, not a low number — which the surface
renders as an exclusion rather than a ranking position.

**Advantages.** Keeps the ordering Option B gives up while refusing to average a refusal. It is the
`ck_matches__score_iff_scored` pattern one level up: a status that decides whether a number exists.

**Cons.** It creates a number whose meaning changes with its status, which is the thing
`factors_known` already struggles to communicate — and now there are two disclosures to render
correctly rather than one. It also settles the easy case and not the hard one: `unknown` sponsorship
is the *dominant* value on the corpus, so nearly every employer would be scored on five comfort
factors with the decisive one absent, and the number would be read as being about sponsorship anyway.

### Option D — A coverage count, with no arithmetic

Not a score: `4 of 6 factors known · 3 stated available · 1 stated unavailable`. Sortable by the
counts, and every term is a fact rather than a weighting.

**Advantages.** Orderable without inventing weights, and a refusal is visible in the summary rather
than folded into it. Nothing needs a scorer version, because nothing is scored.

**Cons.** Sorting by "most known factors" rewards employers we happen to know more about, which is a
property of our coverage rather than of the employer — the bias `source reliability` has to be
watched for everywhere else. And it is a table of counts pretending not to be a score; a person will
read the leftmost number as one.

### Option E — Do nothing, decide later

**Honestly evaluated.** Nothing needs it today: `employer_sponsorship_facts` is empty, `company_id`
is null on every posting, and the surface renders posting-level signals that do not depend on it.

**Refused as a *standing* answer, not as sequencing.** The feature document, the glossary and the
entity document all promise this score in the present tense, and a promise nobody has decided against
is one somebody eventually implements as specified — which is Option A arriving without this
discussion. The decision is cheap now and expensive after a scorer exists.

## Decision

**Option B.** Employer migration support is reported as its factors. **No composite employer migration
score is computed, stored, or rendered**, and `employer_migration_scores` is not built.

The deciding argument is the one ADR-0022 made, narrowed to the fact that makes it apply here:
**work authorization is not a factor among factors.** It decides whether the role exists for this
person; the other five decide how comfortable it would be. A number that can be raised by relocation
support while the employer has stated it will not sponsor is not a summary of anything — it is an
average of two questions with different answers.

Option C is the strongest alternative and is rejected on the corpus rather than on principle: with
`unknown` dominant, a gated composite scores almost every employer on comfort alone while looking
like a statement about sponsorship.

**What is stored instead:** nothing new. The facts already live in `employer_sponsorship_facts` with
their provenance, and the reading surface composes them per employer at request time — the same
choice ADR-0022 made for viability, which has not needed revisiting.

**`ordering` is explicitly given up, and this decision owns that.** If the discovery surface later
needs a ranking, it comes back as its own ADR with the question stated as *"what may an ordering
assert?"* — the shape ADR-0037 used for Skill Fit — rather than as an implementation of this table.

## Consequences

**Accepted costs.**

- **No "sort by migration support".** The most natural product question on this surface has no answer,
  and a person comparing fifty roles reads fifty panels. That is a real loss and the main reason to
  disagree with this ADR.
- **Three documents become wrong and must change in the implementing PR**: `migration-friendly-jobs.md`'s
  score section, `GLOSSARY.md`'s definition, and `employer-sponsorship.md`'s second table. A decision
  that leaves its own specification standing is how the next person builds the thing it refused.
- **`docs/database/data-retention.md`'s derived-data section** loses its only employer example.
- Composing per employer at request time costs a query the surface does not make today.

**Follow-up work.**

1. Delete the `employer_migration_scores` DDL from `employer-sponsorship.md` and replace it with what
   this ADR decided and why, so the document records the refusal rather than falling silent.
2. Rewrite `migration-friendly-jobs.md`'s "Migration-Friendly Employer Score" section as a factor
   panel. Keep the six factors — they are the right six.
3. Amend `GLOSSARY.md`: the term names a **panel**, not a number, and keeps its three "Not:" clauses.
4. When employer facts exist, extend `GET /v1/jobs` with the per-employer factors, in the shape the
   posting-level signals already use.

**Reversal cost.** **Low, and it stays low** — this is the value of deciding before building. Nothing
is stored, so reversing means writing the migration this ADR declined to write and computing from
facts that will already be there. No row becomes invalid, and no stored number has to be recomputed
or explained. Reversing *after* Option A, by contrast, means every consumer of a number nobody should
have trusted.

**The signal to reverse** is the discovery surface being demonstrably unusable without an ordering,
measured against real employer facts — not the absence of a number on a page.

## Compliance

- **The absence is asserted, not remembered.** A test fails if a table named `employer_migration_scores`
  appears in `packages/db/src/schema.ts` or in the migrations directory, mirroring the way ADR-0037's
  test asserts no `scorer_version` starts `job-match`. Without it, the specification this ADR
  contradicts is still sitting in the entity document for somebody to implement.
- **No `scorer_version` for employer support may be introduced**, by the same test.
- The jobs surface keeps rendering signals separately; `apps/web/lib/jobs-view.test.ts` already
  asserts that no merged verdict is produced.

## Related

- **ADR-0022** — no composite viability score, and the argument this one narrows and applies
- ADR-0037 — Skill Fit named for the one axis it measures, and the shape a future ordering ADR takes
- ADR-0039 — what a sponsorship claim may assert; `stated_unavailable` is the value that breaks a composite
- `docs/features/migration-friendly-jobs.md`, `docs/database/entities/employer-sponsorship.md`
