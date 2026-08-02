"""The Ollama adapter and the prompt loader — the only module here that talks to a model.

**The only place an HTTP client is imported in this service.** Everything upstream depends on the
``ModelClient`` port (ADR-0003), so swapping Ollama for a hosted provider is this file.

Stdlib ``urllib`` rather than ``httpx``: the parser's runtime dependency list is deliberately short
(ADR-0016 keeps it to the two document libraries), and one POST to a local host does not justify
adding a third. ``ai/shared/evals/model.py`` made the same call for the same reason.

Prompts are loaded from files and never inlined (``docs/prompts/conventions.md``), and the version
loaded is reported on the response, because a claim produced by an unknown prompt version cannot be
reproduced.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
DEFAULT_MODEL = os.environ.get("ZENTAVIO_PARSER_MODEL", "qwen2.5:14b-instruct")

#: Measured, not guessed. On qwen2.5:14b-instruct the quarantine prompt takes ~29s for a short
#: résumé and recall ~15-19s, so an earlier 30s ceiling sat exactly on the boundary: quarantine
#: timed out roughly every other request and the response degraded to `partial` with no injection
#: screening, which looks like a model quality problem and is not one. The headroom is for a longer
#: document rather than for a slower model — a model this size on a colder machine needs its own
#: measurement.
TIMEOUT_SECONDS = 120
PROBE_TIMEOUT_SECONDS = 2
HTTP_OK = 200

PROMPT_DIR = Path(__file__).resolve().parents[1] / "prompts"

_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")


class PromptNotFoundError(RuntimeError):
    """A prompt file named in code is missing from disk.

    Raised loudly at load time rather than degrading, because this is a packaging error — the code
    and its prompts shipped out of step — not a runtime condition anyone can act on.
    """


def load_prompt(base_name: str) -> tuple[str, str]:
    """Return ``(template, promptVersion)`` for the newest version of a prompt.

    ``promptVersion`` is the filename stem (``docs/prompts/conventions.md``). Old versions stay on
    disk so a recorded output remains explicable, and the newest is current — the same rule
    ``ai/shared/evals/cases.py`` applies when pairing a prompt with its fixtures.
    """
    versions = sorted(PROMPT_DIR.glob(f"{base_name}-*.md"))
    if not versions:
        raise PromptNotFoundError(f"no prompt file matching {base_name}-<date>.md in {PROMPT_DIR}")
    newest = versions[-1]
    return newest.read_text(encoding="utf-8"), newest.stem


def render(template: str, variables: dict[str, object]) -> str:
    """Substitute ``{{ name }}`` placeholders.

    An unsubstituted placeholder raises. A prompt rendered with a missing closed set would quietly
    ask the model to answer without the knowledge it is supposed to be grounded in, which is the
    failure the retrieval-first rule exists to prevent.
    """
    out = template
    for key, value in variables.items():
        rendered = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        out = out.replace(f"{{{{ {key} }}}}", rendered).replace(f"{{{{{key}}}}}", rendered)

    leftover = _PLACEHOLDER.search(out)
    if leftover:
        raise ValueError(f"unsubstituted placeholder: {leftover.group(0)}")
    return out


class OllamaClient:
    """Implements ``ModelClient`` against an Ollama host.

    Every failure — connection refused, timeout, non-JSON body — returns ``None``. The caller
    treats that as "no enrichment", which is a supported outcome rather than an error, so a model
    outage degrades the response instead of failing the upload.
    """

    def __init__(self, host: str = DEFAULT_HOST, name: str = DEFAULT_MODEL) -> None:
        self.host = host.rstrip("/")
        self.name = name

    def available(self) -> bool:
        try:
            # S310: the URL is built from configuration this service controls, never from a
            # request. A résumé cannot influence where this connects.
            with urllib.request.urlopen(  # noqa: S310
                f"{self.host}/api/tags", timeout=PROBE_TIMEOUT_SECONDS
            ) as response:
                return bool(response.status == HTTP_OK)
        except (urllib.error.URLError, OSError, TimeoutError):
            return False

    def complete(self, prompt: str) -> dict | None:
        body = json.dumps(
            {
                "model": self.name,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                # Extraction has one right answer, so temperature 0 and a fixed seed. Note that
                # this makes runs *repeatable*, not *identical*: the same prompt has been observed
                # to move by a case between runs (ADR-0018), which is why nothing downstream
                # treats a single model answer as authoritative.
                "options": {"temperature": 0, "seed": 0},
            }
        ).encode()

        request = urllib.request.Request(  # noqa: S310
            f"{self.host}/api/generate",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
                payload = json.loads(response.read())
        except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError):
            return None

        try:
            parsed = json.loads(payload.get("response", ""))
        except (json.JSONDecodeError, TypeError):
            # Schema adherence is a gate, never something to salvage with a regex
            # (docs/prompts/conventions.md).
            return None

        return parsed if isinstance(parsed, dict) else None
