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

- **CI's `ci` check must be green.** *(Not yet a required status check — see below.)*
- Squash merge, so `main` gets one commit per logical change and reverts are clean.
- The commit message follows `conventions.md`, including the body explaining why.
- Delete the branch after merge.

## Reverting

Prefer a revert over a hotfix on a broken `main`. `main` being green matters more than the change being
present, and a revert is a decision that can be re-made calmly.

A revert commit says what was reverted **and why** — otherwise someone re-lands the same change next week.

## Current gap

**`ci` is not yet a required status check on `main`**, so a red run does not physically block a merge. The
rules above hold by convention until that is configured, which makes them exactly as strong as everyone's
attention — the thing ADR-0005 exists to avoid.

Configure it at Settings → Branches → rule for `main` → require the `ci` status check. Tracked as
outstanding work.

## Related

- `conventions.md` — commit format and types
- `contributing.md` — review expectations
- `ci-cd.md` — what CI enforces, and what it does not yet
