# Branching

> **Purpose:** Git workflow, branch and PR rules.

Trunk-based: short-lived branches off `main`, merged quickly. No long-running release branches — they
accumulate divergence and turn every merge into an event.

## Branches

```text
main                          always green, always deployable in principle
<type>/<short-description>    everything else
```

`<type>` matches the commit types in `conventions.md`: `feat` · `fix` · `docs` · `refactor` · `test` ·
`chore` · `perf` · `build` · `ci`.

```text
feat/greenhouse-connector
fix/stale-posting-expiry
docs/immigration-origin-rules
chore/pin-action-shas
```

**Never commit directly to `main`.** Not for a typo, not for a doc fix. The value of "every change was
reviewed and CI-checked" collapses the first time there is an exception.

## Lifetime

Short. A branch open longer than a couple of days is usually doing two things and should be split — and
the longer it lives, the more its merge is a guess about code that changed underneath it.

Rebase onto `main` rather than merging `main` in, so history stays linear and a revert is a single
commit. Never rebase a branch someone else is working on.

## Pull requests

Every PR states:

1. **What changed** and **why** — the why is the part that survives.
2. **How it was verified** — commands run, and what their output showed. "Tested locally" is not
   verification.
3. **What was not done**, if the change is partial. A known gap named is a gap that gets closed; an
   unnamed one becomes a surprise.
4. **The ADR**, if it touches a boundary, a dependency, or a contract — or the fact that one is needed.

Small PRs. A 40-file PR is not reviewed; it is approved.

## Merging

- **CI's `ci` check must be green.** A required status check since 2026-07-31 — see below.
- Squash merge, so `main` gets one commit per logical change and reverts are clean. *(Enforced by
  convention only: squash-merge-only is not yet configured in repository settings — see below.)*
- The commit message follows `conventions.md`, including the body explaining why.
- Delete the branch after merge.

## Reverting

Prefer a revert over a hotfix on a broken `main`. `main` being green matters more than the change being
present, and a revert is a decision that can be re-made calmly.

A revert commit says what was reverted **and why** — otherwise someone re-lands the same change next week.

## Required checks — configured, not yet tested

**ADR-0011 (Accepted)** specifies branch protection on `main`. Configured on 2026-07-31, after the
precondition was met: CI run `30413570717` on `02fe14a` was observed green, with the
`Integration tests (PostgreSQL)` job actually executing against a live database rather than skipping.

| Setting | ADR-0011 | Actual |
|---|---|---|
| pull request before merging | required | required (0 approvals) |
| status check `ci` | required | required |
| branches up to date | required | `strict: true` |
| force pushes | forbidden | forbidden |
| deletions | forbidden | forbidden |
| administrator exemption | none | none |
| squash merge only | required | **not set** — merge commits and rebase merges are still allowed |

Approvals are set to 0 deliberately: ADR-0011 defers required review (Option C) until a second contributor
joins, so the pull request is a gate for CI, not for review.

Configuring this required making the repository **public** — GitHub gates branch protection and rulesets
behind a paid plan for private repositories, and both API calls returned
`Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)`.

**Two gaps remain open:**

1. **Squash-merge-only is not configured.** Set it at Settings → General → Pull Requests.
2. **The protection has never been tested.** Nobody has opened a pull request with a deliberately failing
   check and confirmed the merge is refused. Until that has happened, the correct statement is "branch
   protection is configured", not "merge enforcement is verified" — a setting nobody has tested is a claim,
   not a control (`.claude/context/decision-gate.md`).

## Related

- `conventions.md` — commit format and types
- `contributing.md` — review expectations
- `ci-cd.md` — what CI enforces, and what it does not yet
