# Entity: Company

> **Purpose:** The identity of an employer, and the alias resolution that makes "Google LLC",
> "Google Germany GmbH" and "google.com" one company. Everything *known about* a company lives in a
> table that references this one.

`companies` is referenced by `applications`, `job_postings`, `outcomes` and
`employer_sponsorship_facts`, and it did not exist. This document specifies it before the migration,
because an applied migration cannot be edited (`packages/db/src/migrations/runner.ts` checksums
them) and a schema invented during implementation is a decision nobody reviewed.

## Scope: identity, not a profile

The tempting version of this table is a rich employer record — sponsorship history, reputation,
headcount, interview process. **That version is already decomposed into other entities**, and
folding it back in would give one row two owners:

| What | Lives in | Why not here |
|---|---|---|
| sponsorship licences, per jurisdiction, versioned | `employer_sponsorship_facts` | it is a dated world fact with provenance, not an attribute |
| the Migration-Friendly Employer Score | derived, recomputed | a stored score with no provenance is a bug (`principles.md`) |
| interview process and questions | `knowledge-engine/interview-reports` → its own tables | tier-4 aggregated experience, minimum-support gated |
| curation from company-data sources | `knowledge-engine/companies` | **curates; `packages/db` stores** (ADR-0020) |

So this table answers exactly one question: **which employer is this, and is it the same one as
that?** Adding an attribute here is only correct when it is part of *identity*.

## Identity is the domain, not the name

Company names are not unique, not stable, and not how people write them. There are many "Acme Ltd";
one employer appears as "Google", "Google LLC", "Google Germany GmbH" and "Alphabet"; and a
connector will emit whichever string a posting happened to contain.

**The primary domain is the strongest identity signal available** and is what deduplication should
key on where it is known. It is nullable, because a company can be real and known without one — but
a null domain means identity rests on alias matching alone, and that is worth knowing when reading
a row.

## `companies`

```sql
CREATE TABLE companies (
  id             uuid         PRIMARY KEY,          -- UUIDv7, generated in the application

  -- Stable, kebab-case, permanent. Crosses the API boundary so the browser never holds a uuid,
  -- the same rule careers and skills follow.
  slug           text         NOT NULL,
  -- As the company writes it. Display only — never a matching key.
  canonical_name text         NOT NULL,
  -- Registered or trading name where it differs and is known. Not a second identity.
  legal_name     text,

  -- The strongest identity signal. Host only: 'google.com', never a URL, never 'www.'.
  primary_domain text,
  -- ISO-3166-1 alpha-2 of the headquarters, where known. Not where it hires.
  country_code   char(2),

  status         text         NOT NULL DEFAULT 'active',
  -- Companies merge, and an outcome recorded against the old one must stay explicable. The row is
  -- kept and pointed at its successor rather than deleted or rewritten — the same reasoning that
  -- makes a changed requirement a new row instead of an UPDATE.
  merged_into    uuid,

  -- Provenance, because a company row is a world fact like any other. Tier 2 is the honest floor
  -- for a company registry: an official register is tier 1, a company's own site is tier 2, and a
  -- name scraped from a job posting is tier 3.
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
  -- A domain, not a URL. Catches 'https://google.com/careers' and 'www.google.com' at write time,
  -- because a domain stored two ways is two companies.
  -- The `www.` exclusion is separate on purpose: `www.acme.com` is a structurally valid host, so
  -- the pattern alone accepts it and `acme.com` plus `www.acme.com` become two companies.
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
-- prevent, and it is the failure that makes an outcome count for the wrong employer.
CREATE UNIQUE INDEX uq_companies__domain ON companies (primary_domain)
  WHERE primary_domain IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_companies__merged ON companies (merged_into) WHERE merged_into IS NOT NULL;
```

## `company_aliases`

The same shape as `skill_aliases`, and for the same reason: resolution is a lookup on a normalized
key, and one key must resolve to exactly one company.

```sql
CREATE TABLE company_aliases (
  id          uuid         PRIMARY KEY,
  company_id  uuid         NOT NULL,
  -- As written by whatever source produced it, kept for provenance.
  alias       text         NOT NULL,
  -- Casefolded, punctuation stripped, whitespace collapsed, legal suffixes removed.
  normalized  text         NOT NULL,
  source_tier smallint     NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz,

  CONSTRAINT fk_company_aliases__companies FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT ck_company_aliases__tier CHECK (source_tier BETWEEN 1 AND 4)
);

-- One alias resolves to exactly one company. Without this, "acme" belongs to two employers and
-- reconciliation picks whichever row the query returned first.
CREATE UNIQUE INDEX uq_company_aliases__normalized ON company_aliases (normalized) WHERE deleted_at IS NULL;
CREATE INDEX idx_company_aliases__company ON company_aliases (company_id) WHERE deleted_at IS NULL;
```

**Normalization must be one function, written down and shared.** `normalizeAlias` in
`packages/db/src/seed.ts` already does casefold, strip, collapse for skills; company names need one
addition — dropping legal suffixes (`GmbH`, `Ltd`, `Inc`, `LLC`, `SE`, `AG`, `B.V.`), because
"Google Germany GmbH" and "Google Germany" are the same employer. That extension belongs beside the
existing function, not in a connector: the skill graph already learned what happens when two
normalizations drift — resolution misses silently and the input lands in `unmatched`, which reads as
a coverage gap rather than the bug it is.

## `job_board_employers`

**Some sources never name the employer at all.** A Lever board is a per-employer feed: the employer
is context, not content (ADR-0034), so a posting arrives with no name to resolve and
`company_name_raw` is null — correctly, because the source said nothing. Resolution as specified
below has no input for those postings and will produce nothing however well it is written.

ADR-0040 fills that gap with a **curated, sourced binding**: a person asserts that a board is
operated by an employer, against a source, on a date.

```sql
CREATE TABLE job_board_employers (
  id           uuid        PRIMARY KEY,
  source_id    text        NOT NULL,   -- the connector's meta.id
  source_scope text        NOT NULL,   -- the board; '' for a single global namespace
  company_id   uuid        NOT NULL,
  source_tier  smallint    NOT NULL,
  source_url   text        NOT NULL,
  retrieved_at timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,

  CONSTRAINT fk_jbe__connector_sources FOREIGN KEY (source_id) REFERENCES connector_sources(id) ON DELETE RESTRICT,
  CONSTRAINT fk_jbe__companies         FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT ck_jbe__tier         CHECK (source_tier BETWEEN 1 AND 3),
  CONSTRAINT ck_jbe__source_url   CHECK (source_url ~ '^https?://'),
  CONSTRAINT ck_jbe__source_scope CHECK (source_scope = '' OR source_scope = btrim(source_scope))
);

CREATE UNIQUE INDEX uq_jbe__source_scope ON job_board_employers (source_id, source_scope) WHERE deleted_at IS NULL;
CREATE INDEX idx_jbe__company ON job_board_employers (company_id) WHERE deleted_at IS NULL;
```

**The three provenance columns are NOT NULL, and tier 4 is refused.** A binding with no source is
indistinguishable from a guess, and by the time anyone notices, `applications` and `outcomes` point
at the company it produced. Tier 4 is aggregated or anecdotal; an employer identity is precisely the
field where "somebody said so" must not be storable.

**A board slug never becomes an alias.** `uq_company_aliases__normalized` is global, so a slug stored
as a name competes with real names — a board called `apple` operated by a small employer would
resolve every one of its postings to Apple, and the row would look correct. The slug is a namespace;
it stays one.

**No binding means `company_id` stays null.** The postings are still stored, extracted and scored. An
unresolved employer is a visible gap, which is the asymmetry this whole document rests on.

**A board that changes hands is a new row.** The old binding is soft-deleted rather than rewritten —
it is the evidence for every posting resolved under it — and the partial unique index keeps exactly
one live binding per board.

## Resolution order

Deduplication is the knowledge engine's job (`docs/architecture/connectors.md`); a connector emits a
name and a domain and never resolves. The order is:

1. **exact `primary_domain`** — decisive where present
2. **`company_aliases.normalized`** — exact match on the normalized key
3. **no match** → a new company at the tier its source justifies, with the emitted name as its first
   alias

**Never fuzzy-match.** A similarity threshold that merges "Acme Health" into "Acme Healthcare" is a
threshold that will eventually merge two real employers, and the resulting outcome data is wrong in
a way no later check can find. An unresolved company is a visible gap; a wrongly merged one is not.

## Lifecycle

| Status | Means |
|---|---|
| `active` | trading, as far as we know |
| `defunct` | no longer trading. Rows referencing it stay valid — a person did apply there |
| `merged` | absorbed. `merged_into` names the successor |

**Nothing is deleted.** An `outcomes` row citing a company that later merged must remain explicable,
which is the same rule requirements follow. A merge points the old row forward; it never rewrites
the references.

## Erasure

**`companies` holds no personal data and is untouched by erasure.** An employer is a world fact
shared by every user. What is personal is the *link* — `applications.user_id`, `outcomes.user_id` —
and those are handled in their own entities (`outcomes.user_id` is nulled rather than deleted, so
the anonymous contribution survives).

## Invariants

- One live company per `slug`, and per `primary_domain` where set.
- One alias resolves to exactly one company.
- `primary_domain` is a host, never a URL and never `www.`-prefixed.
- `merged` requires `merged_into`; `merged_into` never points at itself.
- Every row carries `source_tier`.
- No fuzzy matching, ever.
- One live binding per `(source_id, source_scope)`; every binding carries a tier of 1–3, a URL and a `retrieved_at`.
- **A board slug is never stored as a company alias** (ADR-0040).
- No sponsorship, score, or interview data on this table.

## Related

- `application.md`, `job.md`, `outcome.md` — the three tables that reference this one
- `employer-sponsorship.md` — what is *known about* an employer, deliberately separate
- ADR-0020 — `knowledge-engine/` curates, `packages/db` stores
- ADR-0040 — where an employer comes from when the source names none, and why a slug is not an alias
- `docs/architecture/connectors.md` — why a connector produces a comparable key and resolves nothing
- `.claude/context/knowledge-sources.md` — the tiers `source_tier` records
