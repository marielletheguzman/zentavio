-- Archived source documents (docs/architecture/object-storage.md, ADR-0021 rollout phase 4).
--
-- **PostgreSQL stores metadata only.** The bytes live in object storage behind the `DocumentStore`
-- port; this table records where, how big, and — the part that matters — what the checksum was when
-- it was archived. That checksum is the evidence a document was not altered afterwards, and
-- ADR-0021 keeps it here rather than trusting the provider's own integrity header, which would make
-- the provider the witness to its own claim.
--
-- ## Replacing `requirements.source_document`
--
-- That column was `text` — an object key with nothing to join to, no checksum, and no way to tell
-- a missing archive from a mistyped path. It is dropped and replaced by `document_id`.
--
-- **Verified before dropping:** all five stored requirements had `source_document IS NULL`, so no
-- value is lost. The original migration is applied and checksummed
-- (`packages/db/src/migrations/runner.ts`) and therefore cannot be edited — this is the additive
-- migration that supersedes it, which is the pattern `docs/database/migrations.md` requires.

CREATE TABLE documents (
  id           uuid         PRIMARY KEY,              -- UUIDv7, generated in the application

  -- Deterministic: `<category>/<jurisdiction>/<year>/<slug>.<extension>`. Recomputable from the
  -- record it belongs to, because a key you cannot recompute is a key you cannot audit — you would
  -- have to trust the stored string rather than check it.
  object_key   text         NOT NULL,
  -- Which provider actually holds the bytes. Recorded per row rather than assumed globally,
  -- because a migration between providers has to be able to tell the two apart mid-flight.
  provider     text         NOT NULL,
  bucket       text         NOT NULL,

  mime_type    text         NOT NULL,
  size_bytes   bigint       NOT NULL,
  -- Hex SHA-256 over the bytes as stored. `DocumentStore.get` recomputes and refuses a mismatch;
  -- this is the recorded expectation it checks against.
  sha256       text         NOT NULL,

  -- Where it came from, and when each thing happened.
  source_url   text         NOT NULL,
  -- The connector obtained the bytes.
  retrieved_at timestamptz  NOT NULL,
  -- The bytes reached object storage. **Deliberately separate from `retrieved_at`**: a fetch that
  -- succeeded and an archive that succeeded are two events, and the gap between them is exactly
  -- the failure this table has to make visible rather than hide behind one timestamp.
  archived_at  timestamptz  NOT NULL DEFAULT now(),

  -- The provider's object version where it has one. Null when versioning is off or unreported.
  version      text,

  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT ck_documents__size CHECK (size_bytes > 0),
  -- Hex SHA-256, lower case, exactly 64 characters. A truncated or upper-case digest compares
  -- unequal to the one `DocumentStore` computes, which would fail every read as an integrity
  -- error and send someone hunting a tampering incident that never happened.
  CONSTRAINT ck_documents__sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_documents__archived_after_retrieved CHECK (archived_at >= retrieved_at)
);

-- One row per stored object. Two rows for one key would make "which document is this" ambiguous
-- at exactly the moment someone is checking provenance.
CREATE UNIQUE INDEX uq_documents__object_key ON documents (object_key);

-- Finding every requirement that cites the same archived document, and spotting a byte-identical
-- document stored under two keys.
CREATE INDEX idx_documents__sha256 ON documents (sha256);

-- Requirements now reference a document row rather than carrying a path string.
--
-- Nullable, and it stays nullable until ADR-0021's enforcement phase: the five requirements
-- already stored were accepted before archival existed, and they are backfilled before the flip
-- rather than deleted. Making it NOT NULL now would mean choosing between destroying real
-- statutory data and blocking this migration.
ALTER TABLE requirements ADD COLUMN document_id uuid;

ALTER TABLE requirements
  ADD CONSTRAINT fk_req__documents FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE RESTRICT;

-- Dropped, not kept alongside. Two ways to say where a document is means two answers that can
-- disagree, and the text column had no checksum and nothing to join to.
ALTER TABLE requirements DROP COLUMN source_document;

CREATE INDEX idx_req__document ON requirements (document_id) WHERE document_id IS NOT NULL;

-- Requirements with no archived evidence. This is the query the enforcement phase must return
-- empty before `no-archived-document` can become an error rather than a warning.
CREATE INDEX idx_req__unarchived ON requirements (requirement_id) WHERE document_id IS NULL;
