"""The parser's HTTP contract.

Two properties matter more than the happy path, and both are about what must *not* happen:

* **A parse outcome is not an HTTP error.** A résumé we could not read returns 200 with
  ``status: "unknown"``, because it is a result the user must be shown. 4xx is reserved for "the
  caller sent something wrong", and conflating the two makes them indistinguishable to the gateway.
* **Document content never leaves in an error.** A traceback carrying a fragment of someone's CV is
  the most likely way this service leaks, so there is a test that puts identifiable text in a
  deliberately broken request and asserts it appears nowhere in the response.
"""

from __future__ import annotations

import base64

from extract import DOCX_CONTENT_TYPE, PDF_CONTENT_TYPE, PLAIN_TEXT_CONTENT_TYPE
from fastapi.testclient import TestClient
from fixtures import docx_with, not_a_document, pdf_image_only, pdf_with_text
from main import MAX_DOCUMENT_BYTES, PARSER_VERSION, app

client = TestClient(app)

CLOSED_SET = [
    {
        "slug": "kubernetes",
        "name": "Kubernetes",
        "kind": "technology",
        "aliases": ["kubernetes", "k8s"],
    },
    {"slug": "terraform", "name": "Terraform", "kind": "tool", "aliases": ["terraform", "tf"]},
    {"slug": "go", "name": "Go", "kind": "technology", "aliases": ["go", "golang"]},
]


def post(content: bytes, content_type: str = PLAIN_TEXT_CONTENT_TYPE, skills=CLOSED_SET):  # type: ignore[no-untyped-def]
    return client.post(
        "/parse",
        json={
            "document_base64": base64.b64encode(content).decode(),
            "content_type": content_type,
            "skills": skills,
        },
    )


class TestParse:
    def test_a_plain_text_resume_becomes_a_profile(self) -> None:
        response = post(b"Skills\nKubernetes, Terraform\n\nExperience\nRan Go in production")
        assert response.status_code == 200
        body = response.json()

        assert body["status"] == "ok"
        assert body["parser_version"] == PARSER_VERSION
        by_slug = {s["slug"]: s for s in body["skills"]}
        assert by_slug["kubernetes"]["status"] == "claimed"
        assert by_slug["go"]["status"] == "evidenced"
        assert by_slug["go"]["source_span"] == "Ran Go in production"

    def test_a_pdf_is_accepted(self) -> None:
        response = post(pdf_with_text(["Experience", "Ran Terraform"]), PDF_CONTENT_TYPE)
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_a_docx_is_accepted(self) -> None:
        response = post(docx_with(["Skills", "Kubernetes"]), DOCX_CONTENT_TYPE)
        assert response.status_code == 200
        assert {s["slug"] for s in response.json()["skills"]} == {"kubernetes"}

    def test_an_unreadable_document_is_200_unknown_not_an_http_error(self) -> None:
        # The distinction the whole contract rests on: this is a result, not a failure.
        response = post(pdf_image_only(), PDF_CONTENT_TYPE)
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "unknown"
        assert body["skills"] == []
        assert "scan" in body["reason"]

    def test_a_corrupt_document_is_also_a_result(self) -> None:
        response = post(not_a_document(), PDF_CONTENT_TYPE)
        assert response.status_code == 200
        assert response.json()["status"] == "unknown"

    def test_only_slugs_from_the_supplied_closed_set_come_back(self) -> None:
        # The service may never invent an id. Rust is in the document and not in the set.
        response = post(b"Skills\nRust, Kubernetes")
        assert {s["slug"] for s in response.json()["skills"]} == {"kubernetes"}

    def test_the_closed_set_is_per_request(self) -> None:
        # Stateless: nothing is remembered between calls, so a narrower set yields a
        # narrower result.
        narrow = [CLOSED_SET[0]]
        response = post(b"Skills\nKubernetes, Terraform", skills=narrow)
        assert {s["slug"] for s in response.json()["skills"]} == {"kubernetes"}


class TestValidation:
    def test_an_unsupported_content_type_is_400_with_the_shared_envelope(self) -> None:
        response = post(b"anything", "application/x-msdownload")
        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "VALIDATION_FAILED"
        assert error["retryable"] is False
        assert error["correlationId"]

    def test_undecodable_base64_is_rejected(self) -> None:
        response = client.post(
            "/parse",
            json={
                "document_base64": "!!!not base64!!!",
                "content_type": PLAIN_TEXT_CONTENT_TYPE,
                "skills": CLOSED_SET,
            },
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "VALIDATION_FAILED"

    def test_an_oversized_document_is_rejected(self) -> None:
        response = post(b"x" * (MAX_DOCUMENT_BYTES + 1))
        assert response.status_code == 400
        assert "MB" in response.json()["error"]["message"]

    def test_an_empty_closed_set_is_rejected_rather_than_matching_nothing(self) -> None:
        # Silently returning zero skills for an empty set would look like a résumé problem.
        response = client.post(
            "/parse",
            json={
                "document_base64": base64.b64encode(b"Skills\nGo").decode(),
                "content_type": PLAIN_TEXT_CONTENT_TYPE,
                "skills": [],
            },
        )
        assert response.status_code == 422


class TestPrivacy:
    def test_document_content_never_appears_in_an_error_response(self) -> None:
        # The single most likely leak: a parser exception carrying a fragment of the CV.
        secret = b"Ada Lovelace, ada@example.invalid, Kubernetes"
        response = post(secret, "application/x-msdownload")

        assert response.status_code == 400
        assert "Ada" not in response.text
        assert "ada@example.invalid" not in response.text

    def test_the_response_carries_no_echo_of_the_document_beyond_matched_spans(self) -> None:
        # Source spans are deliberate — they are what makes a claim correctable. Nothing *else*
        # from the document should come back.
        response = post(b"Skills\nKubernetes\n\nPersonal\nHome address: 12 Somewhere Lane")
        assert response.status_code == 200
        assert "Somewhere Lane" not in response.text


class TestHealth:
    def test_live(self) -> None:
        assert client.get("/health/live").json()["status"] == "live"

    def test_ready_claims_nothing_it_does_not_check(self) -> None:
        # This service has no external dependency, so readiness really is "the code imported".
        body = client.get("/health/ready").json()
        assert body["status"] == "ready"
        assert body["version"] == PARSER_VERSION
