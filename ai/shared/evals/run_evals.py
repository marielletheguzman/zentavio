#!/usr/bin/env python3
"""Zentavio prompt eval runner — docs/prompts/evals.md.

Two modes, because only one of them can run in CI today:

    --offline   fixture integrity, required case coverage, prompt-version hygiene.
                No model needed, so CI enforces this on every pull request.

    (default)   the above, then grade every case against a real model. Needs Ollama.
                Run locally, or on a runner with a model host.

Exit codes: 0 pass, 1 gate failure or blocked regression, 2 fixture/usage error.

Invoked directly (`python ai/shared/evals/run_evals.py`) or via `pnpm eval`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import baselines
import cases as case_mod
import grader
from model import Model, render

EXIT_OK, EXIT_FAIL, EXIT_USAGE = 0, 1, 2


def find_repo_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / "package.json").is_file() and (candidate / "docs").is_dir():
            return candidate
    return start


def check_offline(root: Path, suites: list[case_mod.PromptSuite]) -> list[str]:
    """Everything checkable without a model. These are hard failures, not warnings."""
    problems: list[str] = []

    for orphan in case_mod.orphaned_prompts(root):
        problems.append(
            f"{orphan}: prompt has no fixture directory - an unevaluated prompt cannot ship"
        )

    for suite in suites:
        if suite.prompt_file is None:
            problems.append(
                f"{suite.name}: fixtures exist but no prompt file matches "
                f"ai/*/prompts/{suite.name}-<date>.md"
            )
        missing = suite.missing_kinds()
        if missing:
            problems.append(
                f"{suite.name}: missing required case kind(s): {', '.join(missing)} "
                f"(all of {', '.join(case_mod.REQUIRED_KINDS)} are required)"
            )
    return problems


def run_graded(root: Path, suite: case_mod.PromptSuite, model: Model) -> list[grader.CaseResult]:
    template = suite.prompt_file.read_text(encoding="utf-8") if suite.prompt_file else ""
    results = []

    for case in suite.cases:
        if not model.available:
            results.append(grader.grade(case, None))
            continue
        try:
            prompt = render(template, {**case.knowledge, **case.input})
        except ValueError as exc:
            results.append(grader.grade(case, None, error=str(exc)))
            continue
        response, error = model.complete(prompt)
        results.append(grader.grade(case, response, error))

    return results


def report(suite: case_mod.PromptSuite, results: list[grader.CaseResult], summary: dict) -> None:
    print(f"\n{suite.name}  ({suite.version or 'no prompt file'})")
    for r in results:
        if r.skipped:
            mark, note = "skip", f" - {r.skipped}"
        else:
            mark, note = ("pass", "") if r.passed else ("FAIL", "")
        gate = " [gate]" if r.is_gate else ""
        print(f"  {mark:4} {r.case.kind:13} {r.case.name}{gate}{note}")
        for f in r.findings:
            print(f"         {f}")
    if summary["graded"]:
        print(
            f"  {summary['passed']}/{summary['graded']} passed"
            f"  accuracy={summary['accuracy']}%"
            f"  gate failures={summary['gate_failures']}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="run_evals", description=__doc__)
    parser.add_argument("prompt", nargs="?", help="prompt name; omit for all")
    parser.add_argument("--offline", action="store_true", help="fixture checks only, no model")
    parser.add_argument("--baseline", action="store_true", help="record results as the baseline")
    parser.add_argument(
        "--allow-regression", action="store_true", help="permit an accuracy drop over tolerance"
    )
    parser.add_argument(
        "--require-model", action="store_true", help="fail if no model is reachable"
    )
    args = parser.parse_args(argv)

    root = find_repo_root(Path(__file__).resolve())

    try:
        suites = case_mod.discover(root, only=args.prompt)
    except case_mod.FixtureError as exc:
        print(f"fixture error: {exc}", file=sys.stderr)
        return EXIT_USAGE

    problems = check_offline(root, suites)
    if problems:
        print("offline checks failed:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return EXIT_FAIL

    if not suites:
        # Zero prompts is the current state of the repository, not an error. The gate
        # becomes meaningful the moment the first prompt and its fixtures land.
        print("no prompt fixtures found - nothing to evaluate (offline checks passed)")
        return EXIT_OK

    print(f"offline checks passed for {len(suites)} prompt suite(s)")
    if args.offline:
        return EXIT_OK

    model = Model()
    if not model.available:
        message = f"no model reachable at {model.host}"
        if args.require_model:
            print(f"{message} - required", file=sys.stderr)
            return EXIT_FAIL
        print(f"{message}; grading skipped. Run with a model host for the full gate.")

    blocked = False
    for suite in suites:
        results = run_graded(root, suite, model)
        summary = grader.summarize(results)
        report(suite, results, summary)

        if not summary["graded"]:
            continue

        version = suite.version or "unversioned"
        if args.baseline:
            path = baselines.save(root, suite.name, version, summary, model.name)
            print(f"  baseline recorded: {path}")
            continue

        comparison = baselines.compare(summary, baselines.load(root, suite.name, version))
        print(f"  {'BLOCKED' if comparison.blocked else 'ok'}: {comparison.reason}")
        blocked = blocked or comparison.blocked

    return EXIT_FAIL if blocked else EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
