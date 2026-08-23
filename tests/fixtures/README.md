# fixtures

> **Purpose:** Shared test fixtures and sample data.

**What is here:** three families, each with a different producer and a different reason to exist.
None of them are hand-invented sample data — that is the point of the directory.

| Directory | Holds | Read by |
|---|---|---|
| `connectors/<sourceId>/` | the raw payload **as the source served it** | that connector's `normalize.test.ts` |
| `prompts/<prompt-name>/` | eval cases and a dated baseline | `ai/shared/evals` |
| `resume-parser/` | captured responses of the real FastAPI app | the cross-language contract test |

## `connectors/` — golden files, captured not written

One directory per source id, holding what the endpoint actually returned. `normalize` is tested
against these rather than against a shape somebody imagined the source has, which is what makes a
silent upstream change visible: the fixture is refreshed, the assertions move, and the diff says
what the source did.

Eight sources have one: `ch-sem`, `de-aufenthg`, `de-bayingg`, `de-bundesanzeiger`, `git-scm`,
`lever`, `lu-legilux`, `nz-inz`. `de-bundesanzeiger` keeps the served PDF beside its JSON, because
the figures are only in the PDF.

Each connector's README names its own fixture and what was captured. `.claude/skills/connectors/
SKILL.md` step 4 and `docs/development/connector-guide.md` are where the capture step is specified.

## `prompts/` — eval cases, and the six kinds a prompt cannot skip

Layout is `cases/*.json` plus `baseline.<promptVersion>.json`. A case is self-contained — `why`,
`kind`, `knowledge`, `input`, `expect` — so it can be read without the runner.

`ai/shared/evals/cases.py` requires every prompt to cover all six kinds: `happy`, `unknown`,
`contested`, `injection`, `malformed`, `out_of_scope`. **`unknown` and `injection` are gates rather
than trends** — a regression in either blocks regardless of how much accuracy improved, because both
are invisible in normal use and harmful when they slip. A prompt missing one is not evaluated at all.

Two prompts have fixtures: `instruction-quarantine` and `skill-recall`, both baselined
`2026-08-02`. `docs/prompts/evals.md` is the contract.

## `resume-parser/` — written by Python, read by TypeScript

**These files are generated, not authored.** `ai/resume-parser/tests/test_contract.py` writes them
by running the real FastAPI app; `tests/unit/contracts/resume-parser-contract.test.ts` and
`services/api-gateway/src/resume/parser-client.test.ts` read them back and validate them against the
hand-written types in `@zentavio/types`.

That pins the two languages to each other in the absence of schema generation, which is a dependency
needing its own ADR. Change the Python response shape and the fixtures change and the TypeScript
assertions fail; change the TypeScript type and they fail too. The failure it exists to catch — a
gateway that compiles perfectly and misreads every response at runtime — is otherwise invisible
until production.

Enrichment is forced **off** before the app is imported when these are regenerated. With a model
reachable the committed fixtures would say `enrichment: "applied"` on a developer's machine and
`"unavailable"` in CI, and a guard that flips with the environment guards nothing. The degraded
response has the same keys, which is what is being pinned.

**Do not edit a file in this directory by hand.** Regenerate it from its producer, or the guard
stops meaning anything.

## Related

- `.claude/skills/testing/SKILL.md` — what belongs at which test level
- `docs/development/testing.md`, `docs/prompts/evals.md`
