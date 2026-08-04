# skills-graph

> **Purpose:** Skill taxonomy, aliases, relationships, and role-to-skill mappings.

_Structure placeholder — no implementation yet, and deliberately so._

**The skill graph already exists, elsewhere** (ADR-0020, Accepted — binding):

```text
packages/db/seeds/cloud-platform-engineering.json   30 skills, 83 aliases, 34 sourced edges, 1 career
packages/db/seeds/README.md                         provenance, and why every row is tier 3
packages/db/src/seed.ts                             the idempotent loader, keyed on slug
packages/db/migrations/20260803100000-create-skill-graph.sql
packages/db/src/repositories/targets.ts             skillGraph(), careerRequirements()
```

`services/api-gateway/src/gap/gap.service.ts` reads those repositories and passes the result to
`ai/skill-gap`. **Do not build a second graph here.** A graph traversed on every gap request belongs
in the database; a copy in this directory would be a second source of truth for the same edges, and
the two would disagree the first time one was updated.

What would legitimately land here is the *curation* of that graph — deriving edges from posting
co-occurrence, reconciling a new source against the seeded set, resolving conflicts by source tier.
None of that exists yet.

**This file said only `_Structure placeholder — no implementation yet._` until 2026-08-03**, while
`CLAUDE.md` and `docs/roadmap/milestones.md` both claimed the graph was built here. It was not, and
an audit found that pair of claims before ADR-0020 settled it.
