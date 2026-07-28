# Entity: User Memory

> **Purpose:** The tables backing AI long-term memory, and the mapping showing which memory sections need
> no new table at all.

**Person data.** Specification: `.claude/context/ai-memory.md`,
`ai-memory-policy.md`, `memory-manager.md`.

## Most of "memory" is not a new table

The memory spec's sections map almost entirely onto tables that already exist. Building a parallel store
would create two sources of truth about one user, and the copy that rots is the one users are shown.

| Memory section | Lives in | New? |
|---|---|---|
| Profile, career goals, target countries | `users`, `user_profiles`, `user_targets`, `user_country_preferences` | no |
| Skills, proficiency, evidence | `profile_skills` | no |
| Languages | `user_profiles.languages` | no |
| Work experience, education, projects | `user_profiles` versions | no |
| Certifications | **`user_certifications`** | **yes** |
| Learning progress | `learning_paths`, `learning_path_steps` | no |
| Career transition progress | `readiness_scores` (history gives the trend) | no |
| Interview history | `practice_sessions`, `outcomes` | no |
| Applications | `applications`, `application_events` | no |
| Readiness history | `readiness_scores`, `matches` | no |
| Work authorization status | `user_immigration_facts` (isolated, encrypted) | no |
| **AI preferences** | **`user_ai_preferences`** | **yes** |
| **Résumé / cover-letter versions** | **`user_documents`** | **yes** |
| Session context | nowhere — session-scoped, never persisted | no |

Three new tables, not fifteen.

## `user_certifications`

Certifications are evidence with an expiry, which no existing table models.

```sql
CREATE TABLE user_certifications (
  id                uuid         PRIMARY KEY,
  user_id           uuid         NOT NULL,
  name              text         NOT NULL,
  issuer            text         NOT NULL,
  credential_ref    text,                              -- issuer's verification URL, NOT a licence number
  issued_at         date,
  expires_at        date,
  verification      text         NOT NULL,             -- 'user_claimed' | 'document_provided' | 'issuer_verified'
  confidence        text         NOT NULL,             -- high | medium | low
  skill_ids         uuid[]       NOT NULL DEFAULT '{}',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT fk_user_certs__users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_user_certs__verification CHECK (verification IN
    ('user_claimed','document_provided','issuer_verified')),
  CONSTRAINT ck_user_certs__confidence CHECK (confidence IN ('high','medium','low')),
  -- Only a verified certification may report high confidence.
  CONSTRAINT ck_user_certs__high_needs_verification CHECK (
    confidence <> 'high' OR verification = 'issuer_verified'
  ),
  CONSTRAINT ck_user_certs__dates CHECK (expires_at IS NULL OR issued_at IS NULL OR expires_at >= issued_at)
);
CREATE INDEX idx_user_certs__user ON user_certifications (user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_certs__expiring ON user_certifications (expires_at)
  WHERE deleted_at IS NULL AND expires_at IS NOT NULL;
```

**`credential_ref` is a verification URL, never a licence or registration number.** Store the status, not
the identifier (`.claude/context/ai-memory-policy.md`).

**`ck_user_certs__high_needs_verification`** is the memory spec's confidence rule in schema form: a
self-claimed certification cannot report `high`. It is what stops "I have AWS SAA" from carrying the same
weight as a verified credential.

Expiry lowers confidence and prompts reconfirmation — it does not delete
(`idx_user_certs__expiring` makes finding those cheap).

## `user_ai_preferences`

Genuinely new: how the assistant should behave, which is not a career fact.

```sql
CREATE TABLE user_ai_preferences (
  user_id             uuid        PRIMARY KEY,
  explanation_detail  text        NOT NULL DEFAULT 'standard',  -- 'brief' | 'standard' | 'detailed'
  tone                text        NOT NULL DEFAULT 'neutral',
  notification_frequency text     NOT NULL DEFAULT 'important-only',
  learning_style      text,
  dashboard_layout    jsonb       NOT NULL DEFAULT '{}',
  memory_enabled      boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_ai_prefs__users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_ai_prefs__detail CHECK (explanation_detail IN ('brief','standard','detailed'))
);
```

**`memory_enabled = false` must degrade personalization without breaking the product.** Every read path
handles it, and that is a test, not a hope.

`notification_frequency` defaults to `important-only` because the notification policy is that silence is
the default and a real trigger earns an interruption (`docs/features/notifications.md`).

## `user_documents`

Résumé and cover-letter versions.

```sql
CREATE TABLE user_documents (
  id              uuid         PRIMARY KEY,
  user_id         uuid         NOT NULL,
  kind            text         NOT NULL,             -- 'resume' | 'cover_letter'
  version         integer      NOT NULL,
  target_role     text,
  target_company_id uuid,
  application_id  uuid,
  content         text,                              -- generated content; see retention
  generated_by    text,                              -- prompt version, when generated
  user_edited     boolean      NOT NULL DEFAULT false,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT fk_user_docs__users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_user_docs__kind CHECK (kind IN ('resume','cover_letter'))
);
CREATE UNIQUE INDEX uq_user_docs__version ON user_documents (user_id, kind, version);
```

This is the **only** table holding generated document text, and it is retained because a user needs their
own résumé back. The *uploaded* source document is still discarded after parsing
(`docs/features/resume-parsing.md`) — a document we generated for them and a file they gave us are
different things.

`generated_by` records the prompt version, so a résumé can be regenerated or explained later.

## Memory metadata on existing rows

The memory spec requires source, status, confidence, and timestamps on every entry. `profile_skills`
already carries `status`, `evidence_kind`, `confidence`, and `source_span`
(`entities/user.md`). Where a preference table lacks provenance, it gains:

```sql
ALTER TABLE user_targets
  ADD COLUMN source     text NOT NULL DEFAULT 'user_stated',   -- 'user_stated' | 'user_confirmed' | 'imported'
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN expires_at   timestamptz;                          -- e.g. salary expectation, confirm annually
```

`expires_at` implements the expiration table in `ai-memory.md` — expiry lowers confidence and prompts
confirmation rather than deleting.

## Precedence, in practice

`ai-memory-policy.md` splits precedence, and the schema is what makes it enforceable:

- **Goals and preferences** — recency wins. A new `user_targets` row supersedes the old.
- **Skills and credentials** — evidence wins. A `claimed` statement cannot overwrite an `evidenced`
  `profile_skills` row or an `issuer_verified` certification; the write is rejected and a confirmation is
  requested instead.

That asymmetry is the point: goals are mutable, evidence is durable.

## Retention

| Table | Retention | On erasure |
|---|---|---|
| `user_certifications` | while active; expired kept with lowered confidence | hard delete |
| `user_ai_preferences` | while active | hard delete |
| `user_documents` | while active; user-deletable individually | hard delete |
| session context | current conversation only | nothing to delete |

Export returns all of it in a portable form — a person is entitled to the reasoning we hold about them,
not only the inputs (`../data-retention.md`).

## Invariants

- Three new tables only; everything else reuses existing person data.
- No licence or identification numbers — status and verification URLs only.
- `high` confidence on a certification requires issuer verification.
- `memory_enabled = false` degrades, never breaks.
- Evidence is not overwritten by a claim; the write is rejected and confirmation requested.
- Expiry lowers confidence; it does not delete.
- No memory field in a log, event payload, error, or fixture.
- Session context is never persisted without an explicit user action.

## Related

- `.claude/context/ai-memory.md` · `ai-session.md` · `ai-memory-policy.md` · `memory-manager.md`
- `entities/user.md`, `entities/application.md`, `entities/outcome.md`
- `docs/architecture/privacy.md`, `../data-retention.md`
