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
| ~~**`ci` as a required status check**~~ | — engineering | **Resolved 2026-07-31.** Configured and violation-tested; the required check is named `CI`, not `ci` (ADR-0011 Correction) |
| **A hosted PostgreSQL provider** | — engineering | any environment that is not a developer's Docker. Nothing in `tech-stack.md` names one; Supabase was raised and never decided |

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
