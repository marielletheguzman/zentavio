-- `requirements.kind` loses `'quota'` (ADR-0027).
--
-- ## Why a value nothing uses is being removed
--
-- A quota is a **capacity limit on a destination**, not a condition a person satisfies. Nothing an
-- applicant knows, holds, earns or proves changes whether a canton's allocation is exhausted — so a
-- quota cannot be answered `met` / `not_met` / `undetermined` against their facts, which is what
-- `docs/database/entities/requirement.md` means by *one evaluable requirement per row*.
--
-- Stored as a requirement it fails in both directions. With no value, `undetermined` dominance
-- makes every verdict for that pathway `undetermined` forever while naming an input no person can
-- supply. With a value, an exhausted quota becomes a **blocker** — telling somebody they *failed* a
-- capacity limit, which is the same false statement about a person that made `not_applicable`
-- necessary in ADR-0024.
--
-- ## The contradiction this resolves
--
-- The schema has said both things since 2026-07-29, in two places that never met:
--
--   * `immigration_pathways.quota jsonb`     — a quota is a property of the pathway
--   * `requirements.kind` CHECK includes 'quota' — a quota is a requirement
--
-- Nothing has ever written either, so the disagreement was invisible. Switzerland's Höchstzahlen
-- would have been the first write, and the wrong column is cheap to prevent now and expensive to
-- unpick later. **The pathway column wins**; this makes the other choice a database error rather
-- than something caught in review.
--
-- ## Why this is a new migration rather than an edit
--
-- `20260729120100-create-requirements.sql` is applied and checksummed
-- (`packages/db/src/migrations/runner.ts`), so it cannot be edited. This is the additive migration
-- that supersedes its constraint, the pattern `docs/database/migrations.md` requires.

-- **Verified before narrowing:** no stored requirement uses the value being removed. The constraint
-- would refuse to validate if one did, which is the check rather than a comment claiming it.
ALTER TABLE requirements DROP CONSTRAINT ck_req__kind;

ALTER TABLE requirements
  ADD CONSTRAINT ck_req__kind CHECK (kind IN (
    'eligibility','threshold','document','timeline','condition','right','assessment'
  ));

COMMENT ON COLUMN requirements.kind IS
  'What kind of requirement this is. A quota is NOT one of these — it is a property of the pathway '
  '(immigration_pathways.quota), because a capacity limit is not something a person can satisfy or '
  'fail. See ADR-0027.';

COMMENT ON COLUMN immigration_pathways.quota IS
  'The cap on this pathway, where one exists: that it exists, what allocates it, its period, and '
  'its value when we have sourced one. NULL means unsourced, which renders as capped-and-unsourced '
  'rather than as uncapped. See ADR-0027.';
