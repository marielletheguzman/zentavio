# Assessment integrity

> **Purpose:** What can be done to an unproctored assessment, what this repository does about it,
> and what it does not. ADR-0030's anti-gaming follow-up.

**This document exists because the mitigations are weak.** An unproctored, unattributed instrument
can be gamed, and every control below narrows an attack rather than closing it. Writing them down as
a list of features would misrepresent them; the point of the list is the last column.

The honest defence is not technical. It is that **a pass claims only the attempt** — this person
passed this version on this date — and that the instrument's own `does_not_evidence` says out loud
that it is unproctored and does not establish who sat it (ADR-0030). Everything here is secondary to
that sentence, and nothing here makes a pass stronger evidence than it says.

## Threat model

Five ways to obtain a pass that does not reflect competence, in roughly descending order of how
likely they are.

| # | Attack | Status |
|---|---|---|
| 1 | **Extract the key by repetition** — attempt, note the score, vary the answers | **narrowed.** Attempt spacing |
| 2 | **Read the key from the response** | **closed.** It is never served |
| 3 | **Send a score instead of answers** | **closed.** There is no score to send |
| 4 | **Share items and answers between people** | **not mitigated** |
| 5 | **Have somebody else sit it** | **not mitigated, and not mitigable here** |

### 1 — Extraction by repetition

Ten items of four options, attempted without limit, gives up the whole key in a handful of sittings:
score feedback after each attempt is enough to isolate which answers changed the total.

**What is done.** `skill_assessments.retry_interval` — 24 hours by default — is enforced in
`startAttempt`. It is a column rather than a constant because how long is a judgement about the
material: a ten-item recall test and a two-hour practical do not deserve the same cooldown.

**What it achieves.** It makes extraction cost *time* instead of effort. Somebody sufficiently
determined still gets there; they take days over it.

**What would actually close it** is item pooling — serving `n` of a larger bank, so no single
sitting reveals a stable key and no two people see the same paper. That needs more items than the
instrument asks, and the Git instrument has exactly ten. **It is not implemented, and the schema does
not pretend otherwise**: `item_count` is what is asked *and* what exists, checked at publish.

### 2 — Reading the key

`itemsToAnswer` selects `id`, `position`, `stem` and `options`. `correct_option` is absent from the
projection, not stripped afterwards by a caller who might forget. Grading happens server-side against
the stored key, and the browser never holds it.

### 3 — Sending a score

`GradeAttemptDto` has no score field. Answers arrive; the score is computed; the threshold is read
from the instrument. A client that can send its own score has decided whether it passed, and no
validation downstream recovers from that.

### 4 — Sharing between people

**Not mitigated.** The Git instrument is ten fixed questions; anyone who has taken it can write them
down. Pooling and periodic rotation are the answer, and neither exists.

The mitigating fact is not a control: this instrument is **free to attempt and worth little to
fake**. It moves readiness on one skill for one person's own planning; it is not shown to employers,
and it is not a credential. The incentive to share answers is proportional to what a pass is worth,
and a pass here is worth exactly what `does_not_evidence` says.

### 5 — Somebody else sitting it

**Not mitigable in this repository.** There is no proctoring, no identity verification, no device or
session signal being collected. This is stated in ADR-0030 as a limit of the decision rather than as
work outstanding, and it is why part 2 of that decision — the scoped, rendered claim — is not
optional.

## What is deliberately not collected

No device fingerprint, no IP-based scoring, no keystroke or mouse telemetry, no time-per-item
tracking. Each would be a small deterrent and a permanent stream of behavioural data about a person
who came here to plan a career. `privacy.md` and `ai-memory-policy.md` set the standard: data that
would need justifying is not collected on the chance it might help.

**Attempt timing is recorded** — `started_at`, `submitted_at` — because an attempt without a date is
not a record. It is not analysed for suspicion, and no rule anywhere reads it that way.

## What would change this document

- **Pooling becomes possible** — more authored items than an instrument asks. Then attack 1 narrows
  much further and attack 4 becomes real work rather than a copy-paste.
- **A pass starts being worth faking** — shown to an employer, sold, or used as a gate. Then the
  incentive assumption under attack 4 stops holding, and this posture is not adequate.
- **M9's calibration** shows assessment-promoted skills predicting outcomes no better than claimed
  ones. That is the signal ADR-0030 names for reversing the whole decision, and gaming would be one
  explanation for it.

## Related

- ADR-0030 — what may promote a skill, and what a pass claims
- `docs/database/entities/assessment.md` — the instrument, attempts, and the promotion writer
- `docs/architecture/privacy.md` — why the telemetry above is not collected
