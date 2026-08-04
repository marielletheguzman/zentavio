"""Viability composition (ADR-0022).

The property under test throughout is that **no axis is collapsed into the other**. Every failure
mode here is one where a person would be told something untrue about their own relocation: told no
when we simply had not asked, told yes when they cannot do the work, or handed a number that means
two different things.
"""

from __future__ import annotations

from datetime import date

import pytest
from career_roadmap.eligibility import PersonFact, Requirement, evaluate_pathway
from career_roadmap.viability import (
    AsOfMismatchError,
    Employability,
    Viability,
    compose,
)

AS_OF = date(2026, 6, 1)
AS_OF_STR = "2026-06-01"


def threshold(**overrides) -> Requirement:
    base = dict(
        requirement_id="de.eu-blue-card.salary-threshold.general",
        domain="immigration",
        imposed_by="destination",
        kind="threshold",
        evaluation="numeric-gte",
        value={"amount": 50700, "currency": "EUR", "period": "year", "basis": "gross"},
        needs_input=("expected_gross_annual_salary_eur",),
        authority="Bundesministerium des Innern",
        source_url="https://www.bundesanzeiger.de/x",
        effective_from=date(2026, 1, 1),
        effective_to=date(2026, 12, 31),
    )
    base.update(overrides)
    return Requirement(**base)


def salary(amount: int) -> PersonFact:
    return PersonFact(
        key="expected_gross_annual_salary_eur",
        value={"amount": amount, "currency": "EUR", "period": "year", "basis": "gross"},
    )


def verdict(facts=(), *, licence_gated=False, rules=None):
    return evaluate_pathway(
        "de.eu-blue-card",
        list(rules if rules is not None else [threshold()]),
        list(facts),
        AS_OF,
        licence_gated=licence_gated,
    )


READY = Employability(status="no_gap", score_low=0.91, score_high=0.94)
GAPPED = Employability(status="ok", score_low=0.31, score_high=0.44, missing_count=7)
UNREADABLE = Employability(status="unknown", reason="no parsed profile on file")


class TestThereIsNoScore:
    def test_viability_has_no_composite_field(self):
        # ADR-0022. Adding one means changing the decision first, so this asserts the shape rather
        # than trusting review.
        fields = set(Viability.__dataclass_fields__)
        for forbidden in ("score", "viability_score", "composite", "value", "rating"):
            assert forbidden not in fields

    def test_the_readiness_band_survives_intact(self):
        # No midpoint is taken anywhere in this path. The width is how much rests on assertion.
        result = compose(verdict([salary(60000)]), GAPPED, employability_as_of=AS_OF_STR)
        assert result.employability.score_low == 0.31
        assert result.employability.score_high == 0.44


class TestUndeterminedIsNeverANo:
    def test_it_binds_on_eligibility_without_saying_no(self):
        result = compose(verdict(), GAPPED, employability_as_of=AS_OF_STR)

        assert result.eligibility.status == "undetermined"
        assert result.binding == "eligibility"
        assert "Nothing here says no" in result.binding_reason

    def test_it_names_the_input_that_would_resolve_it(self):
        result = compose(verdict(), READY, employability_as_of=AS_OF_STR)
        assert "expected_gross_annual_salary_eur" in result.binding_reason

    def test_readiness_does_not_override_an_unanswered_question(self):
        # Being ready does not make an unchecked rule checked. The pair must still say what is
        # missing rather than reading as a pass.
        result = compose(verdict(), READY, employability_as_of=AS_OF_STR)
        assert result.binding == "eligibility"


class TestEligibleButNotEmployable:
    def test_the_case_the_adr_exists_for(self):
        # "visa-eligible and unemployable at the threshold salary is not an opportunity"
        # (docs/architecture/immigration.md). Before ADR-0022 this returned a bare `met`.
        result = compose(verdict([salary(60000)]), GAPPED, employability_as_of=AS_OF_STR)

        assert result.eligibility.status == "met"
        assert result.binding == "employability"
        assert "7 skill(s)" in result.binding_reason

    def test_nothing_binds_when_both_axes_are_satisfied(self):
        result = compose(verdict([salary(60000)]), READY, employability_as_of=AS_OF_STR)
        assert result.binding == "none"

    def test_unreadable_readiness_binds_and_says_why(self):
        # "We cannot say how ready you are" is not "you are ready".
        result = compose(verdict([salary(60000)]), UNREADABLE, employability_as_of=AS_OF_STR)
        assert result.binding == "employability"
        assert "no parsed profile" in result.binding_reason


class TestOrderOfWhatBlocksWhat:
    def test_a_failed_requirement_binds_before_readiness(self):
        # A threshold that is not met makes readiness moot — there is nothing to be ready for yet.
        result = compose(verdict([salary(30000)]), GAPPED, employability_as_of=AS_OF_STR)

        assert result.binding == "eligibility"
        assert "de.eu-blue-card.salary-threshold.general" in result.binding_reason

    def test_recognition_binds_before_everything(self):
        # The most harmful output this product could produce is a visa-only verdict to someone
        # whose licence does not transfer.
        result = compose(
            verdict([salary(90000)], licence_gated=True), READY, employability_as_of=AS_OF_STR
        )

        assert result.binding == "recognition"
        assert "licence-gated" in result.binding_reason
        assert "not a judgement about you" in result.binding_reason

    def test_an_unmodelled_pathway_is_about_our_coverage_not_the_person(self):
        result = compose(verdict(rules=[]), READY, employability_as_of=AS_OF_STR)

        assert result.binding == "unmodelled"
        assert "Nobody has recorded the rules" in result.binding_reason


class TestOneMoment:
    def test_two_dates_are_refused(self):
        # A pair mixing two dates describes no particular moment, and the `asOf` on the response
        # would be a claim about only half of it.
        with pytest.raises(AsOfMismatchError):
            compose(verdict([salary(60000)]), READY, employability_as_of="2025-01-01")

    def test_the_shared_date_is_carried(self):
        result = compose(verdict([salary(60000)]), READY, employability_as_of=AS_OF_STR)
        assert result.as_of == AS_OF_STR

    def test_the_disclaimer_is_carried_verbatim(self):
        result = compose(verdict([salary(60000)]), READY, employability_as_of=AS_OF_STR)
        assert result.disclaimer == result.eligibility.disclaimer
        assert "not legal advice" in result.disclaimer


class TestDeterminism:
    def test_the_same_inputs_produce_the_same_pair(self):
        first = compose(verdict([salary(60000)]), GAPPED, employability_as_of=AS_OF_STR)
        second = compose(verdict([salary(60000)]), GAPPED, employability_as_of=AS_OF_STR)
        assert first == second

    def test_every_eligibility_status_yields_a_binding_constraint(self):
        # A pair with no named binding constraint is the one thing immigration.md forbids outright.
        cases = [
            (verdict(), GAPPED),
            (verdict([salary(30000)]), GAPPED),
            (verdict([salary(60000)]), GAPPED),
            (verdict([salary(60000)]), READY),
            (verdict(rules=[]), READY),
            (verdict([salary(90000)], licence_gated=True), READY),
        ]
        for eligibility, employability in cases:
            result = compose(eligibility, employability, employability_as_of=AS_OF_STR)
            assert result.binding in {
                "eligibility",
                "employability",
                "recognition",
                "unmodelled",
                "none",
            }
            assert result.binding_reason.strip()
