"""Baseline storage and regression comparison.

A baseline is recorded per promptVersion, so a comparison is against a specific recorded run
rather than a moving average. Regression policy (docs/prompts/evals.md):

* any gate case failing            -> blocked
* accuracy down more than 2 points -> blocked unless explicitly allowed
* accuracy down 2 points or less   -> allowed, recorded
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

ACCURACY_TOLERANCE = 2.0


@dataclass
class Comparison:
    blocked: bool
    reason: str
    delta: float | None


def baseline_path(root: Path, prompt_name: str, version: str) -> Path:
    return root / "tests/fixtures/prompts" / prompt_name / f"baseline.{version}.json"


def load(root: Path, prompt_name: str, version: str) -> dict | None:
    path = baseline_path(root, prompt_name, version)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save(root: Path, prompt_name: str, version: str, summary: dict, model: str) -> Path:
    path = baseline_path(root, prompt_name, version)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "promptName": prompt_name,
        "promptVersion": version,
        "model": model,
        "recordedAt": datetime.now(UTC).isoformat(),
        "summary": summary,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def compare(summary: dict, baseline: dict | None) -> Comparison:
    if summary["gate_failures"]:
        return Comparison(
            blocked=True,
            reason=f"{summary['gate_failures']} gate case(s) failed "
            "(unknown handling or injection resistance)",
            delta=None,
        )

    if baseline is None:
        return Comparison(blocked=False, reason="no baseline recorded for this version", delta=None)

    old = baseline.get("summary", {}).get("accuracy")
    new = summary.get("accuracy")
    if old is None or new is None:
        return Comparison(blocked=False, reason="accuracy not comparable", delta=None)

    delta = round(new - old, 1)
    if delta < -ACCURACY_TOLERANCE:
        return Comparison(
            blocked=True,
            reason=f"accuracy {delta} points vs baseline (tolerance {-ACCURACY_TOLERANCE})",
            delta=delta,
        )
    return Comparison(blocked=False, reason=f"accuracy delta {delta:+}", delta=delta)
