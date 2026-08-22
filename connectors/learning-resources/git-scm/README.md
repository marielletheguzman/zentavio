# git-scm

> **Purpose:** The official Git reference documentation, catalogued as learning resources.

## Why it exists

`learning_resources` was real and empty. A completion has to point at a resource, so the half of M6
that says *"completing a course does not move readiness"* could be asserted and never demonstrated —
there was nothing to complete.

This is the first connector under `learning-resources/`, and the smallest honest one: ten pages
somebody chose, from an authority the product already cites.

## What it stores, and what it refuses to

**A title, a URL, and metadata.** Never the documentation. The manual pages are the Git project's own
prose; linking to them and describing them is a catalogue, copying them would be a mirror, and a
mirror goes stale in a way that misinforms somebody trying to learn.

The one-sentence purpose on each row is **ours**, saying why you would open the page. It is not the
page's NAME line and not a summary of its content: an ingested paraphrase of documentation is exactly
the invented detail the learning-paths skill refuses.

`grants_evidence` is always `false`, and validation refuses a row claiming otherwise. Reading a
manual page is not a demonstration of anything (ADR-0030).

## Legal basis

`git-scm.com` serves **no `robots.txt`** — 404 on 2026-08-22. That states no restriction rather than
granting one, so the courtesy rate limit (20/minute, 3s apart) is the operative constraint. The
reference pages are the Git project's documentation, distributed with Git under GPLv2. Nothing here
reproduces them.

## The pages, and why these ten

| | |
|---|---|
| `git-checkout` · `git-cherry-pick` · `git-commit` · `git-fetch` · `git-merge` | the commands `git-fundamentals` asks about |
| `git-rebase` · `git-reset` · `git-revert` · `git-stash` · `gitignore` | the rest of that same set |

**A closed list, not a crawl.** Crawling a documentation site produces a catalogue nobody chose:
every page equally weighted, most of them irrelevant to any skill we model. And an assessment citing
one page while the catalogue offers a different one would be two opinions about where to learn
something — this way the thing you are sent to read is the thing the questions were written from.

## What it does not model

- **Difficulty.** Reference documentation is not graded, and assigning a level would be our opinion
  wearing the provider's clothes.
- **Duration.** The pages state none. `typical_duration` stays null rather than carrying a guess,
  and `ck_lr__duration_basis` is what makes a guess impossible to store quietly.
- **Anything outside Git.** One skill, one authority.

## Failure modes it is written around

**A page that fetches but cannot be read.** The parser anchors on the site's own
`Git - … Documentation` title format; a redirect, an error page or a rebranded layout yields `null`
and the connector produces **no row**. A resource with a fabricated title sends somebody to a page
that is not what we said it was. `healthCheck` reports `degraded` for the same reason — a 200 that
parses to nothing would otherwise look like a quiet day.

## Related

- ADR-0030 — why documentation cannot grant evidence
- `docs/database/entities/learning-resource.md` — the table, and `learning_completions`
- `.claude/skills/connectors/SKILL.md` — the contract this implements
