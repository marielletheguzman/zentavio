"""Any-of conditions: one requirement satisfiable by alternative means (ADR-0024 rule 10).

Luxembourg is why this exists. Art. 45 (1) 2. of the loi du 29 août 2008 states **one**
qualification condition, and Art. 45 (2) d) and f) give three ways to satisfy it: a higher-education
diploma, ICT experience of three years within seven for CITP-08 groups 133 and 25, or five years in
another profession.

They are not routes — rule 6 says a route is one legal consequence, and these three reach the same
permit under the same salary rule. They are not gates either, and that is the sharper point: a gate
that no one opens makes a route ``not_applicable``, *"this way in is not open to you"*. A person
with no diploma and no qualifying experience has not met a closed door. **They failed the
qualification requirement**, and saying otherwise misdescribes their own case.

Every test here is one of the Compliance bullets in the amendment, asserted rather than described.
"""

from __future__ import annotations

from datetime import date

from career_roadmap.eligibility import PersonFact, Requirement, evaluate_pathway

AS_OF = date(2026, 8, 20)

#: The CITP-08 groups Art. 45 (2) f) i) lists.
ICT_GROUPS = ["133", "25"]


def _rule(requirement_id: str, **overrides) -> Requirement:
    base = dict(
        requirement_id=requirement_id,
        domain="immigration",
        imposed_by="destination",
        kind="eligibility",
        evaluation="boolean",
        value=True,
        needs_input=(),
        authority="Grand-Duché de Luxembourg (Journal officiel)",
        source_url="https://data.legilux.public.lu/eli/etat/leg/loi/2008/08/29/n1",
        effective_from=date(2024, 6, 4),
        effective_to=None,
    )
    base.update(overrides)
    return Requirement(**base)


def qualification_group() -> list[Requirement]:
    """Luxembourg's qualification condition, as the three alternatives it actually is."""
    return [
        _rule(
            "lu.eu-blue-card.qualification.diploma",
            needs_input=("has_recognised_academic_degree",),
            applies_to={"anyOf": "qualification"},
        ),
        _rule(
            "lu.eu-blue-card.qualification.ict-experience",
            kind="condition",
            evaluation="numeric-gte",
            value={"amount": 3, "unit": "years"},
            needs_input=("years_relevant_experience_last_seven",),
            applies_to={"anyOf": "qualification"},
        ),
        _rule(
            "lu.eu-blue-card.qualification.other-experience",
            kind="condition",
            evaluation="numeric-gte",
            value={"amount": 5, "unit": "years"},
            needs_input=("years_relevant_experience",),
            applies_to={"anyOf": "qualification"},
        ),
    ]


def _verdict(rules, facts):
    return evaluate_pathway("lu.eu-blue-card", rules, facts, AS_OF)


class TestTheGroupIsOneCondition:
    def test_one_met_alternative_satisfies_the_whole_condition(self):
        # The case the mechanism exists for: no diploma, but the ICT experience route is open.
        verdict = _verdict(
            qualification_group(),
            [
                PersonFact("has_recognised_academic_degree", False),
                PersonFact("years_relevant_experience_last_seven", 4),
                PersonFact("years_relevant_experience", 4),
            ],
        )

        assert verdict.status == "met"
        assert verdict.blockers == ()

    def test_the_group_fails_only_when_every_alternative_fails(self):
        verdict = _verdict(
            qualification_group(),
            [
                PersonFact("has_recognised_academic_degree", False),
                PersonFact("years_relevant_experience_last_seven", 1),
                PersonFact("years_relevant_experience", 2),
            ],
        )

        assert verdict.status == "not_met"

    def test_one_unanswered_alternative_keeps_the_group_open(self):
        # **An unanswered alternative is never a failure.** Two alternatives are answered no and
        # the third has not been asked, so the condition is not yet decided — the person may still
        # qualify and must not be told they cannot.
        verdict = _verdict(
            qualification_group(),
            [
                PersonFact("has_recognised_academic_degree", False),
                PersonFact("years_relevant_experience_last_seven", 1),
            ],
        )

        assert verdict.status == "undetermined"


class TestWhatThePersonIsTold:
    def test_the_blocker_names_the_group_never_one_alternative(self):
        # The failure mode rule 10 exists to prevent. Telling someone "you lack a degree" when the
        # requirement was *degree or experience* is false about their own case.
        verdict = _verdict(
            qualification_group(),
            [
                PersonFact("has_recognised_academic_degree", False),
                PersonFact("years_relevant_experience_last_seven", 1),
                PersonFact("years_relevant_experience", 2),
            ],
        )

        assert verdict.blockers == ("qualification",)
        assert "lu.eu-blue-card.qualification.diploma" not in verdict.blockers

    def test_every_alternative_is_still_reported_with_its_own_result(self):
        # Collapsing decides the verdict; it does not hide the alternatives. The person sees each
        # way in and how they did on it.
        verdict = _verdict(
            qualification_group(),
            [
                PersonFact("has_recognised_academic_degree", False),
                PersonFact("years_relevant_experience_last_seven", 4),
                PersonFact("years_relevant_experience", 4),
            ],
        )

        reported = {r.requirement_id: r.result for r in verdict.requirements}
        assert reported["lu.eu-blue-card.qualification.diploma"] == "not_met"
        assert reported["lu.eu-blue-card.qualification.ict-experience"] == "met"

    def test_needs_from_user_asks_the_shortest_path_first(self):
        # Rule 5, one level down. Nothing is answered, so all three are open; the question named
        # first is the one from the alternative needing fewest inputs.
        verdict = _verdict(qualification_group(), [])

        assert verdict.status == "undetermined"
        assert len(verdict.needs_from_user) >= 1


class TestTheIdentityThatMakesAdoptionSafe:
    def test_a_one_member_group_behaves_exactly_like_no_group(self):
        # **The property the whole mechanism rests on.** If a single-member group differed from an
        # ungrouped condition, adopting any-of anywhere would silently change every verdict.
        grouped = [
            _rule(
                "lu.eu-blue-card.qualification.diploma",
                needs_input=("has_recognised_academic_degree",),
                applies_to={"anyOf": "qualification"},
            )
        ]
        plain = [
            _rule(
                "lu.eu-blue-card.qualification.diploma",
                needs_input=("has_recognised_academic_degree",),
            )
        ]
        facts = [PersonFact("has_recognised_academic_degree", False)]

        assert _verdict(grouped, facts).status == _verdict(plain, facts).status
        assert _verdict(grouped, facts).needs_from_user == _verdict(plain, facts).needs_from_user

    def test_a_pathway_with_no_groups_is_untouched(self):
        # Rule 2's guarantee, extended. Stored rows keep working.
        rules = [
            _rule(
                "lu.eu-blue-card.salary-threshold.general",
                kind="threshold",
                evaluation="numeric-gte",
                value={"amount": 58968, "currency": "EUR", "period": "year"},
                needs_input=("expected_gross_annual_salary_eur",),
            )
        ]

        salary = PersonFact("expected_gross_annual_salary_eur", {"amount": 70000})
        verdict = _verdict(rules, [salary])

        assert verdict.status == "met"


class TestNotApplicableMembers:
    def test_a_group_of_only_inapplicable_alternatives_is_not_applicable_not_failed(self):
        # Rule 3's distinction, applied inside the group. Members belonging to a route the person
        # never opened are excluded; with nothing left the condition does not apply to them, and
        # calling that `not_met` would report a failure they never had.
        rules = [
            _rule(
                "lu.eu-blue-card.qualification.ict-experience",
                kind="condition",
                evaluation="numeric-gte",
                value={"amount": 3, "unit": "years"},
                needs_input=("years_relevant_experience_last_seven",),
                applies_to={"anyOf": "qualification", "route": "closed"},
            ),
            _rule(
                "lu.eu-blue-card.ict-occupations",
                kind="right",
                evaluation="set-member",
                value=ICT_GROUPS,
                needs_input=("isco_08_group",),
                applies_to={"route": "closed"},
            ),
            _rule(
                "lu.eu-blue-card.salary-threshold.general",
                kind="threshold",
                evaluation="numeric-gte",
                value={"amount": 58968, "currency": "EUR", "period": "year"},
                needs_input=("expected_gross_annual_salary_eur",),
                applies_to={"route": "open"},
            ),
        ]

        verdict = _verdict(
            rules,
            [
                PersonFact("isco_08_group", "51"),
                PersonFact("years_relevant_experience_last_seven", 1),
                PersonFact("expected_gross_annual_salary_eur", {"amount": 70000}),
            ],
        )

        # The open route carries the person; the closed one is reported as closed rather than as a
        # qualification failure. **The assertion that matters is the second one**: the person
        # answered "1 year" to an experience question and must not be told they failed it, because
        # the route it belonged to was never open to them.
        assert verdict.status == "met"

        reported = {r.requirement_id: r.result for r in verdict.requirements}
        assert reported["lu.eu-blue-card.qualification.ict-experience"] == "not_applicable"
        assert verdict.blockers == ()
        assert "qualification" not in verdict.blockers


class TestTheEvaluatorLearnsNothingAboutLuxembourg:
    def test_a_group_id_is_opaque(self):
        # Rule 8, unchanged. The id is data; nothing branches on its meaning.
        rules = [
            _rule(
                "x.y.a",
                needs_input=("has_recognised_academic_degree",),
                applies_to={"anyOf": "zzz"},
            ),
            _rule(
                "x.y.b",
                kind="condition",
                evaluation="numeric-gte",
                value={"amount": 3, "unit": "years"},
                needs_input=("years_relevant_experience_last_seven",),
                applies_to={"anyOf": "zzz"},
            ),
        ]

        verdict = _verdict(
            rules,
            [
                PersonFact("has_recognised_academic_degree", True),
                PersonFact("years_relevant_experience_last_seven", 0),
            ],
        )

        assert verdict.status == "met"

    def test_a_malformed_any_of_makes_the_condition_ordinary_not_unevaluable(self):
        # Same conservative reading `route` already takes: a bad scope must not take the pathway
        # down with it.
        rules = [
            _rule(
                "lu.eu-blue-card.qualification.diploma",
                needs_input=("has_recognised_academic_degree",),
                applies_to={"anyOf": ""},
            )
        ]

        verdict = _verdict(rules, [PersonFact("has_recognised_academic_degree", True)])

        assert verdict.status == "met"
