# Entity: Match

> **Purpose:** User-to-job match record and score.

**Derived data.** A match is recomputable from profile facts plus posting requirements. It is never
authoritative, and it is worthless without the evidence and versions that produced it.

This table is where "a number with no provenance is a bug" becomes a schema constraint.

## `matches`

```sql
CREATE TABLE matches (
  id                uuid         PRIMARY KEY,          -- UUIDv7
  user_id           uuid         NOT NULL,
  job_posting_id    uuid         NOT NULL,

  score             numeric(5,4),                      -- 0..1; NULL when status <> 'scored'
  status            text         NOT NULL,             -- 'scored' | 'unknown'
  confidence        text         NOT NULL,             -- 'high' | 'medium' | 'low'

  evidence          jsonb        NOT NULL,             -- contributing factors with weights
  missing           jsonb        NOT NULL DEFAULT '[]',-- what we would need to do better
  constraints       jsonb        NOT NULL DEFAULT '[]',-- named hard constraints applied

  scorer_version    text         NOT NULL,
  prompt_version    text,                              -- null when no model was involved
  knowledge_as_of   timestamptz  NOT NULL,
  computed_at       timestamptz  NOT NULL,

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT fk_matches__users        FOREIGN KEY (user_id)        REFERENCES users(id)        ON DELETE RESTRICT,
  CONSTRAINT fk_matches__job_postings FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE RESTRICT,

  CONSTRAINT ck_matches__status     CHECK (status IN ('scored','unknown')),
  CONSTRAINT ck_matches__confidence CHECK (confidence IN ('high','medium','low')),
  CONSTRAINT ck_matches__score_range CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  -- The two rules that make this table honest:
  CONSTRAINT ck_matches__score_iff_scored CHECK ((status = 'scored') = (score IS NOT NULL)),
  CONSTRAINT ck_matches__evidence_present CHECK (jsonb_array_length(evidence) > 0)
);

CREATE UNIQUE INDEX uq_matches__user_job ON matches (user_id, job_posting_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_matches__user_score ON matches (user_id, score DESC NULLS LAST) WHERE deleted_at IS NULL;
CREATE INDEX idx_matches__stale ON matches (knowledge_as_of) WHERE deleted_at IS NULL;
```

### The two constraints that matter

**`ck_matches__score_iff_scored`.** A match is either scored with a number, or `unknown` with no
number. There is no third state where a missing computation is recorded as `0.0` — a zero score and an
uncomputable score mean opposite things to a user, and conflating them is how a platform starts
lying quietly (`.claude/context/ai-principles.md`).

**`ck_matches__evidence_present`.** A row cannot exist without at least one evidence entry. This is
principle 2 in schema form: explainability is not a UI feature applied later, it is a property of the
record. An `unknown` row still carries evidence — the factors that *were* determined, plus `missing`
explaining what stopped it.

## `evidence` shape

```json
[
  { "kind": "skill_match",    "label": "Kubernetes", "skillId": "…", "weight": 0.18,
    "detail": "evidenced: 2 roles", "factIds": ["…"] },
  { "kind": "skill_missing",  "label": "Terraform",  "skillId": "…", "weight": 0.12,
    "detail": "required by posting, weight 0.14" },
  { "kind": "skill_transfer", "label": "Docker→Kubernetes", "weight": 0.08,
    "detail": "transfers_to edge 0.8", "edgeId": "…" },
  { "kind": "seniority",      "label": "senior vs mid posting", "weight": -0.05 }
]
```

Rules:

- **Weights reconcile to `score`.** Asserted generically across every scorer, not per test
  (`.claude/skills/testing/SKILL.md`).
- **Negative contributions appear too.** A hidden penalty is an unexplainable score; users act on
  gaps more than on strengths.
- **`factIds` and `edgeId` point at knowledge rows**, so evidence is traceable to sourced facts rather
  than being prose written after the fact.

## `constraints` shape

Hard constraints are **named**, never applied as a silent multiplier:

```json
[
  { "kind": "eligibility", "label": "work authorization required",
    "result": "undetermined", "binding": true, "detail": "DE: no pathway evaluated yet" },
  { "kind": "language", "label": "German B2 expected", "result": "not_met", "binding": true }
]
```

A posting the person cannot legally take is not silently down-ranked — the constraint is stated and
`binding` identifies which one decides the outcome (`docs/architecture/immigration.md`).

## Reproducibility

The four version columns exist so a past match can be re-derived exactly:

| Column | Answers |
|---|---|
| `scorer_version` | which arithmetic produced it |
| `prompt_version` | which prompt shaped any extraction involved |
| `knowledge_as_of` | which state of the world it was computed against |
| `computed_at` | when we said it |

Same inputs plus same versions must yield the identical score, byte for byte. A test asserting a
*range* on this output would hide non-determinism, so exact assertions are the rule.

## Recomputation, not caching

A match is not a cache — it is a record of a judgment made at a point in time. Knowledge moves, so:

- Serving a match whose `knowledge_as_of` predates a relevant fact change is serving a stale verdict
  confidently. `idx_matches__stale` makes finding those cheap.
- Recomputation writes a **new** value with new versions; the previous row is superseded rather than
  silently overwritten, so "why did my score change?" is answerable.
- Changing a scorer bumps `scorer_version` and requires an eval run before it ships
  (`docs/prompts/evals.md`).

## Sibling derived tables

The same shape and the same constraints apply to:

| Table | Subject |
|---|---|
| `readiness_scores` | person × target career — plus a `remaining jsonb` (the gap that stays) |
| `skill_gaps` | person × target — weighted, dependency-ordered items |
| `learning_paths` | person × target — ordered steps, each tied to a gap item |

`readiness_scores` carries one extra rule: **a readiness row without `remaining` is invalid.** A
readiness number with no remainder is a vanity metric
(`.claude/skills/career-intelligence/SKILL.md`).

## Retention

Person data by association. Deleted on erasure — cheaply, because everything here is recomputable
(`entities/user.md`). Not retained after the account is erased, and not contributed to aggregates:
what feeds the learning loop is `outcomes`, not `matches`.

## Invariants

- `status = 'scored'` if and only if `score` is not null.
- `evidence` is never empty.
- Weights in `evidence` reconcile to `score`.
- Every constraint applied appears in `constraints`, with `binding` set on the deciding one.
- All four version columns populated on every row (`prompt_version` nullable only when no model ran).
- One live match per (`user_id`, `job_posting_id`).
- Never displayed as a Career Score — different subject, different question
  (`docs/GLOSSARY.md`).

## Related

- `.claude/skills/ai-matching/SKILL.md` — the output contract this table persists
- `entities/user.md`, `entities/job.md`, `entities/outcome.md`
- `docs/features/job-matching.md`, `docs/GLOSSARY.md` (the five distinct scores)
- `docs/architecture/ai-services.md`
