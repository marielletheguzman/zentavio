# Backlog

> **Purpose:** Parking lot for ideas not yet scheduled.

Every item states the **user question** it serves and its **position in the chain**. An item with no
question is deleted rather than deferred — a backlog full of unjustified items is where prioritization
goes to die (`.claude/skills/roadmap/SKILL.md`).

Ordered within each group by how much it deepens the chain, not by appeal.

## Blocking decisions

Not features. Each one gates work that cannot start without it.

| Item | Question served | Blocks |
|---|---|---|
| **Source origin-side authorities** | Does my licence transfer? | any verdict for a regulated profession (ADR-0010 is Accepted; the data is not sourced) |
| **Observability backend** | — engineering | dashboards and alert routing (ADR-0008 deferred it) |
| **JSON Schema generation for cross-language contracts** | — engineering | `tech-stack.md`'s "neither side hand-writes the other's types". Now live: `ai/resume-parser` produces a shape TypeScript consumes. Held today by golden fixtures the Python side generates (`tests/unit/contracts/`), which proves the shapes agree **today**, not that they cannot diverge. Generation tooling is a dependency and needs its own ADR |
| ~~**`ci` as a required status check**~~ | — engineering | **Resolved 2026-07-31.** Configured and violation-tested; the required check is named `CI`, not `ci` (ADR-0011 Correction) |
| ~~**A hosted PostgreSQL provider**~~ | — engineering | **Resolved 2026-08-01 (ADR-0015): Supabase, as managed PostgreSQL and nothing else.** Provisioning and the pooler-versus-runner question are follow-up work, not a blocking decision |

**Resolved since this list was written:** ADRs 0007–0011 are all Accepted, and the
`applications` / `practice_sessions` entity documents exist. ADR-0014 is Accepted **and implemented** —
TypeScript entrypoints run on Node's native type stripping, so `pnpm migrate` exists and no runner entered
the stack. What remains of those decisions is implementation, tracked as follow-up in each ADR rather than
as a blocker here.

## Near — inside the current phases

| Item | Question | Chain position |
|---|---|---|
| PH reference file (`ph.md`) | What do I need from my own side? | before Phase 3 |
| Recognition-status surfacing (without a verdict) | Is my licence the problem? | Phase 1, honest partial |
| Second career track | What else could I do? | Phase 1 exit test — proves additivity |
| DE salary-band ingestion (tier 1) | Will I meet the threshold? | feeds viability |
| Language-requirement modelling per sector | Can I work there in English? | feeds viability, high value for PH users |
| Resource coverage for the seeded track | What should I learn? | Phase 1 learning paths |
| Rule-change notifications | What changed? | Phase 1, small |

## Near — the pipeline built in #141–#162 has no consumer

| Item | Question | Chain position |
|---|---|---|
| **Jobs discovery surface — cross-country IT & software opportunities** | Which of these jobs is worth my time, *and could I actually take it?* | see below — the only surface that consumes `job_postings`, `job_posting_skills` and `matches` |

**Why this is written down.** #141–#162 built board ingestion, posting persistence, skill extraction
and Skill Fit. **Nothing renders any of it.** `apps/web` has seven pages and none shows a posting;
the gateway has ten modules and none serves one. 239 real postings and 6 matches sit in the dev
database reachable by no route. A built pipeline with an unstated consumer is how a codebase grows
things nobody asked for, so the consumer is stated here.

**What it is.** Not a job board. A **cross-country discovery surface for IT, software, computer
science and engineering roles**, filtered toward opportunities with immigration or relocation value —
browsable by country, role and skill area.

**The distinction it rests on is already specified**, in
[`docs/features/migration-friendly-jobs.md`](../features/migration-friendly-jobs.md), and this item
does not restate it:

> **Employers sponsor. Governments grant.**

Sponsorship, relocation support, migration costs, and a pathway toward permanent residence are
**separate signals and are never merged into one "immigration-friendly" label**. That matters more as
eligibility evaluation completes: a vague label cannot be checked against a rule, and five merged
signals cannot be un-merged later.

**Rules this surface inherits, none of them new:**

- **Skill Fit where computable, never called a Job Match Score** (ADR-0037).
- **`score = 0` is not `unknown`.** Evaluated-with-no-overlap and not-evaluatable are different
  answers; all six matches in the dev database today are the former, which is exactly the case a
  naive UI renders as "0% match" and gets wrong.
- **`unknown` sponsorship is not `no`** (`migration-friendly-jobs.md`, design decision 1). Most
  postings state nothing, so `unknown` will dominate at launch.
- **No claim of sponsorship or a residence pathway without evidence that states it.** ADR-0033
  forbids mining prose for facts the source did not state, and that does not bend for a field users
  want.
- **Source, employer and country shown on every listing.** `company_id` is null on every stored
  posting today, and `company_name_raw` is what a Lever board supplies — which is nothing.
- **It connects to the existing eligibility evaluation rather than inventing a second immigration
  score.** ADR-0022 already refused a composite for exactly this reason.

**What is missing, measured rather than guessed (2026-08-23):**

| Needed | State |
|---|---|
| `employer_sponsorship_facts` | designed in `data-retention.md`, **table does not exist** |
| `employer_migration_scores` | designed, **table does not exist** |
| sponsorship / relocation fields on `job_postings` | **none** — no column matches sponsor, visa or relocation |
| a connector for sponsor registries | none; `migration-friendly-jobs.md` tier 1 is an official register |
| a jobs module in the gateway | **built** — `GET /v1/jobs`, with the Skill Fit and sponsorship shapes above |
| a page in `apps/web` | none of its seven pages shows one |
| employer resolution | `company_id` null on all 239 stored postings |

**Not blocked on a decision** — blocked on build, and on a sponsorship source that states rather than
implies. The Skill Fit half is done and proven against 239 real postings; the immigration half is
specified and unbuilt, and this item must not pretend the first answers the second.

## Middle

| Item | Question | Notes |
|---|---|---|
| Student-specific surface | What should I study, given the move? | a named primary user with no dedicated surface yet |
| Credential-evaluation guidance per destination | Will my degree be accepted? | pairs with recognition |
| Document-authentication checklist | What paperwork, in what order? | high anxiety, low ambiguity — good product |
| Cost-of-move estimation | Can I afford this? | needs sourced cost data |
| Remote-work tax and contracting reality | What do I actually keep? | `REMOTE` is under-served without it |
| Employer sponsorship prevalence per market | Will anyone sponsor me? | changes ranking materially |
| Interview report contribution flow | — | must precede M8 |
| Trajectory view over time | Am I getting closer? | uses `readiness_scores` history |

## Later

| Item | Question | Notes |
|---|---|---|
| Future destinations: NL, IE, AU, CA, Nordics | Where else? | additive by construction; after M4 |
| Employer-side market intelligence | — | aggregates only, never individual data |
| Billing | — | after the answer is proven worth paying for |
| Mobile app | — | responsive web first |
| Agency-alternative positioning | Who can I trust? | product and trust question, not only engineering |

## Rejected, with reasons

Kept so they are not re-proposed. Rejection is as useful as acceptance.

| Rejected | Why |
|---|---|
| Job alert emails as a growth channel | answers "what exists?", not "what should I do next?" — and turns the product into a feed (`notifications.md`) |
| Résumé keyword optimizer | answers "how do I game the filter?" |
| Paid placement or sponsored ranking | monetizing the ordering destroys the asset, which is trust in the ordering |
| Visa "success probability" score | we have no outcome data, and a fabricated probability on an irreversible decision is the worst thing we could ship |
| Chat interface over general knowledge | ungrounded by construction; violates `ai-principles.md` rules 1 and 3 |
| Scraping sources that disallow it | `docs/architecture/connectors.md` |
| Community forum | different product, and it would become an unsourced tier-4 answer channel competing with our sourced one |

## Discipline

- An item that sits here for three phases without becoming a question anyone asks gets deleted.
- Anything touching a boundary, a dependency, or a contract needs an ADR before it is scheduled.
- Items are pulled into a phase, never pushed. A phase is defined by its question first, then filled.

## Related

- `phases.md`, `milestones.md`, `mvp.md`
- `.claude/context/feature-philosophy.md` — the tests an item must pass
