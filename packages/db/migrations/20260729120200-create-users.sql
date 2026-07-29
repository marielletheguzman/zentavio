-- Account identity (docs/database/entities/user.md).
--
-- Deliberately thin: the less that sits here, the smaller the blast radius. No password column —
-- credentials, if stored at all, live in packages/auth's own table with its own access controls,
-- because a table joined on every request should not contain a hash.
--
-- `email` is `text` and `uq_users__email` folds the case, rather than the column being `citext`
-- (ADR-0013). `citext` is a PostgreSQL extension, the hosting target is undecided, and a functional
-- unique index gives exactly the same write-time guarantee using only core PostgreSQL. There is
-- therefore no CREATE EXTENSION in this migration, and tests/integration/db/users-constraints.test.ts
-- asserts that the database has no extension beyond plpgsql — so citext cannot reappear quietly.
--
-- Every lookup must filter `lower(email) = lower($1)`. A forgotten `lower()` is a missed row, which
-- is visible immediately; it can never be a duplicate account, which would not be.
--
-- No `IF NOT EXISTS`: the runner's `schema_migrations` record is what makes applying this twice a
-- no-op. `IF NOT EXISTS` would additionally swallow a `users` table that exists for some *other*
-- reason, which is a collision worth failing on.
--
-- Indexes are created in this transaction rather than CONCURRENTLY, for the reason given in
-- 20260729120000-create-immigration-pathways.sql: the table is empty here, and uq_users__email is a
-- correctness constraint that must not have a window where it is absent.

CREATE TABLE users (
  id                 uuid        PRIMARY KEY,                 -- UUIDv7, generated in the application
  email              text        NOT NULL,                    -- stored as entered; uniqueness folds case
  email_verified_at  timestamptz,
  auth_provider      text        NOT NULL,                    -- 'password' | 'oidc:<issuer>'
  auth_subject       text,                                    -- external identity, when delegated
  locale             text        NOT NULL DEFAULT 'en',
  timezone           text,
  status             text        NOT NULL DEFAULT 'active',
  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  CONSTRAINT ck_users__status CHECK (status IN ('active','suspended','erased'))
);

-- One live account per mailbox. Case-folded because Ada@example.com and ada@example.com are the
-- same mailbox at every provider anyone uses, and two rows for one human makes password reset and
-- account recovery ambiguous — resolvable in an attacker's favour.
CREATE UNIQUE INDEX uq_users__email ON users (lower(email)) WHERE deleted_at IS NULL;

-- A delegated identity is unique per issuer. Not partial on deleted_at: an external subject must not
-- be re-bindable to a second account even after the first is soft-deleted.
CREATE UNIQUE INDEX uq_users__auth_subject ON users (auth_provider, auth_subject) WHERE auth_subject IS NOT NULL;
