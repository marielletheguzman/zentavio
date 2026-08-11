# lu-legilux

> **Purpose:** Luxembourg's EU Blue Card salary threshold — computed from the two instruments that define it (ADR-0025).

**The only connector that performs arithmetic on a legal value**, and the reason is that nobody
publishes the number. The *loi du 29 août 2008* delegates and names no amount; a **règlement
grand-ducal** states a multiple of the average gross annual salary, and a lower multiple for listed
occupations; an annual **règlement ministériel** states the average. Their product exists in no
official act.

ADR-0025 places the multiplication here and pairs it with an obligation: **every contributing
instrument is archived and cited**. A number derived from two sources that names one is not
evidence — it is a figure that looks audited.

Germany needs none of this. `de-bundesanzeiger` reads euro amounts an authority published; copy
that one for a country whose state does its own arithmetic.

## Legal basis

`legilux.public.lu` serves an application, not documents. The machine channel is
`data.legilux.public.lu`, published as a **CC-BY** dataset on the national open-data portal:
a SPARQL endpoint for discovery, and a `303` from each manifestation to the file.

## What it emits

| `requirementId` | Route | Basis | Shape |
|---|---|---|---|
| `lu.eu-blue-card.salary-threshold.general` | `general` | art. 45 (1) 3. + RGD art. 1er | `monetary`, computed |
| `lu.eu-blue-card.salary-threshold.reduced` | `citp-1-2` | RGD art. 1er, dérogation | `monetary`, computed |
| `lu.eu-blue-card.reduced-threshold-occupations` | `citp-1-2` | RGD art. 1er, dérogation | `set-member`, `kind: right` |

**Two routes, and the model already had the shape.** A general threshold and a lower one gated by an
occupation list is § 18g Abs. 1 S. 1 against S. 2 in different words, so `applies_to.route` and
`kind: right` express it with no new rule kind — both arrived with ADR-0024, for Germany.

**A missing operand emits nothing at all.** A multiplier with nothing to multiply is an unknown
rule, not a partially known one; a default would invent the figure this connector exists to derive
honestly.

## Three traps, each of which fails to a plausible wrong number

**The multiplier is words, split by amendment markers.** A consolidation carries its amending act's
boundaries inline, so *"une fois et demie"* arrives as `une fois 1 > et demie 1 <`. Anchored on the
intact phrase, nothing fires and no rule is emitted. Ignoring the markers reads the digit `1` as the
multiplier — a threshold two thirds too low. Markers are stripped in `toPlainText` before any
pattern runs.

**The average uses a dot as the thousands separator.** `65.652` is sixty-five thousand;
`Number('65.652')` is sixty-five. Both parse. The wrong one produces a threshold almost anybody
clears — the same failure shape as the German €700 defect, and `validate` carries a plausibility
floor for exactly it.

**A consolidation's year is the last date in its ELI**, not the act's. `…/rgd/2008/09/26/n3/consolide/20240701`
is a 2024 document of a 2008 act; keyed under 2008 it would collide with every other consolidation
of the same act and silently overwrite one.

## The derogation's unread qualification

The lower threshold applies to listed occupations *"pour lesquelles un besoin particulier de
travailleurs ressortissants de pays tiers est constaté par le Gouvernement"*. Whether that finding
is a separate published act, or is satisfied by the RGD's own enumeration, **has not been read**. It
travels as `domainDetail.governmentFindingRequired` rather than being modelled as a rule.

## Related

- `.claude/skills/immigration/references/countries/lu.md` — the country model
- ADR-0025 (this connector's reason to exist), ADR-0024 (routes), ADR-0021 (archived provenance), ADR-0002 (plugin model)
- Fixture: `tests/fixtures/connectors/lu-legilux/rgd-26-09-2008.json` — both instruments, as served
