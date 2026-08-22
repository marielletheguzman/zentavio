-- Interview reports, and the stages they describe (ADR-0031).
--
-- ## What this data is, and why it is handled differently from everything else here
--
-- **Tier 4 — self-reported experience**, and the only tier-4 data this product surfaces. Every other
-- claim traces to a statute, an official announcement, or something a person said about themselves.
-- This traces to strangers describing a private meeting from memory, with an incentive to look
-- competent about it.
--
-- So a single report is never a fact about a company. Support is counted per
-- `(company, role_family)` — fifteen reports about a company's sales interviews say nothing about
-- its backend process — and the floors live in the repository, because a `CHECK` cannot count rows
-- in another table.
--
-- ## Why erasure detaches rather than deletes
--
-- The same shape as `outcomes`. A report's value is aggregate: other people's answers depend on it
-- being counted, and deleting one on erasure would silently drop a pairing below its floor and
-- change what a stranger is told. The link to the person is the sensitive part, so that is what
-- goes.
--
-- The cost is stated rather than hidden: once a report is detached, "one report per person per
-- pairing" can no longer be enforced for that person. They could contribute again. That is the price
-- of not letting one erasure rewrite what everybody else sees.

CREATE TABLE interview_reports (
  id             uuid         PRIMARY KEY,
  -- Null once erased. `ck_ir__anonymized` keeps it moving in step with `anonymized_at`.
  user_id        uuid,
  company_id     uuid         NOT NULL,
  -- Matches `careers.family`. **The unit of support** (ADR-0031): a count against a company alone
  -- is never sufficient for anything, so the pairing is the key rather than a filter somebody
  -- remembers to apply.
  role_family    text         NOT NULL,

  -- When they interviewed, not when they told us. Recency is part of support — only the last
  -- eighteen months count — and `created_at` is the other fact.
  interviewed_on date         NOT NULL,
  -- One value today. A published process is tier 1, belongs elsewhere, and outranks all of these.
  basis          text         NOT NULL DEFAULT 'self_reported',
  notes          text,

  anonymized_at  timestamptz,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_ir__users     FOREIGN KEY (user_id)    REFERENCES users(id)     ON DELETE RESTRICT,
  CONSTRAINT fk_ir__companies FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,

  CONSTRAINT ck_ir__basis CHECK (basis IN ('self_reported')),
  -- A row with no subject and no `anonymized_at` is a privacy claim nobody can verify; one with a
  -- subject and an `anonymized_at` is a claim that is false. They move together.
  CONSTRAINT ck_ir__anonymized CHECK ((user_id IS NULL) = (anonymized_at IS NOT NULL))
);

-- **One report per person per pairing.** Five reports is not many, and without this a single
-- motivated person — or a company — could clear a floor alone. Partial, because erasure detaches:
-- anonymised rows still count toward support and are no longer attributable to anybody.
CREATE UNIQUE INDEX uq_ir__user_pairing ON interview_reports (user_id, company_id, role_family)
  WHERE user_id IS NOT NULL;

-- The read this table exists for: how much support does this pairing have, recently.
CREATE INDEX idx_ir__pairing ON interview_reports (company_id, role_family, interviewed_on DESC);

-- What happened, in order.
--
-- **`kind` is a closed vocabulary on purpose.** Free text would make aggregation impossible — "sys
-- design", "system design round" and "architecture chat" are one stage described three ways, and a
-- support floor counted across them counts nothing. The cost is that a genuinely novel stage has
-- nowhere to go until the vocabulary grows, which is a deliberate trade: a stage nobody can count
-- is a stage nobody can be told about honestly.
CREATE TABLE interview_report_stages (
  id           uuid         PRIMARY KEY,
  report_id    uuid         NOT NULL,
  position     smallint     NOT NULL,
  kind         text         NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_irs__reports FOREIGN KEY (report_id) REFERENCES interview_reports(id) ON DELETE CASCADE,

  CONSTRAINT ck_irs__position CHECK (position >= 1),
  CONSTRAINT ck_irs__kind CHECK (kind IN (
    'recruiter-screen',
    'technical-screen',
    'coding',
    'system-design',
    'take-home',
    'behavioural',
    'hiring-manager',
    'panel',
    'final'
  ))
);

-- One stage per position per report. A report listing two things at stage 2 describes a process it
-- cannot have observed.
CREATE UNIQUE INDEX uq_irs__report_position ON interview_report_stages (report_id, position);
CREATE INDEX idx_irs__kind ON interview_report_stages (report_id, kind);
