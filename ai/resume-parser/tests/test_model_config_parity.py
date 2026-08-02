"""Cross-language configuration parity for the parser's model client.

Same mechanism and same reason as `ai/shared/evals/tests/test_config_parity.py`: `packages/config`
is the source of truth, and the Python side repeats the defaults because it cannot import the
TypeScript schema (ADR-0003's accepted cost).

Drift here is worse than in the eval runner. A parser pointed at a different model than the one
configured produces profiles whose recorded `model` field is a lie, and the response would still
look perfectly well formed.
"""

from __future__ import annotations

import re
from pathlib import Path

import model_client

CONFIG_TS = Path(__file__).resolve().parents[3] / "packages/config/src/zentavio.ts"


def ts_default(env_name: str) -> str:
    source = CONFIG_TS.read_text(encoding="utf-8")
    match = re.search(
        rf"env: '{re.escape(env_name)}',.*?default: '([^']+)'",
        source,
        re.DOTALL,
    )
    assert match, (
        f"{env_name} not found in {CONFIG_TS.name}, or its shape changed. "
        "If the schema was restructured, update this parser - do not delete the check."
    )
    return match.group(1)


def test_config_source_of_truth_exists() -> None:
    assert CONFIG_TS.is_file(), f"expected the config schema at {CONFIG_TS}"


def test_parser_model_default_matches_typescript() -> None:
    assert ts_default("ZENTAVIO_PARSER_MODEL") == model_client.DEFAULT_MODEL


def test_ollama_host_default_matches_typescript() -> None:
    assert ts_default("OLLAMA_HOST") == model_client.DEFAULT_HOST


def test_enrichment_defaults_to_on() -> None:
    # The default matters: a deployment that forgets this variable should get enrichment, not
    # silently skip injection screening.
    assert ts_default("ZENTAVIO_PARSER_ENRICHMENT") == "on"
