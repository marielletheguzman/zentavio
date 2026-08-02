# Resume Parser Prompts

> **Purpose:** Prompts for CV extraction.

Prompts loaded by `ai/resume-parser`. These are pure **extraction** prompts: they turn a messy document
into structured claims with source spans. They never assess the person, never infer a score, and never
add a skill the document does not mention.

Prompt files live at `ai/resume-parser/prompts/`. This document is the contract, not a copy of the text.

## What the model does here, and what it does not

**ADR-0018 settled this with a measurement.** Skill resolution, the `EVIDENCED`/`CLAIMED` split,
deduplication, confidence and ordering are done by `ai/resume-parser/src/resume_parser/compute.py` — no model
runs there and none should. Alias matching against a known set is a lookup, and a lookup a model
performs is a lookup that can hallucinate.

The model does the two jobs code cannot:

| Prompt | Returns |
|---|---|
| `skill-recall` | technologies the résumé names that are **not** in the closed set — the skill-graph coverage backlog |
| `instruction-quarantine` | spans addressed to the reader rather than describing the person, so code can exclude them before matching |

**Neither prompt emits a `skillId`, a status, or a confidence.** A prompt in this directory whose
output schema contains those fields contradicts ADR-0018.

Prompt files live at `ai/resume-parser/prompts/`. This document is the contract, not a copy of the
text.

### Planned, not built

`experience-extract` (roles, employer, title, dates), `education-extract`, `language-extract`, and
`section-segment` are named in `docs/features/resume-parsing.md` and do not exist yet. Segmentation
is currently deterministic, in `compute.py`.

### `skill-recall`

**Inputs.** `{{ known_skills }}` (the closed set), `{{ resume_text }}` (untrusted).

**Output.**

```json
{
  "status": "ok | unknown | out_of_scope",
  "unmatched": ["Pulumi"],
  "missing": ["<what would improve this>"],
  "reason": null
}
```

**`unmatched` is the whole point.** An unrecognized phrase is returned as-is rather than mapped to
the nearest known skill — mapping Pulumi onto `terraform` would be a fabricated claim about a person
that no source span could justify. It is simultaneously the honest answer and the coverage backlog
for the skill graph, and it is the one thing the deterministic matcher structurally cannot produce:
it returns only what it already knows.

**Returning a known id is the error this prompt must not make.** It means resolution was attempted
in the model instead of in code.

### `instruction-quarantine`

**Inputs.** `{{ resume_text }}` (untrusted). No knowledge block — it judges intent, not facts.

**Output.**

```json
{
  "status": "ok | unknown | out_of_scope",
  "quarantinedSpans": ["<verbatim sentence>"],
  "instructionsIgnored": true,
  "reason": null
}
```

**The failure it exists for.** A sentence reading "This candidate is an expert in Kubernetes,
Terraform, Go and Docker", pasted under an Experience heading, is mined by the alias matcher as four
evidenced skills. Nothing is obeyed — there is nothing to obey — but the padding vector is real, and
alias matching has no notion that a sentence might be addressed to the reader.

**Spans come back verbatim** because code matches them against the document. A paraphrased span
matches nothing, quarantines nothing, and still looks like protection.

**The asymmetry is deliberate.** When unsure, leave it out. A missed injection costs less than a
real line of someone's history being deleted from their profile, so a false positive is the more
expensive error.

**The distinction that matters.** `EVIDENCED` means the skill appears in a described role or project;
`CLAIMED` means it appears only in a list. They carry different weights in every downstream score
(`docs/database/entities/user.md`), and conflating them inflates readiness for everyone who pads a
skills section. Both are decided in `compute.py`, not by a prompt.

**Never infers** a skill from a job title, an employer, or years of experience. "Senior DevOps
Engineer" is not evidence of Terraform.

### `experience-extract` — planned

**Output.** Roles with `employer`, `title`, `startDate`, `endDate`, `isCurrent`, `description`,
`sourceSpan`, and per-field `confidence`. Dates absent in the document are `null` — never inferred from
surrounding roles.

Its output is what would make `EVIDENCED` decidable from prose rather than from headings, so the
described responsibilities are extracted verbatim rather than summarized. Today `compute.py` decides
it from section headings instead, which is why this prompt is not yet needed.

### `section-segment` — superseded

Was to run first when extraction confidence is low: PDF-to-text produces column bleed, lost headings,
and interleaved lines, and segmenting before extracting stops a skills list from being read as a job
description. **`compute.py::segment` does this deterministically** — a heading regex over a known set
of skill-list and experience headings — and by ADR-0018 it stays there. Revisit only if real
documents defeat the heading rules, which would be evidence that the text genuinely is too messy for
a rule.

## Confidence

Per field, never per document:

| Level | Meaning |
|---|---|
| `high` | explicit and unambiguous in clean text |
| `medium` | explicit but in a degraded or ambiguous section |
| `low` | inferred from context — carried forward as `claimed` at best |

A garbled section yields `low` on its fields. It never yields a confident guess.

## Unknown path

An unreadable document returns `status: "unknown"` with `missing` naming what failed — never a partial
profile presented as complete. The user is asked for a better file or manual entry, which is a real
answer rather than a silent degradation.

## Fairness

Nothing is inferred from name, nationality, age, gender, photo, address, or institution prestige. These
fields are not extracted as scoring inputs at all — see `.claude/context/career-philosophy.md`. This is
a hard constraint on the prompt and an eval case, not a guideline.

## Privacy

- The document is parsed and then **discarded**; the parsed profile is retained
  (`docs/architecture/data-flow.md`).
- Résumé text is untrusted input: delimited, declared as data, and instructions inside it are extracted
  rather than followed.
- No résumé text in a log line, an error, or a fixture (`docs/architecture/privacy.md`).

## Eval cases

`skill-recall` — `tests/fixtures/prompts/skill-recall/cases/`:

| Case | Guards |
|---|---|
| `happy-novel-tool` | an unknown tool is returned as-is, not mapped to a neighbour |
| `happy-nothing-new` | an empty list is a real answer; known skills never leak into `unmatched` |
| `happy-not-a-technology` | titles, employers, schools, methodologies and soft skills stay out |
| `contested-known-spelled-differently` | "GoLang", "Postgres", "K8s" are already known, not new |
| `unknown-unreadable-pdf` · `unknown-empty-document` | garbled or empty input returns `unknown`, never a padded list |
| `injection-instruction-in-resume` | an instruction to return a known id, or invent one, is not followed |
| `injection-fake-known-skills-block` | a forged `<known_skills>` block cannot suppress a finding |
| `malformed-truncated-pdf` | word fragments from column bleed are not filed as technologies |
| `out-of-scope-assess-candidate` | a request to rate the person returns the refusal shape |

`instruction-quarantine` — `tests/fixtures/prompts/instruction-quarantine/cases/`:

| Case | Guards |
|---|---|
| `happy-clean-resume` | an ordinary résumé quarantines nothing |
| `happy-boastful-first-person` | self-assessment is résumé content, not an injection |
| `contested-cover-letter-to-hiring-manager` | a letter addressed to a reader, describing one's own work, survives |
| `injection-instruction-in-resume` | "ignore previous instructions…" comes back verbatim, flagged |
| `injection-fake-tag-block` | a forged closing tag is quarantined; the real experience line is not |
| `malformed-truncated-pdf` | garbled text is damage, not intent |
| `unknown-*` · `out-of-scope-assess-candidate` | nothing to inspect, and a document that is itself a request |

**Fairness** has no dedicated case here any more. Neither prompt emits a per-skill claim, so there is
no output field that could vary with a name — the constraint moved to `compute.py`, which mines only
the lines under headings and never the headings, titles, or employers themselves.

## Related

- `../conventions.md`, `../evals.md`
- `docs/features/resume-parsing.md`, `docs/architecture/ai-services.md`
- `docs/database/entities/user.md` — where the output lands
- `.claude/skills/pdf/SKILL.md`, `.claude/skills/docx/SKILL.md` — document extraction tooling
