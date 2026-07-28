# Phases

> **Purpose:** Phase breakdown with entry/exit criteria.

Each phase is a **vertical slice** — one complete answer to one user question, through every layer. No
horizontal phases: "build the knowledge engine" produces nothing demonstrable and nothing learnable until
the last phase, and the last phase always slips
(`.claude/skills/roadmap/SKILL.md`).

Phases are named after the user's question, which keeps scope arguments anchored to something real.

---

## Phase 0 — Foundations

**Question:** none. Infrastructure only, and therefore kept as small as possible.

**Entry:** empty repository.

**Contents:** documentation and ADRs, boundary enforcement (`eslint.config.mjs`, `ruff.toml`), CI, the
eval harness, the monorepo skeleton.

**Exit:** CI green and blocking on `main`; every architectural boundary enforced by a tool rather than by
review; ADRs 0001–0006 Accepted.

**Status:** substantially complete. Outstanding: `ci` as a required check, project references, graded
evals in CI.

---

## Phase 1 — "Can I realistically work in Germany?"

**Question:** a Filipino professional in one track, asking about one destination.

**Entry:** Phase 0 exit met.

**Contents:** `mvp.md` in full — résumé parsing, one seeded track, weighted gap, learning path,
readiness, DE immigration rules tier-1 sourced, viability with the binding constraint named, one
dashboard, outcomes recorded.

**Exit:**
- a real user completes the path end to end
- every number carries reachable evidence and visible confidence
- missing knowledge returns `unknown` with what is needed
- docs match; invariant tests pass; outcomes recording

**Deliberately excluded:** the other three destinations, a second track, regulated professions, billing.

---

## Phase 2 — "Which of these four countries should I choose?"

**Question:** comparison across the launch set.

**Entry:** Phase 1 exit met, and — critically — **adding Luxembourg required no service or AI code
change.** If it did, Phase 1's design failed and the fix precedes Phase 2.

**Contents:** LU, NZ, CH rules ingested with the same tier-1 discipline; the comparison surface, each
cell with its own confidence; language reality per market; partial coverage rendered as `unknown` rather
than blank; `REMOTE` as a peer target.

**Exit:** four destinations answerable with a named binding constraint each; no country-specific branch
anywhere in `services/` or `ai/`; unsupported-market requests recorded.

---

## Phase 3 — "Does my licence transfer?"

**Question:** the regulated professions — nursing, engineering, teaching — which are among the largest
Philippines→Europe flows and are blocked until now.

**Entry:** the origin-jurisdiction ADR Accepted (`docs/architecture/immigration.md`), because the rule
model cannot express origin-imposed requirements before that.

**Contents:** `jurisdiction_role` or equivalent; origin-side rules ingested — overseas employment
regulation, licence recognition, credential evaluation, document authentication; evaluation gathering both
sides for one verdict; recognition named as the binding constraint where it is.

**Exit:** a regulated-profession user gets a real verdict rather than `unknown`; recognition and visa are
reported as distinct constraints; no path where a visa-only verdict reads as an answer.

**Why it is its own phase:** it is the difference between a useful product and a misleading one for a
large share of our users, and it is a schema change rather than content.

---

## Phase 4 — "What should I learn, verified?"

**Question:** closing the gap with evidence rather than claims.

**Entry:** Phase 1 exit; resource coverage for at least the tracks in play.

**Contents:** in-platform assessment; artifact-based verification; `claimed` → `evidenced` promotion only
on real verification; progress adjusting the remainder; re-estimation from observed pace.

**Exit:** a user can move a skill to `evidenced` and watch readiness change for a reason they can see.

---

## Phase 5 — "What will they ask me?"

**Question:** interview preparation, gated on data that must accumulate first.

**Entry:** enough interview reports for the minimum-support threshold in at least one market.

**Contents:** process models with counts and windows; rubrics from requirement facts; practice recorded
as outcomes; two separate confidences.

**Exit:** company-specific prep where support exists, honest role-generic prep where it does not, and
never fabricated specificity.

---

## Phase 6 — "Will this actually work?"

**Question:** prediction, which is only honest once outcomes exist.

**Entry:** outcome volume sufficient for a calibration check on at least one track and market.

**Contents:** calibration of scores against recorded outcomes; observed transition frequencies replacing
assumed adjacency; time-to-competence from observation; honest confidence bounds.

**Exit:** an answer with a track record behind it — the point at which "what should I do next?" stops
being an assessment and becomes a forecast.

---

## Phase entry/exit rules

- **A phase that cannot be demoed is not a phase.**
- Exit criteria are verifiable by someone who did not build it. Merged PRs are not exit criteria.
- The **non-cuttable list** (`mvp.md`) applies to every phase, not just the MVP.
- Scope pressure is absorbed by cutting **coverage** — fewer tracks, fewer sources, manual ingest —
  never evidence, unknown paths, provenance, privacy, or docs.
- Breadth work is only allowed inside a phase when it is **additive by construction**: a reference file,
  connector coverage, ingested facts, a registry entry, and zero code changes.

## Later, unscheduled

Employer-side market intelligence (aggregates only, never individual data) · billing · mobile ·
the future destination set (NL, IE, AU, CA, Nordics). Each needs its own phase definition and, where it
touches a boundary, its own ADR.

## Related

- `mvp.md`, `milestones.md`, `backlog.md`, `vision.md`
- `.claude/skills/roadmap/SKILL.md`
