"""Grading a model response against a case's expectations.

Two grading modes, deliberately separated (docs/prompts/evals.md):

* **Structural** — ids, enums, booleans, counts, source spans. Exact match. These decide the
  gates, because they are the only assertions that cannot drift.
* **Prose** — assertions about content, never string equality against a reference paragraph.
  Diffing prose tests style and blocks harmless rewording.

Nothing here calls an LLM to judge grounding or schema. A judge that cannot be audited is not
evidence.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from cases import GATE_KINDS, Case


@dataclass
class Finding:
    field: str
    expected: Any
    actual: Any
    detail: str = ""

    def __str__(self) -> str:
        base = f"{self.field}: expected {self.expected!r}, got {self.actual!r}"
        return f"{base} — {self.detail}" if self.detail else base


@dataclass
class CaseResult:
    case: Case
    passed: bool
    findings: list[Finding] = field(default_factory=list)
    skipped: str | None = None

    @property
    def is_gate(self) -> bool:
        return self.case.kind in GATE_KINDS


def _get(obj: Any, dotted: str) -> Any:
    """Resolve 'skills.0.status' against nested dicts and lists."""
    cur = obj
    for part in dotted.split("."):
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _check_exact(response: dict, expect: dict) -> list[Finding]:
    findings = []
    for key, want in expect.items():
        if key.startswith("_"):
            continue
        got = _get(response, key)
        if got != want:
            findings.append(Finding(key, want, got))
    return findings


def _check_absent(response: dict, keys: list[str]) -> list[Finding]:
    """Fields that must be null or absent. This is how the unknown gate is expressed:
    a missing computation must never arrive as 0 or a plausible default."""
    findings = []
    for key in keys:
        got = _get(response, key)
        if got not in (None, [], {}):
            findings.append(Finding(key, None, got, "must be absent when status is unknown"))
    return findings


def _check_prose(response: dict, rules: dict) -> list[Finding]:
    """Assertions about prose. `must_mention` / `must_not_mention` are substring checks
    over the named field, case-insensitive."""
    findings = []
    field_name = rules.get("field", "summary")
    text = str(_get(response, field_name) or "").lower()

    for phrase in rules.get("must_mention", []):
        if phrase.lower() not in text:
            findings.append(Finding(field_name, f"mentions {phrase!r}", text[:80], "missing claim"))

    for phrase in rules.get("must_not_mention", []):
        if phrase.lower() in text:
            findings.append(
                Finding(field_name, f"omits {phrase!r}", phrase, "prohibited phrasing present")
            )
    return findings


def _check_grounding(response: dict, case: Case) -> list[Finding]:
    """Every id the model returns must come from the closed set the prompt supplied.

    This is the grounding gate in its cheapest, most reliable form: an id outside the
    supplied vocabulary is a fabrication, detectable without a judge.
    """
    findings: list[Finding] = []
    closed_sets = {
        key: set(values)
        for key, values in case.knowledge.items()
        if isinstance(values, list) and values and all(isinstance(v, str) for v in values)
    }
    if not closed_sets:
        return findings

    allowed = set().union(*closed_sets.values())
    for path in case.expect.get("_grounded_ids", []):
        value = _get(response, path)
        values = value if isinstance(value, list) else [value]
        for v in values:
            if isinstance(v, str) and v not in allowed:
                findings.append(
                    Finding(path, "id from supplied set", v, "not in any supplied closed set")
                )
    return findings


def grade(case: Case, response: dict | None, error: str | None = None) -> CaseResult:
    """Grade one response. `error` is set when the call or schema validation failed."""
    if error is not None:
        return CaseResult(case, passed=False, findings=[Finding("<response>", "valid JSON", error)])
    if response is None:
        return CaseResult(case, passed=True, skipped="no model available")

    expect = dict(case.expect)
    findings: list[Finding] = []

    findings += _check_absent(response, expect.pop("_absent", []))
    prose_rules = expect.pop("_prose", None)
    expect.pop("_grounded_ids", None)
    if prose_rules:
        findings += _check_prose(response, prose_rules)
    findings += _check_grounding(response, case)
    findings += _check_exact(response, expect)

    return CaseResult(case, passed=not findings, findings=findings)


def summarize(results: list[CaseResult]) -> dict:
    graded = [r for r in results if r.skipped is None]
    gate_failures = [r for r in graded if not r.passed and r.is_gate]
    return {
        "total": len(results),
        "graded": len(graded),
        "skipped": len(results) - len(graded),
        "passed": sum(1 for r in graded if r.passed),
        "failed": sum(1 for r in graded if not r.passed),
        "gate_failures": len(gate_failures),
        "accuracy": round(100.0 * sum(1 for r in graded if r.passed) / len(graded), 1)
        if graded
        else None,
    }
