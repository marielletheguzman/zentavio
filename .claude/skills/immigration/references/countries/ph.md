# Philippines (`PH`)

> **Purpose:** **Origin-side** reference model for the Philippines. Defines which authority decides
> what on the origin side, and which official sources are authoritative for it. **Values live in
> `knowledge-engine/immigration`, not here.**

_Status: authored 2026-08-21. Sourced for **professional regulation** (the nursing slice) and for
**document authentication**. Overseas-employment clearance is **named but only partly read**, and
academic credentials are `unknown`. Every gap below says so rather than being filled in from
memory._

---

## This is an origin file, and that changes what belongs in it

Every other file in this directory models a **destination** — the pathways into a country. The
Philippines is the primary **origin** (`.claude/context/countries.md`), so this file models the
regulatory layer a person carries *with* them:

| | Destination file (`de.md`) | This file |
|---|---|---|
| Models | pathways into the country | duties the origin state imposes, and who decides them |
| `imposed_by` on its rules | `destination` | `origin` |
| Scope key it uses | `origin_jurisdiction` — which origins a rule is for | `destination_jurisdiction` — which destinations a rule is for (ADR-0029) |

**This file establishes the Philippine side and nothing else.** The PRC decides who is a registered
nurse *in the Philippines*. It does not decide whether Germany recognises that registration —
that is destination-side evidence, belongs to `de.md`, and is the recognition research this
milestone still owes.

---

## Official sources (tier 1 only)

| Source | Authoritative for | URL | Read | Refresh window |
|---|---|---|---|---|
| Professional Regulation Commission — Mandate / History | that PRC is the licensing and regulatory agency for regulated professions, and its statutory basis | `prc.gov.ph/mandate`, `prc.gov.ph/history` | 2026-08-21 | annually; an agency mandate changes on legislative timelines |
| R.A. 9173, *Philippine Nursing Act of 2002* — full text, hosted by PRC | the Board of Nursing, the licence requirement, registration by reciprocity, foreign-nurse permits | `prc.gov.ph/uploaded/documents/NURSING%20LAW.PDF` | 2026-08-21 | on amendment; see the pending-repeal note below |
| PRC — Board of Nursing page | that the Board of Nursing is the PRB for nursing and that R.A. 9173 is its board law | `prc.gov.ph/Pages/PRBv4/Nursing.htm` | 2026-08-21 | annually |
| HCCH — Philippines, Competent Authority (Art. 6) | the designated authority for apostilles, under the 1961 Convention | `hcch.net/en/states/authorities/details3/?aid=1112` | 2026-08-21 | on notification by the state |
| Bureau of Immigration — OEC clarification | that an OEC is presented on departure by Filipinos travelling on employment visas, and that R.A. 11641 is the basis | `immigration.gov.ph/bi-clarifies-oec-requirement-for-ofws/` | 2026-08-21 | quarterly — an administrative practice, not a statute |

Nothing below tier 1 may produce a rule for this country. See
`.claude/context/knowledge-sources.md`.

### Sources that could not be read, and what that costs

**This section is not bookkeeping.** A source named in a table but never fetched is the failure mode
`de.md` was written to prevent, so every one that refused this client is listed with what it would
have supported.

| Source | What happened | What is therefore unsourced |
|---|---|---|
| `officialgazette.gov.ph` | **HTTP 403** on both R.A. 9173 and R.A. 11641 | the canonical publication of both statutes. R.A. 9173 is read from PRC's own hosted copy instead, which is the regulator publishing its own board law — acceptable, and noted rather than glossed |
| `dfa.gov.ph`, `consular.dfa.gov.ph` | **HTTP 403** | DFA's own description of apostille practice. The *designation* is sourced from HCCH, the treaty body, which is stronger for that particular fact |
| `dmw.gov.ph` | serves a **client-side error page** ("The site may have been updated or your connection was interrupted") rather than content | DMW's own statement of the OEC and its exemptions. Only the Bureau of Immigration's account was read |
| `ched.gov.ph` | **HTTP 403** | everything about academic credentials — which is why that domain is `unknown` below rather than described |
| `elibrary.judiciary.gov.ph` | TLS failure — *unable to verify the first certificate* | R.A. 8981's text. PRC's history page states its effect and date, which is weaker than the statute and is marked as such |

A 403 is **not** a licence to work around anything. These are recorded so the next person reaches
for a different tier-1 source rather than repeating the attempt or, worse, quoting a search snippet
as though a page had been read.

---

## Authority per origin-side domain

The domains are `requirements.domain` (ADR-0010). This table is what a connector or a rule author
needs before writing a single row.

| Domain | Authority | Statutory basis | Sourced? |
|---|---|---|---|
| `recognition` | **Professional Regulation Commission**, through the profession's Professional Regulatory Board | P.D. 223 (1973), modernised by R.A. 8981 (2000); the profession's own board law | **yes**, for the fact that PRC decides. The board law is read for nursing only |
| `authentication` | **Authentication Division, Office of Consular Affairs, Department of Foreign Affairs** | Apostille Convention of 5 October 1961; in force for the Philippines since 14 May 2019 | **yes** — HCCH's designation record |
| `employment_clearance` | **Department of Migrant Workers** | R.A. 11641, *Department of Migrant Workers Act* | **partly** — the requirement and its basis are attested by the Bureau of Immigration; DMW's own pages and the statute text were not readable |
| `credential` | `unknown` — **not sourced.** CHED is the obvious candidate and that is exactly why it is not written here as fact | — | **no** |
| `language` | **not applicable on the origin side.** A language requirement is imposed by the destination | — | — |
| `immigration` | **not applicable.** The Philippines does not grant itself a pathway; `immigration` rows are destination rows | — | — |

**`unknown` here means unknown.** Filling the `credential` row with CHED because it is almost
certainly CHED would make this file look complete and make it untrustworthy — the failure
`.claude/context/countries.md` calls invented coverage.

---

## Professional regulation, in detail

### PRC is the regulator

> *"administers, implements and enforces the regulatory laws and policies of the country with
> respect to the regulation and licensing of the various professions and occupations"*
> — PRC, *Mandate*

Created by **P.D. No. 223 of 22 June 1973**; **R.A. No. 8981**, the *PRC Modernization Act of 2000*,
was signed **5 December 2000**. PRC states it works "in partnership with the forty-six (46)
Professional Regulatory Boards". Nursing is one of them.

*The statute itself was not read* — `elibrary.judiciary.gov.ph` failed TLS verification and the
Official Gazette returned 403. These two dates and the effect come from PRC's own history page,
which is the agency describing the law it operates under: good enough to name the authority, **not**
good enough to support a proposition about what R.A. 8981 requires. Anything of that kind needs the
statute.

### Nursing — the slice this milestone models

The board law is **R.A. 9173, the *Philippine Nursing Act of 2002***, approved **21 October 2002**,
repealing R.A. 7164 (1991). Read in full from PRC's hosted copy.

| Provision | What it establishes |
|---|---|
| **§ 1** | short title — *"Philippine Nursing Act of 2002"* |
| **§ 3** | creates the *"Professional Regulatory Board of Nursing"* — a Chairperson and six members, appointed by the President from PRC's recommendees |
| **§ 12** | *"All applicants for license to practice nursing shall be required to pass a written examination, which shall be given by the Board"*, in accordance with R.A. 8981 |
| **§ 13** | qualifications for admission to the licensure examination, including a Bachelor's degree in nursing |
| **§ 20** | **registration by reciprocity** — a licence *"may be issued without examination to nurses registered under the laws of a foreign state or country"*, where that country's requirements are *"substantially the same"* **and** it grants Philippine nurses the same privileges |
| **§ 21** | special/temporary permits for foreign-licensed nurses — specialists, medical missions, exchange professors |
| **§ 35** | practising *"without a certificate of registration/professional license and professional identification card"* carries a fine of ₱50,000–₱100,000 or one to six years' imprisonment, or both |

**§ 20 runs outward-in, not inward-out.** It governs a foreign nurse being registered *in the
Philippines*. It says nothing about a Philippine-registered nurse being recognised abroad, and using
it to reason about Germany would be exactly the cross-jurisdiction inference
`entities/requirement.md` forbids.

**What the licence is, for our purposes.** A Filipino nurse's PRC registration is the **origin-side
fact** a destination's recognition rule is likely to ask about. That the destination asks, and what
it does with the answer, is destination-side and not sourced here.

### Pending repeal, recorded because it changes the refresh window

Bills replacing R.A. 9173 with a comprehensive nursing law have passed a chamber in earlier
congresses. **No enacted replacement was found on 2026-08-21**, so R.A. 9173 stands. This is a live
legislative area: a rule sourced to it needs a `refresh_after` short enough to catch an enactment,
and the search that establishes "still in force" must be repeated rather than assumed.

### One quirk in the PRC-hosted copy

Its closing block reads *"finally passed by the House of Representatives and the Senate on October
15, 2002 and October 8, 2003 respectively"* — a year that cannot be right for a law approved on
21 October 2002. It affects no operative provision, and it is recorded because someone will
eventually parse this document and should not trust that date.

---

## Document authentication

The Philippines is a party to the **Apostille Convention of 5 October 1961**, in force for it since
**14 May 2019**. The designated Article 6 authority is:

> *"Authentication Division, Office of Consular Affairs, Department of Foreign Affairs"*
> — HCCH, Philippines competent-authority record

An apostille is therefore the form in which a Philippine public document — a PRC certification, a
transcript, a civil-registry record — is made usable in another party state. **Whether a particular
destination's recognition body demands one, and of which documents, is that body's rule**, not this
one.

`e-Apostille` availability and the fee schedule are **unsourced** — DFA's pages refused this client,
and neither belongs in a reference file as a remembered figure anyway.

---

## Overseas employment clearance

The **Overseas Employment Certificate (OEC)** is the origin state's exit clearance for a departing
worker. The Bureau of Immigration states that *"Filipinos traveling abroad on employment visas are
required to present a valid OEC, while those on dependent visas are not required to secure the said
document"*, and cites **R.A. 11641** as mandating *"the issuance of an exit clearance to ensure that
OFWs are legally documented and protected"*.

**Modelled shape, when it is modelled:** `domain: employment_clearance`, `imposed_by: origin`,
`jurisdiction: PH`, **no profession** — it applies to departing workers generally, which is the case
`includeProfessionless` exists for in retrieval — and `kind: document`.

**Not yet sourced, and each matters to a real person:** who is exempt, how the requirement differs
for a first-time hire versus a returning worker, whether the terms vary by destination (which is
what would put a `destination_jurisdiction` scope on the row), and the validity period. DMW's own
site did not render and the statute was not readable, so none of it is written here.

---

## Academic credentials

`unknown` — **nothing sourced.** Named so the gap is visible: for a nurse or an engineer, whether a
destination accepts the degree is often the binding constraint, and the origin side of that
(transcripts, the issuing institution's standing, who certifies them) has no source in this
repository yet.

---

## Labour market · Compensation · Cost and living · Culture and process

`unknown` across the board — **nothing sourced**, exactly as in `de.md`. These sections exist to
hold the shape of the gap, not to be filled from impression. An origin file has less need of them
than a destination file: they describe where someone is going, not where they are leaving.

---

## Gotchas

- **PRC establishes the Philippine side only.** It is the single most likely mistake this file can
  cause: reading "PRC regulates nursing" as though it said anything about German recognition. It
  does not.
- **Origin is where the qualification was awarded, not the passport** (ADR-0029). A Filipino citizen
  holding a German nursing degree is not scoped by a `PH` rule about Philippine qualifications.
- **A search result is not a source.** Several agencies here refuse automated fetches; the snippets
  their pages produce in a search index are not a page anyone read, and must not become a citation.
- **Nothing in this file is a rule yet.** No `requirements` row cites any of it. Sourcing an
  authority is the first half of modelling a rule and is not the rule.

---

## Related

- `.claude/context/countries.md` — the country model, and why `PH` is the primary origin
- `docs/architecture/decisions/0029-origin-scoped-requirements.md` — origin scoping, and why the
  fact is `qualification_awarded_in`
- `docs/database/entities/requirement.md` — `applies_to` scope keys, domains, `imposed_by`
- `de.md` — the destination side of the nursing slice, still unsourced for regulated professions
- `.claude/context/knowledge-sources.md` — tiers, and what may produce a rule
