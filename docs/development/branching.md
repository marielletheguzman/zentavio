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

## Required checks — decided, not yet configured

**ADR-0011 (Accepted)** specifies branch protection on `main`:

- require a pull request before merging
- require the status check named **`ci`**
- require branches to be up to date
- no force pushes, no deletions
- **no administrator exemption**
- squash merge only

**Not configured yet**, so a red run still does not physically block a merge and the rules above hold by
convention. ADR-0011 carries a precondition: **one green CI run must be observed first**, because requiring
a check that has never passed would block all work on an unverified assumption.

Configure at Settings → Branches → rule for `main`. Then verify by opening a pull request with a
deliberately failing check and confirming the merge is refused — a setting nobody has tested is a claim,
not a control.

## Related

- `conventions.md` — commit format and types
- `contributing.md` — review expectations
- `ci-cd.md` — what CI enforces, and what it does not yet
