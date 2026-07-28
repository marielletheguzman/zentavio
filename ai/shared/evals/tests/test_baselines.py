"""Baseline storage and the regression policy.

The asymmetry is the point (docs/prompts/evals.md): a gate failure blocks regardless of how
much extraction accuracy improved, because a confident wrong answer costs a user more than a
missed skill.
"""

from __future__ import annotations

import json
from pathlib import Path

import baselines


def summary(accuracy: float | None, gate_failures: int = 0) -> dict:
    return {
        "total": 6,
        "graded": 6,
        "skipped": 0,
        "passed": 6,
        "failed": 0,
        "gate_failures": gate_failures,
        "accuracy": accuracy,
    }


def test_gate_failure_blocks_even_with_perfect_accuracy():
    result = baselines.compare(summary(100.0, gate_failures=1), {"summary": summary(50.0)})

    assert result.blocked
    assert "gate case" in result.reason


def test_accuracy_drop_beyond_tolerance_blocks():
    result = baselines.compare(summary(90.0), {"summary": summary(95.0)})

    assert result.blocked
    assert result.delta == -5.0


def test_accuracy_drop_within_tolerance_is_allowed():
    result = baselines.compare(summary(93.5), {"summary": summary(95.0)})

    assert not result.blocked
    assert result.delta == -1.5


def test_accuracy_improvement_is_allowed():
    result = baselines.compare(summary(97.0), {"summary": summary(95.0)})

    assert not result.blocked
    assert result.delta == 2.0


def test_drop_exactly_at_tolerance_is_allowed():
    # The boundary is stated in the policy as "more than 2 points", so exactly 2 passes.
    result = baselines.compare(summary(93.0), {"summary": summary(95.0)})

    assert not result.blocked
    assert result.delta == -2.0


def test_no_baseline_does_not_block():
    result = baselines.compare(summary(80.0), None)

    assert not result.blocked
    assert "no baseline" in result.reason


def test_incomparable_accuracy_does_not_block():
    result = baselines.compare(summary(None), {"summary": summary(None)})

    assert not result.blocked


def test_save_writes_the_version_and_model_then_load_returns_it(tmp_path: Path):
    path = baselines.save(
        tmp_path, "skill-extract", "skill-extract-2026-07-01", summary(95.0), "qwen"
    )

    written = json.loads(path.read_text(encoding="utf-8"))
    assert written["promptVersion"] == "skill-extract-2026-07-01"
    assert written["model"] == "qwen"
    assert "recordedAt" in written

    loaded = baselines.load(tmp_path, "skill-extract", "skill-extract-2026-07-01")
    assert loaded["summary"]["accuracy"] == 95.0


def test_load_returns_none_for_an_unrecorded_version(tmp_path: Path):
    assert baselines.load(tmp_path, "skill-extract", "never-recorded") is None


def test_baseline_is_stored_per_prompt_version(tmp_path: Path):
    # Comparison must be against a specific recorded run, not a moving average, so two
    # versions cannot share a file.
    baselines.save(tmp_path, "skill-extract", "v1", summary(90.0), "qwen")
    baselines.save(tmp_path, "skill-extract", "v2", summary(95.0), "qwen")

    assert baselines.load(tmp_path, "skill-extract", "v1")["summary"]["accuracy"] == 90.0
    assert baselines.load(tmp_path, "skill-extract", "v2")["summary"]["accuracy"] == 95.0
