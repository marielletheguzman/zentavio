# Seeds

> **Purpose:** Bootstrap reference data — the closed skill set the résumé parser resolves against.

A seed is **reference data, not schema**. It is deliberately not a migration: migrations are
immutable once applied (`docs/database/migrations.md`), and this data is expected to be **replaced**
by real ingestion rather than amended forever by a chain of `INSERT` migrations.

```bash
pnpm seed:dry-run     # report what would change, write nothing
pnpm seed             # apply
```

Idempotent, keyed on `slug`. Running it twice changes nothing.

## Why this exists at all

`ai/resume-parser` resolves extracted phrases against a **closed set** of skill slugs — the model may
only return ids from a supplied list, never invent one (`docs/prompts/conventions.md`). Without a
populated `skills` table there is no closed set, so there is nothing to parse against. This is the
smallest set that makes M1a's one track real.

## The provenance, stated plainly

**Every row here is `source_tier: 3`, `basis: 'curated'`, with `retrieved_at` NULL.** That is a
deliberate and slightly uncomfortable choice, so here is the reasoning:

- **It is not tier 1 or 2.** Those require an authoritative or reliable *source that was actually
  consulted*. These identifications were curated by hand. Claiming ESCO or O\*NET as the source
  without having ingested them would be a provenance lie, and provenance is on the not-cuttable list
  (`docs/roadmap/mvp.md`).
- **It is not tier 4.** Tier 4 is *anecdotal* — forums, self-reported experience
  (`.claude/context/knowledge-sources.md`). A curated taxonomy is not anecdotal; it is closest in
  spirit to tier 3, "what teams actually use".
- **`retrieved_at` stays NULL** because nothing was retrieved. `source_url` points at each
  technology's canonical documentation so the claim is *checkable*, not because that page was
  fetched and parsed.

**Consequence, and it is the intended one:** tier 3 maps to `low` confidence
(`.claude/context/knowledge-sources.md`), so anything computed from these rows carries low confidence
until they are superseded. That is honest. A hand-seeded registry should not produce confident
answers.

## What this is not

- **Not the skill graph.** No `requires` edges, no weights, no `career_skills`. Those are M1b, and
  they need a real method (co-occurrence across ingested postings, with recorded support) rather than
  a hand-assembled ordering. A `requires` edge asserted without evidence would make every learning
  path a guess presented as a sequence.
- **Not a claim about the track.** The single `careers` row exists so `user_profiles` can reference
  it. Nothing user-facing should describe the track from this data alone.

## Superseding it

Replacement is additive by construction: real ingestion writes rows with a higher `source_tier` and a
real `retrieved_at`, and conflict resolution prefers the higher tier
(`.claude/context/knowledge-sources.md`). The `slug` is the identity that survives, which is why slugs
are permanent and never reused.

`knowledge-engine/ingest` will own this once it exists. It lives in `packages/db` today for one
reason: `packages/*` must not import from `knowledge-engine/` (`eslint.config.mjs`, ADR-0001), and a
loader that writes to the database belongs on the database side of that boundary.

## Related

- `docs/database/entities/skill.md`, `career.md` — the tables
- `.claude/context/knowledge-sources.md` — the tiers and what each may be used to state
- `docs/features/resume-parsing.md` — the consumer, and why the set must be closed
