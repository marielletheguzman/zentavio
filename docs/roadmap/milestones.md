# Milestones

> **Purpose:** Phased milestones: MVP, learning loop, multi-country scale.

A milestone is **verifiable by someone who did not build it** — a user path that works, not a set of
merged pull requests. Each one below states what a person can actually do when it is met.

No dates. Sequencing is by dependency, and a date attached to unbuilt work is a guess that becomes a
commitment.

---

## M0 — The skeleton enforces itself

*Phase 0.* Boundaries are held by tooling rather than by review; CI blocks on `main`; ADRs recorded.

**Verified by:** a deliberate cross-layer import fails the build with the ADR it breaks, and a red CI run
cannot merge.

**Outstanding:** `ci` as a required status check, project references, graded evals in CI.

---

## M1 — One honest answer exists

*Phase 1, first half.* A Filipino professional uploads a résumé and receives a readiness number for one
track with its remainder and its evidence.

**Verified by:** a real user reads the number, opens the evidence, disagrees with one extracted skill,
corrects it, and watches the number change for a reason they can see.

The correction path is part of the milestone, not a follow-up: a profile a user cannot fix is a profile
they will not trust.

---

## M2 — Germany is answerable

*Phase 1 complete.* DE pathway rules ingested from tier-1 sources, dated and versioned; per-rule
eligibility; viability with the binding constraint named.

**Verified by:** a user with an incomplete profile gets `undetermined` plus the one input that would
resolve it — and supplying it produces a definite answer.

That is the milestone's real test. A product that only works on complete profiles does not work.

---

## M3 — Adding a country costs no code

*Phase 2 entry gate.* Luxembourg is added.

**Verified by:** the diff touches a reference file, connector coverage, ingested rules, and a registry
entry. **Nothing in `services/` or `ai/`.**

If the diff is larger, ADR-0002's central claim is false and the design is fixed before NZ and CH follow.
This is the cheapest possible moment to discover that.

---

## M4 — Four destinations, honestly compared

*Phase 2 complete.* DE, LU, NZ, CH, plus `REMOTE`, side by side.

**Verified by:** a user sees one market marked `unknown` on salary while another is complete, and the
comparison is still usable — partial coverage rendered as a designed state rather than a blank.

---

## M5 — Regulated professions get a real verdict

*Phase 3.* Origin-side rules modelled; recognition evaluated alongside the visa.

**Verified by:** a Filipino nurse or engineer receives a verdict that names recognition as the binding
constraint where it is, instead of the `unknown` that honesty currently requires.

**Blocked on:** the origin-jurisdiction ADR. Until then this milestone cannot start, and the product
cannot serve some of its largest user groups — which is why it is a named milestone rather than a backlog
item.

---

## M6 — Learning is verified, not claimed

*Phase 4.* Assessment and artifact verification promote a skill to `evidenced`.

**Verified by:** completing a course does **not** move readiness; passing the assessment does. Visible to
the user, so nobody optimizes for completions.

---

## M7 — The loop closes

*Phase 4–5.* Outcomes accumulate and begin changing what the platform says.

**Verified by:** a transition estimate whose basis reads `observed, n=40` rather than `assumed from
resource durations`. Same surface, different provenance — that shift is the milestone.

---

## M8 — Interview prep where support exists

*Phase 5.* Process models above minimum support; honest generic prep below it.

**Verified by:** a company with thin reports produces "we don't have enough reports yet" plus useful
role-generic prep — never fabricated stages.

---

## M9 — Prediction with a track record

*Phase 6.* Scores calibrated against recorded outcomes.

**Verified by:** a published calibration comparison — of the matches we scored above 0.7, what share
resulted in an interview. Whatever that number is, it is reported.

Willingness to publish it is the milestone. A platform that will not check its own predictions is not
predicting.

---

## Sequencing rules

- **Finishing beats starting.** Two half-milestones deliver nothing; one whole slice delivers a product.
- M3 is a **gate**, not a feature: it validates the plugin claim before three more countries depend on it.
- M5 is blocked by an ADR, not by effort. Unblocking it is a decision, and it should be made early
  because it affects the schema.
- M7 and M9 are gated on **data accumulating**, so outcome capture ships in M1 even though nothing reads
  it until much later.

## Related

- `phases.md`, `mvp.md`, `backlog.md`
- `.claude/skills/roadmap/SKILL.md` — definition of done
