# ci

> **Purpose:** CI/CD pipeline definitions.

## Where the pieces live, and why they are split

GitHub Actions reads workflow files **only** from `.github/workflows/`. That is a platform
constraint, not a convention we chose, so the workflows live there and this directory holds the
reusable pieces they call:

```text
.github/workflows/          workflow entry points (GitHub reads only from here)
└── ci.yml                  lint, typecheck, boundary audit — runs on every PR and push to main

infra/ci/
└── actions/
    └── setup-node-pnpm/    composite action: corepack + Node + pnpm store cache + install
```

A workflow is a trigger plus a job list. Anything a second workflow would repeat belongs in
`actions/` as a composite action, so the toolchain is defined once.

Full pipeline documentation: [`docs/development/ci-cd.md`](../../docs/development/ci-cd.md).

## What CI enforces today

| Job | Runs | Enforces |
|---|---|---|
| `typescript` | `pnpm lint`, `pnpm typecheck`, boundary-disable audit | the layer model, banned imports, `process.env` discipline, strict types (ADR-0001, ADR-0002, ADR-0005) |
| `python` | `ruff check ai/`, `ruff format --check ai/` | `ai/` statelessness — no database, cache, or vector client (ADR-0003, ADR-0004) |
| `ci` | aggregates the two above | the single required status check for branch protection |

The polyglot split is deliberate: ESLint cannot see `ai/` (it is Python, ADR-0003), so the two
halves are separate jobs with separate, legible failure signals.

## Conventions

- **`ci` is the only required status check.** Branch protection points at that job, so adding a
  job to `ci.yml` makes it blocking without editing repository settings.
- **Least privilege.** Every workflow declares `permissions:` explicitly. `contents: read` unless
  a job genuinely needs to write.
- **Pinned toolchains.** pnpm comes from `package.json`'s `packageManager` field via corepack;
  Ruff comes from `requirements-dev.txt`. CI and a developer's machine must run the same rule set,
  or a green CI run means nothing.
- **`--frozen-lockfile` always.** A CI run that silently resolves different versions than the
  lockfile is not a verification.
- **Concurrency cancels superseded runs** on branches, never on `main`.
- **Timeouts on every job.** A hung job is a blocked queue.
- **No secrets in a PR-triggered job.** `pull_request` runs against untrusted code; anything
  needing credentials belongs in a separate, explicitly gated workflow.

## Outstanding

- Pin third-party actions to commit SHAs rather than major tags (`actions/checkout@v4`). Tags are
  mutable, so a tag pin trusts the publisher continuously rather than once.
- Path-filtered per-package build and test tasks via Turborepo (ADR-0001 follow-up). Not yet
  needed: lint over an empty tree is seconds, and filtering the checks that enforce boundaries is
  how a boundary stops being enforced.
- Test and build jobs, once there is code to test and build.
- Deployment workflows (Vercel for `apps/*`, containers for `services/*` and `ai/*`).
