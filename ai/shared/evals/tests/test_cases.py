"""Fixture discovery and validation.

These tests exist because the loader is the offline gate: it is what stops a prompt merging
without fixtures, or with fixtures missing the unknown or injection case. If the loader is
lenient, the gate is decoration.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from cases import (
    GATE_KINDS,
    REQUIRED_KINDS,
    FixtureError,
    discover,
    discover_prompt_files,
    orphaned_prompts,
)

CASE = {
    "why": "Guards the evidenced/claimed split.",
    "kind": "happy",
    "knowledge": {"known_skills": ["kubernetes"]},
    "input": {"resume_text": "Led a Kubernetes migration."},
    "expect": {"skills.0.status": "EVIDENCED"},
}


def write_case(dir_: Path, name: str, **overrides) -> Path:
    dir_.mkdir(parents=True, exist_ok=True)
    payload = {**CASE, **overrides}
    path = dir_ / f"{name}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def make_prompt(root: Path, service: str, stem: str) -> Path:
    d = root / "ai" / service / "prompts"
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{stem}.md"
    p.write_text("Role: probe.\n", encoding="utf-8")
    return p


def test_gate_kinds_are_a_subset_of_required_kinds():
    # A gate kind that is not required would never be enforced.
    assert set(GATE_KINDS) <= set(REQUIRED_KINDS)


def test_unknown_and_injection_are_gates():
    # These are the two failure modes invisible in normal use. If they stop being gates,
    # docs/prompts/evals.md is wrong.
    assert "unknown" in GATE_KINDS
    assert "injection" in GATE_KINDS


def test_discovers_a_suite_and_pairs_it_with_its_prompt(tmp_path: Path):
    make_prompt(tmp_path, "resume-parser", "skill-extract-2026-07-01")
    write_case(tmp_path / "tests/fixtures/prompts/skill-extract/cases", "happy-basic")

    suites = discover(tmp_path)

    assert len(suites) == 1
    assert suites[0].name == "skill-extract"
    assert suites[0].version == "skill-extract-2026-07-01"


def test_missing_kinds_lists_every_absent_required_kind(tmp_path: Path):
    make_prompt(tmp_path, "resume-parser", "skill-extract-2026-07-01")
    write_case(tmp_path / "tests/fixtures/prompts/skill-extract/cases", "happy-basic")

    missing = discover(tmp_path)[0].missing_kinds()

    assert "unknown" in missing
    assert "injection" in missing
    assert "happy" not in missing


def test_rejects_a_case_with_an_empty_why(tmp_path: Path):
    # A case with no stated reason gets deleted in the first refactor, because nobody knows
    # what breaking it would mean.
    make_prompt(tmp_path, "resume-parser", "skill-extract-2026-07-01")
    write_case(tmp_path / "tests/fixtures/prompts/skill-extract/cases", "bad", why="   ")

    with pytest.raises(FixtureError, match="why"):
        discover(tmp_path)


@pytest.mark.parametrize("field", ["why", "kind", "input", "expect"])
def test_rejects_a_case_missing_a_required_field(tmp_path: Path, field: str):
    make_prompt(tmp_path, "resume-parser", "skill-extract-2026-07-01")
    payload = {k: v for k, v in CASE.items() if k != field}
    d = tmp_path / "tests/fixtures/prompts/skill-extract/cases"
    d.mkdir(parents=True, exist_ok=True)
    (d / "bad.json").write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(FixtureError, match=field):
        discover(tmp_path)


def test_rejects_an_unrecognised_kind(tmp_path: Path):
    make_prompt(tmp_path, "resume-parser", "skill-extract-2026-07-01")
    write_case(tmp_path / "tests/fixtures/prompts/skill-extract/cases", "bad", kind="vibes")

    with pytest.raises(FixtureError, match="vibes"):
        discover(tmp_path)


def test_rejects_invalid_json_naming_the_file(tmp_path: Path):
    make_prompt(tmp_path, "resume-parser", "skill-extract-2026-07-01")
    d = tmp_path / "tests/fixtures/prompts/skill-extract/cases"
    d.mkdir(parents=True, exist_ok=True)
    (d / "broken.json").write_text("{not json", encoding="utf-8")

    with pytest.raises(FixtureError, match=r"broken\.json"):
        discover(tmp_path)


def test_rejects_a_fixture_directory_with_no_cases(tmp_path: Path):
    make_prompt(tmp_path, "resume-parser", "skill-extract-2026-07-01")
    (tmp_path / "tests/fixtures/prompts/skill-extract/cases").mkdir(parents=True)

    with pytest.raises(FixtureError, match="no case files"):
        discover(tmp_path)


def test_prompt_base_name_strips_the_date(tmp_path: Path):
    make_prompt(tmp_path, "resume-parser", "skill-extract-2026-07-01")

    assert "skill-extract" in discover_prompt_files(tmp_path)


def test_prompt_without_a_date_keeps_its_full_stem(tmp_path: Path):
    make_prompt(tmp_path, "resume-parser", "draft")

    assert "draft" in discover_prompt_files(tmp_path)


def test_orphaned_prompt_is_reported(tmp_path: Path):
    # An unevaluated prompt is the state the eval policy exists to prevent.
    make_prompt(tmp_path, "resume-parser", "lonely-extract-2026-07-01")

    orphans = orphaned_prompts(tmp_path)

    assert len(orphans) == 1
    assert orphans[0].name == "lonely-extract-2026-07-01.md"


def test_prompt_with_fixtures_is_not_orphaned(tmp_path: Path):
    make_prompt(tmp_path, "resume-parser", "skill-extract-2026-07-01")
    write_case(tmp_path / "tests/fixtures/prompts/skill-extract/cases", "happy-basic")

    assert orphaned_prompts(tmp_path) == []


def test_no_fixture_root_is_not_an_error(tmp_path: Path):
    # Zero prompts is the current state of the repository, not a failure.
    assert discover(tmp_path) == []
