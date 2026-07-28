"""Minimal Ollama client for the eval runner.

Stdlib only, deliberately: the eval runner must be installable with nothing but Python, so
it cannot become a reason to rush the uv workspace (ADR-0006). When ai/ services exist they
will use the real shared client; this one exists to grade prompts, not to serve traffic.

If no model host is reachable, `Model.available` is False and the runner reports every case
as skipped rather than failing. That is what lets CI run the offline checks on a runner with
no Ollama.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

DEFAULT_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
DEFAULT_MODEL = os.environ.get("ZENTAVIO_EVAL_MODEL", "qwen2.5:7b-instruct")
TIMEOUT_SECONDS = 120
HTTP_OK = 200


class Model:
    def __init__(self, host: str = DEFAULT_HOST, name: str = DEFAULT_MODEL) -> None:
        self.host = host.rstrip("/")
        self.name = name
        self.available = self._probe()

    def _probe(self) -> bool:
        try:
            with urllib.request.urlopen(f"{self.host}/api/tags", timeout=5) as resp:  # noqa: S310
                return resp.status == HTTP_OK
        except (urllib.error.URLError, OSError, TimeoutError):
            return False

    def complete(self, prompt: str) -> tuple[dict | None, str | None]:
        """Return (parsed_json, error). Temperature 0: extraction has one right answer."""
        body = json.dumps(
            {
                "model": self.name,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {"temperature": 0, "seed": 0},
            }
        ).encode()

        request = urllib.request.Request(  # noqa: S310
            f"{self.host}/api/generate",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            # S310: the URL is built from configuration we control, never user input.
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310
                payload = json.loads(resp.read())
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            return None, f"model call failed: {exc}"

        text = payload.get("response", "")
        try:
            return json.loads(text), None
        except json.JSONDecodeError as exc:
            # Schema adherence is a gate. A response that does not parse is a failure,
            # never something to salvage with a regex.
            return None, f"response was not valid JSON: {exc}"


def render(template: str, variables: dict) -> str:
    """Substitute {{ name }} placeholders. Missing variables are an error, not a blank:
    a prompt rendered with an empty knowledge block would silently test ungrounded behavior."""
    out = template
    for key, value in variables.items():
        rendered = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        out = out.replace(f"{{{{ {key} }}}}", rendered).replace(f"{{{{{key}}}}}", rendered)

    if "{{" in out:
        start = out.index("{{")
        raise ValueError(f"unsubstituted placeholder near: {out[start : start + 40]!r}")
    return out
