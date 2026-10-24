"""Google Gemma provider adapter (Generative Language / AI Studio REST API, plain httpx).

Backend only. The key is read from env GEMMA_API_KEY (fallback GOOGLE_API_KEY), sent ONLY in the
`x-goog-api-key` header, never put in a URL, logged, or returned. Gemma is driven with everything in
the user turn (no systemInstruction, no JSON response mode); callers must parse and validate the text
defensively (see `extract_json`).
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import httpx

log = logging.getLogger("stormforge.gemma")

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemma-4-26b-a4b-it"  # measured ~5 s ping vs ~36 s for 31b (docs/GEMMA.md); override with GEMMA_MODEL
# Gemma 4 is a thinking model: at default settings it spent the whole 4096-token output budget on reasoning and
# returned no answer (finishReason MAX_TOKENS, ~87 s). thinkingLevel "minimal" gave a valid answer in ~10 s.
DEFAULT_THINKING_LEVEL = "minimal"  # override with GEMMA_THINKING_LEVEL; empty string disables the setting
MAX_RESPONSE_BYTES = 256 * 1024

_ENV_LOADED = False


def load_env() -> None:
    """Load backend/.env once if present (values are never printed)."""
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    _ENV_LOADED = True
    try:
        from dotenv import load_dotenv

        load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
    except Exception:  # dotenv missing/unreadable: plain env vars still work
        pass


def get_api_key() -> str | None:
    load_env()
    for name in ("GEMMA_API_KEY", "GOOGLE_API_KEY"):
        v = (os.environ.get(name) or "").strip()
        if v:
            return v
    return None


def get_model() -> str:
    load_env()
    return (os.environ.get("GEMMA_MODEL") or "").strip() or DEFAULT_MODEL


class GemmaError(Exception):
    """kind: no_api_key | timeout | provider_error | bad_response"""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


def redact(text: str, key: str | None) -> str:
    text = str(text)
    if key:
        text = text.replace(key, "[REDACTED]")
    return re.sub(r"AIza[0-9A-Za-z_\-]{20,}", "[REDACTED]", text)


@dataclass
class GemmaResult:
    text: str
    model: str
    latency_ms: int
    attempts: int


class GemmaClient:
    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        *,
        timeout_s: float | None = None,
        max_retries: int = 1,
        total_budget_s: float = 45.0,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        base_url: str = BASE_URL,
    ):
        load_env()
        self._key = api_key if api_key is not None else get_api_key()
        self.model = model or get_model()
        self.timeout_s = timeout_s if timeout_s is not None else float(os.environ.get("GEMMA_TIMEOUT_S") or 25)
        self.max_retries = max_retries
        self.total_budget_s = total_budget_s
        self._transport = transport
        self._sleep = sleep
        self.base_url = base_url

    @property
    def configured(self) -> bool:
        return bool(self._key)

    def _client(self) -> httpx.Client:
        return httpx.Client(transport=self._transport, timeout=self.timeout_s)

    def _headers(self) -> dict[str, str]:
        return {"x-goog-api-key": self._key or "", "content-type": "application/json"}

    @staticmethod
    def _read_capped(resp: httpx.Response) -> bytes:
        buf = bytearray()
        for chunk in resp.iter_bytes():
            buf.extend(chunk)
            if len(buf) > MAX_RESPONSE_BYTES:
                raise GemmaError("bad_response", "provider response exceeded size limit")
        return bytes(buf)

    def generate(self, prompt: str, *, temperature: float = 0.2, max_output_tokens: int = 4096) -> GemmaResult:
        if not self._key:
            raise GemmaError("no_api_key", "no GEMMA_API_KEY / GOOGLE_API_KEY configured")
        url = f"{self.base_url}/models/{self.model}:generateContent"
        gen_cfg: dict[str, Any] = {"temperature": temperature, "maxOutputTokens": max_output_tokens}
        level = os.environ.get("GEMMA_THINKING_LEVEL", DEFAULT_THINKING_LEVEL).strip()
        if level:
            gen_cfg["thinkingConfig"] = {"thinkingLevel": level}
        body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": gen_cfg}
        start = time.monotonic()
        last: GemmaError | None = None
        attempts = 0
        for attempt in range(self.max_retries + 1):
            if time.monotonic() - start > self.total_budget_s:
                break
            attempts += 1
            try:
                with self._client() as c, c.stream("POST", url, headers=self._headers(), json=body) as resp:
                    status = resp.status_code
                    raw = self._read_capped(resp)
                if status == 200:
                    return GemmaResult(self._extract_text(raw), self.model, int((time.monotonic() - start) * 1000), attempts)
                last = GemmaError("provider_error", f"provider HTTP {status}")
                if status not in (429, 500, 502, 503, 504):
                    break
            except GemmaError as e:
                last = e
                if e.kind == "bad_response":
                    break
            except httpx.TimeoutException:
                last = GemmaError("timeout", "provider request timed out")
            except httpx.HTTPError as e:
                last = GemmaError("provider_error", redact(f"provider transport error: {type(e).__name__}", self._key))
            if attempt < self.max_retries:
                self._sleep(min(2.0 * (attempt + 1), 4.0))
        err = last or GemmaError("timeout", "provider time budget exhausted")
        log.warning("gemma call failed kind=%s msg=%s", err.kind, redact(str(err), self._key))
        raise err

    @staticmethod
    def _extract_text(raw: bytes) -> str:
        try:
            data = json.loads(raw)
            parts = data["candidates"][0]["content"]["parts"]
        except Exception as e:
            raise GemmaError("bad_response", f"unexpected provider payload ({type(e).__name__})") from None
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
        if not text.strip():
            raise GemmaError("bad_response", "provider returned no text")
        return text

    def list_models(self) -> list[dict[str, Any]]:
        """Gemma models that support generateContent for this key."""
        if not self._key:
            raise GemmaError("no_api_key", "no GEMMA_API_KEY / GOOGLE_API_KEY configured")
        out: list[dict[str, Any]] = []
        token = None
        try:
            with self._client() as c:
                for _ in range(10):
                    params: dict[str, Any] = {"pageSize": 200}
                    if token:
                        params["pageToken"] = token
                    r = c.get(f"{self.base_url}/models", headers=self._headers(), params=params)
                    if r.status_code != 200:
                        raise GemmaError("provider_error", f"provider HTTP {r.status_code}")
                    if len(r.content) > MAX_RESPONSE_BYTES * 4:
                        raise GemmaError("bad_response", "model list too large")
                    d = r.json()
                    for m in d.get("models", []):
                        if "gemma" in m.get("name", "").lower() and "generateContent" in m.get("supportedGenerationMethods", []):
                            out.append({"name": m["name"].removeprefix("models/"), "displayName": m.get("displayName"),
                                        "inputTokenLimit": m.get("inputTokenLimit"), "outputTokenLimit": m.get("outputTokenLimit")})
                    token = d.get("nextPageToken")
                    if not token:
                        break
        except httpx.TimeoutException:
            raise GemmaError("timeout", "provider request timed out") from None
        except httpx.HTTPError as e:
            raise GemmaError("provider_error", redact(f"transport error {type(e).__name__}", self._key)) from None
        return out


_FENCE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.S)


def extract_json(text: str) -> Any:
    """Parse a JSON object from model text, tolerating markdown fences and surrounding prose."""
    candidates = [m.group(1) for m in _FENCE.finditer(text)] + [text]
    dec = json.JSONDecoder()
    for cand in candidates:
        i = cand.find("{")
        while i != -1:
            try:
                obj, _ = dec.raw_decode(cand[i:])
                if isinstance(obj, dict):
                    return obj
            except ValueError:
                pass
            i = cand.find("{", i + 1)
    raise ValueError("no JSON object found in model output")
