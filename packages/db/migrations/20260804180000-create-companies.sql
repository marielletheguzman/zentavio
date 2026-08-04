-- Employer identity and alias resolution (docs/database/entities/company.md).
--
-- Specified before it was migrated, because an applied migration cannot be edited
-- (packages/db/src/migrations/runner.ts checksums them) and `companies` is referenced by
-- `applications`, `job_postings`, `outcomes` and `employer_sponsorship_facts` — four tables whose
-- correctness depends on one row meaning one employer.
--
-- **Identity only.** Sponsorship licences live in `employer_sponsorship_facts`, the
-- migration-friendly score is derived and never stored, interview process belongs to
-- knowledge-engine/interview-reports, and ADR-0020 puts curation in `knowledge-engine/` while
-- storage stays here. Adding a column to this table is only correct when it is part of *identity*.
--
-- Indexes are in this transaction rather than CONCURRENTLY for the reason given in
-- 20260729120000-create-immigration-pathways.sql: the tables are created empty here, and the unique
-- indexes are correctness constraints that must not have a window in which they are absent.

CREATE TABLE companies (
  id             uuid         PRIMARY KEY,            -- UUIDv7, generated in the application

  -- Crosses the API boundary so the browser never holds a uuid — the rule careers and skills follow.
  slug           text         NOT NULL,
  -- As the company writes it. Display only, never a matching key.
  canonical_name text         NOT NULL,
  -- Registered or trading name where it differs and is known. Not a second identity.
  legal_name     text,

  -- The strongest identity signal available. Host only: 'google.com', never a URL, never 'www.'.
  primary_domain text,
  country_code   char(2),                             -- headquarters, where known. Not where it hires.

  status         text         NOT NULL DEFAULT 'active',
  -- Companies merge, and an outcome recorded against the old one must stay explicable. The row is
  -- kept and pointed at its successor rather than deleted or rewritten — the same reasoning that
  -- makes a changed requirement a new row instead of an UPDATE.
  merged_into    uuid,

  -- A company row is a world fact like any other. Tier 2 is the honest floor: an official register
  -- is tier 1, a company's own site tier 2, a name scraped from a posting tier 3.
  source_tier    smallint     NOT NULL,
  source_url     text,
  retrieved_at   timestamptz,

  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  CONSTRAINT fk_companies__merged_into FOREIGN KEY (merged_into) REFERENCES companies(id) ON DELETE RESTRICT,

  CONSTRAINT ck_companies__slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT ck_companies__status CHECK (status IN ('active','defunct','merged')),
  CONSTRAINT ck_companies__tier CHECK (source_tier BETWEEN 1 AND 4),

  -- A domain, not a URL. Rejects 'https://google.com/careers' and 'www.google.com' at write time,
  -- because a domain stored two ways is two companies — and that duplicate is what makes an outcome
  -- count for the wrong employer.
  --
  -- The `www.` exclusion is separate and deliberate: `www.acme.com` is a *structurally valid host*,
  -- so the pattern alone accepts it, and `acme.com` plus `www.acme.com` would be two companies.
  -- A test caught this after the comment above already claimed otherwise.
  CONSTRAINT ck_companies__domain CHECK (
    primary_domain IS NULL
    OR (
      primary_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      AND primary_domain NOT LIKE 'www.%'
    )
  ),
  -- 'merged' is a claim about where it went. Without the pointer it is a dead end.
  CONSTRAINT ck_companies__merged CHECK ((status = 'merged') = (merged_into IS NOT NULL)),
  CONSTRAINT ck_companies__no_self_merge CHECK (merged_into IS NULL OR merged_into <> id)
);

CREATE UNIQUE INDEX uq_companies__slug ON companies (slug) WHERE deleted_at IS NULL;

-- One live company per domain. Two rows sharing a domain is the duplicate this table exists to
-- prevent.
CREATE UNIQUE INDEX uq_companies__domain ON companies (primary_domain)
  WHERE primary_domain IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_companies__merged ON companies (merged_into) WHERE merged_into IS NOT NULL;

-- Externally observed names, mapped onto one canonical company. The same shape as `skill_aliases`,
-- and for the same reason: resolution is a lookup on a normalized key.
CREATE TABLE company_aliases (
  id          uuid         PRIMARY KEY,
  company_id  uuid         NOT NULL,
  -- As written by whatever source produced it, kept for provenance.
  alias       text         NOT NULL,
  -- Casefolded, punctuation stripped, whitespace collapsed, legal suffixes removed.
  -- `normalizeCompanyAlias` in packages/db/src/seed.ts is the only function permitted to produce
  -- this value; two normalizations that drift make resolution miss silently, which reads as a
  -- coverage gap rather than the bug it is.
  normalized  text         NOT NULL,
  source_tier smallint     NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz,

  CONSTRAINT fk_company_aliases__companies FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT ck_company_aliases__tier CHECK (source_tier BETWEEN 1 AND 4),
  CONSTRAINT ck_company_aliases__normalized CHECK (normalized <> '')
);

-- One alias resolves to exactly one company. Without this, "acme" belongs to two employers and
-- reconciliation picks whichever row the query returned first.
CREATE UNIQUE INDEX uq_company_aliases__normalized ON company_aliases (normalized) WHERE deleted_at IS NULL;
CREATE INDEX idx_company_aliases__company ON company_aliases (company_id) WHERE deleted_at IS NULL;
