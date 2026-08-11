"""Routes: a pathway with more than one way in (ADR-0024).

The case at the top is why this exists. Before routes, a German software professional in ISCO
group 25 earning €47 000 was told **not_met** — the reduced threshold and the occupation list both
evaluated `met`, and the general threshold blocked anyway, because nothing said the reduced one
*replaces* it. § 18g Abs. 1 S. 2 AufenthG gives that person the Blue Card. Telling them otherwise
is a false negative about a relocation, so it is asserted here directly and by name.

The other tests are the ways this could go wrong in the opposite direction: a route opening for
someone it does not belong to, a closed route reported as a failure, or the routeless behaviour
that every other pathway still depends on quietly changing underneath it.
"""

from __future__ import annotations

from datetime import date

from career_roadmap.eligibility import PersonFact, Requirement, evaluate_pathway

AS_OF = date(2026, 8, 5)

#: The ISCO-08 groups § 18g Abs. 1 S. 2 Nr. 1 lists, as the statute lists them.
REDUCED_GROUPS = ["132", "133", "134", "21", "221", "222", "225", "226", "23", "25"]


def _rule(requirement_id: str, **overrides) -> Requirement:
    base = dict(
        requirement_id=requirement_id,
        domain="immigration",
        imposed_by="destination",
        kind="threshold",
        evaluation="numeric-gte",
        value={"amount": 1, "currency": "EUR", "period": "year"},
        needs_input=(),
        authority="Bundesministerium des Innern",
        source_url="https://www.bundesanzeiger.de/...",
        effective_from=date(2026, 1, 1),
        effective_to=date(2026, 12, 31),
    )
    base.update(overrides)
    return Requirement(**base)


def blue_card_rules() -> list[Requirement]:
    """Germany's Blue Card as it is actually stored once § 18g's two Abs. 1 routes are on file."""
    return [
        _rule(
            "de.eu-blue-card.salary-threshold.general",
            value={"amount": 50700, "currency": "EUR", "period": "year"},
            needs_input=("expected_gross_annual_salary_eur",),
            applies_to={"route": "abs1-s1"},
        ),
        _rule(
            "de.eu-blue-card.salary-threshold.reduced",
            value={"amount": 45934.20, "currency": "EUR", "period": "year"},
            needs_input=("expected_gross_annual_salary_eur",),
            applies_to={"route": "abs1-s2"},
        ),
        _rule(
            "de.eu-blue-card.reduced-threshold-occupations",
            kind="right",
            evaluation="set-member",
            value=REDUCED_GROUPS,
            needs_input=("isco_08_group",),
            applies_to={"route": "abs1-s2"},
        ),
        # No route: § 18g Abs. 3 governs every way in.
        _rule(
            "de.eu-blue-card.employment-duration",
            kind="condition",
            value={"amount": 6, "unit": "months"},
            needs_input=("employment_contract_months",),
            applies_to={},
        ),
    ]


def salary(amount: float) -> PersonFact:
    return PersonFact(
        key="expected_gross_annual_salary_eur",
        value={"amount": amount, "currency": "EUR", "period": "year"},
    )


def occupation(group: str) -> PersonFact:
    return PersonFact(key="isco_08_group", value=group)


def contract(months: int) -> PersonFact:
    return PersonFact(key="employment_contract_months", value=months)


def test_isco_25_at_47000_is_eligible_by_the_reduced_route() -> None:
    """The false negative this whole model exists to fix.

    § 18g Abs. 1 S. 2 Nr. 1: an occupation in one of the listed ISCO-08 groups attracts the 45,3 %
    minimum — €45 934,20 for 2026. €47 000 clears it. Before routes this returned `not_met`.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        blue_card_rules(),
        [salary(47000), occupation("25"), contract(12)],
        AS_OF,
    )

    assert verdict.status == "met"
    assert verdict.route == "abs1-s2"
    assert verdict.blockers == ()
    assert verdict.needs_from_user == ()


def test_an_unlisted_occupation_does_not_get_the_reduced_route() -> None:
    """The opposite error, which would be worse.

    A route without a gate would hand the reduced threshold to everyone. The occupation list is
    what opens `abs1-s2`, so someone outside it is judged against the general threshold — and the
    route they cannot use is `not_applicable`, not failed.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        blue_card_rules(),
        [salary(47000), occupation("999"), contract(12)],
        AS_OF,
    )

    assert verdict.status == "not_met"
    assert verdict.blockers == ("de.eu-blue-card.salary-threshold.general",)

    reduced = next(o for o in verdict.routes if o.route == "abs1-s2")
    assert reduced.status == "not_applicable"
    assert reduced.reason is not None


def test_a_closed_route_is_never_a_blocker_and_never_asks_a_question() -> None:
    """`not_applicable` is not a failure, so it cannot appear anywhere failures appear."""
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        blue_card_rules(),
        [salary(60000), occupation("999"), contract(12)],
        AS_OF,
    )

    assert verdict.status == "met"
    assert verdict.route == "abs1-s1"

    closed = [o for o in verdict.routes if o.status == "not_applicable"]
    assert closed, "the unlisted occupation should close the reduced route"
    for outcome in closed:
        assert outcome.blockers == ()
        assert outcome.needs_from_user == ()
        for requirement_id in outcome.requirement_ids:
            assert requirement_id not in verdict.blockers
            assert requirement_id not in verdict.needs_from_user


def test_a_rule_on_a_closed_route_is_reported_not_applicable_not_failed() -> None:
    """Telling someone they failed a threshold on a route they were never on is a false statement.

    The gating right keeps its own `not_met` — that is *why* the route is closed, and hiding it
    would leave the closure unexplained.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        blue_card_rules(),
        [salary(30000), occupation("999"), contract(12)],
        AS_OF,
    )

    by_id = {r.requirement_id: r for r in verdict.requirements}
    assert by_id["de.eu-blue-card.salary-threshold.reduced"].result == "not_applicable"
    assert by_id["de.eu-blue-card.reduced-threshold-occupations"].result == "not_met"
    # The general threshold is genuinely failed, on a route that is genuinely open.
    assert by_id["de.eu-blue-card.salary-threshold.general"].result == "not_met"


def test_an_unanswered_gate_leaves_its_route_open_but_never_blocks_the_pathway() -> None:
    """The original `right` finding, preserved.

    An unanswered occupation question must not drag the verdict down: `abs1-s1` is met on its own
    terms, and `met` on any route wins. The reduced route stays undetermined and says what it
    would need — it just does not get to decide.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        blue_card_rules(),
        [salary(60000), contract(12)],
        AS_OF,
    )

    assert verdict.status == "met"
    assert verdict.route == "abs1-s1"

    reduced = next(o for o in verdict.routes if o.route == "abs1-s2")
    assert reduced.status == "undetermined"
    assert "isco_08_group" in reduced.needs_from_user


def test_a_pathway_wide_rule_is_evaluated_on_every_route() -> None:
    """A rule with no route belongs to all of them, so failing it closes every way in."""
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        blue_card_rules(),
        [salary(60000), occupation("25"), contract(3)],
        AS_OF,
    )

    assert verdict.status == "not_met"
    assert all(o.status == "not_met" for o in verdict.routes)
    assert "de.eu-blue-card.employment-duration" in verdict.blockers


def test_the_nearest_open_route_is_the_one_asked_about() -> None:
    """Among open routes, the product asks the shortest set of questions (ADR-0024 rule 5).

    The others are still reported in full — this only decides what is asked first, because the
    union of every route's questions is a form nobody finishes.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        blue_card_rules(),
        [occupation("25"), contract(12)],
        AS_OF,
    )

    assert verdict.status == "undetermined"
    assert verdict.needs_from_user == ("expected_gross_annual_salary_eur",)
    assert {o.route for o in verdict.routes} == {"abs1-s1", "abs1-s2"}


def test_a_routeless_pathway_behaves_exactly_as_it_did_before_routes() -> None:
    """The property the whole change rests on, and the reason reverting it is cheap.

    Every stored pathway declares no route today. If this drifts, ADR-0024 stopped being additive
    and every existing verdict is in question.
    """
    rules = [
        _rule(
            "x.salary",
            value={"amount": 50000, "currency": "EUR", "period": "year"},
            needs_input=("expected_gross_annual_salary_eur",),
        ),
        _rule(
            "x.occupations",
            kind="right",
            evaluation="set-member",
            value=["25"],
            needs_input=("isco_08_group",),
        ),
    ]
    verdict = evaluate_pathway("x", rules, [salary(60000)], AS_OF)

    assert verdict.status == "met"
    assert verdict.route is None
    assert verdict.routes == ()
    # A right stays non-deciding and stays unasked, exactly as before.
    assert verdict.needs_from_user == ()


def test_route_ids_come_only_from_the_data() -> None:
    """An id the data never declared must never appear (ADR-0024 rule 10)."""
    rules = blue_card_rules()
    declared = {r.applies_to.get("route") for r in rules} - {None}

    verdict = evaluate_pathway(
        "de.eu-blue-card", rules, [salary(47000), occupation("25"), contract(12)], AS_OF
    )

    assert {o.route for o in verdict.routes} == declared
    assert verdict.route in declared


def test_a_months_threshold_is_comparable() -> None:
    """§ 18g Abs. 3 stored as `{months: 6}` parsed, stored, and evaluated `undetermined` forever.

    The evaluator compares `value.amount`, so a rule written any other way is on file and can
    never be satisfied — the quietest possible failure. `{amount, unit}` is the shape that works,
    and `unit` is checked so six months is never compared against six years.
    """
    rules = [
        _rule(
            "x.duration",
            kind="condition",
            value={"amount": 6, "unit": "months"},
            needs_input=("employment_contract_months",),
        )
    ]

    assert evaluate_pathway("x", rules, [contract(12)], AS_OF).status == "met"
    assert evaluate_pathway("x", rules, [contract(3)], AS_OF).status == "not_met"

    mismatched = PersonFact(key="employment_contract_months", value={"amount": 6, "unit": "years"})
    assert evaluate_pathway("x", rules, [mismatched], AS_OF).status == "undetermined"


def _with_second_gate() -> list[Requirement]:
    """`abs1-s2` as § 18g Abs. 1 S. 2 actually reads: Nr. 1 *oder* Nr. 2."""
    return [
        *blue_card_rules(),
        _rule(
            "de.eu-blue-card.recent-graduate",
            kind="right",
            evaluation="numeric-lte",
            value={"amount": 3, "unit": "years"},
            needs_input=("years_since_degree_awarded",),
            applies_to={"route": "abs1-s2"},
        ),
    ]


def graduated(years_ago: int) -> PersonFact:
    return PersonFact(key="years_since_degree_awarded", value=years_ago)


def test_either_gate_opens_the_route() -> None:
    """Gates are ANY. One legal consequence, two qualifying circumstances.

    A recent graduate outside the listed ISCO groups gets the reduced threshold. Requiring both
    gates would deny exactly that person, which is the statute read backwards.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        _with_second_gate(),
        [salary(47000), occupation("999"), graduated(1), contract(12)],
        AS_OF,
    )

    assert verdict.status == "met"
    assert verdict.route == "abs1-s2"


def test_the_other_gate_opens_it_too() -> None:
    """The listed occupation still works when the degree is old — neither gate is privileged."""
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        _with_second_gate(),
        [salary(47000), occupation("25"), graduated(11), contract(12)],
        AS_OF,
    )

    assert verdict.status == "met"
    assert verdict.route == "abs1-s2"


def test_a_route_closes_only_when_every_gate_is_answered_no() -> None:
    """Closed means *no* qualifying circumstance applies, and the reason names all of them."""
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        _with_second_gate(),
        [salary(47000), occupation("999"), graduated(11), contract(12)],
        AS_OF,
    )

    reduced = next(o for o in verdict.routes if o.route == "abs1-s2")
    assert reduced.status == "not_applicable"
    assert "de.eu-blue-card.reduced-threshold-occupations" in (reduced.reason or "")
    assert "de.eu-blue-card.recent-graduate" in (reduced.reason or "")
    assert verdict.status == "not_met"


def test_one_gate_refused_and_one_unanswered_is_undetermined_not_closed() -> None:
    """A route is not closed while a way into it remains unasked.

    Answering "not a listed occupation" says nothing about when the degree was awarded, and
    closing on the first no would silently drop the second gateway.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        _with_second_gate(),
        [salary(47000), occupation("999"), contract(12)],
        AS_OF,
    )

    reduced = next(o for o in verdict.routes if o.route == "abs1-s2")
    assert reduced.status == "undetermined"
    assert reduced.needs_from_user == ("years_since_degree_awarded",)


def test_a_met_gate_wins_over_a_refused_one() -> None:
    """One gate answered no never overrides another answered yes.

    Gates are alternatives. Letting the refused one decide would be the ALL reading again, arriving
    by a different door: the listed occupation opens the route whatever the degree's age.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        _with_second_gate(),
        [salary(47000), occupation("25"), graduated(11), contract(12)],
        AS_OF,
    )

    reduced = next(o for o in verdict.routes if o.route == "abs1-s2")
    assert reduced.status == "met"
    assert reduced.blockers == ()
    assert verdict.status == "met"
    assert verdict.route == "abs1-s2"


#: The ISCO-08 groups § 18g Abs. 2 admits — **two**, not Abs. 1 S. 2's ten.
EXPERIENCE_GROUPS = ["133", "25"]


def full_18g_rules() -> list[Requirement]:
    """§ 18g as both connectors actually emit it, all three routes on file.

    Written out rather than derived, because the thing under test is precisely which route each row
    lands on. A helper that computed the scoping would test itself.
    """
    return [
        *_with_second_gate(),
        # `de-bundesanzeiger`: the 45,3 % figure governs Abs. 1 S. 2 **and** Abs. 2, so it is one
        # row per route. Without this row Abs. 2 would have no salary rule at all and would open on
        # its gate alone — a false positive at any salary.
        _rule(
            "de.eu-blue-card.salary-threshold.reduced.abs2",
            value={"amount": 45934.20, "currency": "EUR", "period": "year"},
            needs_input=("expected_gross_annual_salary_eur",),
            applies_to={"route": "abs2"},
        ),
        # `de-aufenthg`: the qualification, stated once per route that requires it. Abs. 2 is
        # deliberately absent from this list.
        _rule(
            "de.eu-blue-card.qualification",
            kind="eligibility",
            evaluation="boolean",
            value=True,
            needs_input=("has_recognised_academic_degree",),
            applies_to={"route": "abs1-s1"},
        ),
        _rule(
            "de.eu-blue-card.qualification.abs1-s2",
            kind="eligibility",
            evaluation="boolean",
            value=True,
            needs_input=("has_recognised_academic_degree",),
            applies_to={"route": "abs1-s2"},
        ),
        _rule(
            "de.eu-blue-card.experience-route-occupations",
            kind="right",
            evaluation="set-member",
            value=EXPERIENCE_GROUPS,
            needs_input=("isco_08_group",),
            applies_to={"route": "abs2"},
        ),
        _rule(
            "de.eu-blue-card.professional-experience",
            kind="condition",
            value={"amount": 3, "unit": "years"},
            needs_input=("years_relevant_experience_last_seven",),
            applies_to={"route": "abs2"},
        ),
    ]


def degree(held: bool) -> PersonFact:
    return PersonFact(key="has_recognised_academic_degree", value=held)


def experience(years: int) -> PersonFact:
    return PersonFact(key="years_relevant_experience_last_seven", value=years)


def test_abs2_admits_the_person_without_a_degree() -> None:
    """The population § 18g Abs. 2 exists for, and the one a pathway-wide degree rule would deny.

    An IT professional in ISCO 133 with four years' experience and no degree at all: Abs. 2 grants
    them the Blue Card. Before Abs. 2 was routed, the qualification row was pathway-wide, so this
    person was `not_met` on a rule the statute does not apply to them.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        full_18g_rules(),
        [salary(47000), occupation("133"), experience(4), degree(False), contract(12)],
        AS_OF,
    )

    assert verdict.status == "met"
    assert verdict.route == "abs2"

    abs2 = next(o for o in verdict.routes if o.route == "abs2")
    assert abs2.status == "met"
    assert abs2.blockers == ()


def test_the_degree_question_never_reaches_the_abs2_route() -> None:
    """Scope, asserted on the route rather than on the connector that produced it.

    Two sources write these rows and either could regress. What must hold is that no rule asking
    for a degree is ever evaluated as part of Abs. 2 — not merely that today's connector scopes
    them correctly.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        full_18g_rules(),
        [salary(47000), occupation("133"), experience(4), contract(12)],
        AS_OF,
    )

    abs2 = next(o for o in verdict.routes if o.route == "abs2")
    assert "has_recognised_academic_degree" not in abs2.needs_from_user
    assert not any("qualification" in rid for rid in abs2.requirement_ids)

    # And it does reach the routes that do require it, so the assertion above is scope and not the
    # rule having quietly disappeared.
    for route_id in ("abs1-s1", "abs1-s2"):
        outcome = next(o for o in verdict.routes if o.route == route_id)
        assert "has_recognised_academic_degree" in outcome.needs_from_user


def test_abs2_still_has_a_salary_rule_of_its_own() -> None:
    """A gate with no condition behind it would admit anyone in the group at any wage.

    The 45,3 % figure is emitted once per route it governs precisely so this route is not open on
    its occupation and experience alone.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        full_18g_rules(),
        [salary(20000), occupation("133"), experience(4), degree(False), contract(12)],
        AS_OF,
    )

    abs2 = next(o for o in verdict.routes if o.route == "abs2")
    assert abs2.status == "not_met"
    assert "de.eu-blue-card.salary-threshold.reduced.abs2" in abs2.blockers
    assert verdict.status == "not_met"


def test_the_seven_year_window_is_the_question_not_a_second_rule() -> None:
    """§ 18g Abs. 2 Nr. 3 a) counts experience acquired in the last seven years.

    That window lives in the person fact — one question, one comparison. A second rule filtering a
    career total would mean two places could disagree about what was counted, and the evaluator
    would be reasoning about German law it must never contain.
    """
    rules = full_18g_rules()
    experience_rule = next(
        r for r in rules if r.requirement_id == "de.eu-blue-card.professional-experience"
    )

    assert experience_rule.needs_input == ("years_relevant_experience_last_seven",)
    assert experience_rule.evaluation == "numeric-gte"

    # Two years inside the window fails, whatever a longer career elsewhere might say. Nothing here
    # windows anything: the fact arrived already windowed.
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        rules,
        [salary(47000), occupation("133"), experience(2), degree(False), contract(12)],
        AS_OF,
    )

    abs2 = next(o for o in verdict.routes if o.route == "abs2")
    assert abs2.status == "not_met"
    assert "de.eu-blue-card.professional-experience" in abs2.blockers


def test_a_degree_holder_is_never_told_they_failed_the_experience_route() -> None:
    """`not_applicable`, the distinction ADR-0024 added a fourth result for.

    Someone with a degree in an unlisted occupation was never on Abs. 2. Reporting its experience
    rule as `not_met` would be a false statement about a person, not a wording problem.
    """
    verdict = evaluate_pathway(
        "de.eu-blue-card",
        full_18g_rules(),
        [salary(60000), occupation("999"), degree(True), graduated(11), contract(12)],
        AS_OF,
    )

    assert verdict.status == "met"
    assert verdict.route == "abs1-s1"

    abs2 = next(o for o in verdict.routes if o.route == "abs2")
    assert abs2.status == "not_applicable"

    by_id = {r.requirement_id: r for r in verdict.requirements}
    assert by_id["de.eu-blue-card.professional-experience"].result == "not_applicable"
    assert "de.eu-blue-card.professional-experience" not in verdict.blockers
