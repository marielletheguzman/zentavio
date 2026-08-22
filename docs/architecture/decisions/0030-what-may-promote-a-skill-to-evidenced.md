# ADR 0030: An in-platform assessment is the only thing that may promote a skill to `evidenced`, and what it evidences is the attempt

- **Status:** Proposed
- **Date:** 2026-08-22
- **Deciders:** project lead
- **Affects:** `packages/db` (`profile_skills`, the unbuilt assessment tables), `ai/skill-gap`, `services/api-gateway`, `apps/web`, `docs/features/learning-paths.md`, `docs/database/entities/user.md`

## Context

`profile_skills.status` is `evidenced` or `claimed`, and `ai/skill-gap` credits only the first
(`_CREDIT_STATUSES`). That split is what makes readiness honest: a résumé saying "Kubernetes" moves
nothing until something backs it.

Today exactly one thing writes `evidenced`: the résumé parser, from a role or a project it can quote
a source span for. `evidence_kind` already anticipates three more — `certification`, `assessment`,
`artifact` — and **nothing writes any of them**. `verified_at` is documented as *"set only by
in-platform verification"* and is never set, because no in-platform verification exists.

M6 requires that gap to close in a particular direction: *"completing a course does **not** move
readiness; passing the assessment does. Visible to the user, so nobody optimizes for completions."*
`learning_completions` was built for the first half (#123) and deliberately promotes nothing.

### The constraint that makes this non-obvious

**Whatever we choose, this platform becomes an issuer of evidence about a person.** Every downstream
number inherits it: readiness feeds viability, viability feeds the comparison, and M9 eventually
publishes how well our scores predicted reality. A weak promotion path does not merely add noise —
it inflates readiness for exactly the people most motivated to game it, and the inflation is
invisible until outcomes accumulate.

`career-philosophy.md` states the standard: *"Requirements are met by proof, not by self-assessment"*
and *"evidence outranks assertion"*. The difficulty is that most cheap verification paths are
assertion wearing evidence's clothes — a completion certificate asserts attendance, a repository URL
asserts authorship, a certification badge asserts a pass we never witnessed.

**We also cannot verify identity.** There is no proctoring, no ID check, and no session integrity
work in this repository. Anything decided here is decided under that limit, and pretending otherwise
would be the same failure in a different place.

## Options considered

### Option A — An in-platform assessment, authored by us

A person answers items we wrote; passing writes `evidenced` with `evidence_kind = 'assessment'` and
sets `verified_at`.

**Advantages.** It is the path M6's own sentence names. It is the only option where **we control what
passing means**, so the claim we make is one we can describe precisely and later calibrate against
outcomes (M9). The evidence is produced by an act the person performed *here*, at a known time,
against a known version of a known instrument — which is the same shape as every other fact in this
product: sourced, dated, and quotable.

**Disadvantages.** Items must be authored per skill, so coverage will be tiny for a long time and
most skills stay `claimed`. Unproctored and unattributed: somebody else can sit the assessment, and
items leak. We become an assessment authority with no external validation of our own item quality —
a badly written item produces a confidently wrong `evidenced`, in the direction that flatters.

### Option B — Artifact review

The person submits a repository, project or piece of work; it promotes on review.

**Advantages.** Closest to how competence is actually judged, and it costs no item authoring. Reuses
`evidence_kind = 'artifact'`, which already exists.

**Disadvantages.** **Review by whom.** Self-submitted with no reviewer, it is a URL and a claim —
strictly weaker than the résumé line we already refuse to treat as evidence. A human reviewer is an
operational commitment this product does not have and cannot staff. An automated check — does it
build, does it have tests — measures the repository, not the person, and is trivially satisfied by a
template or a fork.

### Option C — Recognised certification, trusted from the issuer

A certification from a named authority promotes at its own weight, reusing
`learning_resources.grants_evidence` and `cert_authority`.

**Advantages.** Cheapest by far: it is ingestion, not authoring. Some issuers genuinely do proctor,
and their pass means more than anything we could construct alone.

**Disadvantages.** **We cannot check that this person holds it.** A certificate URL or an id typed
into a box is self-report about a third party's judgement, which is one more layer away from proof
than the résumé claim we already discount. Several major issuers publish a verification endpoint;
none of them is integrated, and the option is only as good as that integration — which makes this
Option A's cost in a different currency, paid per issuer rather than per skill.

### Option D — Do nothing; evidence stays what the résumé shows

**Advantages.** Costs nothing, and today's behaviour is already honest: a completion moves nothing
because it can move nothing.

**Disadvantages.** M6 is unreachable, and the product's answer to *"how do I close this gap?"* ends
at *"learn it somehow, and we will never notice."* It also leaves a documented column
(`verified_at`) whose stated meaning nothing can ever satisfy, which is a lie by omission in the
schema rather than a gap in it.

### Option E — All three at once, with weights

**Advantages.** Widest coverage soonest; a weighted blend hides any single path's weakness.

**Disadvantages.** A weight is a number we would have no basis for. It buries the strength of the
evidence inside an aggregate exactly where the user most needs to see it, which is what ADR-0022 and
ADR-0026 already refused for viability and for destinations. Three unvalidated paths blended is not
more trustworthy than one described precisely.

## Decision

**An in-platform assessment is the only path that may promote a skill to `evidenced`; a pass
evidences *the attempt* — this person passed this version of this assessment on this date — and the
surface says exactly that rather than "is competent".**

Four parts.

**1 — One writer.** Promotion happens in one place, from a recorded attempt. Nothing else writes
`evidence_kind = 'assessment'` or `verified_at`, and `learning_completions` continues to promote
nothing at all. `grants_evidence` stays read by nothing until Option C is decided on its own merits.

**2 — The claim is scoped, and the scope is rendered.** A promoted skill carries which assessment,
which version, and when. The surface states the limit in the person's own view — unproctored, and
about the attempt rather than about them — because the alternative is a user who believes we
certified them and an employer who is told we did.

**3 — Versioned and re-attemptable.** Items change; a pass cites the version it was earned against,
so a later rewrite does not retroactively change what somebody demonstrated. Re-attempts are allowed
and the most recent result stands, because forbidding them would make a single bad day permanent.

**4 — Identity is not claimed.** No proctoring exists, so nothing here asserts *who* sat the
assessment. That is a stated limit, not a footnote, and it is the reason part 2 is not optional.

## Consequences

**Accepted costs.**

- **Coverage will be embarrassing for a long time.** Items must be authored per skill, so most
  skills stay `claimed` and readiness stays conservative. That is the honest direction to be wrong
  in, and it will still read as the product not working.
- **A pass is weaker evidence than it looks.** Unproctored and unattributed. We hold the line by
  describing it precisely rather than by pretending otherwise — and a description is a weaker
  mitigation than a control.
- **We become an assessment authority with no external check on item quality**, until M9's
  calibration gives one. A badly authored item produces a confidently wrong `evidenced`, and it errs
  toward flattering the person.
- **Somebody genuinely competent can fail narrow items**, and readiness will understate them. There
  is no appeal mechanism and this ADR does not create one.
- **Two paths stay closed** that users will ask for, repeatedly: their certification and their
  GitHub. The answer is "not yet, and here is why", which is a worse user experience than saying yes.

**Follow-up work.**

- Schema and entity documentation for assessments and attempts: the instrument, its version, and one
  recorded attempt per person per version.
- The single promotion writer, with a test that no other code path sets `verified_at`.
- Items for **one** skill first, drawn from the seeded track and the product's own priority — IT,
  software and computer engineering — as the vertical slice that proves the model before it is
  repeated.
- The surface: take it, see the result, and see what it did and did not claim.
- A stated anti-gaming posture — item pooling, attempt spacing — recorded honestly as mitigation
  rather than as a solution.
- Revisit Option C when a major issuer's verification endpoint is integrated, which is the only thing
  that would make a certification evidence rather than self-report.

**Reversal cost.** Low, and additive. Reversing means ceasing to write `evidence_kind = 'assessment'`
and deciding what happens to rows already promoted — they stay, citing the version they were earned
against, because deleting somebody's evidence to simplify our model would be worse than keeping a
retired instrument on the record. The signal to reverse is M9's calibration showing that
assessment-promoted skills predict outcomes no better than claimed ones, which would mean the
assessment measures nothing and its `evidenced` is noise wearing a badge.

## Compliance

A reviewer verifies this by:

- **`tests/integration/db/learning-constraints.test.ts`** — a completion writes no `profile_skills`
  row, including when `grants_evidence` is true. Already passing; this ADR is why it stays.
- **A new test asserting one writer**: `verified_at` is set only by the promotion path, and
  `evidence_kind = 'assessment'` appears nowhere else in the repository. `ck_profile_skills__
  verified_is_evidenced` holds the weaker half in schema; the test holds the rest.
- **A surface test** that a promoted skill renders which assessment and version produced it. A
  promotion with no visible basis is the failure this ADR's part 2 exists to prevent.
- **Grep discipline**: `grants_evidence` has no readers. When it gains one, this ADR is being
  changed, and the change needs its own decision record.

## Related

- ADR-0018 — the evidenced/claimed split at extraction, and why the parser writes only what it can
  quote
- ADR-0022 — no composite score; the binding constraint is named instead
- `docs/features/learning-paths.md` — the promotion table this implements the first row of
- `docs/database/entities/user.md` — `profile_skills`, `evidence_kind`, `verified_at`
- `.claude/context/career-philosophy.md` — evidence outranks assertion
