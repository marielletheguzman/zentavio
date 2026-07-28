# Tech Stack

> **Purpose:** The fixed technology set. Claude must never introduce a framework, library,
> datastore, queue, or hosted service that is not listed here without an ADR in
> `docs/architecture/decisions/`. "It's a small dependency" is not an exemption.

## The stack

### Frontend
- **Next.js** (App Router) — `apps/web`, `apps/admin`
- **React** + **TypeScript** (strict)
- **Tailwind CSS** — styling; design tokens in `packages/ui`
- **packages/ui** — the shared component layer. Extend it; do not fork primitives per app.

### Backend
- **NestJS** + **TypeScript** — everything under `services/`
- **FastAPI** + **Python** — everything under `ai/` (stateless AI capability services)
- Contract between them: JSON Schema in `packages/types`. Neither side hand-writes the
  other's types.

### Data
- **PostgreSQL** — system of record. Schema and migrations in `packages/db`.
- **`pg`** — the driver; **Kysely** — typed queries. Plain `.sql` migrations, applied by our own
  runner so `migrations.md`'s CONCURRENTLY and NOT VALID rules stay expressible (ADR-0012).
  **No ORM and no schema DSL:** the entity documents are the schema.
- **Redis** — cache, rate limiting, and the event transport between services
- **Qdrant** — vector store for embeddings (`knowledge-engine/vector-store`)

### AI
- **Ollama** — local model runtime; the only thing that talks to a model
- **Qwen**, **Gemma** — the model families in use
- **Embeddings** — via `ai/embeddings`, written to Qdrant

The model is an implementation detail behind `ai/`. Nothing outside `ai/` knows which model
answered, which is what makes swapping one a config change rather than a refactor.

### Monorepo tooling
- **pnpm workspaces** — workspace membership (`pnpm-workspace.yaml`)
- **Turborepo** — task graph and caching across the TypeScript workspaces (ADR-0001)
- **ESLint** flat config + `eslint-plugin-boundaries` — layer enforcement (ADR-0005)
- **Ruff** — lint and format for `ai/`, plus the `ai/` statelessness bans (ADR-0005)
- **Vitest** — TypeScript test runner, `unit` and `integration` projects (ADR-0007)
- **pytest** — Python test runner for `ai/` (ADR-0007)
- **OpenTelemetry** — instrumentation layer; backend deferred as a separate choice (ADR-0008)
- **uv** — Python dependencies and environments for `ai/`, as a workspace with one
  committed `uv.lock` (ADR-0006)
- `ai/` keeps its own Python toolchain inside the same tree; Turborepo does not manage it.
  Two unrelated "workspace" concepts coexist: pnpm's for TypeScript, uv's for Python.

### Infrastructure
- **Docker** — local and deployed runtime (`infra/docker`)
- **AWS** — services, data, and workers (`infra/terraform`)
- **Vercel** — Next.js app hosting (`infra/vercel`)
- **GitHub Actions** — CI/CD (`infra/ci`)
- **Terraform** — all infrastructure as code. No console-created resources.

### Cross-cutting packages
`packages/types` (contracts) · `packages/db` · `packages/auth` · `packages/events` ·
`packages/config` (the only reader of environment variables) · `packages/logger` ·
`packages/i18n` · `packages/ui`

## Hard rules

- **No second framework in a layer.** One HTTP framework per language: NestJS for
  TypeScript, FastAPI for Python. Not Express "just for this one service."
- **No second datastore.** If something needs a new store, it needs an ADR first.
- **No ORM swap, no query-builder addition** without an ADR.
- **No hosted third-party API** for a capability the stack already covers (embeddings,
  vector search, model inference).
- **No `process.env` outside `packages/config`.**
- **No cloud resource outside Terraform.**
- **No client-side state library.** Server Components, the URL, and local state cover it —
  see `ui-guidelines.md` and the `frontend` skill.
- **No LLM SDK outside `ai/`.**

## When a dependency is genuinely needed

1. Check whether `packages/*` or the existing stack already covers it.
2. If not, write the ADR: what it does, what it replaces, what it costs, alternatives
   considered, and how it would be removed.
3. Get it Accepted, then add it — and update this file in the same change.

A dependency that is not in this file after being added means this file is wrong, which
means the next session will make the wrong assumption. Keep it current.

## Deliberately not in the stack

Listed so nobody re-litigates them by accident: GraphQL, Kafka, MongoDB, Prisma-alternatives,
Redux/MobX/Zustand, a second CSS framework, a hosted vector database, a hosted LLM provider
as a default path. Also rejected with reasons recorded: **polyrepo** and **Nx** (ADR-0001),
**pgvector** as the primary vector store (ADR-0004), **TypeScript for `ai/`** (ADR-0003).
Any of these may become right later — via an ADR, not via an import.

## Related

- `docs/architecture/decisions/` — 0001 monorepo, 0002 connector plugin model,
  0003 Python for AI services, 0004 vector store choice
- `decisions.md`
- Skills: `architecture`, `backend-service`, `frontend`, `database`
