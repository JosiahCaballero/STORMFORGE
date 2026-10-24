import json
import logging

import httpx
import pytest

from app.gemma import GemmaClient, GemmaError, extract_json

KEY = "AIzaSyFAKEKEYFAKEKEYFAKEKEYFAKEKEY12345"


def ok_body(text):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def client(handler, **kw):
    return GemmaClient(api_key=KEY, model="gemma-test", transport=httpx.MockTransport(handler),
                       sleep=lambda s: None, **kw)


def test_success_header_not_url():
    seen = {}

    def h(req):
        seen["url"], seen["hdr"] = str(req.url), req.headers
        return httpx.Response(200, json=ok_body("hi"))

    r = client(h).generate("p")
    assert r.text == "hi" and r.model == "gemma-test"
    assert KEY not in seen["url"] and seen["hdr"]["x-goog-api-key"] == KEY
    assert "gemma-test:generateContent" in seen["url"]


def test_skips_thought_parts():
    def h(req):
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "x", "thought": True}, {"text": "ok"}]}}]})

    assert client(h).generate("p").text == "ok"


def test_no_key():
    c = GemmaClient(api_key="", model="m")
    # api_key "" falls to explicit empty -> not configured
    assert not c.configured
    with pytest.raises(GemmaError) as e:
        c.generate("x")
    assert e.value.kind == "no_api_key"


@pytest.mark.parametrize("status,kind", [(429, "provider_error"), (500, "provider_error"), (400, "provider_error")])
def test_http_errors_and_retry_count(status, kind):
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(status, json={"error": {"message": f"bad key {KEY}"}})

    with pytest.raises(GemmaError) as e:
        client(h).generate("p")
    assert e.value.kind == kind and KEY not in str(e.value)
    assert len(calls) == (1 if status == 400 else 2)


def test_retry_then_success():
    n = {"i": 0}

    def h(req):
        n["i"] += 1
        return httpx.Response(429) if n["i"] == 1 else httpx.Response(200, json=ok_body("fine"))

    r = client(h).generate("p")
    assert r.text == "fine" and r.attempts == 2


def test_timeout():
    def h(req):
        raise httpx.ReadTimeout("slow", request=req)

    with pytest.raises(GemmaError) as e:
        client(h).generate("p")
    assert e.value.kind == "timeout"


def test_transport_error_redacted():
    def h(req):
        raise httpx.ConnectError(f"boom {KEY}", request=req)

    with pytest.raises(GemmaError) as e:
        client(h).generate("p")
    assert e.value.kind == "provider_error" and KEY not in str(e.value)


def test_oversize_and_bad_payload():
    with pytest.raises(GemmaError) as e:
        client(lambda r: httpx.Response(200, content=b"x" * (300 * 1024))).generate("p")
    assert e.value.kind == "bad_response"
    with pytest.raises(GemmaError) as e:
        client(lambda r: httpx.Response(200, json={"candidates": []})).generate("p")
    assert e.value.kind == "bad_response"


def test_list_models_filters_gemma():
    def h(req):
        assert req.headers["x-goog-api-key"] == KEY and KEY not in str(req.url)
        return httpx.Response(200, json={"models": [
            {"name": "models/gemma-4-31b-it", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-x", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemma-embed", "supportedGenerationMethods": ["embedContent"]}]})

    assert [m["name"] for m in client(h).list_models()] == ["gemma-4-31b-it"]


def test_extract_json_variants():
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Sure! Here:\n{"a": {"b": 2}} thanks') == {"a": {"b": 2}}
    with pytest.raises(ValueError):
        extract_json("no json here")
    with pytest.raises(ValueError):
        extract_json("{broken")


def test_key_not_logged(caplog):
    caplog.set_level(logging.DEBUG)

    def h(req):
        return httpx.Response(500, text=KEY)

    with pytest.raises(GemmaError):
        client(h).generate("p")
    assert KEY not in caplog.text
