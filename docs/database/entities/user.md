# Entity: User

> **Purpose:** User profile, preferences, preferred-countries.

**Person data.** Every query predicates on the subject, every table here has a retention policy, and
everything is erasable. This is the most sensitive cluster in the schema — see
`docs/architecture/privacy.md`.

## `users`

Account identity only. Deliberately thin: the less that sits here, the smaller the blast radius.

```sql
CREATE TABLE users (
  id                 uuid        PRIMARY KEY,          -- UUIDv7
  email              citext      NOT NULL,
  email_verified_at  timestamptz,
  auth_provider      text        NOT NULL,             -- 'password' | 'oidc:<issuer>'
  auth_subject       text,                             -- external identity, when delegated
  locale             text        NOT NULL DEFAULT 'en',
  timezone           text,
  status             text        NOT NULL DEFAULT 'active',  -- 'active' | 'suspended' | 'erased'
  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  CONSTRAINT ck_users__status CHECK (status IN ('active','suspended','erased'))
);

CREATE UNIQUE INDEX uq_users__email ON users (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users__auth_subject ON users (auth_provider, auth_subject) WHERE auth_subject IS NOT NULL;
```

No password column here. Credentials, if stored at all, live in `packages/auth`'s own table with its
own access controls — a table joined on every request should not contain a hash.

`status = 'erased'` is a tombstone: the row survives so foreign keys and anonymized aggregates stay
coherent, with every identifying column cleared.

## `user_consents`

Consent is a **fact with a timestamp and a version**, never a boolean that overwrites its history.
"Did they consent at the time we did this?" must be answerable a year later.

```sql
CREATE TABLE user_consents (
  id            uuid        PRIMARY KEY,
  user_id       uuid        NOT NULL,
  purpose       text        NOT NULL,   -- 'processing' | 'training' | 'marketing' | 'outcome-aggregation'
  granted       boolean     NOT NULL,
  policy_version text       NOT NULL,
  granted_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_user_consents__users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_user_consents__user_purpose ON user_consents (user_id, purpose, granted_at DESC);
```

Uploading a resume for a gap analysis is consent for `processing`, never for `training`. Those are
separate rows.

## `user_profiles`

The parsed resume result. One live profile per user, versioned so a score can be reproduced against
the profile as it stood.

```sql
CREATE TABLE user_profiles (
  id                uuid        PRIMARY KEY,
  user_id           uuid        NOT NULL,
  version           integer     NOT NULL,
  is_current        boolean     NOT NULL DEFAULT true,

  headline          text,
  years_experience  numeric(4,1),                -- a signal, never a seniority determinant
  current_career_id uuid,                        -- resolved career track, nullable
  seniority         text,
  languages         jsonb       NOT NULL DEFAULT '[]',   -- [{code, cefr, basis}]

  parsed_from       text,                        -- 'resume-upload' | 'manual' | 'import'
  parser_version    text,
  parsed_at         timestamptz,
  completeness      numeric(4,3),                -- drives confidence downstream

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT fk_user_profiles__users    FOREIGN KEY (user_id)           REFERENCES users(id)    ON DELETE RESTRICT,
  CONSTRAINT fk_user_profiles__careers  FOREIGN KEY (current_career_id) REFERENCES careers(id)  ON DELETE RESTRICT,
  CONSTRAINT ck_user_profiles__completeness CHECK (completeness IS NULL OR (completeness >= 0 AND completeness <= 1))
);

CREATE UNIQUE INDEX uq_user_profiles__current ON user_profiles (user_id) WHERE is_current AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_user_profiles__version ON user_profiles (user_id, version);
```

**No resume document column.** The uploaded file is parsed and then discarded
(`docs/architecture/data-flow.md`); the parsed profile is the asset and the file is a liability.

`years_experience` is stored because sources state it, and deliberately *not* used to determine
seniority — years are a proxy for skills we measure directly
(`.claude/context/career-philosophy.md`).

## `profile_skills`

The heart of every score. The `evidenced` / `claimed` distinction is what makes readiness honest.

```sql
CREATE TABLE profile_skills (
  id                uuid        PRIMARY KEY,
  user_profile_id   uuid        NOT NULL,
  skill_id          uuid        NOT NULL,
  status            text        NOT NULL,        -- 'evidenced' | 'claimed'
  evidence_kind     text,                        -- 'role' | 'project' | 'certification' | 'assessment' | 'artifact'
  source_span       text,                        -- the verbatim sentence it came from
  confidence        text        NOT NULL,        -- 'high' | 'medium' | 'low'
  self_reported     boolean     NOT NULL DEFAULT false,
  verified_at       timestamptz,                 -- set only by in-platform verification
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_profile_skills__profiles FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_profile_skills__skills   FOREIGN KEY (skill_id)        REFERENCES skills(id)        ON DELETE RESTRICT,
  CONSTRAINT ck_profile_skills__status CHECK (status IN ('evidenced','claimed')),
  CONSTRAINT ck_profile_skills__evidence CHECK (status = 'claimed' OR evidence_kind IS NOT NULL)
);

CREATE UNIQUE INDEX uq_profile_skills__profile_skill ON profile_skills (user_profile_id, skill_id);
```

`ck_profile_skills__evidence` is the rule in schema form: **an evidenced skill must say what evidences
it.** A row claiming `evidenced` with no `evidence_kind` cannot be written.

`ON DELETE CASCADE` here is deliberate and the only cascade in the cluster — a profile version's skills
have no meaning without the version, and re-parsing replaces them wholesale.

## `user_country_preferences`

```sql
CREATE TABLE user_country_preferences (
  id            uuid        PRIMARY KEY,
  user_id       uuid        NOT NULL,
  country_code  char(2)     NOT NULL,        -- or 'RE' sentinel handled by target_kind below
  target_kind   text        NOT NULL,        -- 'country' | 'remote'
  rank          smallint    NOT NULL,
  willing_to_relocate boolean NOT NULL DEFAULT true,
  earliest_move_at timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT fk_ucp__users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_ucp__target_kind CHECK (target_kind IN ('country','remote'))
);
CREATE UNIQUE INDEX uq_ucp__user_country ON user_country_preferences (user_id, country_code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_ucp__user_rank ON user_country_preferences (user_id, rank) WHERE deleted_at IS NULL;
```

`target_kind = 'remote'` exists because remote-worldwide is a first-class target with a different shape
— no jurisdiction, and its constraints are employer policy, time zone, and tax treatment
(`.claude/context/countries.md`).

## `user_immigration_facts`

Isolated in its own table precisely because it is the most sensitive data in the system. Its disclosure
can imply nationality, legal precarity, and family circumstance.

```sql
CREATE TABLE user_immigration_facts (
  id            uuid        PRIMARY KEY,
  user_id       uuid        NOT NULL,
  fact_kind     text        NOT NULL,   -- 'citizenship' | 'residence' | 'permit' | 'qualification-recognition'
  value         text        NOT NULL,   -- column-level encrypted at rest
  jurisdiction  char(2),
  valid_until   timestamptz,
  self_declared boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT fk_uif__users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);
```

Separate table means separate access, separate audit, and separate encryption. Never joined into a
general profile read.

## Erasure

```text
1  clear identifying columns on users; set status='erased'
2  hard-delete user_profiles, profile_skills, user_immigration_facts, preferences
3  delete derived rows: matches, readiness_scores, skill_gaps, learning_paths
4  delete the person's embeddings (derived, rebuildable — ADR-0004)
5  outcomes: detach from the user, retain the anonymized aggregate contribution
6  audit records: retain per data-retention.md, without the PII
```

Step 5 is the one boundary stated to the user rather than implied: aggregates already computed have no
path back to the individual and are not withdrawn.

## Invariants

- One `is_current` profile per user.
- An `evidenced` skill has an `evidence_kind`.
- `verified_at` is set only by in-platform verification, never by a claimed course completion.
- Every query touching these tables predicates on the subject.
- No PII from these tables in a log, event payload, error, or fixture.
- Consent rows are append-only.

## Retention

Active-account lifetime, then erasure on request or after the inactivity window in
`data-retention.md`. Resume documents are not retained at all beyond parsing.

## Related

- `docs/architecture/privacy.md`, `docs/architecture/security.md`
- `entities/outcome.md`, `entities/skill.md`, `entities/match.md`
- `docs/features/resume-parsing.md`, `docs/features/country-preferences.md`
- `.claude/skills/database/SKILL.md`, `.claude/context/career-philosophy.md`
