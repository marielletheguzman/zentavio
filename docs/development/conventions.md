# Conventions

> **Purpose:** Code style, naming, commit conventions.

Mechanical rules. Where a rule is enforced by a tool, the tool is named — anything else is held by
review, and rules held by review decay.

## Formatting and style

Formatting is not a matter of opinion here; it is delegated.

| Language | Tool | Config | Enforced? |
|---|---|---|---|
| TypeScript (`.ts`, `.tsx`, `.mts`, `.cts`) | ESLint | `eslint.config.mjs` | **yes** — CI fails |
| Python (`ai/` only) | Ruff (`ruff check`, `ruff format`) | `ruff.toml` | **yes** — CI fails |
| Markdown, JSON, YAML | none yet | — | convention only, held by review |

Markdown, JSON, and YAML are **not** currently linted or formatted by any tool: `eslint.config.mjs`
matches TypeScript extensions only, and Ruff is scoped to `ai/` with Markdown excluded. The rules
below still apply to them, but a reviewer is the only thing enforcing it. Adding a formatter for
those file types is outstanding work, not a silent gap.

- **Line length:** 100 characters. Applies to prose in Markdown too — long lines make diffs
  unreadable. Enforced by tooling in TypeScript and Python; by convention elsewhere.
- **Quotes:** single in TypeScript, double in Python (Ruff's default; consistency beats preference).
- **Semicolons:** yes, in TypeScript.
- **Indentation:** 2 spaces TypeScript, 4 Python.
- **Trailing commas:** in multiline literals — they keep diffs to one line.
- Run `pnpm lint:all` before pushing. It is what CI runs.

## Naming

### Files and directories

| Thing | Convention | Example |
|---|---|---|
| Directory | kebab-case | `knowledge-engine/skills-graph/` |
| TypeScript file | kebab-case | `skill-graph.adapter.ts` |
| React component file | kebab-case, component PascalCase inside | `match-card.tsx` → `MatchCard` |
| Test file | mirrors subject | `rank.test.ts`, `test_rank.py` |
| Python module | snake_case | `skill_gap.py` |
| Connector directory | `<kind>/<id>`, id kebab-case and permanent | `job-boards/greenhouse/` |
| Migration | timestamp + description | `20260728120000-add-matches.sql` |
| ADR | `00NN-kebab-title.md`, never renumbered | `0002-connector-plugin-model.md` |

A connector's `id` is a foreign key in the database. It is never renamed or reused.

### Code

| Thing | Convention |
|---|---|
| TypeScript type, interface, class, enum | `PascalCase` |
| Variable, function, method | `camelCase` (TS) / `snake_case` (Python) |
| Constant | `SCREAMING_SNAKE_CASE` |
| Boolean | `is` / `has` / `should` prefix |
| React hook | `use` prefix |
| Database table, column | `snake_case` — see `.claude/skills/database/SKILL.md` |
| Event | `namespace.noun.past-tense-verb.vN` — `job.posting.normalized.v1` |
| Prompt version | `<name>-<YYYY-MM-DD>` — `skill-extract-2026-07-01` |
| Score version | `<name>-vN` — `job-match-v3` |

**No invented abbreviations.** `configuration` not `cfg`, `request` not `req`, `implementation` not
`impl`. Well-known acronyms are fine: `id`, `url`, `http`, `api`, `db`, `pdf`.

**Domain terms come from `docs/GLOSSARY.md`.** A variable holding a Career Score is not named
`jobScore` — the glossary distinguishes five different scores precisely because they get confused,
and a misnamed variable is how one gets wired to the wrong column.

### Interfaces and their implementations

```typescript
// The inner layer declares what it needs.
export interface SkillGraphPort { … }

// The outer layer supplies it. Named for what it adapts.
export class SkillGraphAdapter implements SkillGraphPort { … }
```

Suffix with the role: `.port.ts`, `.adapter.ts`, `.controller.ts`, `.service.ts`, `.dto.ts`,
`.repository.ts`. No Hungarian prefixes — never `ISkillGraph`.

## Types

- **`strict: true`**, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
  (`tsconfig.base.json`).
- **`any` is a lint error.** Use `unknown` and narrow. Every score, fact, and event shape is a
  contract, and `any` at a boundary is how a contract rots.
- Shared shapes live in `packages/types`, generated from JSON Schema so the TypeScript and Pydantic
  sides cannot drift (ADR-0003). Neither side hand-writes the other's types.
- Prefer `type` for unions and object shapes; `interface` when it will be implemented or extended.
- Absent data is `null`, never a default. `salaryMin: 60000` as a fallback is invented data.

## Comments

Explain **why**, not what. The code says what.

```typescript
// Bad — restates the code.
// Loop over the connectors and call search.

// Good — explains a decision the reader would otherwise undo.
// Cursor is persisted per page rather than per run: a crash mid-crawl must resume,
// not restart, or we burn the source's rate limit re-fetching what we have.
```

Comment the non-obvious: a rule that cites an ADR, a workaround with its cause, a constraint that
looks removable but is not. Delete commented-out code — that is what git is for. `TODO` needs a
reason and an owner or it is noise.

## Errors

- Shared envelope and the eight-code taxonomy: `.claude/skills/backend-service/SKILL.md`. `retryable`
  is part of the contract, not a hint.
- Catch to translate or to add context. Never to hide — a swallowed error is a bug that will be
  diagnosed twice.
- Throw for broken invariants; return a result for expected outcomes. "No match found" is data.
- Never put a secret, token, email, or resume text in an error message.

## Imports

- Layer rules are enforced by `eslint.config.mjs`. A cross-layer import fails the build with the
  ADR it breaks.
- No deep relative escapes (`../../../`) across a package boundary — that is a layer violation
  wearing a disguise. Within a package, relative is fine.
- Configuration comes from `packages/config` only. `process.env` elsewhere is a lint error.
- Import order: node builtins → external → workspace packages → relative. ESLint sorts it.

## Tests

Full strategy in `.claude/skills/testing/SKILL.md`. The conventions:

- Name the test after the invariant, not the function: `returns unknown when market facts are
  absent`.
- One assertion subject per test.
- Assert exact values on deterministic output. A range on a deterministic score hides
  non-determinism.
- Fixtures in `tests/fixtures/`, synthetic, never real personal data.
- A bug fix ships with the test that would have caught it, at the cheapest level that could have.

## Commits

Conventional Commits:

```text
<type>(<scope>): <subject>

<body — why, not what>

<footer>
```

**Types:** `feat` · `fix` · `docs` · `refactor` · `test` · `chore` · `perf` · `build` · `ci` ·
`revert`

**Scope** is the affected area: `connectors`, `matching`, `knowledge-engine`, `db`, `web`, `ci`.

**Subject:** imperative, lowercase, no trailing period, ≤72 characters. "add readiness remainder",
not "added" or "adds".

**Body** explains why the change is right, and names what was rejected if a reader would wonder.
Wrap at 100.

**Footer:** `BREAKING CHANGE:` with the migration path; `Refs: ADR-0005`; co-authors.

```text
feat(connectors): add greenhouse job board connector

normalize() is pure and tested against three captured payloads rather than the live
API — the source changes shape without notice, and a golden-file diff is reviewable
where a live-API test is just flaky.

Refs: ADR-0002
```

**One logical change per commit.** A commit that both fixes a bug and renames a module cannot be
reverted cleanly.

**Documentation ships with the change.** Code contradicting its doc is broken (principle 5), so the
doc edit belongs in the same commit — not the next one.

## Branches and pull requests

- Branch: `<type>/<short-description>` — `feat/greenhouse-connector`, `fix/stale-posting-expiry`.
- Never commit directly to `main`.
- A pull request states what changed, why, and how it was verified. If it changes a boundary, a
  contract, or a dependency, it links its ADR — or it needs one.
- CI's `ci` check must be green. Details: `ci-cd.md`.

## Related

- `.claude/skills/architecture/SKILL.md` — layer rules these imports obey
- `.claude/skills/backend-service/SKILL.md`, `database/SKILL.md`, `frontend/SKILL.md`,
  `testing/SKILL.md`
- `docs/GLOSSARY.md` — binding on every name above
- `branching.md`, `contributing.md`, `ci-cd.md`
- `eslint.config.mjs`, `ruff.toml`, `tsconfig.base.json`
