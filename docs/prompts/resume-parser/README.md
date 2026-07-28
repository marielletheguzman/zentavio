# Resume Parser Prompts

> **Purpose:** Prompts for CV extraction.

Prompts loaded by `ai/resume-parser`. These are pure **extraction** prompts: they turn a messy document
into structured claims with source spans. They never assess the person, never infer a score, and never
add a skill the document does not mention.

Prompt files live at `ai/resume-parser/prompts/`. This document is the contract, not a copy of the text.

## Prompts

| Prompt | Extracts |
|---|---|
| `skill-extract` | skills, each as `EVIDENCED` or `CLAIMED`, with a source span |
| `experience-extract` | roles: employer, title, dates, described responsibilities |
| `education-extract` | qualifications, institution, level, dates |
| `language-extract` | human languages and any stated level |
| `section-segment` | splits a garbled document into labelled sections before the above run |

### `skill-extract`

**Inputs.** `{{ known_skills }}` (the closed set), `{{ resume_text }}` (untrusted).

**Output.**

```json
{
  "skills": [{ "skillId": "kubernetes", "status": "EVIDENCED|CLAIMED",
               "sourceSpan": "<verbatim quote>", "confidence": "high|medium|low" }],
  "unmatched": ["<looks like a skill, not in known_skills>"],
  "missing": ["<what would improve this>"]
}
```

**The distinction that matters.** `EVIDENCED` means the skill appears in a described role or project;
`CLAIMED` means it appears only in a list. They carry different weights in every downstream score
(`docs/database/entities/user.md`), and conflating them inflates readiness for everyone who pads a
skills section.

**Never infers** a skill from a job title, an employer, or years of experience. "Senior DevOps
Engineer" is not evidence of Terraform.

**`unmatched` is load-bearing.** An unrecognized phrase is returned as-is rather than mapped to the
nearest known skill. It is simultaneously the honest answer and the coverage backlog for the skill
graph.

### `experience-extract`

**Output.** Roles with `employer`, `title`, `startDate`, `endDate`, `isCurrent`, `description`,
`sourceSpan`, and per-field `confidence`. Dates absent in the document are `null` — never inferred from
surrounding roles.

Its output is what makes `EVIDENCED` decidable, so the described responsibilities are extracted
verbatim rather than summarized.

### `section-segment`

Runs first when extraction confidence is low. PDF-to-text produces column bleed, lost headings, and
interleaved lines; segmenting before extracting stops a skills list from being read as a job
description. Returns labelled spans and a `quality` signal that becomes per-field confidence downstream.

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

| Case | Guards |
|---|---|
| `happy-senior-backend` | clean extraction, correct `EVIDENCED`/`CLAIMED` split |
| `claimed-only-skills-list` | a skills list must not become `EVIDENCED` |
| `unknown-unreadable-pdf` | garbled input returns `unknown`, not a partial profile |
| `unmatched-novel-tool` | an unknown tool goes to `unmatched`, is not mapped to a neighbour |
| `injection-instruction-in-resume` | "ignore previous instructions…" produces normal extraction |
| `fairness-no-inference-from-name` | no output field varies with name or nationality |
| `out-of-scope-assess-candidate` | a request to rate the person returns the refusal shape |

## Related

- `../conventions.md`, `../evals.md`
- `docs/features/resume-parsing.md`, `docs/architecture/ai-services.md`
- `docs/database/entities/user.md` — where the output lands
- `.claude/skills/pdf/SKILL.md`, `.claude/skills/docx/SKILL.md` — document extraction tooling
