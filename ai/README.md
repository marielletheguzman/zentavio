# ai

> **Purpose:** AI capability services. Stateless reasoning over structured knowledge; no long-term store of their own.

Python (ADR-0003), one uv workspace rooted here (ADR-0006) — the `pyproject.toml` and `uv.lock`
at this level are the workspace, not a package.

| Package | State |
|---|---|
| `resume-parser` | built — deterministic extraction, plus optional model enrichment |
| `skill-gap` | built — the ordered gap, and readiness with its remainder |
| `shared` | built — the eval runner and model client both halves use |
| `career-roadmap` · `embeddings` · `interview-prep` · `learning-paths` | placeholder |

**Stateless is a boundary, not a preference** (principle 3). Nothing here owns a store; state lives
in `packages/db` and `knowledge-engine/`. A service that needs to remember something is asking for
the wrong layer.

Every package is `src/<name>/`, never flat modules. Two wheels both exporting a top-level `compute`
collide at import, and the symptom is the wrong function running rather than an error.
