# de-bayingg

> **Purpose:** BayIngG Art. 2 and Art. 3 — the protected title `Ingenieur` in Bavaria, and what a
> qualification earned outside the EU/EEA has to show before it may be used.

## Why it exists

M5 asks for a recognition verdict a person can act on, for the work this product is actually built
around: IT, software and computer engineering.

**For software and platform work the answer is that recognition does not apply.** The occupation is
not regulated in Germany, BIBB's federal portal says recognition is not required to work in a
non-regulated profession, and `de.md` records that with its source. *"This does not apply to you"* is
a better answer than `unknown` and it costs no rule to give.

**The narrow exception is the title.** `Ingenieurin` / `Ingenieur` is protected, per Land, and a
computer or electronics engineer who wants to use it needs permission. That is a real recognition
rule, it is sourced, and it is what this connector reads.

**It gates the title, not the activity.** Someone with a Philippine computer-engineering degree may
do engineering work in Bavaria; what they may not do is call themselves `Ingenieur` until the
Genehmigung is granted. Every row carries `gatesTitleNotActivity: true` in its `domainDetail`,
because a surface rendering this as *"you cannot work in Germany"* would be false about a person's
life.

## Legal basis

`gesetze-bayern.de/robots.txt` is `User-agent: *` / `Allow: /` — read on 2026-08-21. BAYERN.RECHT is
the Free State of Bavaria's official legal-information portal, and German statutes are amtliche
Werke, uncopyrighted under § 5 UrhG.

## What it extracts

Both articles travel in **one payload**, for the reason `lu-legilux` carries two instruments:
neither is a rule alone. Art. 2 states numbers about a German degree; only Art. 3 Abs. 4 makes them
the test a qualification earned outside the EU/EEA is measured against. Fetching Art. 2 without
Art. 3 returns `null` rather than a partial answer.

| Requirement | Basis | Shape | Origin scope |
|---|---|---|---|
| `de.ingenieur-title.by.study-duration.ph` | Art. 2 Abs. 1 Nr. 1 b), via Art. 3 Abs. 4 | ≥ 6 semesters, `numeric-gte` | `["PH"]` |
| `de.ingenieur-title.by.ects-credits.ph` | Art. 2 Abs. 1 Nr. 1 b), via Art. 3 Abs. 4 | ≥ 180 ECTS, `numeric-gte` | `["PH"]` |
| `de.ingenieur-title.by.permission.ph` | Art. 2 Abs. 1 Nr. 2, Art. 3 Abs. 1 | the Genehmigung, `document-present` | `["PH"]` |

All three are `recognition` rows: `jurisdiction: DE`, `subdivision: BY`, `profession:
ingenieur-protected-title`, **no pathway**. That combination is exactly what no pathway-scoped query
could ever return, which is why ADR-0029 had to widen retrieval before this connector was worth
writing.

**The permission rule is deliberately undecidable.** `document-present` makes the evaluator answer
`undetermined` with a reason. Only the authority knows whether a Genehmigung was granted, and
asserting it either way would be inventing a verdict.

### Why the origin scope names one country

Art. 3 Abs. 4 addresses evidence from outside the EU/EEA — a **class**, not a list. The scope key is
an inclusion test, and *"every country except twenty-eight"* is not expressible as one. ADR-0029
models a class one member at a time with distinct `requirement_id`s, so the Philippines is the first
member and a second origin is a second row rather than an edit.

## What it refuses to model

- **Art. 3 Abs. 1's equivalence assessment** routes through the BayBQFG, whose text is on another
  page. The rows name it in `domainDetail` so a reader knows where the rest of the test lives.
- **Art. 3 Abs. 2's one-year practice rule** applies only where the engineering profession is
  unregulated *in a member or contracting state* — a status this connector cannot determine.
- **Art. 3 Abs. 3's** equation of Directive 2005/36/EC programmes.
- **Every other Land.** Sixteen Ingenieurgesetze exist; this reads Bavaria's. Another Land is another
  connector or another document id, never an assumption that Bavaria's terms generalise.
- **Art. 2 Abs. 1 Nr. 1 c)'s subject-area test** — that mathematics, computer science, natural
  sciences and technology predominate — is carried as `domainDetail` rather than as a rule, because
  nothing the person can answer decides it: the authority reads the subject catalogue.

An eligibility answer that silently omits a rule is a false positive, so this list exists rather than
letting the omission look like coverage.

## Two traps the fixture caught

**The wording is not the summary's wording.** The statute does not say `mindestens 180 ECTS`; it says
*"bei Anwendung des ECTS-Systems mindestens 180 Punkte erworben werden können"*. A pattern written
from a summary read nothing and reported no rules — silence, which looks like a law that says
nothing rather than like a broken parser.

**The portal serves numeric entities.** `Gesch&#xFC;tzte`, not `Geschützte`. Every anchor here keys
on a German word, so without decoding them each pattern misses. This is `de-aufenthg`'s ISO-8859-1
bug in hexadecimal, and it fails the same silent way.

A third, related: each article page carries navigation naming **every** article of the law before the
body text, so slicing from the first `Art. 2` heading yields a heading and nothing else. The parser
takes the longest slice instead, and a test pins it.

## Related

- `de.md` — Germany's country model, including why IT and software need no recognition
- `ph.md` — the origin side: PRC, and what it does and does not establish
- ADR-0029 — origin scoping, and why absent means broader
- ADR-0025 — why both articles are archived and cited
