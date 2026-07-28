"""Discovery and validation of prompt eval fixtures.

Fixture layout, one directory per prompt:

    tests/fixtures/prompts/<prompt-name>/
    ├── cases/*.json          each case is self-contained: why, kind, knowledge, input, expect
    └── baseline.<promptVersion>.json

Every case declares its `kind`, and every prompt must cover all six required kinds
(docs/prompts/evals.md). A prompt missing its unknown-handling or injection case is not
evaluated, so the gate refuses to pass it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

FIXTURE_ROOT = Path("tests/fixtures/prompts")
PROMPT_GLOB = "ai/*/prompts/*.md"

# The six required case kinds. These are not a suggestion: the two that matter most
# (unknown, injection) are invisible in normal use and harmful when they regress.
REQUIRED_KINDS = (
    "happy",
    "unknown",
    "contested",
    "injection",
    "malformed",
    "out_of_scope",
)

# Which kinds are gates rather than trends. A regression here blocks regardless of
# how much extraction accuracy improved.
GATE_KINDS = ("unknown", "injection")

REQUIRED_CASE_FIELDS = ("why", "kind", "input", "expect")

# A prompt filename is <name>-<YYYY>-<MM>-<DD>: three hyphen-separated date parts follow
# the base name, so that is how many segments are stripped to recover it.
PROMPT_DATE_SEGMENTS = 3


@dataclass
class Case:
    path: Path
    prompt_name: str
    kind: str
    why: str
    knowledge: dict
    input: dict
    expect: dict

    @property
    def name(self) -> str:
        return self.path.stem


@dataclass
class PromptSuite:
    name: str
    prompt_file: Path | None
    cases: list[Case] = field(default_factory=list)

    @property
    def version(self) -> str | None:
        """promptVersion is the prompt filename stem (docs/prompts/conventions.md)."""
        return self.prompt_file.stem if self.prompt_file else None

    def missing_kinds(self) -> list[str]:
        present = {c.kind for c in self.cases}
        return [k for k in REQUIRED_KINDS if k not in present]


class FixtureError(Exception):
    """A fixture is malformed. Reported with its path, never swallowed."""


def _load_case(path: Path, prompt_name: str) -> Case:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise FixtureError(f"{path}: invalid JSON — {exc}") from exc

    missing = [f for f in REQUIRED_CASE_FIELDS if f not in raw]
    if missing:
        raise FixtureError(f"{path}: missing required field(s): {', '.join(missing)}")

    if raw["kind"] not in REQUIRED_KINDS:
        raise FixtureError(
            f"{path}: unknown kind {raw['kind']!r}; expected one of {', '.join(REQUIRED_KINDS)}"
        )

    # A case with no stated reason gets deleted in the first refactor, because nobody
    # knows what breaking it would mean.
    if not str(raw["why"]).strip():
        raise FixtureError(f"{path}: 'why' is empty — state what this case guards")

    return Case(
        path=path,
        prompt_name=prompt_name,
        kind=raw["kind"],
        why=raw["why"],
        knowledge=raw.get("knowledge", {}),
        input=raw["input"],
        expect=raw["expect"],
    )


def discover_prompt_files(root: Path) -> dict[str, list[Path]]:
    """Map prompt base name -> versioned prompt files.

    `skill-extract-2026-07-01.md` has base name `skill-extract`. Several versions of one
    prompt may coexist; the newest is current, and older ones stay so past outputs remain
    reproducible.
    """
    by_base: dict[str, list[Path]] = {}
    for path in sorted(root.glob(PROMPT_GLOB)):
        has_date = path.stem.count("-") >= PROMPT_DATE_SEGMENTS
        base = path.stem.rsplit("-", PROMPT_DATE_SEGMENTS)[0] if has_date else path.stem
        by_base.setdefault(base, []).append(path)
    return by_base


def discover(root: Path, only: str | None = None) -> list[PromptSuite]:
    """Build a suite per fixture directory, pairing it with its current prompt file."""
    fixture_root = root / FIXTURE_ROOT
    prompt_files = discover_prompt_files(root)
    suites: list[PromptSuite] = []

    if not fixture_root.is_dir():
        return suites

    for prompt_dir in sorted(p for p in fixture_root.iterdir() if p.is_dir()):
        name = prompt_dir.name
        if only and name != only:
            continue

        versions = prompt_files.get(name, [])
        suite = PromptSuite(name=name, prompt_file=versions[-1] if versions else None)

        case_dir = prompt_dir / "cases"
        if not case_dir.is_dir():
            raise FixtureError(f"{prompt_dir}: no cases/ directory")

        for case_path in sorted(case_dir.glob("*.json")):
            suite.cases.append(_load_case(case_path, name))

        if not suite.cases:
            raise FixtureError(f"{case_dir}: no case files")

        suites.append(suite)

    return suites


def orphaned_prompts(root: Path) -> list[Path]:
    """Prompt files with no fixture directory.

    An unevaluated prompt is the state docs/prompts/evals.md exists to prevent, so this
    is reported as a violation rather than a warning.
    """
    fixture_root = root / FIXTURE_ROOT
    covered = set()
    if fixture_root.is_dir():
        covered = {p.name for p in fixture_root.iterdir() if p.is_dir()}
    orphans = []
    for base, paths in discover_prompt_files(root).items():
        if base not in covered:
            orphans.extend(paths)
    return sorted(orphans)
