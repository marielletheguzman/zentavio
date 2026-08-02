"""The gap's HTTP contract.

The arithmetic is tested in `test_compute.py`. What matters here is the boundary: which outcomes are
200, which are 4xx, and whether the response still carries the provenance a caller needs to
reproduce it.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from skill_gap.main import app

client = TestClient(app)

REQUEST = {
    "target_id": "cloud-platform-engineer",
    "target_kind": "career",
    "requirements": [
        {"skill_id": "kubernetes", "weight": 0.95, "cluster": "core"},
        {"skill_id": "containers", "weight": 0.92, "cluster": "core"},
    ],
    "held": [{"skill_id": "docker", "status": "evidenced"}],
    "edges": [
        {
            "from_skill_id": "kubernetes",
            "to_skill_id": "containers",
            "edge_type": "requires",
            "weight": 0.9,
        }
    ],
    "knowledge_as_of": "2026-08-03T00:00:00Z",
}


def test_a_gap_is_returned_in_dependency_order() -> None:
    response = client.post("/gap", json=REQUEST)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert [item["skill_id"] for item in body["items"]] == ["containers", "kubernetes"]
    assert body["items"][1]["prerequisites"] == ["containers"]


def test_an_unmodelled_target_is_200_and_unknown_rather_than_an_error() -> None:
    # A résumé we could not read is not an HTTP error, and neither is a track nobody has modelled.
    # Reserving 4xx for "the caller sent something wrong" keeps the two distinguishable.
    response = client.post("/gap", json={**REQUEST, "requirements": []})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unknown"
    assert body["items"] == []
    assert body["reason"]


def test_every_response_records_the_scorer_and_the_knowledge_date() -> None:
    # A gap whose scorer is unknown cannot be reproduced or re-examined after a bug.
    body = client.post("/gap", json=REQUEST).json()
    assert body["scorer_version"].startswith("skill-gap/")
    assert body["knowledge_as_of"] == "2026-08-03T00:00:00Z"


def test_confidence_is_always_present() -> None:
    # Stated, never implied. A caller must not have to infer it from the shape of the list.
    body = client.post("/gap", json=REQUEST).json()
    assert body["confidence"] in {"high", "medium", "low"}


def test_a_malformed_request_is_a_4xx() -> None:
    response = client.post("/gap", json={"target_id": "x", "target_kind": "posting"})
    assert response.status_code == 422


def test_a_weight_outside_the_range_is_refused_at_the_boundary() -> None:
    response = client.post(
        "/gap",
        json={
            **REQUEST,
            "requirements": [{"skill_id": "kubernetes", "weight": 1.5, "cluster": "core"}],
        },
    )
    assert response.status_code == 422


def test_the_same_request_produces_the_same_response() -> None:
    # Determinism observable from outside the process, which is the form the caller depends on.
    first = client.post("/gap", json=REQUEST).json()
    for _ in range(5):
        assert client.post("/gap", json=REQUEST).json() == first


def test_readiness_claims_nothing_it_does_not_use() -> None:
    body = client.get("/health/ready").json()
    assert body["status"] == "ready"
