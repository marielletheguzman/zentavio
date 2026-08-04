"""The HTTP surface.

The distinction under test is the one that matters operationally: **an eligibility outcome is a
200, a malformed request is a 4xx**. A caller must be able to tell "we cannot answer this" from
"you sent something wrong", because the first is shown to a user and the second is our defect.
"""

from __future__ import annotations

from career_roadmap.main import EVALUATOR_VERSION, app
from fastapi.testclient import TestClient

client = TestClient(app)

THRESHOLD = {
    "requirement_id": "de.eu-blue-card.salary-threshold.general",
    "domain": "immigration",
    "imposed_by": "destination",
    "kind": "threshold",
    "evaluation": "numeric-gte",
    "value": {"amount": 50700, "currency": "EUR", "period": "year", "basis": "gross"},
    "needs_input": ["expected_gross_annual_salary_eur"],
    "authority": "Bundesministerium des Innern",
    "source_url": "https://www.bundesanzeiger.de/...",
    "effective_from": "2026-01-01",
    "effective_to": "2026-12-31",
}


def evaluate(**overrides):
    body = {
        "pathway_id": "de.eu-blue-card",
        "requirements": [THRESHOLD],
        "facts": [],
        "as_of": "2026-06-01",
    }
    body.update(overrides)
    return client.post("/evaluate", json=body)


class TestTheMilestoneScenario:
    def test_an_incomplete_profile_is_undetermined_with_the_resolving_input(self):
        response = evaluate()
        assert response.status_code == 200

        body = response.json()
        assert body["status"] == "undetermined"
        assert body["needs_from_user"] == ["expected_gross_annual_salary_eur"]

    def test_supplying_it_produces_a_definite_answer(self):
        response = evaluate(
            facts=[
                {
                    "key": "expected_gross_annual_salary_eur",
                    "value": {
                        "amount": 60000,
                        "currency": "EUR",
                        "period": "year",
                        "basis": "gross",
                    },
                }
            ]
        )
        body = response.json()
        assert body["status"] == "met"
        assert body["needs_from_user"] == []


class TestOutcomesAreAnswers:
    def test_an_unmodelled_pathway_is_a_200_with_a_reason(self):
        # A pathway nobody has modelled is a result the user must be shown, not an error.
        response = evaluate(requirements=[])
        assert response.status_code == 200
        assert response.json()["status"] == "unknown"
        assert response.json()["notes"]

    def test_a_licence_gated_profession_without_recognition_data_is_a_200(self):
        response = evaluate(licence_gated=True)
        assert response.status_code == 200
        assert response.json()["status"] == "unknown"
        assert response.json()["binding_domain"] == "recognition"


class TestMalformedRequests:
    def test_a_missing_as_of_is_a_422(self):
        # `as_of` is not defaulted to today: a verdict without a stated date is unreproducible.
        response = client.post("/evaluate", json={"requirements": [], "facts": []})
        assert response.status_code == 422

    def test_an_unparseable_date_is_a_422(self):
        assert evaluate(as_of="not-a-date").status_code == 422

    def test_an_unknown_basis_is_a_422(self):
        response = evaluate(
            facts=[{"key": "x", "value": 1, "basis": "guessed"}],
        )
        assert response.status_code == 422


class TestEveryResponseCarriesItsProvenance:
    def test_the_disclaimer_is_present_and_verbatim(self):
        body = evaluate().json()
        assert "not legal advice" in body["disclaimer"]

    def test_the_as_of_date_is_echoed(self):
        assert evaluate().json()["as_of"] == "2026-06-01"

    def test_the_evaluator_version_is_reported(self):
        # A stored verdict records this, so "why did this answer change?" is answerable.
        assert evaluate().json()["evaluator_version"] == EVALUATOR_VERSION

    def test_each_requirement_carries_its_authority_and_source(self):
        for requirement in evaluate().json()["requirements"]:
            assert requirement["authority"]
            assert requirement["source_url"]


class TestStateless:
    def test_the_same_body_produces_the_same_response(self):
        # Nothing is read from a clock or a store, so determinism is observable from outside.
        first = evaluate().json()
        second = evaluate().json()
        assert first == second


class TestHealth:
    def test_live(self):
        assert client.get("/health/live").json()["status"] == "ok"

    def test_ready_says_it_has_no_dependencies(self):
        # Honest rather than a check that checks nothing and implies it checked something.
        body = client.get("/health/ready").json()
        assert body["status"] == "ok"
        assert body["dependencies"] == "none"
