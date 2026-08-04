# ADR 0020: Structured knowledge lives in `packages/db`; `knowledge-engine/` is where it is curated

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** project lead
- **Affects:** `knowledge-engine/`, `packages/db`, `CLAUDE.md`, `docs/architecture/knowledge-engine.md`,
  `docs/roadmap/milestones.md`

## Context

Two current-state claims in this repository say the seeded skill graph lives in
`knowledge-engine/skills-graph`:

```text
CLAUDE.md:20                      Built column — "knowledge-engine/ — seeded skill graph only"
docs/roadmap/milestones.md:186    M1b vertical — "knowledge-engine/skills-graph (seeded, sourced edges only)"
```

It does not. `knowledge-engine/` was created on 2026-07-28 and holds **13 READMEs and zero
implementation files** — a number unchanged through M1a, M1b and M1c. `knowledge-engine/skills-graph/README.md`
still reads `_Structure placeholder — no implementation yet._`, which is honest.

The graph M1b actually shipped is:

```text
packages/db/seeds/cloud-platform-engineering.json   30 skills, 83 aliases, 34 sourced edges, 1 career
packages/db/seeds/README.md                         provenance, and why every row is tier 3
packages/db/src/seed.ts                             the idempotent loader, keyed on slug
packages/db/migrations/20260803100000-create-skill-graph.sql
packages/db/src/repositories/targets.ts             skillGraph(), careerRequirements()
```

`services/api-gateway/src/gap/gap.service.ts:91` reads both repositories and passes the result to
`ai/skill-gap`, which stores nothing. That path is tested, seeded, and running.

So the disagreement is not cosmetic. `docs/architecture/knowledge-engine.md` says the engine "is the
only place structured truth lives", and principle 1 in `CLAUDE.md` says AI services read from
`knowledge-engine/`. A skill graph with sourced edges is structured truth by any reading. Either the
architecture moved and the docs did not, or the implementation put knowledge in the wrong place and
nobody noticed for three milestones.

Fixing the two lines to say `packages/db` would make the documents true today and would silently
ratify whichever of those it is. That is the decision this ADR exists to make instead.

M2 is when it stops being cheap: outcomes, market-intel, immigration rules and interview reports all
land under the same substrate, and each one lands twice if this is settled afterward.

## Options

### A. Move the graph into `knowledge-engine/skills-graph`

Knowledge data and its loaders move out of `packages/db`; `packages/db` keeps only the schema and
the application tables.

**Pros.** Honours principle 1 and `docs/architecture/knowledge-engine.md` literally. Gives the
thirteen placeholder directories a filled first example to pattern-match against.

**Cons.** The knowledge still has to be *in PostgreSQL* to be queryable — `skillGraph()` is a SQL
query, and a gap request cannot read a JSON file per user. So this splits one concern across two
directories: the seed data in `knowledge-engine/`, the migration and repository in `packages/db`,
and a loader that reaches across the boundary `eslint.config.mjs` exists to enforce (ADR-0005). The
result is a rule violation with a comment explaining it, which is what ADR-0005 was written to
prevent.

### B. `knowledge-engine/` is a curation layer, not a storage layer

Structured knowledge is **stored** in `packages/db` — schema, seeds, repositories, all of it.
`knowledge-engine/` owns what turns raw sources into rows worth storing: ingest and reconciliation,
source-tier and conflict resolution, provenance, aggregation of outcomes. It reads and writes
through `packages/db` like everything else.

**Pros.** Matches what was built without inventing a justification for it — one concern, one
package, no cross-boundary loader. It also matches the line `knowledge-engine.md` already defends
("if it is a fact, it belongs here; if it is a judgment about facts, it belongs in `ai/`"): that line
is about *what* is knowledge, not *which directory the bytes sit in*. The thirteen placeholders keep
their purpose lines nearly unchanged — `ingest`, `outcomes/collectors`, `outcomes/aggregators` are
already curation, not storage.

**Cons.** Principle 1's wording ("AI services read from `knowledge-engine/`") becomes wrong as
written and must be amended: AI services read knowledge that `knowledge-engine/` curated, via the
gateway, from `packages/db`. Nothing lands in `knowledge-engine/` until M2, so it stays empty a while
longer with a sharper reason.

### C. Leave it and fix the two lines

**Pros.** Zero work.

**Cons.** The next person to open `knowledge-engine/skills-graph/` for M2 finds an empty directory
whose purpose line promises exactly the thing that already exists elsewhere, and either duplicates it
or moves it under time pressure. This is the same defect three consecutive audits have now found —
a document asserting a location that the tree does not have — and leaving it means finding it a
fourth time.

## Decision

**Option B.** Not because the architecture document was wrong, but because the distinction it draws
is between knowledge and judgment, and that distinction survives intact: facts live in
`packages/db`, judgments live in `ai/`, and `knowledge-engine/` is what earns a fact the right to be
stored — source tier, provenance, conflict resolution, reconciliation.

The deciding evidence is that Option A cannot be implemented without violating ADR-0005. A skill
graph that must be queried per request has to live in the database; putting its data in another
package means a loader that imports across a boundary the build fails on. When the layering rule and
the directory layout disagree, the layering rule is the one with a test.

## Consequences

- `CLAUDE.md`'s Built table stops claiming `knowledge-engine/`. The seeded graph is named where it
  is: `packages/db/seeds/` and four tables.
- Principle 1 is amended to say what it means: AI services reason over curated knowledge and do not
  invent facts. The path is `knowledge-engine/` curates → `packages/db` stores → gateway reads →
  `ai/` reasons.
- `docs/roadmap/milestones.md` M1b's vertical names the packages it actually used.
- `knowledge-engine/README.md` and `skills-graph/README.md` state that storage is `packages/db` and
  what remains theirs, so the next person does not fill in a directory twice.
- `docs/architecture/knowledge-engine.md` keeps its line about facts versus judgments — that line is
  unaffected — and gains the storage boundary.
- M2's outcome recording (ADR-0019) writes through `packages/db` and puts its collectors and
  aggregators under `knowledge-engine/outcomes/`, which is what those two placeholders already say.

**This does not license knowledge tables to skip provenance.** Every seeded row carries its source
tier today (`packages/db/seeds/README.md`), and storing knowledge next to application tables makes
that discipline easier to drop, not harder. The `source_tier` column is the guard, and it is
`NOT NULL`.

## Compliance

**The rejected option is already unbuildable, and that is the enforcement.**
`eslint.config.mjs`'s `boundaries/element-types` graph disallows `package → knowledge`
("packages/\* must not import from apps/, services/, connectors/, or knowledge-engine/ — ADR-0001").
A loader in `packages/db` reading seed data from `knowledge-engine/` — Option A's shape — fails
`pnpm lint`, which runs under the required `CI` check. The same graph permits `knowledge → package`,
so the accepted shape (curation writing through `packages/db`) passes. Reviewers do not have to
adjudicate this; the build does.

**What the build does not catch, and a reviewer must.** Nothing stops seed data being *added* under
`knowledge-engine/` with a loader that also lives there — that direction is legal. So the check on a
PR touching `knowledge-engine/` is: does this hold anything read on a request path? Schema,
migrations, seed rows, and repositories belong in `packages/db`. Ingest, reconciliation, source-tier
resolution, provenance, and outcome aggregation belong here.

**The provenance guard is a constraint, not a convention.** `source_tier` is `NOT NULL`, and
`tests/integration/db/seed.test.ts` asserts that every seeded skill and every graph edge is tier 3
`curated`. A knowledge row that overclaims its source fails CI rather than review.
