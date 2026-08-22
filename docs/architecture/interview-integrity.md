# Interview report integrity

> **Purpose:** What can be done to a tier-4 report pool, what this repository does about it, and what
> it does not. ADR-0032's follow-up, in the shape `assessment-integrity.md` took for ADR-0030.

**This document exists because the defences are thin.** Five reports describe a company's process,
and five accounts is not a high bar. Writing the mitigations as a feature list would misrepresent
them; the point of the list is the right-hand column.

The honest defence is structural rather than technical, and it is worth stating before the table:
**a report is never presented as company policy, never attributed to anybody, and never ranked
against another company.** What a seeded report can buy is not status — there is no leaderboard —
it is a stranger preparing for the wrong thing.

## Threat model

Five ways the pool can be made to say something untrue, in roughly descending order of likelihood.

| # | Attack | Status |
|---|---|---|
| 1 | **One person's account read as the company's process** | **closed.** Support floors |
| 2 | **One outlier stage inventing a round** | **closed.** Per-stage floor |
| 3 | **Withdrawing to drop a pairing below its floor** | **closed.** Withdrawal detaches |
| 4 | **Seeding a pairing from several accounts** | **narrowed, barely** |
| 5 | **An honest report about a process that has since changed** | **narrowed.** The window |

### 1 and 2 — anecdote presented as process

The whole of ADR-0031. A pairing needs five reports in eighteen months before its process is
described at all, and a stage needs three mentions before it appears. Below either floor the surface
says so and shows the count.

**These are the only two attacks that are genuinely closed**, and they are closed against the
*accidental* version — a well-meaning aggregate over thin data — as much as the deliberate one.

### 3 — withdrawal as a weapon

Deleting a report would let anybody drop a pairing below its floor at will, changing what a stranger
is told. So withdrawal **detaches**: the attribution goes, the count stays (ADR-0032 part 4). Erasure
does the same thing for the same reason.

The cost is disclosed on the contribution form *before* anybody submits, because a person consenting
to contribute is entitled to know what they cannot take back.

### 4 — seeding

**Narrowed, and barely.** `uq_ir__user_pairing` costs an attacker one account per report, so a
pairing costs five accounts and five separate submissions. That is friction, not a defence, and
ADR-0032 accepted it in writing rather than dressing it up.

**Why the cheap fix was refused.** Requiring a recorded application to that company sounds like
verification and is not: an application here is self-reported too, so it stacks one self-report on
another. It would also exclude everybody who interviewed before finding this product — which today is
almost everybody — and ADR-0031 already named **contribution**, not fabrication, as the binding risk.
A gate that halves the eligible population does not halve the fabrication risk.

**What would actually close it** is verification we cannot do without reading somebody's mail or
calendar, which `privacy.md` forbids, and which would be far more sensitive than the report it
validated.

### 5 — a true report that has gone stale

Processes change. A report accurate in 2024 can be wrong now, and nobody involved was dishonest.

The eighteen-month window is the whole mitigation: an old report simply stops counting. It is crude —
a company that changed its process last month still shows the old one until enough recent reports
arrive — and the count and window are always displayed so a reader can judge that themselves.

## What is deliberately not collected

No device fingerprint, no IP scoring, no account-age heuristics, no timing analysis of submissions.
Each would be a small deterrent and a permanent stream of behavioural data about somebody who came
here to plan a career (`privacy.md`, `ai-memory-policy.md`).

**No moderation exists.** Nothing is reviewed, nothing is flagged, and there is no queue. Building an
unattended queue would be worse than having none: it looks like moderation and is a backlog.

## What would change this document

- **Reports become worth gaming** — shown to employers, ranked, sold, or used as a gate anywhere. The
  incentive assumption under attack 4 stops holding, and this posture is **not adequate**. ADR-0032
  requires reopening that decision *before* such a change ships, not after.
- **A pairing's reports arrive in a burst from accounts with no other activity.** Nothing currently
  watches for this, and saying so is part of the posture rather than a gap in it.
- **Pooling becomes possible for stage vocabulary** — not applicable here in the way it is for
  assessments, but a company-specific question bank would inherit the same problem and should be
  designed against this document.

## Related

- ADR-0031 — the support floors, and why both failure directions are unsafe
- ADR-0032 — who may contribute, and why the cheap eligibility gate was refused
- `docs/architecture/assessment-integrity.md` — the same treatment for ADR-0030
- `docs/database/entities/interview-report.md` — the schema, and the detach-on-erasure rule
