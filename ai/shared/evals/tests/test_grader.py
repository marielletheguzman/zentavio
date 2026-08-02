"""Grading, and the two gates that must not be softened.

`_absent` is how the unknown gate is expressed: a missing computation must never arrive as 0
or a plausible default. `_grounded_ids` is the grounding gate in its auditable form: an id
outside the supplied closed set is a fabrication, detectable without a judge.
"""

from __future__ import annotations

from pathlib import Path

from cases import Case
from grader import grade, summarize


def make_case(
    kind: str = "happy", knowledge: dict | None = None, expect: dict | None = None
) -> Case:
    return Case(
        path=Path(f"cases/{kind}-probe.json"),
        prompt_name="skill-extract",
        kind=kind,
        why="probe",
        knowledge=knowledge or {},
        input={"resume_text": "x"},
        expect=expect or {},
    )


def test_exact_match_on_a_dotted_path_passes():
    case = make_case(expect={"skills.0.status": "EVIDENCED"})

    result = grade(case, {"skills": [{"status": "EVIDENCED"}]})

    assert result.passed


def test_exact_match_failure_reports_expected_and_actual():
    case = make_case(expect={"skills.0.status": "EVIDENCED"})

    result = grade(case, {"skills": [{"status": "CLAIMED"}]})

    assert not result.passed
    assert "EVIDENCED" in str(result.findings[0])
    assert "CLAIMED" in str(result.findings[0])


def test_absent_directive_passes_when_the_field_is_null():
    case = make_case(kind="unknown", expect={"_absent": ["score"]})

    assert grade(case, {"status": "unknown", "score": None}).passed


def test_absent_directive_fails_when_a_missing_value_arrives_as_zero():
    # The specific failure this gate exists for: 0.0 reads to a user as "bad fit" rather
    # than "not computed".
    case = make_case(kind="unknown", expect={"_absent": ["score"]})

    result = grade(case, {"status": "unknown", "score": 0.0})

    assert not result.passed
    assert "must be absent" in str(result.findings[0])


def test_grounding_accepts_an_id_from_the_supplied_closed_set():
    case = make_case(
        knowledge={"known_skills": ["kubernetes", "docker"]},
        expect={"_grounded_ids": ["skills.0.skillId"]},
    )

    assert grade(case, {"skills": [{"skillId": "kubernetes"}]}).passed


def test_grounding_rejects_a_fabricated_id():
    case = make_case(
        knowledge={"known_skills": ["kubernetes", "docker"]},
        expect={"_grounded_ids": ["skills.0.skillId"]},
    )

    result = grade(case, {"skills": [{"skillId": "terraform"}]})

    assert not result.passed
    assert "terraform" in str(result.findings[0])


def test_grounding_checks_every_element_of_a_list():
    case = make_case(
        knowledge={"known_skills": ["kubernetes"]},
        expect={"_grounded_ids": ["ids"]},
    )

    assert not grade(case, {"ids": ["kubernetes", "invented"]}).passed


def test_prose_must_mention_fails_when_the_claim_is_absent():
    case = make_case(expect={"_prose": {"field": "summary", "must_mention": ["Terraform"]}})

    assert not grade(case, {"summary": "You match on Kubernetes."}).passed


def test_prose_must_not_mention_catches_a_prohibited_phrase():
    # Banned phrasing: employers sponsor, governments grant.
    case = make_case(
        expect={"_prose": {"field": "summary", "must_not_mention": ["free citizenship"]}}
    )

    result = grade(case, {"summary": "This employer offers free citizenship."})

    assert not result.passed
    assert "prohibited phrasing" in str(result.findings[0])


def test_prose_matching_is_case_insensitive():
    case = make_case(expect={"_prose": {"field": "summary", "must_mention": ["terraform"]}})

    assert grade(case, {"summary": "Terraform is the gap."}).passed


def test_a_schema_failure_is_a_finding_not_a_crash():
    case = make_case()

    result = grade(case, None, error="response was not valid JSON")

    assert not result.passed
    assert "valid JSON" in str(result.findings[0])


def test_no_model_is_a_skip_rather_than_a_failure():
    # This is what lets the offline half run in CI without a model host.
    result = grade(make_case(), None)

    assert result.passed
    assert result.skipped == "no model available"


def test_gate_kinds_are_flagged_as_gates():
    assert grade(make_case(kind="unknown"), {}).is_gate
    assert grade(make_case(kind="injection"), {}).is_gate
    assert not grade(make_case(kind="happy"), {}).is_gate


def test_summarize_counts_gate_failures_separately():
    results = [
        grade(make_case(kind="happy", expect={"a": 1}), {"a": 2}),  # fails, not a gate
        grade(make_case(kind="unknown", expect={"_absent": ["score"]}), {"score": 0}),  # gate
    ]

    summary = summarize(results)

    assert summary["failed"] == 2
    assert summary["gate_failures"] == 1


def test_summarize_excludes_skipped_from_accuracy():
    results = [grade(make_case(), None), grade(make_case(expect={"a": 1}), {"a": 1})]

    summary = summarize(results)

    assert summary["skipped"] == 1
    assert summary["graded"] == 1
    assert summary["accuracy"] == 100.0


def test_summarize_reports_no_accuracy_when_nothing_was_graded():
    summary = summarize([grade(make_case(), None)])

    assert summary["accuracy"] is None


def test_ci_compares_a_listed_field_ignoring_case():
    # ADR-0018: the model owns identifying the phrase, code owns recovering how the document
    # spelled it (compute.py::recover_spelling). Grading the model on capitalization would fail
    # it for work it is not responsible for.
    case = make_case(expect={"unmatched": ["Pulumi"], "_ci": ["unmatched"]})

    assert grade(case, {"unmatched": ["pulumi"]}).passed
    assert grade(case, {"unmatched": ["PULUMI"]}).passed


def test_ci_still_fails_on_a_different_value():
    # Case-insensitive is not value-insensitive. A wrong technology is still wrong.
    case = make_case(expect={"unmatched": ["Pulumi"], "_ci": ["unmatched"]})

    result = grade(case, {"unmatched": ["Terraform"]})

    assert not result.passed
    assert "ignoring case" in str(result.findings[0])


def test_a_field_not_listed_in_ci_is_still_compared_exactly():
    case = make_case(expect={"status": "ok", "unmatched": ["Pulumi"], "_ci": ["unmatched"]})

    assert not grade(case, {"status": "OK", "unmatched": ["pulumi"]}).passed
