# Entity: Outcome

> **Purpose:** Anonymized user outcome record.

The most valuable rows in the system and the most re-identifiable. Outcomes are what turn described
scores into predicted ones (`docs/architecture/knowledge-engine.md`), and "rejected by company X for
role Y in month Z" is close to unique.

So the design rule is: **the aggregate is the product, the row never is.**

## `outcomes`

```sql
CREATE TABLE outcomes (
  id                uuid         PRIMARY KEY,          -- UUIDv7

  -- Nulled on erasure. Everything below survives as an anonymous contribution.
  user_id           uuid,
  application_id    uuid,

  kind              text         NOT NULL,
  occurred_at       timestamptz  NOT NULL,
  occurred_month    date         NOT NULL,             -- month-truncated; what aggregation reads

  -- The pattern: what was attempted, from where, in which market.
  career_id         uuid,
  target_career_id  uuid,
  company_id        uuid,
  country_code      char(2),
  seniority         text,
  was_relocation    boolean      NOT NULL DEFAULT false,
  was_career_change boolean      NOT NULL DEFAULT false,

  -- What we predicted at the time. This is what makes calibration possible.
  predicted_score   numeric(5,4),
  predicted_kind    text,                              -- 'job_match' | 'readiness' | 'viability'
  scorer_version    text,
  knowledge_as_of   timestamptz,

  -- Bounded, non-identifying context.
  elapsed_days      integer,                           -- from application to this outcome
  skill_snapshot    jsonb        NOT NULL DEFAULT '[]', -- [{skillId, status}] — ids only, no text
  source            text         NOT NULL,             -- 'user-reported' | 'inferred' | 'platform-observed'
  confidence        text         NOT NULL,

  anonymized_at     timestamptz,                       -- set when user_id is detached
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_outcomes__users        FOREIGN KEY (user_id)          REFERENCES users(id)        ON DELETE RESTRICT,
  CONSTRAINT fk_outcomes__applications FOREIGN KEY (application_id)   REFERENCES applications(id) ON DELETE RESTRICT,
  CONSTRAINT fk_outcomes__career       FOREIGN KEY (career_id)        REFERENCES careers(id)      ON DELETE RESTRICT,
  CONSTRAINT fk_outcomes__target       FOREIGN KEY (target_career_id) REFERENCES careers(id)      ON DELETE RESTRICT,
  CONSTRAINT fk_outcomes__company      FOREIGN KEY (company_id)       REFERENCES companies(id)    ON DELETE RESTRICT,

  CONSTRAINT ck_outcomes__kind CHECK (kind IN (
    'applied','screened','interviewed','offered','rejected','withdrawn',
    'accepted','started','relocated','course_completed','assessment_passed'
  )),
  CONSTRAINT ck_outcomes__source CHECK (source IN ('user-reported','inferred','platform-observed')),
  CONSTRAINT ck_outcomes__confidence CHECK (confidence IN ('high','medium','low')),
  -- Detachment is a state, not a guess: anonymized means no subject.
  CONSTRAINT ck_outcomes__anonymized CHECK ((anonymized_at IS NULL) = (user_id IS NOT NULL))
);

CREATE INDEX idx_outcomes__user ON outcomes (user_id, occurred_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_outcomes__pattern ON outcomes (target_career_id, country_code, kind, occurred_month);
CREATE INDEX idx_outcomes__transition ON outcomes (career_id, target_career_id, kind) WHERE was_career_change;
CREATE INDEX idx_outcomes__calibration ON outcomes (scorer_version, kind) WHERE predicted_score IS NOT NULL;
```

## Why these columns

**`occurred_month` beside `occurred_at`.** Aggregation reads the month-truncated column, never the
timestamp. An exact timestamp plus a company plus a role is identifying; a month is not. Both are
stored because the user's own timeline needs the precise value while every cross-user query needs the
coarse one.

**`predicted_score` and `scorer_version`.** The loop only closes if we recorded what we *said* before
we learned what happened. Without these, outcomes describe the market but cannot calibrate our own
scoring — which is the whole point (`.claude/skills/ai-matching/SKILL.md`).

**`skill_snapshot` as ids only.** The profile at the time of the attempt, so "which starting points
actually succeed" is answerable later. Skill ids and status only — no free text, no source spans,
nothing that reconstructs a résumé.

**`ck_outcomes__anonymized`.** Detachment is enforced rather than trusted: a row either has a subject
and no `anonymized_at`, or it has `anonymized_at` and no subject. There is no state where an
"anonymized" row still points at a person.

**`source`.** A user-reported rejection, an inferred one (no response in 60 days), and a
platform-observed event are different evidence strengths. Inferred outcomes are especially useful and
especially wrong sometimes — the `confidence` column travels with them.

**No free-text column at all.** Deliberate. A notes field on an outcome would become the most
sensitive and least controllable column in the schema.

## What outcomes feed

| Consumer | Reads | Produces |
|---|---|---|
| `career_edges.transition_path` | `was_career_change`, `career_id` → `target_career_id`, `kind='offered'` | observed transition frequency — so a proposed route can prefer one people actually took |
| time-to-competence | `course_completed`, `assessment_passed`, `elapsed_days` | estimates that move from assumed to observed |
| `connector_sources.reliability` | outcomes on postings from a source | a source yielding dead postings loses reliability regardless of its tier |
| score calibration | `predicted_score` vs actual `kind` | whether 0.72 means what it claimed |

## Aggregation rules

- **Minimum support before anything is surfaced.** Below the threshold the answer is "not enough data
  yet" — a valid, shippable answer here, and both an honesty and a privacy control.
- **Always with `n` and a window.** "37 of 120 (last 18 months)", never "users like you often…".
- **Never surfaced individually**, in either direction: one person's outcome never appears in another
  person's view, and no market figure carries a path back to a contributor.
- **Aggregation reads the month, the ids, and the flags** — not the timestamp, not the application.

## Retention and erasure

Indefinite, **detached** rather than deleted (`data-retention.md`):

```text
erasure → user_id = NULL, application_id = NULL, anonymized_at = now()
        → the pattern row remains and keeps contributing to aggregates
```

This boundary is stated to the user at erasure rather than implied: aggregates already computed have no
path back to the individual and are not withdrawn. The alternative — deleting outcomes on erasure —
would mean the learning loop silently degrades every time someone leaves, and the data cannot be
recovered or backfilled.

## Invariants

- `anonymized_at` set if and only if `user_id` is null.
- No free text, ever.
- `skill_snapshot` holds ids and status only.
- Aggregation queries read `occurred_month`, never `occurred_at`.
- Nothing surfaced below minimum support.
- `predicted_score` requires `scorer_version` — an uncalibratable prediction is not worth recording.
- Outcomes are append-only. A correction is a new row, not an edit: what we believed at the time is
  itself the data.

## Related

- `docs/architecture/knowledge-engine.md` — the feedback loop
- `docs/architecture/privacy.md`, `data-retention.md` — the detachment rule
- `docs/features/outcomes-learning.md`
- `entities/user.md` (erasure order), `entities/match.md` (what `predicted_score` came from)
