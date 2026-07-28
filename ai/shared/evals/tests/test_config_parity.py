"""Cross-language configuration parity.

ADR-0003 accepted a real cost: the TypeScript and Python halves describe the same configuration
and can drift. `packages/config` is the source of truth; `ai/shared/evals/model.py` duplicates two
defaults because it is stdlib-only and cannot import from the TypeScript side.

If they drift, a graded eval runs against a different model than the one configured and the delta
report compares two different things while looking correct. ADR-0003's proper fix is generation
from a shared schema; until that exists, this test is the mechanism — it parses the TypeScript and
compares, so the claim is checked rather than asserted.
"""

from __future__ import annotations

import re
from pathlib import Path

import model

CONFIG_TS = Path(__file__).resolve().parents[4] / "packages/config/src/zentavio.ts"


def ts_default(env_name: str) -> str:
    """Read one default out of the TypeScript schema.

    A regex over source is crude. It is also the only option without adding a build step to the
    Python side, and it fails loudly rather than silently when the shape changes.
    """
    source = CONFIG_TS.read_text(encoding="utf-8")
    match = re.search(
        rf"env: '{re.escape(env_name)}',.*?default: '([^']+)'",
        source,
        re.DOTALL,
    )
    assert match, (
        f"{env_name} not found in {CONFIG_TS.name}, or its shape changed. "
        "If the schema was restructured, update this parser — do not delete the check."
    )
    return match.group(1)


def test_config_source_of_truth_exists():
    assert CONFIG_TS.is_file(), f"expected the config schema at {CONFIG_TS}"


def test_ollama_host_default_matches_typescript():
    assert ts_default("OLLAMA_HOST") == model.DEFAULT_HOST


def test_eval_model_default_matches_typescript():
    # The one that matters most: a mismatch means graded evals silently use another model.
    assert ts_default("ZENTAVIO_EVAL_MODEL") == model.DEFAULT_MODEL
