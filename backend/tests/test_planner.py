import copy
import json
import logging

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import api_plan, planner
from app.gemma import GemmaClient
from app.planner import FALLBACK_LABEL, Sim

KEY = "AIzaSyFAKEKEYFAKEKEYFAKEKEYFAKEKEY12345"

COVER = {"c_a": {1, 2, 3, 4, 5}, "c_b": {4, 5, 6}, "c_c": {7}, "c_d": {1, 2}}
NAMES = {"c_a": "Alpha Staging Point", "c_b": "Bravo Staging Point", "c_c": "Charlie Staging Point", "c_d": "Delta Staging Point"}
BASE_NODES = 100


def fake_candidates():
    return [{"id": i, "name": NAMES[i], "zone_id": "z1", "kind": "hypothetical_staging", "lon": -81.31, "lat": 29.89,
             "provenance": "hypothetical"} for i in sorted(COVER)]


def metrics(extra):
    return {"nodes_total": 1820, "nodes_with_hospital_route": BASE_NODES, "nodes_with_staging_route": extra,
            "nodes_with_any_care_route": BASE_NODES + extra, "origins_total": 102, "origins_with_hospital_route": 5,
            "origins_with_staging_route": extra // 2, "origins_with_any_care_route": 5 + extra // 2, "provenance": "simulated"}


def fake_eval(cat, ids):
    ids = list(dict.fromkeys(ids))
    s = set().union(*[COVER[i] for i in ids]) if ids else set()
    b, i = metrics(0), metrics(len(s))
    return {"category": cat, "candidate_ids": ids, "baseline": b, "intervention": i,
            "delta": {k: i[k] - b[k] for k in b if k != "provenance"}, "provenance": "simulated"}


def fake_report(cat, ids):
    f = lambda a: {"agent": a, "headline": f"{a} headline", "limitations": ["Provisional graph."],  # noqa: E731
                   "findings": [{"id": f"{a}.f1", "text": f"{a} sees 1820 nodes in the graph", "value": 1820, "unit": "nodes",
                                 "provenance": "simulated"}]}
    return {"category": cat, **{a: f(a) for a in planner.AGENTS}}


def sim():
    return Sim(fake_candidates, fake_eval, fake_report)


GOOD = {
    "summary": "Activate Alpha Staging Point and Bravo Staging Point first because they widen modeled care access.",
    "ranked": [{"candidate_id": "c_a", "rank": 1, "rationale": "Largest standalone gain in the evaluator output."},
               {"candidate_id": "c_b", "rank": 2, "rationale": "Adds reach beyond the first site."}],
    "recommended_ids": ["c_a", "c_b"],
    "tradeoffs": ["Uses 2 of the sites; remaining sites stay unused."],
    "agent_citations": [{"agent": "medical", "finding_id": "medical.f1"}],
    "limitations_ack": "Hypothetical sites on a provisional graph; simulated, not for real decisions.",
}


def mk(text_or_list, log=None):
    """Mock Gemma client returning queued texts (str) or status codes (int) / exceptions."""
    q = list(text_or_list) if isinstance(text_or_list, list) else [text_or_list]
    calls = []

    def h(req):
        calls.append(json.loads(req.content))
        item = q.pop(0) if len(q) > 1 else q[0]
        if isinstance(item, int):
            return httpx.Response(item, json={"error": "x"})
        if isinstance(item, Exception):
            raise item
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": item}]}}]})

    c = GemmaClient(api_key=KEY, model="gemma-test", transport=httpx.MockTransport(h), sleep=lambda s: None)
    c.calls = calls
    return c


def mutate(**kw):
    d = copy.deepcopy(GOOD)
    d.update(kw)
    return json.dumps(d)


@pytest.fixture(autouse=True)
def _clear():
    planner.clear_cache()
    api_plan._last_call = 0.0
    yield


def run(client, cat=3, n=2):
    return planner.generate_plan(cat, n, client=client, sim=sim(), use_cache=False)


def test_valid_response_uses_evaluator_metrics():
    out = run(mk(json.dumps(GOOD)))
    assert out["source"] == "gemma" and out["source_label"] == "Real Gemma response (model gemma-test)"
    assert out["fallback_reason"] is None and out["validation"]["ok"]
    assert out["verified"]["evaluate"] == fake_eval(3, ["c_a", "c_b"])
    assert out["verified"]["evaluate"]["delta"]["nodes_with_any_care_route"] == 6


def test_model_metrics_field_rejected_and_never_used():
    bad = copy.deepcopy(GOOD)
    bad["metrics"] = {"nodes_with_any_care_route": 9999}
    out = run(mk(json.dumps(bad)))
    assert out["source"] == "deterministic_fallback" and out["fallback_reason"] == "invalid_output"
    assert "9999" not in json.dumps(out["verified"])


def test_markdown_fenced_json_ok():
    assert run(mk("Here you go:\n```json\n" + json.dumps(GOOD) + "\n```"))["source"] == "gemma"


def test_malformed_json_repair_then_success():
    c = mk(["{not json", json.dumps(GOOD)])
    out = run(c)
    assert out["source"] == "gemma" and len(c.calls) == 2
    assert "repair_retry_succeeded" in out["validation"]["repairs"]
    assert "VALIDATION_FEEDBACK" in c.calls[1]["contents"][0]["parts"][0]["text"]
    assert out["validation"]["rejected"][0]["reason"] == "malformed_json"


def test_persistent_malformed_falls_back():
    c = mk("{not json")
    out = run(c)
    assert len(c.calls) == 2 and out["source"] == "deterministic_fallback" and out["fallback_reason"] == "invalid_output"
    assert out["source_label"] == FALLBACK_LABEL and out["model"] is None


@pytest.mark.parametrize("mut,reason", [
    ({"recommended_ids": ["c_a", "c_zzz"]}, "unknown_candidate_id"),
    ({"recommended_ids": ["c_a", "c_a"]}, "duplicate_candidate_id"),
    ({"recommended_ids": ["c_a", "c_b", "c_c"]}, "too_many_recommended"),
    ({"agent_citations": [{"agent": "medical", "finding_id": "nope"}]}, "unknown_finding_id"),
    ({"summary": "This adds 4242 nodes of access."}, "number_not_in_evidence"),
    ({"summary": "Improves access by 37% overall."}, "number_not_in_evidence"),
    ({"summary": "Place it at 29.89123, -81.31456."}, "coordinates_not_allowed"),
    ({"summary": "Send patients to Flagler Hospital instead."}, "unknown_facility_name"),
    ({"summary": "Use Memorial Medical Center."}, "unknown_facility_name"),
    ({"limitations_ack": ""}, "missing_limitations_ack"),
])
def test_validation_rejections(mut, reason):
    v = planner.Validator(planner.build_evidence(3, 2, sim()))
    plan, rej = v.validate({**GOOD, **mut})
    assert plan is None and reason in {r["reason"] for r in rej}


def test_evidence_numbers_and_ordinals_allowed():
    v = planner.Validator(planner.build_evidence(3, 2, sim()))
    ok = {**GOOD, "summary": "There are 1,820 nodes in the graph; rank 2 of the sites in category 3 for Alpha Staging Point."}
    assert v.validate(ok)[0] is not None


def test_candidate_id_digits_masked():
    global COVER
    v = planner.Validator(planner.build_evidence(3, 2, sim()))
    assert v.validate({**GOOD, "summary": "Pick c_a and c_b."})[0] is not None


def test_hallucinated_facility_then_fallback_end_to_end():
    out = run(mk(mutate(summary="Route everyone to Flagler Hospital.")))
    assert out["source"] == "deterministic_fallback"
    assert any(r["reason"] == "unknown_facility_name" for r in out["validation"]["rejected"])


def test_supplied_facility_name_allowed():
    assert run(mk(mutate(summary="Alpha Staging Point is best.")))["source"] == "gemma"


@pytest.mark.parametrize("item,reason", [(httpx.ReadTimeout("t"), "timeout"), (429, "provider_error"), (500, "provider_error")])
def test_provider_failures_fall_back(item, reason):
    out = run(mk(item))
    assert out["source"] == "deterministic_fallback" and out["fallback_reason"] == reason
    assert out["source_label"] == FALLBACK_LABEL and out["model"] is None
    assert "gemma" not in out["source_label"].lower().replace("not a gemma", "")


def test_missing_key_fallback():
    c = GemmaClient(api_key="", model="m")
    out = planner.generate_plan(3, 2, client=c, sim=sim())
    assert out["source"] == "deterministic_fallback" and out["fallback_reason"] == "no_api_key"
    assert out["source_label"] == "Deterministic demo fallback — NOT a Gemma response"


def test_fallback_greedy_and_stable(monkeypatch):
    monkeypatch.setattr(planner, 'MIN_NODE_GAIN', 1)
    a = planner.deterministic_plan(3, 3, sim())
    b = planner.deterministic_plan(3, 3, sim())
    assert a == b
    # greedy: c_a (5), then c_b adds 6 (total 6), then c_c adds 7 (total 7); c_d adds nothing
    assert a["recommended_ids"] == ["c_a", "c_b", "c_c"]
    assert planner.deterministic_plan(3, 1, sim())["recommended_ids"] == ["c_a"]
    assert planner.deterministic_plan(3, 8, sim())["recommended_ids"] == ["c_a", "c_b", "c_c"]  # stops at zero gain


def test_category_zero_no_model_call():
    c = mk(json.dumps(GOOD))
    out = planner.generate_plan(0, 3, client=c, sim=sim())
    assert c.calls == [] and out["plan"]["recommended_ids"] == [] and out["source_label"] == FALLBACK_LABEL


def test_cache_hit_avoids_second_call():
    c = mk(json.dumps(GOOD))
    planner.generate_plan(3, 2, client=c, sim=sim())
    out = planner.generate_plan(3, 2, client=c, sim=sim())
    assert len(c.calls) == 1 and out.get("cached") is True


def test_prompt_has_no_coordinates_or_key():
    c = mk(json.dumps(GOOD))
    run(c)
    text = c.calls[0]["contents"][0]["parts"][0]["text"]
    assert "29.89" not in text and "-81.31" not in text and KEY not in text


# ---------------- API
def make_app(client, monkeypatch):
    monkeypatch.setattr(api_plan, "get_client", lambda: client)
    monkeypatch.setattr(api_plan, "get_sim", sim)
    app = FastAPI()
    app.include_router(api_plan.router)
    return TestClient(app)


def test_api_status_and_no_key_leak(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    tc = make_app(mk(json.dumps(GOOD)), monkeypatch)
    s = tc.get("/api/v1/plan/status")
    assert s.json() == {"provider": "gemma", "configured": True, "model": "gemma-test", "fallback_available": True}
    g = tc.post("/api/v1/plan/generate", json={"category": 3, "max_candidates": 2})
    assert g.status_code == 200 and g.json()["source"] == "gemma"
    assert KEY not in s.text + g.text + caplog.text


def test_api_status_unconfigured(monkeypatch):
    tc = make_app(GemmaClient(api_key="", model="m"), monkeypatch)
    assert tc.get("/api/v1/plan/status").json()["configured"] is False
    g = tc.post("/api/v1/plan/generate", json={"category": 2}).json()
    assert g["source"] == "deterministic_fallback" and g["fallback_reason"] == "no_api_key"


@pytest.mark.parametrize("body", [{"category": 6}, {"category": -1}, {"category": 2, "max_candidates": 0},
                                  {"category": 2, "max_candidates": 99}, {}])
def test_api_validation(monkeypatch, body):
    tc = make_app(mk(json.dumps(GOOD)), monkeypatch)
    assert tc.post("/api/v1/plan/generate", json=body).status_code == 422


def test_api_rate_limit(monkeypatch):
    tc = make_app(mk(json.dumps(GOOD)), monkeypatch)
    assert tc.post("/api/v1/plan/generate", json={"category": 3, "max_candidates": 2}).status_code == 200
    # different params -> uncached -> limited
    assert tc.post("/api/v1/plan/generate", json={"category": 4, "max_candidates": 2}).status_code == 429


def test_api_category_zero(monkeypatch):
    tc = make_app(mk(json.dumps(GOOD)), monkeypatch)
    r = tc.post("/api/v1/plan/generate", json={"category": 0})
    assert r.status_code == 200 and r.json()["plan"]["recommended_ids"] == []


def test_fallback_skips_trivial_gains():
    """Default threshold: sites whose marginal gain is just themselves (+1..4 nodes) are not recommended."""
    assert planner.MIN_NODE_GAIN >= 2
    plan = planner.deterministic_plan(3, 3, sim())
    assert plan["recommended_ids"] == ["c_a"]
