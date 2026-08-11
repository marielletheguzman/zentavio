# Country References

> **Purpose:** Per-country immigration reference models. One file per country, named by ISO
> code (`de.md`, `ca.md`, `au.md`, …).

## Load one file, never the directory

These files exist so a session working on Germany does not load Japan. Read
`<code>.md` for the country in scope. Loading the whole directory defeats the purpose and
crowds out the actual task.

## What a reference file is — and is not

**Is:** the *model* of a country's immigration knowledge. Which pathways exist, which rules
constitute each one, which official sources are authoritative for what, refresh windows, and
the shape of the country's specifics (occupation lists, language levels, qualification
recognition).

**Is not:** the values. Thresholds, salaries, quotas, and timelines live in
`knowledge-engine/immigration` as versioned, dated, tier-1-sourced rows — because they change,
and because a plan made against last year's threshold must remain reproducible.

**Any figure written into a reference file is a stale copy waiting to mislead someone.** If a
number appears here, it appears as an example clearly marked as illustrative, with its date,
and never as the value a service reads.

## Structure

Follow `_TEMPLATE.md`. The full country model is defined in
`.claude/context/countries.md`.

## Markets

**Launch:** `DE` · `LU` · `NZ` · `CH` · `REMOTE`
**Future:** `NL` · `IE` · `AU` · `CA` · Nordics (`SE`, `NO`, `DK`, `FI`)
**Origin:** `PH` — carries its own rule domains; see `.claude/context/countries.md`.

`REMOTE` is modeled differently — no jurisdiction, no pathway. Its constraints are employer
policy, time zone, contracting and tax treatment, and payment mechanics.

## Adding a country

1. Copy `_TEMPLATE.md` to `<code>.md`.
2. Identify the tier-1 official sources and record what each is authoritative for.
3. Add or extend an `immigration-data` connector for those sources.
4. Ingest rules with `effectiveFrom`, `version`, `sourceUrl`, `retrievedAt`.
5. Set refresh windows per domain.
6. Verify the honest-unknown path renders before launching the country.

Zero changes to `services/` or `ai/` should be required. If code must change, the design is
wrong — see ADR-0002 and the `immigration` skill.

## Status

| File | State |
|---|---|
| `de.md` | **Authored 2026-08-11.** One pathway (`de.eu-blue-card`) modelled and sourced end to end; every other section marked `unknown` and unsourced, which is the honest state rather than a to-do list. |
| `lu.md` | **Authored 2026-08-11** from the consolidated statute and the two instruments its salary threshold depends on, ahead of any connector — the order step 1 prescribes. **No rule is ingested yet.** Its threshold is a *product* of a multiplier and an annually-published average, which is the open modelling question recorded in the file. |
| `nz.md` · `ch.md` | Not authored. |

`_TEMPLATE.md` defines the shape. **Read `de.md` before writing the next one** — it is the worked
example of a country whose rules are actually ingested, and of how to say `unknown` at length
without it reading as an apology.
