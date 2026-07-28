#!/usr/bin/env python3
"""promptVersion integrity check — ADR-0009 compliance.

`promptVersion` is the prompt filename stem (docs/prompts/conventions.md), so changing a
prompt's content without renaming the file silently changes behaviour while claiming to be the
version that produced past outputs. That makes those outputs unreproducible, which is the one
part of the eval gate that can be mechanised — everything else in ADR-0009 is a review
artifact.

Three violations, all about reproducibility:

    modified  a prompt file's content changed but its filename did not
    deleted   a prompt version was removed
    renamed   a prompt version was moved — which removes the old version

**The workflow is copy, not move.** docs/prompts/evals.md and conventions.md both require old
versions to stay: several versions of one prompt coexist, the newest is current, and the older
ones remain so a recorded output stays explicable. So:

    cp  ai/x/prompts/name-2026-07-01.md  ai/x/prompts/name-2026-08-01.md
    # edit the new file; leave the old one untouched

That produces one addition and no modification, which is clean. `git mv` is not, and this
check says so rather than letting the policy be true only in the documentation.

Usage:
    python ai/shared/evals/check_prompt_versions.py [--base <ref>]

Exit codes: 0 pass or nothing to check · 1 violation · 2 usage/git error.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

PROMPT_DIR_PARTS = ("ai", "prompts")
# ai / <service> / prompts / <file>.md
PROMPT_PATH_DEPTH = 4
EXIT_OK, EXIT_FAIL, EXIT_USAGE = 0, 1, 2


def run_git(args: list[str], cwd: Path) -> tuple[int, str]:
    result = subprocess.run(  # noqa: S603
        ["git", *args],  # noqa: S607
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, (result.stdout or "") + (result.stderr or "")


def is_prompt_file(path: str) -> bool:
    """`ai/<service>/prompts/<name>.md` — the only place prompts live."""
    parts = Path(path).parts
    return (
        len(parts) >= PROMPT_PATH_DEPTH
        and parts[0] == PROMPT_DIR_PARTS[0]
        and parts[2] == PROMPT_DIR_PARTS[1]
        and path.endswith(".md")
    )


def resolve_base(cwd: Path, explicit: str | None) -> str | None:
    """Pick something to diff against, preferring the explicit ref.

    Returns None when there is nothing sensible to compare — a fresh repository with one
    commit, for instance. That is not a failure: there is no previous version to contradict.
    """
    if explicit:
        code, _ = run_git(["rev-parse", "--verify", explicit], cwd)
        return explicit if code == 0 else None

    for candidate in ("origin/main", "main"):
        code, _ = run_git(["rev-parse", "--verify", candidate], cwd)
        if code != 0:
            continue
        # On main itself, comparing against main is empty; use the previous commit.
        head_code, head = run_git(["rev-parse", "HEAD"], cwd)
        cand_code, cand = run_git(["rev-parse", candidate], cwd)
        if head_code == 0 and cand_code == 0 and head.strip() == cand.strip():
            continue
        return candidate

    code, _ = run_git(["rev-parse", "--verify", "HEAD~1"], cwd)
    return "HEAD~1" if code == 0 else None


def find_violations(cwd: Path, base: str) -> list[str]:
    code, out = run_git(["diff", "--name-status", "--find-renames", f"{base}...HEAD"], cwd)
    if code != 0:
        # A three-dot range needs a merge base; fall back to a plain two-dot diff.
        code, out = run_git(["diff", "--name-status", "--find-renames", base, "HEAD"], cwd)
        if code != 0:
            raise RuntimeError(f"git diff against {base} failed: {out.strip()}")

    violations = []
    for line in out.splitlines():
        if not line.strip():
            continue
        fields = line.split("\t")
        status, paths = fields[0], fields[1:]

        if status.startswith("M") and is_prompt_file(paths[0]):
            violations.append(
                f"{paths[0]}: content changed but the filename did not. promptVersion is the "
                f"filename stem, so this makes every output recorded against it "
                f"unreproducible. Copy to a new dated filename and edit the copy."
            )
        elif status.startswith("D") and is_prompt_file(paths[0]):
            violations.append(
                f"{paths[0]}: prompt version deleted. Old versions stay so a recorded output "
                f"remains explicable (ADR-0009)."
            )
        elif status.startswith("R") and is_prompt_file(paths[0]):
            # A move removes the old version just as surely as a delete does. The new path is
            # fine; the loss of the old one is not.
            moved_to = paths[1] if len(paths) > 1 else "?"
            violations.append(
                f"{paths[0]}: prompt version moved to {moved_to}. Copy instead of moving — the "
                f"old version stays so a recorded output remains explicable (ADR-0009)."
            )
    return violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="check_prompt_versions", description=__doc__)
    parser.add_argument("--base", help="ref to diff against; defaults to origin/main, then HEAD~1")
    parser.add_argument("--repo", default=".", help="repository root")
    args = parser.parse_args(argv)

    cwd = Path(args.repo).resolve()
    code, _ = run_git(["rev-parse", "--is-inside-work-tree"], cwd)
    if code != 0:
        print(f"not a git repository: {cwd}", file=sys.stderr)
        return EXIT_USAGE

    base = resolve_base(cwd, args.base)
    if base is None:
        print("promptVersion check: no base ref to compare against - nothing to check")
        return EXIT_OK

    try:
        violations = find_violations(cwd, base)
    except RuntimeError as exc:
        print(f"promptVersion check: {exc}", file=sys.stderr)
        return EXIT_USAGE

    if not violations:
        print(f"promptVersion check: clean (vs {base})")
        return EXIT_OK

    print(f"promptVersion check failed (vs {base}):", file=sys.stderr)
    for v in violations:
        print(f"  {v}", file=sys.stderr)
    return EXIT_FAIL


if __name__ == "__main__":
    sys.exit(main())
