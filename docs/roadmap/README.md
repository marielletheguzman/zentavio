# Roadmap

> **Purpose:** Roadmap overview and how milestones are tracked.

## Documents

| Document | Read it when |
|---|---|
| [`vision.md`](vision.md) | any design decision — users, destinations, and the five-question design test |
| [`mvp.md`](mvp.md) | scoping the first slice, or arguing about what to cut |
| [`mvp-scope-options.md`](mvp-scope-options.md) | deciding the MVP feature scope and career track — awaiting approval |
| [`phases.md`](phases.md) | planning what comes next, and its entry/exit criteria |
| [`milestones.md`](milestones.md) | checking whether something is actually done |
| [`backlog.md`](backlog.md) | proposing an item, or looking for what was already rejected |

## The shape of the plan

```text
Phase 0  foundations, boundaries enforced by tooling          M0
Phase 1  "Can I work in Germany?"  — one origin, one          M1 · M2
         destination, one track, end to end
Phase 2  "Which of these four?"    — DE · LU · NZ · CH        M3 (gate) · M4
Phase 3  "Does my licence transfer?" — origin-side rules      M5
Phase 4  "What should I learn, verified?"                     M6 · M7
Phase 5  "What will they ask me?"                             M8
Phase 6  "Will this actually work?"  — prediction             M9
```

**Users:** professionals and students from the Philippines, and skilled workers planning international
careers. **Launch destinations:** Germany, Luxembourg, New Zealand, Switzerland. **Future:** Netherlands,
Ireland, Australia, Canada, Nordics. `REMOTE` is first-class throughout.

## How this roadmap is built

**Vertical slices, named after the user's question.** A phase delivers one complete answer through every
layer. Horizontal phases — "build the knowledge engine", then "build the AI layer" — produce nothing
demonstrable until the last one, and the last one always slips.

**Depth before breadth.** One country and one track answered completely beats ten answered vaguely. Country
five is cheap only because country one forced the design to be additive; adding countries before one works
produces ten shallow answers and a design that hardcodes the shallowness.

**No dates.** Sequencing is by dependency. A date on unbuilt work is a guess that becomes a commitment.

**Milestones are verified by someone who did not build them.** A user path that works, never a set of
merged pull requests.

## Cutting scope

When a phase is too big, cut in this order:

1. **Coverage** — fewer countries, tracks, or sources. One is a valid number.
2. **Automation** — manual or seeded ingest instead of a live connector, as long as provenance is real.
3. **Polish** — fewer surfaces, no charts.
4. **Depth of a secondary engine** — interview prep can be a stub while career reasoning is real.

**Never cut:** evidence · the unknown path · provenance · privacy and retention · honest recognition
handling · documentation of what shipped. The full argument is in
[`mvp.md`](mvp.md#not-cuttable-under-any-schedule-pressure).

If a phase cannot ship with those intact, the phase is too big. Cut coverage until it fits.

## Two gates worth knowing about

**M3 — adding Luxembourg must cost no service or AI code.** If that diff is larger than a reference file,
connector coverage, ingested rules, and a registry entry, then ADR-0002's central claim is false and the
design gets fixed before three more countries depend on it.

**M5 — regulated professions are blocked on a decision, not on effort.** The rule model cannot express
origin-imposed requirements, so nursing, engineering, and teaching must return `unknown` until the
origin-jurisdiction ADR is Accepted. That affects some of our largest user groups, so the decision should
be made early rather than when the schema is full.

## Current state

Phase 0 substantially complete: documentation, boundary enforcement, CI, the eval harness. **ADRs 0001–0009 and 0011 Accepted; 0010 reserved for the origin-side immigration rule model.** No
application code yet, and none of the newly accepted follow-up work is done — no test runner installed,
nothing instrumented, branch protection unconfigured.

**MVP settled: modified Option A · cloud / platform engineering · Germany** ([`mvp.md`](mvp.md)). Not a
regulated profession, so Phase 1 does not wait on origin-side recognition rules.

Phase 1 is now unblocked on decisions. What remains is implementation, and the ADR follow-up each decision
created.

Regulated professions — nursing, engineering, teaching — are Phase 3: ADR-0010 is Accepted so the schema
can express recognition, but no recognition rule is sourced yet.

## Related

- `.claude/skills/roadmap/SKILL.md` — the method and the definition of done
- `.claude/context/feature-philosophy.md` — whether an item belongs at all
- `docs/features/README.md` — the capability chain these phases build along
