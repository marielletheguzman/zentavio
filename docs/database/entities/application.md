# Entity: Application

> **Purpose:** A person's application to a posting, its stage timeline, and interview practice sessions.

**Person data.** Referenced by `outcomes.application_id`, scheduled in `data-retention.md`, and
required by `docs/features/outcomes-learning.md` — but until now it had no document. This is that
document.

Two tables: `applications` and `practice_sessions`.

## `applications`

```sql
CREATE TABLE applications (
  id                uuid         PRIMARY KEY,          -- UUIDv7
  user_id           uuid         NOT NULL,
  job_posting_id    uuid,                              -- null when applied outside Zentavio
  company_id        uuid,                              -- resolved where known
  external_role     text,                              -- free-form title when there is no posting row

  status            text         NOT NULL,             -- current stage; history in application_events
  applied_at        timestamptz,
  closed_at         timestamptz,

  -- What we said at the time, so the outcome can calibrate it.
  match_id          uuid,
  predicted_score   numeric(5,4),
  scorer_version    text,

  -- Migration context, since it is the point of the product for these users.
  required_sponsorship  boolean  NOT NULL DEFAULT false,
  sponsorship_status_at_apply text,                    -- what we told them: stated_available | unknown | ...
  country_code      char(2),

  source            text         NOT NULL,             -- 'zentavio' | 'user-recorded' | 'imported'
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT fk_applications__users     FOREIGN KEY (user_id)        REFERENCES users(id)        ON DELETE RESTRICT,
  CONSTRAINT fk_applications__postings  FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_applications__companies FOREIGN KEY (company_id)     REFERENCES companies(id)    ON DELETE RESTRICT,
  CONSTRAINT fk_applications__matches   FOREIGN KEY (match_id)       REFERENCES matches(id)      ON DELETE SET NULL,

  CONSTRAINT ck_applications__status CHECK (status IN (
    'saved','applied','screening','interviewing','offered','accepted','rejected','withdrawn','expired'
  )),
  CONSTRAINT ck_applications__source CHECK (source IN ('zentavio','user-recorded','imported')),
  -- A posting row or a typed-in role: one of the two must identify what was applied to.
  CONSTRAINT ck_applications__identifies_role CHECK (job_posting_id IS NOT NULL OR external_role IS NOT NULL),
  CONSTRAINT ck_applications__predicted CHECK (predicted_score IS NULL OR scorer_version IS NOT NULL)
);

CREATE INDEX idx_applications__user_status ON applications (user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_applications__open ON applications (user_id, applied_at DESC)
  WHERE deleted_at IS NULL AND closed_at IS NULL;
CREATE UNIQUE INDEX uq_applications__user_posting ON applications (user_id, job_posting_id)
  WHERE job_posting_id IS NOT NULL AND deleted_at IS NULL;
```

### Why these columns

**`job_posting_id` nullable, with `external_role` as the alternative.** People apply to things they found
elsewhere, and refusing to record those would make the outcome loop see a biased slice — only the
applications we sourced. `ck_applications__identifies_role` ensures one of the two is present.

**`predicted_score` and `scorer_version` copied at apply time.** The match may be recomputed later
(matches are not caches), so the prediction must be frozen here or calibration compares against a number
we have since changed (`entities/match.md`).

**`sponsorship_status_at_apply`.** What we *told* them when they applied. If someone applies believing
sponsorship was available and it was not, that is a product failure we need to be able to see — and it is
only visible if the claim at the time is recorded (`docs/features/migration-friendly-jobs.md`).

**`ON DELETE SET NULL` for `match_id`** — the only one in the cluster. A recomputed match may be
superseded; the application survives it.

## `application_events`

Status is a current value; the timeline is the data.

```sql
CREATE TABLE application_events (
  id              uuid         PRIMARY KEY,
  application_id  uuid         NOT NULL,
  status          text         NOT NULL,
  occurred_at     timestamptz  NOT NULL,
  source          text         NOT NULL,        -- 'user-reported' | 'inferred' | 'platform-observed'
  note_free_text  text,                         -- NEVER populated; see below
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT fk_app_events__applications FOREIGN KEY (application_id)
    REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT ck_app_events__no_free_text CHECK (note_free_text IS NULL)
);
CREATE INDEX idx_app_events__application ON application_events (application_id, occurred_at);
```

`note_free_text` exists with a `CHECK` forbidding it, deliberately: it documents that the column was
considered and rejected. A notes field on a rejection becomes the most sensitive, least controllable data
in the schema, and asking someone to explain a rejection is a good way to never be told about one again
(`docs/features/outcomes-learning.md`). If it is ever wanted, the constraint has to be dropped
explicitly, in review.

Cascade here is correct: an event has no meaning without its application.

## `practice_sessions`

```sql
CREATE TABLE practice_sessions (
  id                uuid         PRIMARY KEY,
  user_id           uuid         NOT NULL,
  application_id    uuid,                              -- null for untargeted practice
  company_id        uuid,
  role_family       text,

  theme_id          uuid,                              -- the interview theme practised
  question_kind     text         NOT NULL,             -- 'generated-practice' | 'reported-theme'
  skill_ids         uuid[]       NOT NULL DEFAULT '{}',

  strength          text         NOT NULL,             -- 'strong' | 'adequate' | 'weak' — about the ANSWER
  rubric_met        jsonb        NOT NULL DEFAULT '[]',
  rubric_missing    jsonb        NOT NULL DEFAULT '[]',

  prompt_version    text,
  occurred_at       timestamptz  NOT NULL,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT fk_practice__users        FOREIGN KEY (user_id)        REFERENCES users(id)        ON DELETE RESTRICT,
  CONSTRAINT fk_practice__applications FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE RESTRICT,
  CONSTRAINT ck_practice__strength CHECK (strength IN ('strong','adequate','weak')),
  CONSTRAINT ck_practice__question_kind CHECK (question_kind IN ('generated-practice','reported-theme'))
);
CREATE INDEX idx_practice__user_theme ON practice_sessions (user_id, theme_id, occurred_at DESC)
  WHERE deleted_at IS NULL;
```

**No answer text stored.** The rubric result is what has future value; the answer itself is the most
personal thing in an interview practice session and keeping it buys nothing.

**`strength` describes the answer, never the person** — `docs/features/interview-prep.md`. And
`question_kind = 'generated-practice'` is recorded so a generated question is never later mistaken for
one a company actually asked.

## Relationships

```text
users ──1:N──► applications ──1:N──► application_events
                    │  1:N
                    ├────────────► outcomes        (outcomes.application_id)
                    └────────────► practice_sessions
job_postings ──1:N──► applications
matches ──0:1──────► applications  (frozen prediction)
```

## Retention

| Table | Retention | On erasure |
|---|---|---|
| `applications` | while the account is active | hard delete |
| `application_events` | with its application | cascade |
| `practice_sessions` | 12 months, then aggregate signal only | hard delete |

Outcomes referencing a deleted application are **detached, not deleted** — the pattern survives with the
link removed (`entities/outcome.md`).

## Invariants

- A posting reference or an `external_role`, never neither.
- `predicted_score` requires `scorer_version`.
- No free text anywhere — enforced by `CHECK`, not by convention.
- No answer text in a practice session.
- `strength` is about the answer.
- Every query predicates on the subject.

## Related

- `entities/outcome.md`, `entities/match.md`, `entities/user.md`
- `docs/features/outcomes-learning.md`, `interview-prep.md`, `migration-friendly-jobs.md`
- `../data-retention.md`
