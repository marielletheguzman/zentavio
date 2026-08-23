# src

> **Purpose:** Matching source: scoring arithmetic, feature builders, the scoring API.

_Structure placeholder — no implementation yet._

The parent README says what is blocking this and why the purpose line no longer mentions ranking
models: **the number is arithmetic, not a model output** (`.claude/skills/ai-matching/SKILL.md`). A
model that produces the score is not reproducible, not calibratable and not defensible, which is the
whole product.

Planning is separated from execution here for the same reason it is in `services/ingestion`: the
interesting behaviour — what a match may claim when a signal was never consulted — must be testable
without PostgreSQL.

**ADR-0037 decides what the first score is allowed to be.** Read it first.
