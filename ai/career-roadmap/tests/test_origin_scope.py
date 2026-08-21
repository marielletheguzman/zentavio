"""Origin-scoped rules: which rules are *about this person* at all (ADR-0029).

Recognition follows the qualification rather than the passport. A rule declaring
``applies_to.origin_jurisdiction`` is for qualifications awarded in those places; a rule declaring
none is for everybody, which is the same conservative reading ``route`` already gets — **absent
means broader, not narrower**.

Three answers, and the middle one is the safety property this whole ADR exists for:

* the rule applies, and is evaluated
* the rule is for other origins, and is ``not_applicable`` — never a rule the person *failed*
* we do not know where they qualified, so we cannot place the rule: ``undetermined``, naming the
  question that would resolve it

The sharpest consequence is the licence-gated guard. A recognition rule written for qualifications
from somewhere else is **not a recognition rule for this person**, so a licence-gated profession
whose only recognition rule excludes her still returns ``unknown`` — not the visa answer on the
strength of a rule that was never about her.

Deliberately jurisdiction-free in substance: the codes here are fixtures, and the evaluator has no
branch naming any of them.
"""

from __future__ import annotations

from datetime import date

from career_roadmap.eligibility import (
    ORIGIN_FACT_KEY,
    PersonFact,
    Requirement,
    evaluate_pathway,
    scope_status,
)

AS_OF = date(2026, 8, 21)


def _rule(requirement_id: str, **overrides) -> Requirement:
    base = dict(
        requirement_id=requirement_id,
        domain="recognition",
        imposed_by="destination",
        kind="eligibility",
        evaluation="boolean",
        value=True,
        needs_input=("has_recognised_professional_qualification",),
        authority="A competent authority",
        source_url="https://official.invalid/rule",
        effective_from=date(2026, 1, 1),
        effective_to=None,
        applies_to={},
    )
    base.update(overrides)
    return Requirement(**base)


def _qualified_in(code) -> PersonFact:
    return PersonFact(key=ORIGIN_FACT_KEY, value=code)


HOLDS_QUALIFICATION = PersonFact(key="has_recognised_professional_qualification", value=True)


class TestScopeStatus:
    """The primitive, on its own, because three other behaviours are built from it."""

    def test_absent_scope_applies_to_everyone(self) -> None:
        rule = _rule("x", applies_to={})
        assert scope_status(rule, origin="AA", destination="BB") == "applies"
        # ...including someone who has said nothing at all. A rule for everybody needs no facts to
        # be placed.
        assert scope_status(rule, origin=None, destination=None) == "applies"

    def test_matching_origin_applies(self) -> None:
        rule = _rule("x", applies_to={"origin_jurisdiction": ["AA", "BB"]})
        assert scope_status(rule, origin="BB", destination=None) == "applies"

    def test_other_origin_is_excluded(self) -> None:
        rule = _rule("x", applies_to={"origin_jurisdiction": ["AA"]})
        assert scope_status(rule, origin="ZZ", destination=None) == "excluded"

    def test_unknown_origin_cannot_be_placed(self) -> None:
        # Guessing either way fabricates a verdict: assuming it applies invents a hurdle, assuming
        # it does not invents compliance.
        rule = _rule("x", applies_to={"origin_jurisdiction": ["AA"]})
        assert scope_status(rule, origin=None, destination=None) == "unanswered"

    def test_destination_scope_mirrors_origin(self) -> None:
        rule = _rule("x", applies_to={"destination_jurisdiction": ["AA"]})
        assert scope_status(rule, origin=None, destination="AA") == "applies"
        assert scope_status(rule, origin=None, destination="ZZ") == "excluded"
        assert scope_status(rule, origin=None, destination=None) == "unanswered"

    def test_both_scopes_must_hold(self) -> None:
        rule = _rule(
            "x",
            applies_to={"origin_jurisdiction": ["AA"], "destination_jurisdiction": ["BB"]},
        )
        assert scope_status(rule, origin="AA", destination="BB") == "applies"
        assert scope_status(rule, origin="AA", destination="ZZ") == "excluded"

    def test_a_bare_string_is_the_one_element_case(self) -> None:
        # A connector writing "AA" where it meant ["AA"] expressed the same intent.
        rule = _rule("x", applies_to={"origin_jurisdiction": "AA"})
        assert scope_status(rule, origin="AA", destination=None) == "applies"

    def test_an_unreadable_scope_is_broader_never_narrower(self) -> None:
        # A scope nobody can read must not silently exclude the people the rule was written for. A
        # rule quietly applying to no one is invisible in a way a wrong verdict is not.
        for value in (5, [], [7], None, {}):
            rule = _rule("x", applies_to={"origin_jurisdiction": value})
            assert scope_status(rule, origin="ZZ", destination=None) == "applies"

    def test_codes_compare_regardless_of_case_or_padding(self) -> None:
        # The person's answer is free text: `ph` and ` PH ` are real answers to the question asked.
        rule = _rule("x", applies_to={"origin_jurisdiction": [" aa "]})
        assert scope_status(rule, origin="AA", destination=None) == "applies"


class TestVerdicts:
    """The same three answers, where a person actually sees them."""

    def test_a_rule_for_other_origins_is_not_a_rule_they_failed(self) -> None:
        verdict = evaluate_pathway(
            "p",
            [_rule("r1", applies_to={"origin_jurisdiction": ["AA"]})],
            [_qualified_in("ZZ")],
            AS_OF,
        )

        [result] = verdict.requirements
        assert result.result == "not_applicable"
        assert result.requirement_id not in verdict.blockers

    def test_an_unplaceable_rule_names_the_question_that_places_it(self) -> None:
        verdict = evaluate_pathway(
            "p",
            [_rule("r1", applies_to={"origin_jurisdiction": ["AA"]})],
            [HOLDS_QUALIFICATION],
            AS_OF,
        )

        assert verdict.status == "undetermined"
        assert ORIGIN_FACT_KEY in verdict.needs_from_user

    def test_a_matching_rule_is_evaluated_exactly_as_any_other(self) -> None:
        verdict = evaluate_pathway(
            "p",
            [_rule("r1", applies_to={"origin_jurisdiction": ["AA"]})],
            [_qualified_in("AA"), HOLDS_QUALIFICATION],
            AS_OF,
        )

        assert verdict.status == "met"

    def test_an_unscoped_rule_still_applies_to_someone_who_never_answered(self) -> None:
        # The no-backfill property: every rule ingested before ADR-0029 declares no scope, and must
        # keep evaluating exactly as it did.
        verdict = evaluate_pathway("p", [_rule("r1")], [HOLDS_QUALIFICATION], AS_OF)

        assert verdict.status == "met"

    def test_a_destination_scoped_rule_the_request_cannot_place_asks_nothing_of_the_person(
        self,
    ) -> None:
        # The destination is ours to supply. Naming a person fact here would ask them to fix our
        # omission, and no answer they gave could.
        verdict = evaluate_pathway(
            "p",
            [
                _rule(
                    "r1",
                    domain="employment_clearance",
                    imposed_by="origin",
                    applies_to={"destination_jurisdiction": ["AA"]},
                )
            ],
            [HOLDS_QUALIFICATION],
            AS_OF,
            destination=None,
        )

        assert verdict.status == "undetermined"
        assert verdict.needs_from_user == ()

    def test_a_destination_scoped_rule_is_placed_once_the_destination_is_stated(self) -> None:
        verdict = evaluate_pathway(
            "p",
            [
                _rule(
                    "r1",
                    domain="employment_clearance",
                    imposed_by="origin",
                    applies_to={"destination_jurisdiction": ["AA"]},
                )
            ],
            [HOLDS_QUALIFICATION],
            AS_OF,
            destination="AA",
        )

        assert verdict.status == "met"


class TestLicenceGatedGuard:
    """ADR-0029's safety property, which is the reason origin is modelled at all."""

    def test_a_recognition_rule_for_other_origins_does_not_count_as_one_on_file(self) -> None:
        # **The failure this prevents.** Without scope, the excluded rule counts, the guard sees a
        # recognition rule, and a nurse receives the visa answer on the strength of a rule that was
        # never about her qualification.
        verdict = evaluate_pathway(
            "p",
            [
                _rule("visa", domain="immigration", applies_to={}),
                _rule("rec", applies_to={"origin_jurisdiction": ["AA"]}),
            ],
            [_qualified_in("ZZ"), HOLDS_QUALIFICATION],
            AS_OF,
            licence_gated=True,
        )

        assert verdict.status == "unknown"
        assert verdict.binding_domain == "recognition"

    def test_an_unplaceable_recognition_rule_does_count_and_stays_answerable(self) -> None:
        # She has not said where she qualified. That is a question she can answer, so the verdict is
        # `undetermined` naming it — not `unknown`, which would say we have nothing at all.
        verdict = evaluate_pathway(
            "p",
            [
                _rule("visa", domain="immigration", applies_to={}),
                _rule("rec", applies_to={"origin_jurisdiction": ["AA"]}),
            ],
            [HOLDS_QUALIFICATION],
            AS_OF,
            licence_gated=True,
        )

        assert verdict.status == "undetermined"
        assert ORIGIN_FACT_KEY in verdict.needs_from_user

    def test_a_matching_recognition_rule_is_evaluated(self) -> None:
        verdict = evaluate_pathway(
            "p",
            [
                _rule("visa", domain="immigration", applies_to={}),
                _rule("rec", applies_to={"origin_jurisdiction": ["AA"]}),
            ],
            [_qualified_in("AA"), HOLDS_QUALIFICATION],
            AS_OF,
            licence_gated=True,
        )

        assert verdict.status == "met"


class TestTheBavarianTitleRulesAsIngested:
    """The rules `de-bayingg` actually stores, evaluated.

    Not a second copy of the connector's tests: those assert what is written to the database, and
    these assert what a person is told. The shapes here are the stored ones — three recognition
    rows, all scoped to `PH`, one of them a document only an authority can decide.

    **No test crosses the HTTP boundary**, and none builds a gateway. The chain is covered in two
    halves: the database and retrieval in `tests/integration/db/de-bayingg-ingest.test.ts`,
    placement and the verdict here.
    """

    def _rules(self) -> list[Requirement]:
        common = dict(
            domain="recognition",
            imposed_by="destination",
            authority="Bayerisches Staatsministerium für Wirtschaft, Landesentwicklung und Energie",
            source_url="https://www.gesetze-bayern.de/Content/Document/BayIngG2016-2",
            effective_from=date(2016, 8, 1),
            effective_to=None,
            applies_to={"origin_jurisdiction": ["PH"]},
        )
        return [
            Requirement(
                requirement_id="de.ingenieur-title.by.study-duration.ph",
                kind="condition",
                evaluation="numeric-gte",
                value={"amount": 6, "unit": "semesters"},
                needs_input=("degree_standard_duration_semesters",),
                **common,
            ),
            Requirement(
                requirement_id="de.ingenieur-title.by.ects-credits.ph",
                kind="condition",
                evaluation="numeric-gte",
                value={"amount": 180, "unit": "ects"},
                needs_input=("degree_ects_credits",),
                **common,
            ),
            Requirement(
                requirement_id="de.ingenieur-title.by.permission.ph",
                kind="document",
                evaluation="document-present",
                value={"document": "Genehmigung zum Führen der Berufsbezeichnung"},
                needs_input=(),
                **common,
            ),
        ]

    def test_a_philippine_degree_is_measured_against_them(self) -> None:
        verdict = evaluate_pathway(
            "de.eu-blue-card",
            self._rules(),
            [
                _qualified_in("PH"),
                PersonFact(key="degree_standard_duration_semesters", value=8),
                PersonFact(key="degree_ects_credits", value=240),
            ],
            AS_OF,
            destination="DE",
        )

        results = {r.requirement_id: r.result for r in verdict.requirements}
        assert results["de.ingenieur-title.by.study-duration.ph"] == "met"
        assert results["de.ingenieur-title.by.ects-credits.ph"] == "met"
        # The permission is undetermined and stays that way: only the authority knows whether it was
        # granted, and asserting either way would be inventing a verdict.
        assert results["de.ingenieur-title.by.permission.ph"] == "undetermined"
        assert verdict.status == "undetermined"

    def test_a_shorter_programme_is_a_real_no_on_the_condition_it_fails(self) -> None:
        verdict = evaluate_pathway(
            "de.eu-blue-card",
            self._rules(),
            [
                _qualified_in("PH"),
                PersonFact(key="degree_standard_duration_semesters", value=4),
                PersonFact(key="degree_ects_credits", value=120),
            ],
            AS_OF,
            destination="DE",
        )

        assert "de.ingenieur-title.by.study-duration.ph" in verdict.blockers
        assert "de.ingenieur-title.by.ects-credits.ph" in verdict.blockers

    def test_a_qualification_from_elsewhere_is_told_the_rules_are_not_about_it(self) -> None:
        # The whole point of origin scoping. Art. 3 Abs. 4 addresses evidence from outside the
        # EU/EEA; someone holding a German degree is not measured against it, and telling them they
        # failed a condition written for other qualifications would be false about their own case.
        verdict = evaluate_pathway(
            "de.eu-blue-card",
            self._rules(),
            [_qualified_in("DE")],
            AS_OF,
            destination="DE",
        )

        assert {r.result for r in verdict.requirements} == {"not_applicable"}
        assert verdict.blockers == ()

    def test_someone_who_has_not_said_where_they_qualified_is_asked(self) -> None:
        verdict = evaluate_pathway("de.eu-blue-card", self._rules(), [], AS_OF, destination="DE")

        assert verdict.status == "undetermined"
        assert ORIGIN_FACT_KEY in verdict.needs_from_user
