"""Real-key smoke test: lists Gemma models and makes one call. Never prints the key.

Run from backend/:  python scripts/gemma_smoke.py
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.gemma import GemmaClient, GemmaError, extract_json  # noqa: E402


def main() -> int:
    c = GemmaClient()
    if not c.configured:
        print("No GEMMA_API_KEY/GOOGLE_API_KEY set (backend/.env or environment). Nothing to test.")
        return 2
    try:
        models = c.list_models()
        print(f"Gemma models supporting generateContent ({len(models)}):")
        for m in models:
            print(f"  - {m['name']}")
        listed = any(m["name"] == c.model for m in models)
        print(f"Configured model: {c.model} ({'listed' if listed else 'NOT in list - set GEMMA_MODEL'})")
        t = time.monotonic()
        r = c.generate('Reply with ONLY this JSON, no prose, no markdown: {"ok": true, "word": "ping"}')
        print(f"Call OK model={r.model} latency={int((time.monotonic() - t) * 1000)}ms attempts={r.attempts}")
        try:
            print("Parsed JSON:", extract_json(r.text))
        except ValueError:
            print("Output was not parseable JSON (first 200 chars):", r.text[:200])
        return 0
    except GemmaError as e:
        print(f"FAILED kind={e.kind}: {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
