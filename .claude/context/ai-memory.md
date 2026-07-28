# AI Memory Architecture

> **Purpose:** What Zentavio remembers about a user, where it lives, how confident it is, and who
> controls it. Version 1.0 · Draft.

The goal is **not to remember everything**. It is to remember only what improves future
recommendations — and to be able to say, for any recommendation, which memory influenced it.

Behave like a professional career coach: remembers your goals, strengths, weaknesses, progress,
target countries, and past interviews. Does **not** remember every conversation.

## Four independent systems, never mixed

```text
                    AI
                     │
              Memory Manager
     ┌──────────┬────────────┬──────────────┐
     ▼          ▼            ▼              ▼
  Session    User        Project       Knowledge
  Memory     Memory      Context        Engine
```

| System | Lifetime | Owns |
|---|---|---|
| **Session** | current session, then discarded | current task, filters, active simulation |
| **User** | persistent, user-controlled | goals, skills, progress, preferences, history |
| **Project context** | repository lifetime | `.claude/context/`, `.claude/skills/` — about *Zentavio*, not a user |
| **Knowledge engine** | versioned, indefinite | facts about the *world* — never about a user |

Mixing them is the primary failure mode. A world fact is not a memory; a session filter is not a
preference; project context is not user data.

---

## Reconciliation with existing architecture

**Read this before implementing anything above.** Three parts of the spec conflict with binding
decisions, and each has a resolution.

### 1. `ai/` is stateless — memory cannot live there

CLAUDE.md principle 3 and ADR-0003: AI services own no persistent store, which is what keeps the model
replaceable. So:

- **Memory is state**, and therefore lives in `packages/db` (person data) — never inside `ai/`.
- The **Memory Manager is a service capability**, not an `ai/` module. It sits with `services/` and is
  read by `ai/` through a port, like any other retrieved fact.
- An `ai/` service receives the memory it needs **per request** and retains nothing.

If the Memory Manager were implemented inside `ai/`, `ruff.toml`'s banned-import list would reject it —
which is the enforcement working as designed.

### 2. Memory is mostly a **view**, not a new store

The User Memory sections above map almost entirely onto tables that already exist
(`docs/database/schema-overview.md`):

| Memory section | Existing home |
|---|---|
| Profile, career goals, target countries | `users`, `user_profiles`, `user_targets`, `user_country_preferences` |
| Skills, certifications, languages | `profile_skills`, `user_profiles.languages` |
| Work experience, education, projects | `user_profiles` and its versions |
| Learning progress | `learning_paths`, `learning_path_steps` |
| Career transition progress | `readiness_scores` (history gives the trend) |
| Interview history | `practice_sessions`, `outcomes`, `interview_reports` |
| Applications | `applications`, `outcomes` |
| Career readiness history | `readiness_scores`, `matches` |
| Preferences | `user_country_preferences` and preference tables |

**Genuinely new:** AI preferences (tone, explanation detail, notification frequency, dashboard layout),
resume/cover-letter versions, and session context.

So "memory" is a **contract over person data**, not a parallel store. Building it as a second store
creates two sources of truth about the same user, and the copy that rots is the one users are shown.
The spec's own rule — "do not duplicate resume data" — generalizes to everything here.

### 3. Confidence is an enum, not a percentage

The spec's examples (`100%`, `82%`, `60%`) conflict with the established contract: confidence is
`high | medium | low`, derived from source tier and completeness, and **never a model-produced
probability** (`.claude/context/ai-principles.md`).

Resolution — keep the existing two axes and drop invented percentages:

| Spec example | Correct representation |
|---|---|
| AWS · certification · 100% | `status: evidenced`, `evidence_kind: certification`, `confidence: high` |
| Docker · quiz · 82% | `status: evidenced`, `evidence_kind: assessment`, `confidence: high`, plus the **real** score |
| Terraform · user statement · 60% | `status: claimed`, `confidence: low` |

A measured assessment score is a real number and may be stored as one. "60% confident because they said
so" is an invented number, and a decimal point on a guess reads as precision we do not have.

**Skill proficiency levels** (Advanced / Intermediate) are a *new* concept — the current model records
evidenced vs claimed, not a level. If levels are wanted they need a defined basis per level and belong
in `profile_skills` with that basis recorded, not asserted from a résumé phrase.

---

## Session memory

Current task, current country, current target role, active filters, current simulation, open branch.

**Never promoted to User Memory without explicit user action.** An inference drawn during one
conversation is not a preference. No PII from session memory in a log line.

## User memory

Persistent, and everything in it is **viewable, editable, exportable, and deletable**.

Every entry records:

```text
value · source · status(evidenced|claimed) · confidence(high|medium|low) · recorded_at · expires_at?
```

**Sources**, with their tier (`.claude/context/knowledge-sources.md`):

| Source | Gives | Notes |
|---|---|---|
| User input | claimed | never overwrites evidenced data without confirmation |
| Résumé | claimed or evidenced, with a source span | parsed, then the document is discarded |
| Certification | evidenced | with issuer, issue and expiry dates |
| Assessment / quiz | evidenced | with the actual score |
| Interview or practice outcome | evidenced | aggregated where used across users |
| Portfolio / GitHub | claimed until verified | a **connector** with explicit consent; tier 3 |

## Expiration

Some memories go stale, and stale memory presented as current is the failure:

| Memory | Window |
|---|---|
| Preferred countries | never expires; changed by the user |
| Interview readiness | 90 days |
| Knowledge verification | 180 days |
| Salary expectation | confirm annually |
| Learning progress | never expires |
| Certifications | expire on their own expiry date |

Expiry **lowers confidence and prompts confirmation** — it does not delete. This reuses the freshness
model already applied to world facts (`docs/architecture/knowledge-engine.md`).

## Memory as evidence

When memory influences a recommendation, it appears as a named evidence entry, not as invisible
personalization:

> Recommended because Germany is a stated target and your AWS certification is on file.

Mechanically, a memory-derived factor is an `evidence` entry with its source and confidence, exactly like
a knowledge fact (`.claude/skills/ai-matching/SKILL.md`). Personalization that cannot be explained is
indistinguishable from a guess.

## Privacy and control

- **View · export · edit · delete · disable · reset** — all supported, all tested. An untested erasure
  path is a promise, not a feature.
- Memory is **person data**: subject-predicated on every query, retention set at creation, erased on
  request (`docs/database/data-retention.md`).
- Sensitive fields encrypted at rest; immigration-related memory isolated as it already is
  (`docs/database/entities/user.md`).
- **Never in a log, an error, an event payload, or a fixture.**
- Never shared, never used outside Zentavio, never trained on without separate explicit consent.
- Disabling memory degrades personalization and must not break the product.

## Memory events

```text
quiz completed        → skill becomes evidenced, with its real score
certification earned  → certification recorded, skill status raised
offer accepted        → career history updated → readiness recomputed → recommendations recomputed
```

Events are versioned like any other (`packages/events`), and recomputation writes new values with new
versions rather than overwriting — so "why did this change?" stays answerable.

## API shape

Through `services/api-gateway`, authorized per subject, never a direct client-to-store path:

```text
GET    /memory · /memory/profile · /memory/skills · /memory/career · /memory/preferences
PATCH  /memory
DELETE /memory
POST   /memory/export · /memory/reset
```

`PATCH` never silently overwrites an evidenced value with a claimed one — it asks.

## Rules

- Store only what has future value.
- Never store a temporary discussion.
- Never store an assumption or an inference as a fact.
- Never overwrite verified information without confirmation.
- Never invent user information.
- Never mix the four systems.
- Never present expired memory as current.
- Never personalize without being able to explain it.

## Future

Memory timeline · career milestones · memory graph · memory search · automatic résumé updates ·
cross-device sync · prediction. Each needs its own scoping; none justifies relaxing the rules above.

## Success criteria

Users feel Zentavio understands their career journey without being asked the same thing twice, while
keeping complete visibility and control over what is stored.

## Open questions

1. **Skill proficiency levels** — wanted, or does evidenced/claimed plus assessment scores cover it?
   Adding levels means defining what each level requires.
2. **Where the new tables live** — AI preferences and résumé versions need an entity document before
   their migration, and `applications` / `practice_sessions` are already owed one.
3. **GitHub/portfolio ingestion** — a connector with consent, and tier-3 data. Worth confirming it is
   wanted before it is built.

## Related

- `.claude/context/ai-principles.md` — confidence, grounding, no fabrication
- `docs/database/schema-overview.md`, `docs/database/entities/user.md`,
  `docs/database/data-retention.md`
- `docs/architecture/privacy.md`, `docs/architecture/ai-services.md`
- ADR-0003 — why memory cannot live in `ai/`
