# ADR-0016: Libraries for extracting text from uploaded résumés

- **Status:** Accepted
- **Accepted:** 2026-08-01
- **Date:** 2026-08-01
- **Deciders:** project lead
- **Affects:** `ai/resume-parser`, `ai/pyproject.toml`, `.claude/context/tech-stack.md`

## Context

`docs/features/resume-parsing.md` specifies PDF and DOCX upload. Neither format is readable with the
Python standard library, so a library is required, and `.claude/context/tech-stack.md` requires an ADR
before any library enters the tree.

The constraint that makes this non-obvious is not capability — several libraries can extract text.
It is **threat model and honesty**:

**An uploaded document is hostile input.** `docs/features/resume-parsing.md` states plainly that a
crafted document is a threat and parsing happens in a constrained context. A document parser is a
large attack surface with a long CVE history, and this one runs on a file a stranger uploaded.

**Extraction quality decides whether the product lies.** Real résumés are two-column layouts, tables,
and text drawn as vectors. A library that silently returns interleaved garbage produces a profile that
looks complete and is wrong — worse than one that fails. The `partial` state exists because degraded
extraction is the *common* case, and it can only be reported if extraction says what it could not do.

**Scanned résumés exist.** An image-only PDF contains no text at all. That is an `unknown` outcome
naming what is wrong, not an OCR project — but the library must let us *detect* it rather than return
an empty string indistinguishable from a blank page.

## Options considered

### Option A — `pypdf` + `python-docx`

**Advantages.** Both are pure Python, actively maintained, permissively licensed, and narrow: they
read the formats and do nothing else. Pure Python means no system packages in the container and no
native build step, which keeps the `ai/` image simple. `python-docx` reads paragraph and table
structure, which is what section segmentation needs.

**Disadvantages.** `pypdf`'s text extraction is the weakest of the options on multi-column layouts —
the exact case résumés are full of. It has had CVEs, as every PDF parser has. Two libraries rather
than one, with unrelated APIs.

### Option B — `pdfplumber` + `python-docx`

**Advantages.** `pdfplumber` exposes word positions and bounding boxes, so column detection is
possible rather than hoped for — a genuine quality difference on the layouts that matter here. Same
DOCX story as Option A.

**Disadvantages.** Heavier, slower, and built on `pdfminer.six`, adding a transitive dependency with
its own history. The positional API is more code to write and maintain, and that code is ours to get
right.

### Option C — `PyMuPDF` (fitz)

**Advantages.** Fastest and generally the best extraction quality, including layout-aware modes.
Handles DOCX and other formats too, so one library covers everything.

**Disadvantages.** **AGPL-licensed** unless a commercial licence is purchased. For a product intended
to be sold, that is a legal decision, not a technical one, and it should not be made by an
implementation detail. Also a native binary, so the container gains a compiled dependency.

### Option D — Apache Tika or a hosted extraction API

**Advantages.** Handles every format, battle-tested, and moves the hostile-input surface out of our
process.

**Disadvantages.** Tika means running a JVM service beside a Python one — a whole new runtime in the
stack for one step. A hosted API means sending a stranger's résumé, an unusually sensitive document,
to a third party — which is a privacy decision, and privacy is not cuttable
(`docs/roadmap/mvp.md`).

### Option E — Do nothing: accept pasted plain text only

**Advantages.** Zero dependencies, zero parser attack surface, and it makes M1a testable end to end
immediately. The rest of the pipeline — resolution, classification, evidence — is identical whatever
produced the text.

**Disadvantages.** Nobody has their résumé as plain text. `docs/features/resume-parsing.md` names PDF
and DOCX as the entry point, and "paste your résumé as text" is a materially worse product for the
person we are building for.

## Decision

**Option A — `pypdf` + `python-docx`.** Decided 2026-08-01 by the project lead.

The reasoning, stated rather than assumed: pure Python keeps
the container and the build simple, the scope of each library is narrow, and extraction quality is
recoverable — a weak extraction that we *detect* becomes a `partial` or `unknown` result, which the
product is already designed to show honestly. Option B is the upgrade path if `partial` turns out to
be the common outcome rather than an occasional one, and it is an upgrade behind the same port rather
than a rewrite. **Option C was excluded on licence, not on merit.** PyMuPDF is the best extractor here and would have
won on quality alone; AGPL for a product intended to be sold is a commercial decision, and it was made
deliberately rather than absorbed by an implementation detail. If a commercial licence is ever bought,
this ADR is the thing to revisit — the port makes that a one-file change.

**Regardless of which option is chosen, extraction sits behind a port.** `ai/resume-parser` defines a
`TextExtractor` protocol; the library is one implementation. That is what makes A→B an afternoon, and
it is why the rest of the parser can be built and tested before this ADR is Accepted.

## Consequences

**Accepted costs.**

- **A parser CVE becomes our CVE.** Uploads must stay size-capped and parsed with a timeout, and the
  dependency must be updated deliberately rather than pinned and forgotten.
- **Multi-column extraction will be imperfect**, and this is the cost that shows up in the product.
  It is survivable only because the pipeline reports `partial` honestly — if that state is ever
  quietly dropped, this decision becomes wrong retroactively.
- **Two libraries, two APIs**, both behind one port.
- **No OCR.** An image-only PDF returns `unknown` naming what is missing. That is the honest answer,
  not a gap to paper over with a guess.

**Follow-up work.**

- Add `pypdf` and `python-docx` to `ai/resume-parser`'s own `pyproject.toml` — not to `ai/shared`,
  which must not accumulate its members' dependencies (ADR-0006).
- Implement the port with both, plus the image-only-PDF detection that makes `unknown` reachable.
- Cap upload size and wall-clock parse time at the gateway, before any library sees the bytes.
- Golden-file tests over fixture documents that are **synthetic, never a real person's résumé**
  (`docs/development/testing.md`).

**Reversal cost.** Low, and deliberately: the port is the whole point. Swapping to `pdfplumber` is a
new implementation of one protocol plus a dependency change, with no caller affected.

## Compliance

- **Verified by attempting to violate it:** nothing outside the port implementation imports `pypdf`
  or `docx`. A `import pypdf` in `compute.py` means the port was bypassed and the reversal argument
  above is void.
- Document libraries appear in `ai/resume-parser/pyproject.toml` only — never in `ai/shared`.
- An image-only PDF fixture returns `unknown` with a reason, and there is a test asserting it.
- **Résumé text never appears in a log, an error message, or a fixture**
  (`docs/architecture/privacy.md`). This is the rule most likely to be broken by a debugging session
  and never noticed.

## Related

- ADR-0003 (`ai/` is Python), ADR-0006 (dependencies belong to the member that needs them)
- `docs/features/resume-parsing.md` — the flow, the states, and the threat statement
- `.claude/skills/pdf/SKILL.md`, `.claude/skills/docx/SKILL.md` — vendored tooling references
