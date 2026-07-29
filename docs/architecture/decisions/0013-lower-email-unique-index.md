# ADR 0013: Case-insensitive email uniqueness via a `lower(email)` unique index

- **Status:** Accepted
- **Accepted:** 2026-07-29
- **Date:** 2026-07-29
- **Deciders:** project lead
- **Affects:** `packages/db` (schema, migrations, user repository), `docs/database/entities/user.md`,
  `.claude/context/tech-stack.md`, `infra/docker`, any future hosted PostgreSQL

## Context

`docs/database/entities/user.md` declares:

```sql
email citext NOT NULL
CREATE UNIQUE INDEX uq_users__email ON users (email) WHERE deleted_at IS NULL;
```

`citext` is a PostgreSQL **extension**, and `.claude/skills/database/SKILL.md` states
*"No new datastore, extension, or ORM without an ADR."* `.claude/context/tech-stack.md` repeats it
for anything not in the stack. So the `users` table cannot be migrated until this is settled — which
is what blocked step 4 of the migration order in `packages/db/README.md`.

Three things make the choice non-obvious rather than a style preference.

**Uniqueness here is a security property, not a convenience.** `Ada@example.com` and
`ada@example.com` are the same mailbox at every provider anyone uses. Two rows means two accounts for
one human: password reset, verification email, and account recovery all become ambiguous, and the
ambiguity is resolvable in the attacker's favour. This must be enforced by the database, because a
constraint that lives only in application code is not a constraint — it is a convention with a race
condition.

**The hosting target is undecided.** Nothing in `.claude/context/tech-stack.md` names a managed
PostgreSQL provider. An extension is available on most of them and awkward on a few; committing to
one now spends portability we have not yet decided we can afford.

**Case is not the whole normalization problem.** Whitespace, unicode confusables, and provider-specific
rules (Gmail's dots and `+` tags) are all normalization concerns, and none of them are solved by any
option below. Whatever is chosen, the application still normalizes before writing. The question is
narrower than it looks: *what does the database guarantee on top of that?*

## Options considered

### Option A — `citext`

`email citext NOT NULL`, with the existing unique index unchanged.

**Advantages.**

- **Developer experience is the best available.** `WHERE email = $1` is case-insensitive with no
  discipline required at the call site, and a developer cannot forget something the type does for
  them.
- **Simplicity at the query layer.** One concept, applied once, at the column.
- **Duplicate risk is low** and enforced by the database.
- **Performance is comparable** to Option B. `citext` folds case at comparison time; a plain B-tree
  on the column serves equality lookups.
- Extension ships in PostgreSQL's `contrib`, is present on the common managed providers, and is
  stable — it is not going away.

**Disadvantages.**

- **It is an extension**, which the database skill and the tech stack both gate behind exactly this
  ADR. Every environment — local compose, CI service container, and whichever provider is eventually
  chosen — must have it installed and must be *checked* to have it. `CREATE EXTENSION` also requires
  elevated privilege, which some managed and hardened instances grant only through their own console.
- **Portability cost.** `citext` is PostgreSQL-specific. A dump restored into an instance without the
  extension fails at type resolution, not at row insert — a failure at the least convenient moment.
- **Migration complexity is asymmetric.** Adopting it is easy. Leaving it is an `ALTER TYPE` on a
  populated column, which `docs/database/migrations.md` classifies as *never in one step*: new column
  → backfill → switch → drop, four migrations and three deploys.
- **PostgreSQL itself now steers elsewhere.** The documented modern equivalent is a nondeterministic
  collation, which makes `citext` a long-lived legacy path rather than the recommended one. Choosing
  it is choosing a third thing to migrate off later.
- **Future maintenance** carries one more moving part in every environment, forever, for a rule
  expressible in core SQL.

### Option B — `text` + a unique index on `lower(email)`

```sql
email text NOT NULL
CREATE UNIQUE INDEX uq_users__email ON users (lower(email)) WHERE deleted_at IS NULL;
```

**Advantages.**

- **Core PostgreSQL.** No extension, no privilege requirement, no per-environment check. It works
  identically on local compose, a CI service container, and every managed provider — including the
  restricted ones, which is precisely the case the undecided hosting target has to survive.
- **The database guarantee is identical to Option A.** A functional unique index rejects
  `ADA@example.com` when `ada@example.com` is live, at write time, under concurrency.
- **Portability.** A functional unique index is expressible in every engine we would plausibly move
  to. Nothing to unwind on a dump/restore.
- **Migration complexity is the lowest of the three**: one `CREATE TABLE`, one index, no extension
  step, no ordering dependency on a `CREATE EXTENSION` having succeeded.
- **The original casing is preserved.** The column stores what the person typed; only the index folds
  it. That matters for addressing them in an email, and it keeps RFC 5321's technically
  case-sensitive local part recoverable if it ever matters.
- **Failure mode is the safe one** — see the Decision.
- **Future maintenance is zero.** There is nothing to upgrade, install, or verify.

**Disadvantages.**

- **Lookups must say `lower(email) = lower($1)`** to use the index. A forgotten `lower()` is a
  sequential scan and a lookup that misses a differently-cased row.
- Slightly more to know when reading the schema than "the column is case-insensitive".
- The index is on an expression, so `EXPLAIN` output is marginally less obvious.

### Option C — application-layer normalization only

Lower-case in `packages/db`'s user repository before every write and every lookup; a plain unique
index on `email`.

**Advantages.**

- No extension, no functional index, nothing PostgreSQL-specific.
- Fully portable, and the normalization code is needed anyway for whitespace and unicode.

**Disadvantages, and they are disqualifying.**

- **It is not a guarantee.** Two concurrent registrations for `Ada@…` and `ada@…` both pass an
  application-level check and both commit. The window is small and the consequence is a duplicated
  human identity, which is the exact failure this constraint exists to prevent.
- **Every non-application writer bypasses it**: a migration, a backfill, an admin action, a support
  engineer in `psql`, a future service. The database is the only place a rule applies to all of them.
- Contradicts the project's own standard — `docs/database/entities/*.md` puts invariants in `CHECK`
  constraints and unique indexes specifically so that guessing is not expressible.
- The bug it produces is **silent**. Nothing fails; there are simply two accounts, discovered later
  by a confused user or an account-recovery incident.

Option C is not an alternative to A or B. Application normalization happens in **all three**, because
case is only one of several normalizations. The question is what backs it.

## Comparison

| Criterion | A — `citext` | B — `lower()` unique index | C — application only |
|---|---|---|---|
| PostgreSQL compatibility | extension required, privileged install | core, everywhere | core, everywhere |
| Performance | equality via B-tree, case folded per comparison | equality via functional index; needs `lower()` in the predicate | fastest index, wrong answers |
| Simplicity | best at the call site | one convention at the call site | simplest schema, no guarantee |
| Migration complexity | `CREATE EXTENSION` first; leaving it is a 4-step retype | one table, one index | one table, one index |
| Portability | PostgreSQL-only; dump fails without the extension | portable | portable |
| Developer experience | best | good, one thing to remember | best until the incident |
| Risk of duplicate emails | low, database-enforced | low, database-enforced | **high, race-prone and silent** |
| Future maintenance | one extension per environment, forever; PostgreSQL now recommends collations instead | none | recurring reconciliation of duplicates |

## Decision

**Option B — `users.email` is `text`, and case-insensitive uniqueness is enforced by a partial unique
index on `lower(email)`.** `citext` is rejected, and no PostgreSQL extension is added.

The deciding argument is not the extension's cost — it is the **shape of each option's failure mode**.

- Option A's cost lands on *environments*: an instance without the extension fails to restore, and a
  provider that restricts `CREATE EXTENSION` blocks a deploy. That is a failure in a place we have
  not chosen yet.
- Option B's cost lands on *one query predicate*, and it fails **loudly and harmlessly**: a forgotten
  `lower()` means a user cannot find their account, which is an immediately visible bug. It can never
  produce a duplicate, because uniqueness is enforced at write regardless of how any query is
  written.
- Option C's cost lands on *data integrity*, silently.

A bug that shows up as "login didn't work" is recoverable. A bug that shows up as two accounts for
one person is not, and neither is a deploy blocked by a missing extension.

The `lower()` discipline is also cheap **here specifically**: ADR-0012 made hand-written repository
functions in `packages/db` the only path to the database, so the convention lives in one file rather
than being scattered across services.

The column stays `NOT NULL` and stores the address as entered. Normalization of whitespace and case
before writing is the repository's job; the index is what makes it true.

## Consequences

**Accepted costs.**

- Every email lookup must be written `lower(email) = lower($1)`. In Kysely that is
  `sql\`lower(${eb.ref('email')})\`` rather than a bare `.where('email', '=', …)` — less pretty, and
  a real thing to remember.
- `docs/database/entities/user.md` diverges from what it declared, so the document is edited in this
  same change.
- Storing as-entered means two rows can differ in display casing across a soft-delete boundary
  (`ada@…` deleted, `Ada@…` live). Harmless, occasionally surprising in an admin view.
- If a second case-insensitive column ever appears, this convention is repeated rather than declared
  once at a type.

**Follow-up work.**

- The `users` repository, with `findByEmail` implemented via `lower()` and a test that a
  differently-cased address resolves to the same row.
- Email normalization (trim, case, unicode) in the repository, with the tests that go with it —
  this ADR settles the *guarantee*, not the normalization rules.
- **Erasure interacts with `NOT NULL`.** `user.md`'s erasure procedure clears identifying columns and
  sets `status = 'erased'`, but `email` is `NOT NULL`. What an erased row's email becomes is
  undecided and is *not* settled here.
- The remaining tables in the user cluster (`user_consents`, `user_profiles`, `profile_skills`,
  `user_country_preferences`, `user_immigration_facts`) still need `skills` and `careers` first.

**Reversal cost.** Low in one direction, moderate in the other, and this is the cheap moment either
way — the table is new and empty.

- **B → A** later: `CREATE EXTENSION citext`, then a four-step retype per
  `docs/database/migrations.md` (add column → backfill → switch reads → drop). The signal to do it
  would be case-insensitive comparison spreading to several columns, at which point a type earns its
  keep.
- **B → C**: never. Dropping the index is dropping the guarantee.
- Reversing *today*, before any commit, is one migration file and one entity-document edit.

## Compliance

- **The index is the enforcement.** `uq_users__email` on `lower(email)` where `deleted_at IS NULL`,
  verified in `tests/integration/db/users-constraints.test.ts` by inserting a differently-cased
  duplicate and asserting the violated index's name — not merely that something threw.
- **No extension.** `SELECT extname FROM pg_extension` on a migrated database returns only
  `plpgsql`, asserted in the same integration file. That is what stops `citext` reappearing quietly
  through some later migration.
- **A reviewer check:** any query filtering on `email` without `lower()` on both sides is a defect.
- `.claude/context/tech-stack.md` gains no new entry, which is itself the point.

## Related

- `docs/database/entities/user.md` — the specification this changes
- `docs/database/migrations.md` — why an `ALTER TYPE` on a populated column is a four-step migration
- `.claude/skills/database/SKILL.md` — "no new datastore, extension, or ORM without an ADR"
- ADR-0012 — repositories are the only path to the database, which is what makes the `lower()`
  convention affordable
