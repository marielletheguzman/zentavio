# AI Skills

> **Purpose:** Catalog every project-specific Claude Skill — what it governs, when it loads,
> what it depends on, and which documents it treats as source of truth.

Skills live in `.claude/skills/<name>/SKILL.md`. Claude loads only the skills relevant to the
current task, matched from each skill's `description` frontmatter. **Never restate a skill's
rules inside a prompt** — reference the skill.

## The three layers

| Layer | Answers | Lives in |
|---|---|---|
| **Context** | What is true about Zentavio always? | `.claude/context/` |
| **Skills** | How do I do this kind of work correctly? | `.claude/skills/` |
| **Templates** | What is the canonical skeleton? | `.claude/templates/` |

Context is always relevant; skills are task-scoped. See `.claude/context/README.md`.

## Catalog

| Skill | Kind | Governs |
|---|---|---|
| [architecture](#architecture) | engineering | layering, boundaries, dependency direction, ADRs |
| [backend-service](#backend-service) | engineering | `services/*` internals, error taxonomy, config, health |
| [frontend](#frontend) | engineering | `apps/*`, `packages/ui`, server/client split, states, a11y |
| [database](#database) | engineering | schema, naming, migrations, indexes, versioning |
| [connectors](#connectors) | engineering | the plugin contract, retries, dedup keys |
| [testing](#testing) | engineering | test levels, golden files, invariant tests, evals |
| [documentation](#documentation) | engineering | `docs/`, purpose lines, ADRs, doc-code alignment |
| [prompt-engineering](#prompt-engineering) | engineering | prompt structure, schemas, versioning, evals |
| [roadmap](#roadmap) | engineering | vertical-slice phasing, scope cuts, backlog |
| [knowledge-engine](#knowledge-engine) | domain | facts, provenance, versioning, graphs, reconciliation |
| [ai-matching](#ai-matching) | domain | scores, evidence bundles, calibration |
| [career-intelligence](#career-intelligence) | domain | transitions, readiness, transferability, viability |
| [job-aggregation](#job-aggregation) | domain | ingestion runs, validation, freshness, reliability |
| [learning-paths](#learning-paths) | domain | ordered gap closure, real resources, honest timelines |
| [interviews](#interviews) | domain | interview process models, practice, readiness |
| [recommendations](#recommendations) | domain | ranking by expected value, notification triggers |
| [immigration](#immigration) | domain | tier-1 rules, pathways, eligibility, disclaimers |

---

## Engineering skills

### architecture

**Purpose** — keep the dependency direction correct for the lifetime of the project.

**Responsibilities** — place each capability in exactly one layer; reject reversed imports and
propose the inversion; keep `services/ingestion` source-agnostic; keep `ai/` stateless; define
the TypeScript↔Python contract; require an ADR for any new dependency.

**Loads when** — creating or moving modules, adding a service, wiring cross-package
dependencies, designing cross-service communication, touching `infra/`, writing an ADR, or any
change that crosses a directory boundary.

**Depends on** — `docs/architecture/overview.md`, `principles.md`, `system-diagram.md`,
`data-flow.md`, `docs/architecture/decisions/`, `docs/development/conventions.md`.
Loads alongside `backend-service`, `connectors`, `database`, `knowledge-engine`.

**Example** — `ai/skill-gap` importing a repository from `services/matching` is rejected; the
inversion is a port in `ai/shared/ports` with an adapter injected from the service.

---

### backend-service

**Purpose** — make every service in `services/` identical from the outside: same error shape,
config source, log fields, health probes, DTO discipline.

**Responsibilities** — validate every inbound payload before it reaches a use case; return the
shared error envelope; read config only through `packages/config`; log with a correlation id;
expose real liveness and readiness; keep controllers logic-free and use cases HTTP-free;
version every route and event.

**Loads when** — creating or editing anything in `services/*`, adding a controller, route, or
event handler, wiring a repository, or adding a config value or health probe.

**Depends on** — `docs/development/conventions.md`, `docs/architecture/overview.md`,
`packages/config`, `packages/logger`, `packages/events`, `packages/types`.

**Example** — the error taxonomy table: eight codes, each with its HTTP status and a
`retryable` flag that is part of the contract, not a hint.

---

### frontend

**Purpose** — keep the explainability claim intact in the UI, and the server/client boundary
sane.

**Responsibilities** — fetch only through `services/api-gateway`; render loading, empty, error,
and success for every async surface; render evidence beside every score; meet WCAG 2.1 AA;
route all copy through `packages/i18n`; support both themes from one token set.

**Loads when** — editing `apps/web`, `apps/admin`, `apps/mobile`, or `packages/ui`, adding a
page, route, or component, or wiring a UI to an API.

**Depends on** — `.claude/context/ui-guidelines.md`, `docs/features/*`, `packages/ui`,
`packages/types`, `packages/i18n`. Related: `dataviz` skill for any chart.

**Example** — a page-level `'use client'` with an untyped `fetch` and a clickable `div` is
replaced by a Server Component with `loading.tsx`, `error.tsx`, and an evidence disclosure.

---

### database

**Purpose** — one naming, keying, and temporal convention that outlives every service reading
it.

**Responsibilities** — name every object per the convention table; declare every FK with an
explicit `ON DELETE`; ship the index with the query; soft-delete user-removable rows; version
knowledge rows instead of mutating them; store provenance on every derived row; keep migrations
safe under live deployment.

**Loads when** — adding or altering a table, writing a migration in `packages/db`, designing a
relationship, adding an index, editing `docs/database/*`, or diagnosing a slow query.

**Depends on** — `docs/database/schema-overview.md`, `entities/*`, `relationships.md`,
`migrations.md`, `data-retention.md`, `vector-store.md`.

**Example** — `matches` with `evidence jsonb NOT NULL`, `scorer_version`, `ON DELETE RESTRICT`,
and partial indexes on `deleted_at IS NULL`.

---

### connectors

**Purpose** — make adding a data source additive: one folder, one registry line.

**Responsibilities** — keep `normalize` pure and total; emit a stable dedup key; honor rate
limits and back off with jitter; classify failures as retryable or terminal; register in the
registry; record full provenance; respect terms of service.

**Loads when** — adding or editing anything under `connectors/`, adding a source of any kind,
debugging an ingestion failure, or when tempted to put source logic in `services/ingestion`.

**Depends on** — `docs/architecture/connectors.md`, `docs/development/connector-guide.md`,
`.claude/templates/connector.template.md`, ADR-0002, `packages/types`.

**Example** — a `normalize` that defaults `salaryMin` to 60000 and calls the database is
rewritten pure, with absent fields staying `null`.

---

### testing

**Purpose** — enforce by test the properties reviews miss: determinism, evidence completeness,
provenance, unknown paths.

**Responsibilities** — put each test at the cheapest level that can catch the bug; golden-file
every connector `normalize`; assert exact scores and reconciling evidence; run prompt evals as a
gate; keep fixtures synthetic; treat flakes as failures.

**Loads when** — writing or changing tests, adding a fixture, testing a connector, score, or
prompt, when a test is flaky, or when deciding which level a test belongs at.

**Depends on** — `docs/development/testing.md`, `docs/prompts/evals.md`, `tests/fixtures/`.

**Example** — a score test asserting `toBe(0.72)`, that evidence weights sum to the score, and
that a second identical call returns an identical object.

---

### documentation

**Purpose** — keep `docs/` the source of truth, and keep each fact in exactly one place.

**Responsibilities** — honor the purpose line as a binding contract; write the doc before the
code and reconcile after; put each document in its one correct home; author ADRs with real
alternatives; mark placeholders; never document a fact twice.

**Loads when** — creating or editing anything under `docs/`, filling in a placeholder, writing
an ADR or README, or when a change alters documented behavior.

**Depends on** — `docs/README.md`, `docs/development/contributing.md`,
`.claude/templates/doc.template.md`, `.claude/templates/ADR.template.md`.

**Example** — a doc opening with `> **Purpose:**`, leading with the JSON shape, stating the
unknown path, and linking rather than restating the glossary.

---

### prompt-engineering

**Purpose** — treat prompts as versioned, typed, tested production code.

**Responsibilities** — retrieval-first structure with knowledge before input; a JSON schema and
validation for every prompt; an explicit unknown representation per field; versioned prompt
files recorded with their outputs; injection-resistant delimiting; an eval run for every change.

**Loads when** — writing or changing anything under `docs/prompts/` or a prompt inside `ai/`,
adding a field to an AI output, debugging hallucination, or adding an eval.

**Depends on** — `.claude/context/ai-principles.md`, `docs/prompts/conventions.md`,
`docs/prompts/evals.md`, `.claude/templates/prompt.template.md`.

**Example** — a skill-extraction prompt given a closed `known_skills` set, returning
`EVIDENCED`/`CLAIMED` plus a verbatim source span, with `unmatched` for anything unrecognized.

---

### roadmap

**Purpose** — sequence work as vertical slices, and protect the parts of quality that cannot be
retrofitted.

**Responsibilities** — phase by user question, not by layer; apply the six-point definition of
done; cut coverage before quality; never cut evidence, unknown paths, provenance, privacy, or
docs; tie every backlog item to a question and a chain position; finish what is started.

**Loads when** — editing `docs/roadmap/*`, planning a phase or milestone, prioritizing the
backlog, defining or cutting MVP scope, or deciding what to build next.

**Depends on** — `docs/roadmap/vision.md`, `phases.md`, `mvp.md`, `milestones.md`,
`backlog.md`, `.claude/context/feature-philosophy.md`.

**Example** — "Phase 2: Am I ready for cloud engineering in Germany?" — one track, one country,
end to end, with an explicit cuttable/not-cuttable list.

---

## Domain skills

### knowledge-engine

**Purpose** — hold all structured truth, with provenance and version history, so every claim is
traceable.

**Responsibilities** — store no fact without full provenance; version rather than mutate; keep
tier-5 generated values out of fact tables; resolve entities through registries; return
`unknown` rather than a plausible value; expose facts to `ai/` with provenance attached; keep
embeddings derived and rebuildable; record outcomes.

**Loads when** — adding or querying facts in `knowledge-engine/`, designing graph edges,
reconciling duplicates, writing an ingest step, deciding fact vs judgment, or embedding
anything.

**Depends on** — `docs/architecture/knowledge-engine.md`, `docs/database/entities/*`,
`docs/database/vector-store.md`, `.claude/context/knowledge-sources.md`, ADR-0004.

**Example** — LLM-generated skill edges with invented weights are replaced by posting
co-occurrence edges carrying `basis`, `support`, and `computeVersion`.

---

### ai-matching

**Purpose** — define how a Zentavio score is computed, what it carries, and how it stays honest.

**Responsibilities** — keep the six scores distinct; emit score + confidence + evidence +
versions; compute the number in code, never in the model; weight requirements from knowledge,
not constants; apply constraints by name; degrade confidence to the weakest input; calibrate
against outcomes.

**Loads when** — working in `ai/resume-parser`, `ai/skill-gap`, `ai/embeddings`, or the scoring
paths in `services/matching`; defining or changing a score; ranking anything.

**Depends on** — `docs/GLOSSARY.md` (score definitions), `docs/features/job-matching.md`,
`skill-gap-analysis.md`, `resume-parsing.md`, `.claude/context/ai-principles.md`.

**Example** — the output contract: evidence entries whose weights reconcile to the score, plus
`scorerVersion`, `promptVersion`, `knowledgeAsOf`.

---

### career-intelligence

**Purpose** — reason about where a person can realistically go from where they are.

**Responsibilities** — answer with a verdict, a remainder, and a cost; compute transferability
from skill-graph edges; order gaps by dependency; give honest ranged timelines; name the binding
constraint; prefer observed transition paths; never score on a protected attribute or prestige
proxy.

**Loads when** — working in `ai/career-roadmap`, modeling a career or transition, computing
readiness or transferability, traversing the career graph, or adding a track under
`references/careers/`.

**Depends on** — `.claude/context/career-philosophy.md`, `references/careers/<track>.md`,
`docs/features/skill-gap-analysis.md`, `docs/features/country-preferences.md`.

**Example** — readiness 0.61 with `remaining` (weighted, with time-to-competence ranges),
`estimatedTimeToReady` as a range, and `bindingConstraint`.

---

### job-aggregation

**Purpose** — keep the knowledge engine fed at scale without letting one source degrade the
platform.

**Responsibilities** — iterate the registry, never name a source; persist cursors for resumable
idempotent runs; route every record to accept/flag/quarantine with a reason; group by dedup key;
expire honestly and distinguish our failures from the source's; observe reliability; break
circuits per source.

**Loads when** — working in `services/ingestion`, scheduling connector runs, debugging duplicate
or stale postings, tuning validation, or tracking reliability.

**Depends on** — `docs/features/job-aggregation.md`, `docs/architecture/connectors.md`,
`docs/database/entities/connector-source.md`, ADR-0002.

**Example** — a run loop that skips open breakers, rate-limits per source, quarantines rejects
with reasons, saves cursors per page, then hands reconciliation to the knowledge engine.

---

### learning-paths

**Purpose** — turn a weighted gap into an ordered, resourced, honestly-timed plan.

**Responsibilities** — order steps by prerequisites then by weight; tie every step to a gap
item; attach only ingested resources or state their absence; give ranged effort and elapsed
estimates with assumptions; declare verification per step; recompute on change.

**Loads when** — working in `ai/learning-paths` or `connectors/learning-resources`, generating a
plan from a gap, estimating time to competence, or answering "what should I learn?".

**Depends on** — `docs/features/learning-paths.md`,
`docs/database/entities/learning-resource.md`, the skill graph's `requires` edges.

**Example** — Docker before Kubernetes because the graph says so; effort `25–45h` with its
basis; `resources: []` plus a note when nothing is ingested.

---

### interviews

**Purpose** — prepare people for a specific process using aggregated experiential data, handled
at its true confidence.

**Responsibilities** — aggregate reports and enforce minimum support; attach `n`, window, and
confidence to every pattern; prefer an officially published process; label generated practice as
generated; build rubrics from requirement facts; record practice outcomes; report process
confidence separately from person readiness.

**Loads when** — working in `ai/interview-prep` or `knowledge-engine/interview-reports`,
modeling a company's process, generating practice questions, or scoring interview readiness.

**Depends on** — `docs/features/interview-prep.md`,
`.claude/context/knowledge-sources.md` (tier 4 handling).

**Example** — "12 of 15 reports (last 18 months) describe a system-design round at stage 3",
never "this company asks system design".

---

### recommendations

**Purpose** — decide what to suggest, in what order, and when it is worth interrupting someone.

**Responsibilities** — emit action + reason + expected effect; rank by expected value with every
factor in the evidence; name every constraint; enforce diversity and horizon mix without
padding; notify only on real triggers; capture reasoned feedback; keep commercial interest out of
the ordering.

**Loads when** — building any ranked list, dashboard surface, suggestion, digest, or
notification, or deciding what a user sees next.

**Depends on** — `docs/features/notifications.md`, `docs/features/outcomes-learning.md`,
`.claude/context/business.md`, `.claude/context/ui-guidelines.md`.

**Example** — "Learn Terraform · 25–45h · largest remaining gap (weight 0.14), required in 71%
of DE postings (n=340) · readiness 0.61 → ~0.75".

---

### immigration

**Purpose** — make a wrong or stale immigration answer structurally impossible.

**Responsibilities** — source every rule from tier 1 with URL and date; version rules, never
overwrite; return `undetermined` with the missing input; attach the disclaimer and `asOf` to
every output; keep evaluation deterministic; track refresh windows and flag stale rules; emit an
event when a depended-on rule changes.

**Loads when** — working in `knowledge-engine/immigration`, `connectors/immigration-data`, any
`ai/` eligibility path, adding or updating a country's rules, or answering anything about visas,
permits, residence, or citizenship.

**Depends on** — `docs/architecture/immigration.md`,
`docs/database/entities/immigration-rule.md`, `docs/features/immigration-tracking.md`,
`.claude/context/countries.md`, `references/countries/<code>.md`.

**Example** — per-rule results (`met` / `not_met` / `undetermined`) with `sourceUrl` and
`effectiveFrom`, `needsFromUser` for missing inputs, and no advice framing anywhere.

---

## Reference libraries

Domain skills carry on-demand references. **Load the specific file, not the directory.**

| Library | Contains | Rule |
|---|---|---|
| `immigration/references/countries/` | per-country immigration models | values live in `knowledge-engine`, never in the file |
| `career-intelligence/references/careers/` | per-track career models | weights are measured, never declared in the file |

Each has a `_TEMPLATE.md` defining the shape.

## Vendored community skills

`skill-creator`, `mcp-builder`, `pdf`, `docx` come from ComposioHQ/awesome-claude-skills and
Anthropic. They are **references and tooling, not Zentavio dependencies**. `pdf` and `docx` have
real runtime value for resume ingestion. `skill-creator` and `mcp-builder` inform how Zentavio
skills and connectors are authored. None define Zentavio behavior.

## Authoring a new skill

1. Copy `.claude/templates/SKILL.template.md` to `.claude/skills/<name>/SKILL.md`.
2. Write the `description` frontmatter first — it is the only thing Claude sees before deciding
   to load the skill. Name concrete paths, file types, and task phrasings. Specific, not
   aspirational.
3. Fill all eight sections: Purpose, Scope, Responsibilities, Workflow, Constraints,
   Dependencies, Examples, Best Practices.
4. Phrase Constraints as prohibitions. They must hold even when a prompt asks otherwise, absent
   an ADR.
5. Reference real paths only. A skill citing a file that does not exist teaches the wrong thing.
6. Prefer a good/bad example pair over prose.
7. Add the skill to this catalog and to `CLAUDE.md`.
8. If the skill needs bulk reference material, put it in `references/` and state the
   load-one-file rule.

## Related

- `CLAUDE.md` — project instructions and the skill index
- `.claude/context/README.md` — the context layer
- `.claude/templates/` — canonical skeletons
- `docs/README.md` — the documentation map
