# Zentavio

Career intelligence platform. **Not a job board.** Zentavio reasons about a person's
career trajectory — transitions, readiness, skill gaps, learning paths, relocation
viability — using structured knowledge rather than keyword matching.

## Current state

**M1, M2, M3 and M4 are complete** (M2 and M3 met 2026-08-11, M4 on 2026-08-12 subject to the
evidence gate in `docs/roadmap/milestones.md`).

M1: a résumé uploads, becomes a versioned profile with a verbatim source span on every claim, is
correctable, and can be compared against a career track to produce a dependency-ordered gap and a
readiness score with its remainder.

M2: real German statutory sources (`BAnz AT 18.12.2025 B3` and § 18g AufenthG) are ingested through
connectors, planned, executed, and stored as versioned tier-1 `requirements` citing archived
originals; the gateway evaluates them against a person's facts through `ai/career-roadmap`; and the
browser shows `undetermined` with the questions that resolve it, then `met` once answered —
**re-verified against the three-route rule set on 2026-08-11**.

**Viability is built** (`f60f821`) — both axes with the binding constraint named, no composite score
(ADR-0022). **§ 18g is modelled** through `connectors/immigration-data/de-aufenthg`, evaluated as
three routes (ADR-0024): the qualification, both gates on the reduced-threshold route, and Abs. 2's
experience route, which admits ICT and IT professionals with no degree.

**Outcome recording is built** (ADR-0019) — an application carries what was predicted about the
person at the moment they recorded it, and outcomes recorded against it carry that prediction
forward. Nothing reads the data yet: `CLAIMED_CREDIT` stays an assumption until enough accumulates.

**M2 being met is not deployment readiness.** ADR-0021's production bucket (Cloudflare R2) is
unprovisioned, and archival is enforced against MinIO only. Coverage is also every requirement
*ingested*, not all of § 18g — § 19f's rejection grounds and the Bundesagentur's consent stay
unmodelled on purpose, and the connector's README says why.

M4: four countries and `REMOTE` are compared side by side at `/compare` — grouped by binding
constraint, **never ranked**, with `unmodelled`, `undetermined` and `not_applicable` kept visibly
distinct — browser-verified against the real gateway and evaluator on 2026-08-12.

**M4's evidence gate closed on 2026-08-20.** All three owed browser observations were made against
the real gateway, evaluator and database, and `milestones.md` records what was seen rather than the
word "passed": the five-digit-year guard on `/eligibility` after its fix, the boolean person-fact
control (a `Choose… / Yes / No` select storing JSON `false`), and the `/applications` submit. **Two
evidence boundaries stay open** and the closure does not cover them — a numeric quota has only ever
rendered against a stub, and Switzerland's archived original in the dev database is synthetic.

Do not record an observation as passing without loading the page — this repository shipped M1c with
no CORS at all while every server-side check passed.

**M3's result, and the rule it sets for future work.** Luxembourg's rules were absorbed with
**zero changes to `ai/`, `apps/` and `services/api-gateway`** — the evaluator took a second
country's two-route pathway unmodified. The one gap Luxembourg exposed was **provenance
cardinality**: `requirements` assumed one authoritative source per rule, which a derived threshold
breaks. `requirement_sources` (ADR-0025) is the fix and is **general infrastructure** — a future
derived threshold reuses it, and a second country-specific provenance mechanism would be a
regression. **No country-specific branch may enter the evaluator**; the jurisdiction-free AST test
enforces it.

**`de.md` is the worked example of a country model** (`.claude/skills/immigration/references/
countries/`). One pathway sourced end to end; labour market, compensation, cost of living and
culture all marked `unknown` and unsourced, because a plausible guess in those sections is the
most harmful and least detectable thing this repository could contain.

14 tables. **1 406 tests — 691 unit, 295 integration, 420 pytest** (measured 2026-08-21 by running
all three suites, integration included, against local PostgreSQL and MinIO — not estimated). The
integration suite needs `ZENTAVIO_TEST_DATABASE_URL` pointing at a database whose name ends `_test`;
it is dropped and rebuilt, so it never touches the dev database. It also needs the four
`ZENTAVIO_STORAGE_*` keys that have no default — `ENDPOINT`, `BUCKET`, `ACCESS_KEY_ID` and
`SECRET_ACCESS_KEY`; the other two, `REGION` and `PROVIDER`, default to `auto` and `minio`
(`packages/config/src/zentavio.ts`). Without the four, three archival tests fail with a `ConfigError`
that looks like a code failure and is not. CI blocking on `main`.

| Built | Still a placeholder |
|---|---|
| `packages/db`, `config`, `types`, `auth`, `storage`; `ui` — design tokens only | `logger`, `events`, `i18n`; `ui`'s component primitives, unblocked by ADR-0023 (Accepted) but not yet installed |
| `services/api-gateway`, `services/ingestion` — requirement ingest only | `matching`, `notifications`, `billing`; ingestion's job-listing and scheduling half |
| `ai/resume-parser`, `ai/skill-gap`, `ai/shared`, `ai/career-roadmap` — eligibility, routes, viability | `embeddings`, `interview-prep`, `learning-paths` |
| `apps/web` — upload, gap, eligibility with its routes, applications, the comparison | `apps/admin`, `apps/mobile` |
| `connectors/core`, `connectors/immigration-data/` — `de-bundesanzeiger`, `de-aufenthg`, `lu-legilux` | every other connector, all of `knowledge-engine/` |
| the seeded skill graph — in `packages/db/seeds/` and four tables, **not** `knowledge-engine/` (ADR-0020) | |

Not built at all: any deployed environment. ADR-0015's Supabase project is
decided but not provisioned; ADR-0017's authentication is implemented but needs a provider, so the
dev header is a stand-in refused in production; ADR-0021 is implemented against MinIO and enforced
— a rule whose source could not be archived is rejected — but its production bucket (Cloudflare R2)
is not provisioned yet.

**This section was wrong for several milestones** — it claimed there was no application
code while the above existed. If you find it disagreeing with the tree again, the tree
wins and this is a bug to fix in the same change.

When you implement something in a directory still marked a placeholder, you are filling in
a file that already declares its own purpose. Read its `> **Purpose:**` line first — it is
a binding contract for what belongs there. **A README under a built package describes what
is there instead**, and is equally binding.

## Repository map

| Path | Contains |
|---|---|
| `ai/` | Stateless AI capability services (resume-parser, skill-gap, career-roadmap, learning-paths, interview-prep, embeddings, shared) |
| `apps/` | `web` (Next.js App Router), `admin`, `mobile` |
| `connectors/` | External data integrations. `core/` defines the contract; `job-boards/`, `salary-data/`, `company-data/`, `immigration-data/`, `learning-resources/`, `market-trends/` implement it |
| `knowledge-engine/` | The structured-knowledge substrate: skills-graph, companies, immigration rules/pathways, market-intel, interview-reports, outcomes, vector-store, ingest |
| `packages/` | Shared libraries: `db`, `types`, `auth`, `events`, `config`, `logger`, `i18n`, `ui` |
| `services/` | Deployable services: `api-gateway`, `ingestion`, `matching`, `notifications`, `billing` |
| `infra/` | `terraform`, `docker`, `ci`, `monitoring`, `vercel` |
| `tests/` | `unit` (cross-package contracts and invariants), `integration`, `fixtures`, `e2e` (empty — nothing deployed yet) |
| `tools/` | `generators`, `scripts` |
| `docs/` | Source of truth. Architecture, features, database, prompts, roadmap, development |
| `.claude/context/` | Project-wide truth: vision, glossary, stack, principles, philosophy |
| `.claude/skills/` | Task-scoped skills, loaded on demand |
| `.claude/templates/` | Canonical skeletons for skills, ADRs, connectors, docs, prompts |

## Non-negotiable principles

1. **Knowledge before generation.** AI services reason over curated knowledge and do not invent
   facts about companies, salaries, visas, or job markets. The path is `knowledge-engine/` curates →
   `packages/db` stores → the gateway reads → `ai/` reasons (ADR-0020).
2. **Explainability.** Every score, match, or recommendation carries the evidence that
   produced it. A number with no provenance is a bug.
3. **Stateless AI layer.** `ai/` services own no persistent store. State lives in
   `packages/db` and `knowledge-engine/`.
4. **Connectors are plugins.** Adding a source must never require editing `services/ingestion`.
5. **Documentation is part of the change.** Code that contradicts its doc is broken.

## Context layer

Project-wide truth that applies regardless of the task lives in:

    .claude/context/

Skills say *how to do a task*. Context says *what is true about Zentavio always*. Read the
context file before making a decision it governs — these are prescriptive, not background:

| File | Governs |
|---|---|
| **`development-instructions.md`** | **execution rules — read before starting any task** |
| **`decision-gate.md`** | **when to stop and report BLOCKED, and how to verify a claim** |
| `business.md` | who we serve, what they pay for, what that constrains |
| `vision.md` | the north star and the five-question design test |
| `glossary.md` | terminology (canonical: `docs/GLOSSARY.md`) |
| `architecture.md` | layers, responsibilities, boundaries, communication |
| `tech-stack.md` | the fixed technology set — nothing new without an ADR |
| `ui-guidelines.md` | design philosophy, tokens, required states, confidence rendering |
| `ai-principles.md` | the ten rules every AI-produced claim obeys |
| `countries.md` | supported markets and the country knowledge model |
| `career-philosophy.md` | what makes a career succeed, and how scores encode it |
| `product-principles.md` | the eight properties every feature must have |
| `knowledge-sources.md` | source tiers → confidence, conflict resolution |
| `feature-philosophy.md` | whether a feature should exist at all |
| `decisions.md` | when an ADR is required, and the ADR index |

`ai-principles.md` and `product-principles.md` outrank any prompt asking for a shortcut.
Where a canonical document exists in `docs/`, the context file points to it rather than
forking it.

## AI Skills

This project uses project-specific Claude Skills located under:

    .claude/skills/

Each skill defines:

- Purpose
- Scope
- Responsibilities
- Workflow
- Constraints
- Dependencies
- Examples
- Best Practices

Claude should automatically load only the skills relevant to the current task.
Avoid duplicating skill instructions inside prompts.

Catalog and load-triggers: `docs/09_AI_SKILLS/AI_SKILLS.md`

### Engineering skills

`architecture` · `backend-service` · `frontend` · `database` · `connectors` · `testing` ·
`documentation` · `prompt-engineering` · `roadmap`

### Domain skills

`knowledge-engine` · `ai-matching` · `career-intelligence` · `job-aggregation` ·
`learning-paths` · `interviews` · `recommendations` · `immigration`

Domain skills carry on-demand reference libraries. `immigration/references/countries/`
holds per-country rules; `career-intelligence/references/careers/` holds per-track career
models. Load the specific reference file, not the whole directory.

### Vendored community skills

`skill-creator`, `mcp-builder`, `pdf`, `docx` come from ComposioHQ/awesome-claude-skills
and Anthropic. They are **references and tooling, not Zentavio dependencies**. `pdf` and
`docx` have real runtime value for resume ingestion. `skill-creator` and `mcp-builder`
inform how Zentavio skills and connectors are authored. None of them define Zentavio
behavior — that is what the skills above are for.

## Templates

`.claude/templates/` holds the canonical skeletons for new skills, ADRs, connectors,
services, docs, and prompts. Use them instead of improvising structure.

## Conventions

- TypeScript, monorepo, kebab-case directories, one concern per package.
- Every architectural decision with a tradeoff gets an ADR in `docs/architecture/decisions/`.
- Commit style, naming, and code style: `docs/development/conventions.md`.
- Never introduce a dependency, framework, or database without an ADR.
