# ADR 0009: AI evaluation strategy

- **Status:** Accepted
- **Accepted:** 2026-07-28
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** `ai/shared/evals`, `docs/prompts/evals.md`, `.github/workflows/ci.yml`, `tests/fixtures/prompts`

## Context

The runner exists (`ai/shared/evals/`) and its offline half runs in CI: fixture integrity, all six required
case kinds present, no prompt without fixtures. **Graded runs are implemented but run nowhere**, because
grading needs a reachable model and the GitHub-hosted runner has none.

So the open question is narrower than "how do we evaluate", and sharper: **how do we know an AI change is
actually better, and what blocks a merge?**

Three constraints.

**Grading needs a model.** Ollama with a pinned model, somewhere CI can reach it.

**`pull_request` runs untrusted code.** Any solution involving credentials or a persistent host must not
expose them to a fork's pull request (`docs/architecture/security.md`).

**The gates are asymmetric, and this is the important part.** Grounding, schema adherence, unknown handling,
and injection resistance are **gates**; extraction accuracy is a **trend**. A change that improves accuracy
by four points while regressing unknown handling is rejected, because a confident wrong answer costs a user
more than a missed skill. Any mechanism that reduces this to one aggregate score defeats it.

## Options considered

### Option A — Self-hosted CI runner with Ollama

A machine we control, registered as a runner, with the pinned model resident.

**Advantages.** Fully automated: graded evals run on every relevant pull request, and the gate is genuinely
blocking. Model version pinned in one place. No per-run model download, so runs are fast. Same model as
local development, so results are comparable.

**Disadvantages.** A machine to operate, patch, and pay for. **Self-hosted runners must not run
`pull_request` from forks** — a well-known code-execution exposure — so the workflow needs
`pull_request_target` or a trusted-contributor gate, which is real security configuration to get right.
Becomes a single point of failure for merging. Heaviest option, and it is infrastructure before there is a
product.

### Option B — Model in a CI container, downloaded per run

A hosted runner starts Ollama as a service container and pulls the pinned model each run.

**Advantages.** No persistent infrastructure and no self-hosted runner exposure. Ephemeral, so nothing to
patch. Works identically for forks.

**Disadvantages.** Multi-gigabyte model pull per run — slow and wasteful, and cache layers for model weights
on hosted runners are unreliable at that size. Hosted runners are CPU-only, so inference is slow enough that
a full eval suite may exceed sane job timeouts. Cost in minutes rather than dollars, but real.

### Option C — Required manual gate: author runs graded evals, attaches the delta report

The offline half stays automated and blocking. Graded runs happen on the author's machine; the PR requires
the delta report, and a reviewer checks it.

**Advantages.** No infrastructure, no security exposure, no cost. The author already has a model locally
(they are developing prompts). The delta report is exactly the artifact a reviewer needs, and a human reading
it is *better* at spotting a bad tradeoff than a threshold is — particularly the accuracy-up /
unknown-handling-down case, which is the failure mode that matters most. Available immediately.

**Disadvantages.** Enforced by review, not mechanism — a determined author can skip it, and the honest
framing is that it is a strong convention rather than a gate. Results vary with the author's hardware and
model version unless both are pinned. Does not scale past a small team.

### Option D — LLM-as-judge for the whole suite

**Advantages.** Cheap, fast, no local model needed for grading, scales.

**Disadvantages.** **Rejected on principle already recorded** (`docs/prompts/evals.md`): a judge that
cannot be audited is not evidence. Grounding and schema adherence are checked deterministically — a returned
id is either in the supplied closed set or it is not — and replacing that with a model's opinion makes the
gate softer exactly where it must be hardest. Retained only for prose assertions, where it already is.

### Option E — Do nothing; leave graded evals unrun

**Advantages.** None beyond inaction.

**Disadvantages.** The offline half checks that cases *exist*, not that the prompt passes them. Shipping a
prompt whose injection case fails, with the fixture present and unexecuted, is worse than having no fixture:
it looks covered.

## Decision

**Option C now, Option A when there is a second contributor or the first paying user — whichever
comes first.**

Concretely:

1. **Offline checks stay automated and blocking** — no prompt without fixtures, no fixture set missing any of
   the six kinds. Already live.
2. **A prompt change requires an attached delta report** from `pnpm eval -- <name>`, produced against a
   **pinned model** (`ZENTAVIO_EVAL_MODEL`) so reports are comparable between machines.
3. **A `promptVersion` bump is verified automatically** — changed prompt content with an unchanged version
   fails CI. This is the part of the gate that *can* be mechanised today, and it is what keeps past outputs
   reproducible.
4. **Baselines are committed** per `promptVersion`, so the comparison is against a recorded run rather than a
   memory.
5. **Gate asymmetry is preserved in the report**, which states gate results separately from the accuracy
   delta. A reviewer approving an accuracy gain with a gate regression is making a visible mistake rather
   than an invisible one.

The reason to start here rather than at Option A: the gate's value is in the *judgment* about a tradeoff, and
a human reading a delta report supplies that better than a threshold does. Option A adds automation and a
security surface to a process that currently has one contributor, and it is the right answer at the moment
that stops being true.

**This is deliberately not called a blocking gate.** It is a required review artifact. Calling it blocking
would repeat exactly the error this repository already made once — documenting a gate that mechanism did not
enforce.

## Consequences

**Accepted costs.**

- The strongest part of the eval gate is enforced by review, not mechanism. Stated plainly in
  `docs/prompts/evals.md` and `ci-cd.md` rather than glossed.
- Contributors need Ollama and the pinned model locally to change a prompt.
- Delta reports depend on the author running them honestly. The `promptVersion` check catches the careless
  case, not the deliberate one.
- Deferring Option A means a second contributor arrives before the automation does.

**Follow-up work.**

- ~~The `promptVersion` check.~~ **Done** — also catches deletes and moves, which the original wording
  did not anticipate.
- A PR template section for the delta report.
- Pin `ZENTAVIO_EVAL_MODEL` in `packages/config` and document the local setup.
- Human review process: a prompt change needs a reviewer who reads the gate results, not only the summary.
- Dataset management — case files are committed, reviewed like code, and every case states why it exists;
  a case without a `why` is rejected by the loader today.
- Revisit trigger written into the ADR: second contributor, or first paying user.

**Reversal cost.** Low. Moving to Option A is adding a runner and a workflow job; the runner, fixtures,
grader, and baselines are unchanged. That is why the runner was built model-agnostic.

## Compliance

- Offline checks run on every pull request and block — verifiable in `.github/workflows/ci.yml`.
- `promptVersion` bump check blocks — implemented in `ai/shared/evals/check_prompt_versions.py`, run in
  the `python` CI job, covered by 19 tests. It also fails a delete or a move, since either removes the
  version that produced past outputs.
- A prompt change without an attached delta report is a review rejection.
- The delta report states gate results and the accuracy delta **separately**. A single blended score is a
  defect in the report format.
- No LLM judge for grounding or schema adherence, ever. Prose assertions only, spot-checked.
- Every case file has a non-empty `why` — enforced by the loader.

## Related

- `docs/prompts/evals.md` — the policy and the six required case kinds
- `docs/prompts/conventions.md`, `ai/shared/evals/README.md`
- ADR-0003 (model boundary), ADR-0005 (what CI enforces today)
- `.claude/context/decision-gate.md` — the claim-verification discipline this ADR applies to itself
