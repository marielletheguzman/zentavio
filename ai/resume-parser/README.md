# resume-parser

> **Purpose:** Extract skills, roles, and experience from uploaded CVs.

```text
src/resume_parser/
├── ports.py         what it needs from outside — all of it supplied in the request
├── extract.py       PDF/DOCX/text (ADR-0016); the only module importing pypdf or python-docx
├── compute.py       segment, resolve, classify — deterministic, no model
├── enrich.py        what the model adds, and every way it may fail
├── model_client.py  the only module that talks to a model
└── main.py          POST /parse, health, the shared error envelope
```

**Stateless.** The closed set of skills arrives *in the request*, so the service may only return
slugs the caller supplied and cannot invent one.

**The document is parsed and discarded.** The parsed profile is the asset; the file is a liability,
and it is never written to disk, a log, or an error message.

**Resolution and classification belong to code, not the model** (ADR-0018), and that split was
settled by measurement rather than argument: a full-extraction prompt scored 4/11 while `compute.py`
got resolution, the evidenced/claimed distinction, deduplication and ordering right on the same
inputs. The model supplies the two jobs it is measurably better at — recall on phrasing the alias
table has never seen, and spans addressed to the reader rather than describing the person.

**A parse outcome is not an HTTP error.** An unreadable résumé is `200` with `status: "unknown"` and
a reason; `4xx` is reserved for "the caller sent something wrong", so a broken upload stays
distinguishable from a broken document.

**Enrichment is optional and its absence is visible.** With no model reachable the response carries
`enrichment: "unavailable"`, which means the profile had **no injection screening**. That is not the
same result, and the field exists so a caller cannot mistake one for the other.

Prompts live beside `src`, not inside the package: they are versioned artifacts the eval runner
globs at `ai/*/prompts/*.md`.

## Not here

`experience-extract`, `education-extract`, `language-extract`. Segmentation is deterministic in
`compute.py` and stays there until real documents defeat the heading rules.
