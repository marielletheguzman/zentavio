"""What the eligibility evaluator refuses to do.

Most of these assert a *refusal*: not collapsing an unknown into a yes or a no, not comparing
incompatible units, not answering for a licence-gated profession with no recognition data. Those
are the behaviours that make a verdict trustworthy, and each one is a place where a plausible
shortcut produces a confident wrong answer.
"""

from __future__ import annotations

import ast
from datetime import date
from pathlib import Path

import pytest
from career_roadmap.eligibility import (
    DISCLAIMER,
    PersonFact,
    Requirement,
    applicable_on,
    evaluate_pathway,
    evaluate_requirement,
)

AS_OF = date(2026, 6, 1)


def threshold(**overrides) -> Requirement:
    """The real German Blue Card general threshold, as stored."""
    base = dict(
        requirement_id="de.eu-blue-card.salary-threshold.general",
        domain="immigration",
        imposed_by="destination",
        kind="threshold",
        evaluation="numeric-gte",
        value={"amount": 50700, "currency": "EUR", "period": "year", "basis": "gross"},
        needs_input=("expected_gross_annual_salary_eur",),
        authority="Bundesministerium des Innern",
        source_url="https://www.bundesanzeiger.de/...",
        effective_from=date(2026, 1, 1),
        effective_to=date(2026, 12, 31),
    )
    base.update(overrides)
    return Requirement(**base)


def salary(amount, basis="self_reported") -> PersonFact:
    return PersonFact(
        key="expected_gross_annual_salary_eur",
        value={"amount": amount, "currency": "EUR", "period": "year", "basis": "gross"},
        basis=basis,
    )


class TestApplicability:
    def test_a_bounded_rule_applies_inside_its_window(self):
        assert applicable_on(threshold(), date(2026, 6, 1))

    def test_a_bounded_rule_does_not_apply_outside_it(self):
        assert not applicable_on(threshold(), date(2025, 12, 31))
        assert not applicable_on(threshold(), date(2027, 1, 1))

    def test_currency_is_containment_not_a_null_end_date(self):
        # Germany's Blue Card minimum is announced *for one calendar year*, so every stored row has
        # an `effective_to` and none is ever null. Treating null as "current" excludes every annual
        # rule and returns an empty rule set — which reads as "we have no requirements" rather than
        # as the bug it is.
        bounded = threshold()
        assert bounded.effective_to is not None
        assert applicable_on(bounded, AS_OF)

    def test_an_open_ended_rule_applies_from_its_start(self):
        assert applicable_on(threshold(effective_to=None), date(2099, 1, 1))


class TestOneRequirement:
    def test_met_when_the_salary_clears_the_threshold(self):
        result = evaluate_requirement(
            threshold(), {"expected_gross_annual_salary_eur": salary(60000)}
        )
        assert result.result == "met"
        assert "50700" in result.basis.replace(" ", "")

    def test_not_met_when_it_does_not(self):
        result = evaluate_requirement(
            threshold(), {"expected_gross_annual_salary_eur": salary(40000)}
        )
        assert result.result == "not_met"

    def test_boundary_is_inclusive(self):
        # "mindestens 50 700 Euro" — at least. Exactly the threshold qualifies, and an exclusive
        # comparison would reject someone the statute admits.
        result = evaluate_requirement(
            threshold(), {"expected_gross_annual_salary_eur": salary(50700)}
        )
        assert result.result == "met"

    def test_undetermined_names_the_missing_input(self):
        result = evaluate_requirement(threshold(), {})
        assert result.result == "undetermined"
        assert result.needs_input == ("expected_gross_annual_salary_eur",)
        assert "expected_gross_annual_salary_eur" in result.reason

    def test_refuses_to_compare_across_currencies(self):
        # 55 000 USD against a 50 700 EUR threshold is a confident wrong answer.
        usd = PersonFact(
            key="expected_gross_annual_salary_eur",
            value={"amount": 55000, "currency": "USD", "period": "year", "basis": "gross"},
        )
        result = evaluate_requirement(threshold(), {"expected_gross_annual_salary_eur": usd})
        assert result.result == "undetermined"
        assert "units" in result.reason

    def test_refuses_to_compare_across_periods(self):
        monthly = PersonFact(
            key="expected_gross_annual_salary_eur",
            value={"amount": 60000, "currency": "EUR", "period": "month", "basis": "gross"},
        )
        result = evaluate_requirement(threshold(), {"expected_gross_annual_salary_eur": monthly})
        assert result.result == "undetermined"

    def test_a_bare_number_is_taken_in_the_requirement_units(self):
        bare = PersonFact(key="expected_gross_annual_salary_eur", value=60000)
        assert (
            evaluate_requirement(threshold(), {"expected_gross_annual_salary_eur": bare}).result
            == "met"
        )

    def test_a_non_numeric_answer_is_undetermined_not_zero(self):
        junk = PersonFact(key="expected_gross_annual_salary_eur", value="about sixty thousand")
        result = evaluate_requirement(threshold(), {"expected_gross_annual_salary_eur": junk})
        assert result.result == "undetermined"

    def test_a_contested_rule_is_undetermined_with_its_note(self):
        # Ambiguity is written down, never resolved by picking the friendlier reading.
        rule = threshold(contested=True, contested_note="two official pages disagree on the figure")
        result = evaluate_requirement(rule, {"expected_gross_annual_salary_eur": salary(90000)})
        assert result.result == "undetermined"
        assert "disagree" in result.reason

    @pytest.mark.parametrize("evaluation", ["document-present", "manual"])
    def test_an_evaluation_this_module_does_not_perform_is_undetermined(self, evaluation):
        # Never `met`. Silently passing an unimplemented comparison lets a rule nobody evaluated
        # read as satisfied.
        rule = threshold(evaluation=evaluation, needs_input=())
        assert evaluate_requirement(rule, {}).result == "undetermined"

    def test_set_member(self):
        rule = threshold(
            evaluation="set-member",
            value=["2211", "2212"],
            needs_input=("isco_08_code",),
        )
        facts = {"isco_08_code": PersonFact(key="isco_08_code", value="2211")}
        assert evaluate_requirement(rule, facts).result == "met"
        facts = {"isco_08_code": PersonFact(key="isco_08_code", value="9999")}
        assert evaluate_requirement(rule, facts).result == "not_met"


class TestVerdict:
    def test_the_m2_scenario_undetermined_then_definite(self):
        # The milestone test: an incomplete profile gets `undetermined` plus the one input that
        # would resolve it, and supplying it produces a definite answer.
        rules = [threshold()]

        incomplete = evaluate_pathway("de.eu-blue-card", rules, [], AS_OF)
        assert incomplete.status == "undetermined"
        assert incomplete.needs_from_user == ("expected_gross_annual_salary_eur",)

        answered = evaluate_pathway("de.eu-blue-card", rules, [salary(60000)], AS_OF)
        assert answered.status == "met"
        assert answered.needs_from_user == ()

    def test_undetermined_dominates_a_met(self):
        # One unknown makes the verdict undetermined even when everything else is met. It never
        # rounds toward the friendlier answer.
        rules = [
            threshold(),
            threshold(
                requirement_id="de.eu-blue-card.language",
                domain="language",
                needs_input=("cefr_german",),
            ),
        ]
        verdict = evaluate_pathway("de.eu-blue-card", rules, [salary(60000)], AS_OF)
        assert verdict.status == "undetermined"
        assert verdict.needs_from_user == ("cefr_german",)

    def test_not_met_produces_a_named_blocker(self):
        verdict = evaluate_pathway("de.eu-blue-card", [threshold()], [salary(30000)], AS_OF)
        assert verdict.status == "not_met"
        assert verdict.blockers == ("de.eu-blue-card.salary-threshold.general",)

    def test_recognition_binds_before_the_visa(self):
        # An unrecognised qualification makes a visa threshold moot, so recognition is reported
        # first even though the salary rule also fails.
        rules = [
            threshold(),
            threshold(
                requirement_id="de.nursing.recognition",
                domain="recognition",
                evaluation="boolean",
                value=True,
                needs_input=("licence_recognised",),
            ),
        ]
        facts = [salary(30000), PersonFact(key="licence_recognised", value=False)]
        verdict = evaluate_pathway("de.eu-blue-card", rules, facts, AS_OF)
        assert verdict.binding_domain == "recognition"

    def test_a_licence_gated_profession_with_no_recognition_rule_is_unknown(self):
        # Returning a visa-only verdict to a nurse whose licence does not transfer is the most
        # harmful output this product could produce.
        verdict = evaluate_pathway(
            "de.eu-blue-card", [threshold()], [salary(90000)], AS_OF, licence_gated=True
        )
        assert verdict.status == "unknown"
        assert verdict.binding_domain == "recognition"
        assert any("licence-gated" in note for note in verdict.notes)

    def test_no_requirements_is_unknown_not_met(self):
        verdict = evaluate_pathway("de.eu-blue-card", [], [salary(90000)], AS_OF)
        assert verdict.status == "unknown"
        assert verdict.confidence == "low"

    def test_rules_outside_the_date_are_not_evaluated(self):
        verdict = evaluate_pathway(
            "de.eu-blue-card", [threshold()], [salary(90000)], date(2027, 6, 1)
        )
        assert verdict.status == "unknown"

    def test_a_stale_rule_is_flagged_rather_than_silently_trusted(self):
        rule = threshold(refresh_after=date(2026, 1, 1))
        verdict = evaluate_pathway("de.eu-blue-card", [rule], [salary(90000)], AS_OF)
        assert any("refresh window" in note for note in verdict.notes)

    def test_self_reported_lowers_confidence_below_verified(self):
        # A stated salary is an intention. A verdict computed from one is not wrong, but it is less
        # certain than one computed from a verified figure.
        stated = evaluate_pathway("de.eu-blue-card", [threshold()], [salary(60000)], AS_OF)
        verified = evaluate_pathway(
            "de.eu-blue-card", [threshold()], [salary(60000, basis="verified")], AS_OF
        )
        assert stated.confidence == "medium"
        assert verified.confidence == "high"

    def test_every_verdict_carries_its_date_and_the_disclaimer_verbatim(self):
        verdict = evaluate_pathway("de.eu-blue-card", [threshold()], [salary(60000)], AS_OF)
        assert verdict.as_of == "2026-06-01"
        assert verdict.disclaimer == DISCLAIMER

    def test_every_evaluated_rule_carries_its_evidence(self):
        # A number with no provenance is a bug (CLAUDE.md, principle 2).
        verdict = evaluate_pathway("de.eu-blue-card", [threshold()], [salary(60000)], AS_OF)
        for req in verdict.requirements:
            assert req.source_url
            assert req.authority
            assert req.effective_from

    def test_is_deterministic(self):
        rules = [threshold()]
        facts = [salary(60000)]
        assert evaluate_pathway("de.eu-blue-card", rules, facts, AS_OF) == evaluate_pathway(
            "de.eu-blue-card", rules, facts, AS_OF
        )

    def test_no_jurisdiction_appears_in_the_evaluator(self):
        """Adding a country adds rows, never a branch (ADR-0002).

        Checks executable code only. `tokenize` is used rather than line filtering because a
        docstring citing Germany as the motivating example is legitimate — and a naive filter
        catches it, which is how a guard like this gets deleted for being noisy instead of fixed.
        """
        source = Path(__file__).parent.parent / "src" / "career_roadmap" / "eligibility.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))

        # A hardcoded country check would *be* a string literal, so string constants are exactly
        # what must be inspected — minus docstrings, where naming the motivating example is
        # legitimate.
        docstrings = {
            id(node.body[0].value)
            for node in ast.walk(tree)
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
            and node.body
            and isinstance(node.body[0], ast.Expr)
            and isinstance(node.body[0].value, ast.Constant)
            and isinstance(node.body[0].value.value, str)
        }
        literals = [
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and id(node) not in docstrings
        ]
        names = [node.id for node in ast.walk(tree) if isinstance(node, ast.Name)]

        for value in literals + names:
            for marker in ("DE", "Germany", "Bundesanzeiger", "AufenthG", "eu-blue-card"):
                assert marker != value, f"{marker!r} is hardcoded in the evaluator"


class TestARightNeverBlocks:
    """A `right` is a benefit the statute grants, not a hurdle.

    Germany's reduced Blue Card salary threshold for certain ISCO groups is one: it can only lower
    the bar. Letting an unanswered one drag the verdict to `undetermined` rejects exactly the people
    the provision is being generous to — found live, after the statute was first ingested.
    """

    def right(self, **overrides) -> Requirement:
        return threshold(
            requirement_id="de.eu-blue-card.reduced-threshold-occupations",
            kind="right",
            evaluation="set-member",
            value=["133", "25"],
            needs_input=("isco_08_group",),
            **overrides,
        )

    def test_an_unanswered_right_does_not_make_the_verdict_undetermined(self):
        verdict = evaluate_pathway(
            "de.eu-blue-card", [threshold(), self.right()], [salary(60000)], AS_OF
        )
        assert verdict.status == "met"

    def test_it_is_not_listed_as_something_the_user_must_supply(self):
        # Listing it would promise that answering changes the outcome. It cannot make things worse,
        # and here it cannot make them better either — the general threshold is already met.
        verdict = evaluate_pathway(
            "de.eu-blue-card", [threshold(), self.right()], [salary(60000)], AS_OF
        )
        assert "isco_08_group" not in verdict.needs_from_user

    def test_a_right_that_does_not_apply_is_never_a_blocker(self):
        facts = [salary(60000), PersonFact(key="isco_08_group", value="9999")]
        verdict = evaluate_pathway("de.eu-blue-card", [threshold(), self.right()], facts, AS_OF)

        assert verdict.status == "met"
        assert verdict.blockers == ()

    def test_it_is_still_evaluated_and_reported(self):
        # Not blocking is not the same as invisible: the person should see it was considered.
        verdict = evaluate_pathway(
            "de.eu-blue-card", [threshold(), self.right()], [salary(60000)], AS_OF
        )
        ids = [r.requirement_id for r in verdict.requirements]
        assert "de.eu-blue-card.reduced-threshold-occupations" in ids

    def test_a_real_requirement_still_blocks(self):
        # The fix must not make everything permissive.
        verdict = evaluate_pathway("de.eu-blue-card", [threshold(), self.right()], [], AS_OF)
        assert verdict.status == "undetermined"
        assert verdict.needs_from_user == ("expected_gross_annual_salary_eur",)
