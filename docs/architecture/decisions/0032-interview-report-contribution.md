# ADR 0032: Anyone signed in may report a pairing once, corrections recompute, and withdrawal detaches rather than deletes

- **Status:** Proposed
- **Date:** 2026-08-22
- **Deciders:** project lead
- **Affects:** `services/api-gateway`, `apps/web`, `packages/db` (`interview_reports`), `docs/features/interview-prep.md`

## Context

ADR-0031 settled what a report has to add up to: five per `(company, role_family)` in eighteen
months before a process is described, three mentions before a stage appears. It named the flow that
produces them as separate work, and named its own biggest risk as **cold start** — every company
reading *"we don't have enough reports"* forever, so nobody contributes, so the floor is never
reached.

The schema already carries one anti-gaming rule: `uq_ir__user_pairing`, one report per person per
pairing. That is where this decision starts, not where it ends.

### The constraint that makes this non-obvious

**Every eligibility rule that raises integrity lowers contribution, and contribution is the binding
risk.** Five reports per pairing in eighteen months is already demanding. A gate that halves the
eligible population does not halve the fabrication risk and does halve the chance any pairing is ever
describable — which would leave M8 delivering role-generic prep and nothing else, permanently.

**And short of verification, every option is friction rather than proof.** We cannot see a calendar
invite, an interview email, or an offer letter. Anything we ask the contributor to assert is another
self-report, and stacking self-reports does not produce evidence.

### What is actually at stake if somebody games it

Worth stating plainly, because it bounds how much friction is justified.

**There is no ranking to climb.** ADR-0026 refused ranking destinations; nothing in this product
ranks companies either, and no surface says one company's process is better. A seeded report cannot
move a leaderboard, because there is no leaderboard.

What it *can* do is mislead a person's preparation — the same harm ADR-0031 is written against, from
the other direction. Five plausible reports could put a stage into a company's described process that
does not exist, and somebody spends a week on it.

**The incentive is weak and the harm is real**, which argues for cheap mitigations that keep
contribution flowing, not expensive ones that stop it.

## Options considered

### Option A — Anyone signed in may report, once per pairing

**Advantages.** The largest eligible population, which is the thing the cold-start risk needs. Simple
to explain, simple to implement, nothing to work around. The existing unique index already costs an
attacker one account per report.

**Disadvantages.** Five accounts is not a high bar for somebody determined. Nothing distinguishes a
person who interviewed from a person who did not, and nothing ever will under this option.

### Option B — Only somebody with a recorded application to that company

**Advantages.** Meaningful friction: an attacker needs an application row per account, dated, before
the report counts. It also correlates with reality — people who applied are the people who
interviewed.

**Disadvantages.** **The application is self-recorded too**, so this stacks one self-report on
another rather than verifying anything; the friction is real but the proof is not. It also excludes
honest contributors — anybody who interviewed before finding this product, or who tracked their
applications elsewhere, which today is almost everybody. It attacks the risk that is not binding and
worsens the one that is.

### Option C — Verified evidence of the interview

An interview email, a calendar invite, an offer letter.

**Advantages.** The only option that produces actual evidence rather than friction.

**Disadvantages.** Requires reading somebody's mail or calendar, which this product will not do —
`privacy.md` and `ai-memory-policy.md` set that standard, and the data is far more sensitive than the
report it would validate. An uploaded document would need review nobody can staff, and would be
trivially forged for a claim this low-stakes.

### Option D — Open contribution with an operator review queue

**Advantages.** Catches the obvious cases: five reports for one pairing from accounts created the
same afternoon.

**Disadvantages.** A review queue is an operational commitment that does not exist, and one nobody
can staff on this product's timeline. Building the queue and leaving it unattended is worse than not
having one: it looks like moderation and is a backlog.

### Option E — Do not collect reports; role-generic prep only

**Advantages.** No integrity problem, because no tier-4 data.

**Disadvantages.** This is ADR-0031's Option D arriving again by another route, and it was refused
there for the same reason: the useful, honestly-stated aggregate is the thing M8 exists to produce.

## Decision

**Option A — anyone signed in may report a pairing once; a correction updates the report they already
made; and withdrawing a report detaches it rather than removing it, which is disclosed before they
submit.**

Five parts.

**1 — Eligibility is being signed in.** No application requirement, no evidence requirement. Contribution
is the binding risk and every gate makes it worse without producing proof.

**2 — One per person per pairing, already in the schema.** `uq_ir__user_pairing` is the whole of the
per-account limit, and it is honest about being a limit rather than a defence.

**3 — Corrections update in place, and that is safe because nothing is cached.**
`processForPairing` aggregates at read time, so a corrected report is simply counted correctly from
then on. There is no stored aggregate to go stale and no version chain to maintain — a typo that
misdescribes a company should be fixable by the person who made it.

**4 — Withdrawal detaches, and the person is told so first.** Removing a report would let anybody
drop a pairing below its floor at will, changing what a stranger is told — the same reason erasure
detaches (ADR-0031). So withdrawal clears the attribution and keeps the count, and the submission
form says that **before** the report is made, because a person consenting to contribute is entitled
to know what they cannot take back.

**5 — No public attribution, ever.** A report is never shown with a name, a handle, or anything that
identifies who made it, and the aggregate never reveals a single report's contents. Somebody
describing an employer's process is exposed if that is traceable to them.

## Consequences

**Accepted costs.**

- **Five accounts still clears a floor.** This decision does not prevent seeding; it makes it cost
  five accounts and five separate submissions. That is the honest strength of it, and it is written
  here rather than implied by the word "posture".
- **Nothing distinguishes a report from somebody who interviewed and one from somebody who did not.**
  Under this option nothing ever will.
- **No moderation exists.** Nothing is reviewed, nothing is flagged, and there is no queue. Adding
  one is a real operational commitment and should be a decision, not a drift.
- **Withdrawal is partial and that will surprise somebody.** "Delete my report" removes their name
  and not their contribution. The disclosure is the mitigation, and a disclosure is weaker than a
  control.
- **A person could report a pairing they know nothing about**, in good faith or otherwise, and the
  stage floor is the only thing standing between that and a described process.

**Follow-up work.**

- The contribution surface: closed vocabulary as a form, one submission per pairing, correction of
  an existing report, and withdrawal with its disclosure stated **before** submitting.
- Gateway routes, with the same ownership rule the assessment routes use — a report that belongs to
  somebody else gets the same answer as one that does not exist.
- `interview-integrity.md`, the honest account of what is and is not defended, in the shape
  `assessment-integrity.md` took for ADR-0030.
- A revisit trigger written into that document: **if reports ever become worth gaming** — shown to
  employers, ranked, sold, or used as a gate — this decision is not adequate and must be reopened
  before that ships, not after.

**Reversal cost.** Low. Adding an eligibility gate later is a check at the write boundary and
invalidates no stored data; the reports already collected stay valid under a stricter rule, because
a stricter rule is about who may add one. The signal to reverse is a pairing whose reports arrive in
a burst from accounts with no other activity — which nothing currently watches for, and saying so is
part of the decision.

## Compliance

A reviewer verifies this by:

- **A test that a second report from the same person for the same pairing is refused**, and that the
  same person may report a different pairing.
- **A test that a correction updates rather than inserts**, and that the pairing's count is unchanged
  afterwards.
- **A test that withdrawal leaves the count intact and the attribution gone** — `user_id` null,
  `anonymized_at` set, exactly as erasure does it.
- **A test that a report belonging to another user is not readable or writable** through the routes.
- **A surface test that the withdrawal disclosure is present on the form**, not only on the
  confirmation. A consequence explained after the fact is not a disclosure.

## Related

- ADR-0031 — the support floors, and cold start as the binding risk
- ADR-0030 and `docs/architecture/assessment-integrity.md` — the shape this document's follow-up takes
- ADR-0026 — no ranking, which is why a seeded report has no leaderboard to move
- `docs/architecture/privacy.md` — why Option C is not available
