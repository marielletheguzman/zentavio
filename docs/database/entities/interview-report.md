# Entity: Interview Report

> **Purpose:** What people say a company's interview process was, and the support floors that decide
> whether it may be described (ADR-0031).

**Tier 4 — self-reported experience**, and the only tier-4 data this product surfaces. Every other
claim here traces to a statute, an official announcement, or something a person said about
themselves. This traces to strangers describing a private meeting from memory, months later, with an
incentive to look competent about it.

So a single report is never a fact about a company, and the schema alone cannot hold that rule: a
`CHECK` cannot count rows in another table. **The floors live in
`packages/db/src/repositories/interview-reports.ts`**, and that module is the only thing that decides
whether a process may be described.

## `interview_reports`

```sql
CREATE TABLE interview_reports (
  id             uuid         PRIMARY KEY,
  user_id        uuid,                          -- null once erased
  company_id     uuid         NOT NULL,
  role_family    text         NOT NULL,         -- matches careers.family; the unit of support
  interviewed_on date         NOT NULL,         -- when they interviewed, not when they told us
  basis          text         NOT NULL DEFAULT 'self_reported',
  notes          text,
  anonymized_at  timestamptz,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_ir__users     FOREIGN KEY (user_id)    REFERENCES users(id)     ON DELETE RESTRICT,
  CONSTRAINT fk_ir__companies FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT ck_ir__basis CHECK (basis IN ('self_reported')),
  CONSTRAINT ck_ir__anonymized CHECK ((user_id IS NULL) = (anonymized_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_ir__user_pairing ON interview_reports (user_id, company_id, role_family)
  WHERE user_id IS NOT NULL;
CREATE INDEX idx_ir__pairing ON interview_reports (company_id, role_family, interviewed_on DESC);
```

**The unit is `(company_id, role_family)`.** Fifteen reports about a company's sales interviews say
nothing about its backend process, so counting per company produces the most confident output exactly
where the variance is highest. The pairing is the key rather than a filter somebody remembers to
apply.

**`uq_ir__user_pairing` — one report per person per pairing.** Five reports is not many, and without
it a single motivated person, or a company, could clear a floor alone. Partial, because erasure
detaches: anonymised rows still count and are attributable to nobody.

## `interview_report_stages`

```sql
CREATE TABLE interview_report_stages (
  id         uuid        PRIMARY KEY,
  report_id  uuid        NOT NULL,
  position   smallint    NOT NULL,
  kind       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_irs__reports FOREIGN KEY (report_id) REFERENCES interview_reports(id) ON DELETE CASCADE,
  CONSTRAINT ck_irs__position CHECK (position >= 1),
  CONSTRAINT ck_irs__kind CHECK (kind IN (
    'recruiter-screen','technical-screen','coding','system-design',
    'take-home','behavioural','hiring-manager','panel','final'
  ))
);

CREATE UNIQUE INDEX uq_irs__report_position ON interview_report_stages (report_id, position);
```

**`kind` is a closed vocabulary on purpose.** Free text makes aggregation impossible — "sys design",
"system design round" and "architecture chat" are one stage described three ways, and a floor counted
across them counts nothing. The cost is that a genuinely novel stage has nowhere to go until the
vocabulary grows, which is a deliberate trade: a stage nobody can count is a stage nobody can be told
about honestly.

## The floors

| | |
|---|---|
| `PAIRING_SUPPORT_FLOOR` | **5** reports before a process is described at all |
| `STAGE_SUPPORT_FLOOR` | **3** mentions before a stage appears |
| `SUPPORT_WINDOW_MONTHS` | **18** — a process from four years ago is a different company's |

`processForPairing` returns either a **described** process or a **shortfall** — never raw reports for
a caller to aggregate. A second aggregator would be a second threshold, and the one thing worse than a
fabricated stage is two surfaces disagreeing about whether it exists.

**Confidence never exceeds `medium`**, at any count. Fifty agreeing reports are still fifty
strangers' recollections. An officially published process is tier 1, outranks all of them, and does
not come from this table.

**Below the floor is an answer.** The shortfall carries the count and what is still needed, because
*"3 reports, we need 5"* invites a contribution and *"not enough"* is a dead end.

## Erasure detaches rather than deletes

The same shape as `outcomes`, and for the same reason: a report's value is aggregate. Other people's
answers depend on it being counted, and deleting one on erasure would silently drop a pairing below
its floor and change what a stranger is told about a company. The link to the person is the sensitive
part, so that is what goes — `user_id` to null, `anonymized_at` set, in one statement because
`ck_ir__anonymized` requires them to move together.

**The cost, stated rather than hidden:** once detached, "one report per person per pairing" can no
longer be enforced for that person, and they could contribute again. That is the price of not letting
one erasure rewrite what everybody else sees.

## Invariants

- A report with **no stages** is refused. It counts toward support while describing nothing, which is
  the cheapest way over a floor.
- An interview **that has not happened** cannot be reported.
- **Two stages at the same position** describe a process nobody could have observed.
- Support is counted **per pairing**, never per company.
- Confidence is **never `high`**.

## Related

- ADR-0031 — the floors, the unit, and why both failure directions are unsafe
- `docs/features/interview-prep.md` — what the surface does above and below the floor
- `.claude/context/knowledge-sources.md` — tier 4 and its ceiling
- `entities/outcome.md` — the detach-on-erasure pattern this follows
