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
