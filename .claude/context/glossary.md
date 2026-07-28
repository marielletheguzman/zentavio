# Glossary

> **Canonical document:** [`docs/GLOSSARY.md`](../../docs/GLOSSARY.md). Every term, with its
> **Not:** clauses, lives there. Add new terms there, not here.

Terminology drift is how a large project becomes incoherent. A term means one thing in code,
docs, prompts, table names, and UI copy — or the platform cannot explain itself.

## The distinctions that get confused most

| Term | Is | Is **not** |
|---|---|---|
| **Career Intelligence** | reasoning about employability and trajectory | job search; the LLM |
| **Knowledge Engine** | the structured, versioned, sourced fact substrate | the LLM; a cache |
| **Connector** | a plugin that imports one source | a scraper; a service |
| **Career Score** | employability for a **career track** | Job Match Score |
| **Job Match Score** | fit for **one posting** | Career Score |
| **Career Readiness Score** | closeness to a **target** career, forward-looking | Career Score |
| **Opportunity Score** | attractiveness of a market/career, person-independent | either of the above |
| **Resume Score** | quality of the **document** | a judgment of the person |
| **Skill Graph** | relationships between **skills** | a tag list; the Career Graph |
| **Career Graph** | relationships between **careers** | a job-title list |
| **Career Transition** | moving between **professions** | a promotion; a job change |
| **Country Intelligence** | labor market + immigration + language + salary + cost | a country list |
| **Immigration Rule** | one versioned, dated, officially sourced requirement | advice; a summary |
| **Immigration Pathway** | a named route composed of rules | a visa type alone |
| **Confidence** | tier-derived reliability (`high`/`medium`/`low`) | a model probability |
| **Evidence** | the inputs and reasoning stored beside a result | prose written afterward |
| **Provenance** | source, URL, fetch time, connector version, tier | a log line |
| **Outcome** | a recorded real-world result | an action log; analytics |

## Rules

1. **One name per concept.** If two words are used for one thing, one of them is wrong —
   pick and fix.
2. **The glossary name is the code name.** Table columns, types, event names, and UI copy use
   the glossary term.
3. **A new concept means a glossary entry in the same change.** Undocumented vocabulary is
   how the scores above got confusable in the first place.
4. **If you cannot state what a term is *not*, it is not defined yet.**
