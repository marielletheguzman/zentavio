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

**Both halves verified, 2026-07-31.**

*A red CI run cannot merge.* A branch with a deliberate type error was refused with
`HTTP 405: Required status check "CI" is failing.` while a green pull request read `CLEAN`. See ADR-0011's
Correction section.

*A deliberate cross-layer import fails the build with the ADR it breaks.* Three probes were written, run,
and deleted:

| Probe | Result |
|---|---|
| `packages/types` imports `@zentavio/config` | rejected — "packages/types is the innermost layer…" |
| `packages/config` imports `services/api-gateway` | rejected — "…A shared library that knows its consumers is not shared — ADR-0001" |
| `process.env` read inside `packages/db` | rejected — "Read configuration through packages/config…" |

The test found one defect, now fixed: the `package-types` message was the only `disallow` message in
`eslint.config.mjs` that named no ADR, so that violation failed the build without saying which decision it
broke — which is the criterion, not merely failing.

**Outstanding:** TypeScript project references, and graded evals in CI (deferred deliberately by ADR-0009,
so it does not gate Phase 0 exit).

---

## M1 — One honest answer exists

*Phase 1, first half.* A Filipino professional uploads a résumé and receives a readiness number for one
track with its remainder and its evidence.

**Verified by:** a real user reads the number, opens the evidence, disagrees with one extracted skill,
corrects it, and watches the number change for a reason they can see.

The correction path is part of the milestone, not a follow-up: a profile a user cannot fix is a profile
they will not trust.

### M1 in three slices

M1 is too large to build in one go and too easy to build in the wrong order. The split below is by
**user question**, never by layer — "build the parser, then the graph, then the scorer" would produce
nothing demonstrable until the end, and the end always slips (`.claude/skills/roadmap/SKILL.md`).

Each slice is demoable on its own, and each carries the full non-cuttable list at its own scale:
evidence, an honest `unknown`, provenance, privacy, and docs.

Chain position, from `docs/features/README.md`: **résumé → profile → skill gap → readiness.** The slices
follow that order because each genuinely needs the one before it.

---

#### M1a — "What does the system think about me?"

*The profile exists, and the user can fix it.*

Résumé (PDF/DOCX) → parsed profile → skills marked **evidenced** or **claimed**, each with the source
span it came from → the user disagrees with one, corrects it, and the correction sticks.

No score yet. That is the point: a profile is useful on its own, and a score built on a profile nobody has
checked is a confident wrong answer.

**Vertical:** `ai/resume-parser` · `packages/db` (profile, skills, corrections) · `services/api-gateway` ·
`apps/web` upload and profile surface.

**Progress (2026-08-01): steps 1–11 are built, and the stack was run end to end for real** — three
processes, a real PDF over HTTP, into PostgreSQL:

```text
POST /v1/resume/upload  →  200 {"stored":true,"version":1}
   kubernetes  evidenced  "Led a Kubernetes migration across 40 services"
   terraform   evidenced  "Wrote Go services and Terraform modules"
   go          evidenced  "Wrote Go services and Terraform modules"
scan.pdf       →  200 {"stored":false,"status":"unknown"}  and v1 survived
wrong type     →  400 VALIDATION_FAILED with a correlation id
```

**The correction path is now reachable by a person** (2026-08-01). `POST /v1/resume/corrections`
plus a control that sits **inside the evidence disclosure**, next to the sentence the claim came
from — disagreeing is only possible once you can see what the claim was based on, and putting the
two apart is how a correction path exists and never gets used.

Verified over HTTP against the running stack:

```text
upload                    → v1  terraform = evidenced (parser)
POST /v1/resume/corrections → v2  terraform = claimed   (self-reported)
v1 in the database         → still evidenced, byte-identical
unknown slug               → 400 "Unknown skill: not-a-real-skill"
bad payload                → 400 with field-level details
```

The route is keyed by **slug, not skill id**: the browser has no business holding database UUIDs,
and an unknown slug becomes a 400 naming it rather than a foreign key violation surfacing as a 500.

**Outcome recording is blocked on a schema question, found 2026-08-01.** `outcomes.kind` is a closed
set of application-lifecycle events — `applied`, `screened`, `interviewed`, `offered`, `rejected`,
`withdrawn`, `accepted`, `started`, `relocated`, `course_completed`, `assessment_passed`
(`docs/database/entities/outcome.md`). **None of them describes "a profile was created."** Forcing an
upload into one of these would corrupt the calibration data the table exists for — a `kind` that
means two different things cannot be aggregated.

The `outcomes` table also has foreign keys to `applications` and `companies`, neither of which
exists, so it cannot be migrated as documented yet.

**Resolved by ADR-0019 (Accepted 2026-08-03): outcome recording begins at M2.** M1a records none,
and that is now a decision rather than a gap. The original wording is kept below because it is the
reasoning the ADR was written against.

Resolving it
needs a decision: add a profile-lifecycle `kind`, add a separate table for profile events, or accept
that outcomes begin at M2 when there is an application to attach them to. Erasure — the other half of
this step — **is** implemented, because it could not wait: retrofitted privacy is a breach already
shipped.

**Done when:** an unparseable or image-only résumé returns an honest failure naming what is wrong rather
than an empty profile; every extracted skill shows its source span; a correction persists and is
attributed to the user rather than overwriting the parser's claim; retention and deletion for résumés
work **in this slice**, because this is where résumés first exist and retrofitted privacy is a breach
already shipped. **Outcome recording is not wired here** — ADR-0019 moves it to M2, where
`applications` exist to attach it to.

**Cuttable:** DOCX (PDF alone is a real answer), role/employer extraction beyond titles, any styling.
**Not cuttable:** source spans, the evidenced/claimed distinction, the correction path, retention.

**The authorization hole is closed; the mechanism is still open** (2026-08-01). `userId` used to
arrive in the request body, so any caller could read and correct any person's profile. It is gone
from every DTO: the subject now comes from `@CurrentSubject()`, established by a **global** guard —
deny by default, because opting a route *in* to protection is a list someone forgets, and the route
they forget is the one that leaks.

Verified by attempting the attack against the running gateway:

```text
no credential                        → 401 UNAUTHENTICATED
naming another user in the body      → 400 "property userId should not exist"
acting on your own profile           → 200, v3
victim's profile after the attempt   → untouched at v2
NODE_ENV=production + dev flag on    → 401, the flag is ignored
```

**ADR-0017 is Accepted: a hosted OIDC provider, verified generically.** The issuer, audience, and
JWKS endpoint are configuration, so Clerk, WorkOS, Auth0, or a self-hosted Keycloak are three
environment variables rather than a code change. Tokens are checked for signature, algorithm,
issuer, audience, and expiry; users are provisioned just-in-time on first valid token.

**What is left is provisioning a provider account** — `ZENTAVIO_OIDC_ISSUER` and
`ZENTAVIO_OIDC_AUDIENCE`. Until they are set the gateway falls back to deny-by-default, or to the
loudly-named `ZENTAVIO_INSECURE_DEV_AUTH` header, which is refused outright in production. Real
authentication wins whenever it is configured, so leaving the dev flag set cannot downgrade a
properly-configured environment.

**One behaviour worth knowing:** a person who erases their account and signs in again becomes a
**new** account with no data. Erasure clears `auth_subject`, so the tombstone cannot be matched —
deliberately, because refusing them forever would be a ban rather than an erasure.

**Two schema dependencies were found while planning M1a**, and they change the M1a/M1b boundary:

- `profile_skills.skill_id` references `skills(id)`, and the parser resolves phrases against a
  **closed set** of slugs. So the skill entity splits **by table, not by milestone**: M1a takes
  `skills` and `skill_aliases` (the closed set and its resolution), M1b takes `skill_edges` and
  `career_skills` (the graph and the target). M1a stays self-contained.
- `careers` was referenced by `user.md`, `skill.md`, and `outcome.md` and **defined by none**.
  Written as `docs/database/entities/career.md` before any migration touched it.

---

#### M1b — "How far am I from cloud / platform engineering?"

*The gap exists, and it is honest about what it does not know.*

Profile → seeded skill graph for the one track → weighted, dependency-ordered gap → each missing skill
shows why it is required and how far it sits from what the user already has.

**Vertical:** `packages/db/seeds/` (seeded, sourced edges only) and the `skills` · `skill_aliases` ·
`skill_edges` · `career_skills` tables · `ai/skill-gap` · `apps/web` gap surface.

*This line named `knowledge-engine/skills-graph` until 2026-08-03. It was never built there, and
ADR-0020 settles why: the graph is queried per request, so it lives in the database.*

**Done when:** a skill the graph does not cover returns `unknown` naming what is missing, never a zero;
every `requires` edge carries its source; the ordering is dependency-driven and reproducible — the same
profile and graph produce the same gap, asserted by a determinism test.

**Cuttable:** learning paths (`mvp.md` already names them first to cut — a gap without a plan is still a
useful answer), breadth of the seeded graph, any second track.
**Not cuttable:** sourced edges, the `unknown` path, determinism.

---

#### M1c — "Am I ready, and why that number?"

*The number exists, carries its remainder, and moves for a reason the user can see.*

Gap → readiness score + remainder + the evidence bundle that produced it → the correction from M1a
changes the number, and the change is explainable.

This slice is what M1's stated verification actually tests. It is small **only because M1a and M1b did
their work honestly** — which is the argument for this ordering.

**Vertical:** `ai/skill-gap` scoring · the evidence bundle contract in `packages/types` · `apps/web`
readiness surface with evidence disclosure.

**Done when:** every number is traceable to the evidence that produced it, reachable in the UI; confidence
is visible, not implied; a profile too sparse to score returns `unknown` with the one input that would
resolve it, rather than a low number; the full path — upload, correct, watch it change — works for a real
user.

**Cuttable:** comparison against `REMOTE`, charts, multiple score presentations.
**Not cuttable:** the evidence bundle, visible confidence, the `unknown` path, the correction loop.

---

**Why this order and not another.** Each slice makes the next one's answer more honest rather than merely
possible. Building the scorer first would mean scoring a profile nobody had checked; building the graph
first would mean a gap against skills the system had not confirmed the user has. The prioritization rule
is to finish a vertical, then deepen it — not to start three (`.claude/skills/roadmap/SKILL.md`).

---

## M2 — Germany is answerable

**Status: Met** (2026-08-11).

*Phase 1 complete.* DE pathway rules ingested from tier-1 sources, dated and versioned; per-rule
eligibility; viability with the binding constraint named.

**Verified by:** a user with an incomplete profile gets `undetermined` plus the one input that would
resolve it — and supplying it produces a definite answer.

That is the milestone's real test. A product that only works on complete profiles does not work.

**The verification passed in a browser on 2026-08-04** (`90dae86`, PR #68). `/eligibility` returned
`undetermined` naming `expected_gross_annual_salary_eur`; entering 60 000 and re-checking returned
`met` with the basis *"60000 against a threshold of at least 50700"*, the deciding authority, the
effective date, and a link to the source. CORS worked — which only a browser can prove, and which
M1c shipped without while every server-side check passed.

The path is real end to end: `BAnz AT 18.12.2025 B3` → `connectors/immigration-data/de-bundesanzeiger`
→ `planIngest` → `executePlan` → `requirements` → gateway → `ai/career-roadmap` → browser.

**The verification was re-run against the current rule set on 2026-08-11**, and it is a different
test now than it was on 2026-08-04: § 18g is modelled as three routes rather than two salary
thresholds. With no relevant facts answered, **all three routes returned `undetermined`, each
naming its own unanswered question** — `abs1-s2` asking when the degree was awarded, `abs2` asking
for experience in the last seven years. Supplying the facts produced a definite **`met` through
`abs2`**: the route that admits an ICT professional with no degree at all.

### Completed

Each of these was outstanding when this milestone was written and is now implemented:

- **Viability** — PR #75
- **§ 18g beyond the two salary thresholds** — PR #89
- **Typed person-fact controls** — PR #90
- **Outcome recording** — PR #91
- **Archived provenance** — built and enforced

What each one is, and the reasoning worth keeping:

- **Viability** (`f60f821`, PR #75). `ai/career-roadmap/viability.py` pairs the two
  axes and names the binding constraint; the gateway serves `GET /v1/viability` computing both
  halves in one call; `/eligibility` leads with the binding constraint rather than the eligibility
  status. Visa-eligible and unemployable at the threshold salary is caught — it renders as *"You
  qualify — the gap is readiness, not the rules"*. **No composite score**, per ADR-0022. *This
  bullet said only eligibility was built until 2026-08-11; the code landed on 2026-08-05 and the
  milestone was never updated.*
- **§ 18g beyond the two salary thresholds** (ADR-0024, PR #89). The statute is
  on file through `connectors/immigration-data/de-aufenthg`: the six-month employment duration
  (Abs. 3), the academic qualification (Abs. 1 S. 1, widened by S. 5), both gates on the reduced
  route (Abs. 1 S. 2 Nr. 1's ISCO-08 groups and Nr. 2's three-year graduate window), and the
  experience route (Abs. 2 — its own two ISCO-08 groups and three years' experience within seven).
  Three routes are evaluated, `abs1-s1` · `abs1-s2` · `abs2`, per ADR-0024.

  **Coverage is every requirement *ingested*, not every statutory requirement.** Still not on file:
  § 19f's rejection grounds, whose substance is on another provision; the Bundesagentur für Arbeit's
  consent, recorded as a note because nobody can answer it in advance; and the dependent, residence
  and job-change provisions, which are not eligibility. So "every rule we checked" remains a claim
  about what is ingested, not about § 18g entire — which is a scoping statement, not an unmet
  requirement. The country model is in
  `.claude/skills/immigration/references/countries/de.md`.
- **Outcome recording** (ADR-0019, PR #91). `packages/db/src/repositories/applications.ts`
  records an application with **what was predicted at that moment** and records outcomes against
  it; the gateway serves `POST /v1/applications`, `GET /v1/applications` and
  `POST /v1/applications/:id/outcomes`; `apps/web/app/applications` is the one-tap surface. The
  prediction is captured when the person acts rather than when the result arrives, because a score
  recorded late has already moved — that is ADR-0019's argument and the reason the column exists.
  Erasure detaches the outcome and deletes the application, asserted against rows the real write
  path produced.

  **What this does not yet do is read the data.** `CLAIMED_CREDIT` stays an assumption until enough
  outcomes accumulate to observe the rate, exactly as ADR-0019 says. A calibration reader with zero
  rows could only answer "not enough data yet", which is why it is not built here.
- **Archived provenance** (ADR-0021, phases 2–6). Every stored requirement cites an archived
  original; `unarchivedRequirements()` returns empty; a rule whose source could not be archived is
  **rejected** by `services/ingestion`, asserted against real MinIO in
  `tests/integration/db/ingestion-archival.test.ts`. *This was listed as unbuilt until 2026-08-11;
  it landed on 2026-08-05.* The production bucket is a deployment prerequisite and is recorded
  below rather than here.
- **Typed person-fact controls** (PR #90). An answer is validated against its catalogue
  `value_type` at the write boundary, so a `needsFromUser` question cannot be answered with a value
  the evaluator will misread. Found by a browser check: answering *"no"* to the degree question
  stored the string `'no'`, which read as `true` and reported the qualification rule **met** for
  somebody who had just said the opposite. M2's own verification statement depends on this — "the
  one input that would resolve it" is only true if supplying that input resolves it *correctly*.

### Verification limitations

**Two surfaces merged without a browser check**, and neither is claimed as browser-verified: the
`/eligibility` typed-control surface (PR #90) and `/applications` (PR #91). The browser extension
was unavailable for the rest of that session and did not reconnect across a restart. Their logic is
pure and unit-tested, and the write path behind #90 was exercised over HTTP.

These are **verification limitations, not outstanding milestone requirements**. Recorded because
this repository has been caught by exactly this gap before — the gateway shipped with no CORS at all
through the whole of M1c while every server-side check passed — so the next session should load both
pages rather than assume them.

**Outcome data is recorded and not yet read**, and that is deliberate rather than unfinished.
ADR-0019: a calibration reader with zero rows can only answer "not enough data yet", so
`CLAIMED_CREDIT` stays a stated assumption until enough outcomes accumulate to observe the rate.
Consumption is not an M2 requirement.

### Deployment prerequisite

**Cloudflare R2 is not provisioned** (ADR-0021). Archival is implemented and enforced against MinIO
locally and in CI, so this is **not an M2 completion requirement** — but production storage does not
exist, and nothing here should be read as deployment readiness.

```text
M2 milestone          → MET
Production deployment → still requires R2 provisioning
```

---

## M3 — Adding a country costs no code

*Phase 2 entry gate.* Luxembourg is added.

**Verified by:** the diff touches a reference file, connector coverage, ingested rules, and a registry
entry. **Nothing in `services/` or `ai/`.**

If the diff is larger, ADR-0002's central claim is false and the design is fixed before NZ and CH follow.
This is the cheapest possible moment to discover that.

**Germany's reference file exists as of 2026-08-11** (`.claude/skills/immigration/references/
countries/de.md`), which is what makes this milestone measurable: Luxembourg's diff can be compared
against a real one rather than against an idea of one. Note what Germany's own history says about
the claim being tested — § 18g needed **ADR-0024 and a change to `ai/career-roadmap`** before its
Abs. 2 route could be expressed at all. That was a genuine gap in the model rather than a country
detail, and the honest reading is that the first country to need a new *shape* of rule will always
cost code. Luxembourg tests whether a country needing no new shape costs none.

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
- M7 and M9 are gated on **data accumulating**, so outcome capture ships as early as it can hold —
  **M2**, not M1 (ADR-0019). Calibration data cannot be backfilled, so the window opens the moment
  the first prediction has a checkable result, which is an application.

## Related

- `phases.md`, `mvp.md`, `backlog.md`
- `.claude/skills/roadmap/SKILL.md` — definition of done
