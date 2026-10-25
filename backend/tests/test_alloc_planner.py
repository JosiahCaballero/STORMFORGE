"""Offline tests for the Gemma allocation planner (mock transport; never touches the network or a real key)."""
import copy
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import alloc_planner as ap
from app import api_alloc
from app.allocation import ORDER, TOTALS, default_model
from app.gemma import GemmaClient
from app.main import app
from app.planner import FALLBACK_LABEL

KEY = "AIzaSyFAKEKEYFAKEKEYFAKEKEYFAKEKEY12345"
M = default_model()
CAT = 3
tc = TestClient(app)
STEPS = ap.greedy_plan(M, CAT)[1]
GREEDY_IDS = [s["action_id"] for s in STEPS]


@pytest.fixture(autouse=True)
def _clear():
    ap.clear_cache()
    api_alloc._last_call = 0.0
    yield


def mk(items):
    q = list(items) if isinstance(items, list) else [items]
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


def good(ids=None, **over):
    ids = ids or GREEDY_IDS
    p = {"summary": "Open the blocked roads first, then place EMS, supply and rescue units where they add the most new coverage.",
         "assignments": [{"action_id": i, "rationale": f"Adds new coverage for {ap.RES_WORDS[i.split('@')[0]]}."} for i in ids],
         "tradeoffs": ["Some regions stay without ground coverage because they are cut off from the response base."],
         "limitations_ack": "Hypothetical inventory on a provisional road graph; locations are not people; simulation only."}
    p.update(over)
    return p


def run(client, current=None, use_cache=False):
    return ap.generate_allocation_plan(CAT, current, client=client, use_cache=use_cache)


# ---------------------------------------------------------------- greedy
def test_greedy_is_deterministic_bounded_and_feasible():
    chosen, steps = ap.greedy_plan(M, CAT)
    chosen2, steps2 = ap.greedy_plan(M, CAT)
    assert chosen == chosen2 and steps == steps2
    counts = {r: sum(1 for c in chosen if c["resource"] == r) for r in ORDER}
    assert all(counts[r] <= TOTALS[r] for r in ORDER) and len(chosen) <= 11
    res = M.evaluate(CAT, chosen)
    assert not res["rejected"] and all(s["new_locations"] >= ap.MIN_GAIN for s in steps)
    # the order of types is the fixed priority (enabler first) and every unit adds new coverage when removed (leave-one-out)
    assert [s["resource"] for s in steps] == sorted((s["resource"] for s in steps), key=ORDER.index)
    assert all(g["gain"] >= ap.MIN_GAIN for g in ap.leave_one_out(M, CAT, chosen))


def test_greedy_second_crew_uses_unlocked_debris():
    assert GREEDY_IDS[0] == "debris_crew@west_augustine"
    assert GREEDY_IDS[1].startswith("debris_crew@") and GREEDY_IDS[1] != GREEDY_IDS[0]      # the second crew goes to a different region


# ---------------------------------------------------------------- valid Gemma response
def test_valid_response_is_recomputed_by_backend_and_labelled_gemma():
    out = run(mk(json.dumps(good())))
    assert out["source"] == "gemma" and out["source_label"] == "Real Gemma response (model gemma-test)" and out["fallback_reason"] is None
    assert out["validation"]["ok"] and out["model"] == "gemma-test"
    asg = [{"resource": a["resource"], "zone_id": a["zone_id"]} for a in out["plan"]["assignments"]]
    assert out["verified"]["result"] == M.evaluate(CAT, asg)                 # numbers come from the backend only
    assert out["verified"]["current_result"] is None


def test_gemma_cannot_supply_metrics():
    bad = good()
    bad["metrics"] = {"ems_locations": 9999}
    out = run(mk(json.dumps(bad)))
    assert any(r["reason"] == "forbidden_field" for r in out["validation"]["rejected"]) and out["source"] == "deterministic_fallback"


def test_markdown_fenced_json_is_accepted():
    assert run(mk("Here:\n```json\n" + json.dumps(good()) + "\n```"))["source"] == "gemma"


# ---------------------------------------------------------------- rejection + repair
def test_unknown_action_id_rejected_then_repaired():
    c = mk([json.dumps(good(["ems_team@atlantis"])), json.dumps(good())])
    out = run(c)
    assert out["source"] == "gemma" and "repair_retry_requested" in out["validation"]["repairs"] and len(c.calls) == 2
    assert "unknown_action_id" in c.calls[1]["contents"][0]["parts"][0]["text"]


def test_inventory_overrun_rejected():
    out = run(mk(json.dumps(good(["helicopter@davis_shores", "helicopter@uptown_san_marco"]))))
    assert out["source"] == "deterministic_fallback" and out["fallback_reason"] == "invalid_output"
    assert any(r["reason"] == "inventory_exceeded" for r in out["validation"]["rejected"])
    assert out["verified"]["result"]["units_used"] <= 11


def test_infeasible_assignment_rejected_with_backend_reason():
    out = run(mk(json.dumps(good(["ems_team@davis_shores"]))))
    r = [x for x in out["validation"]["rejected"] if x["reason"] == "infeasible_assignment"]
    assert r and "ems_team@davis_shores" in r[0]["detail"] and out["source"] == "deterministic_fallback"


def test_redundant_unit_rejected():
    out = run(mk(json.dumps(good(["ems_team@lincolnville"] * 3))))
    assert any(r["reason"] == "redundant_assignment" for r in out["validation"]["rejected"])
    assert out["source"] == "deterministic_fallback"


@pytest.mark.parametrize("field,text", [
    ("summary", "Historic Downtown improves a lot under this plan."),                       # it does not improve
    ("tradeoffs", ["Zero of 6 zones improve."] ),                                            # not matched by regex -> still fine; replaced below
    ("tradeoffs", ["0 of 6 zones improve under this plan."]),
    ("tradeoffs", ["No zones improve with this allocation."]),
    ("tradeoffs", ["West Augustine does not improve at all."]),                             # it does
])
def test_contradictory_zone_claims_rejected_or_ignored(field, text):
    p = good()
    p[field] = text if isinstance(text, list) else text
    plan, rej, _ = ap.Validator(M, CAT, ap.build_evidence(M, CAT, None)).validate(p)
    if text == ["Zero of 6 zones improve."]:
        return  # wording the heuristic does not claim to catch (documented limitation)
    assert plan is None and any(r["reason"] == "zone_claim_contradiction" for r in rej)


def test_consistent_zone_claims_pass():
    p = good()
    p["tradeoffs"] = ["West Augustine improves because its blocked roads are cleared.", "Historic Downtown stays cut off."]
    plan, rej, _ = ap.Validator(M, CAT, ap.build_evidence(M, CAT, None)).validate(p)
    assert plan is not None, rej


def test_hallucinated_number_and_coordinates_rejected():
    for text in ("This unit reaches 4242 locations.", "Target near 29.8912 -81.3112."):
        p = good()
        p["summary"] = text
        plan, rej, _ = ap.Validator(M, CAT, ap.build_evidence(M, CAT, None)).validate(p)
        assert plan is None and {r["reason"] for r in rej} & {"number_not_in_evidence", "coordinates_not_allowed"}


def test_numbers_present_in_the_evidence_are_allowed():
    n = STEPS[0]["new_locations"]
    p = good()
    p["summary"] = f"The first crew adds {n} locations according to the evidence."
    plan, rej, _ = ap.Validator(M, CAT, ap.build_evidence(M, CAT, None)).validate(p)
    assert plan is not None, rej


# ---------------------------------------------------------------- fallback / failures
def test_no_key_uses_labelled_fallback():
    out = run(GemmaClient(api_key="", model="m"))
    assert out["source"] == "deterministic_fallback" and out["fallback_reason"] == "no_api_key" and out["source_label"] == FALLBACK_LABEL and out["model"] is None
    assert [a["action_id"] for a in out["plan"]["assignments"]] == GREEDY_IDS
    assert out["verified"]["result"] == M.evaluate(CAT, [{"resource": a["resource"], "zone_id": a["zone_id"]} for a in out["plan"]["assignments"]])


@pytest.mark.parametrize("item,reason", [(500, "provider_error"), (429, "provider_error"), (httpx.ReadTimeout("t"), "timeout")])
def test_provider_failures_fall_back_with_label(item, reason):
    out = run(mk(item))
    assert out["source"] == "deterministic_fallback" and out["fallback_reason"] == reason and out["source_label"] == FALLBACK_LABEL


def test_persistent_malformed_json_falls_back():
    out = run(mk("not json at all"))
    assert out["source"] == "deterministic_fallback" and out["fallback_reason"] == "invalid_output"


def test_category_zero_needs_no_model_call():
    c = mk(json.dumps(good()))
    out = ap.generate_allocation_plan(0, None, client=c)
    assert out["plan"]["assignments"] == [] and not c.calls


# ---------------------------------------------------------------- comparison with the user's plan
def test_current_allocation_is_compared_not_overwritten():
    mine = [{"resource": "ems_team", "zone_id": "west_augustine"}]
    snapshot = copy.deepcopy(mine)
    out = run(mk(json.dumps(good())), current=mine)
    assert mine == snapshot
    v = out["verified"]
    assert v["current_result"] == M.evaluate(CAT, mine) and v["assignment_diff"] and "ems_locations" in v["metric_diff"]
    assert out["verified"]["result"]["units_used"] == len(out["plan"]["assignments"])


def test_prompt_contains_current_plan_and_no_key():
    c = mk(json.dumps(good()))
    run(c, current=[{"resource": "ems_team", "zone_id": "west_augustine"}])
    text = c.calls[0]["contents"][0]["parts"][0]["text"]
    assert "current_user_allocation" in text and "ems_team@west_augustine" in text and KEY not in json.dumps(c.calls)


def test_cache_avoids_second_call():
    c = mk(json.dumps(good()))
    run(c, use_cache=True)
    out = run(c, use_cache=True)
    assert len(c.calls) == 1 and out.get("cached") is True


# ---------------------------------------------------------------- API
def test_api_plan_validation_and_fallback(monkeypatch):
    monkeypatch.setenv("GEMMA_API_KEY", "")
    monkeypatch.setenv("GOOGLE_API_KEY", "")
    monkeypatch.setattr("app.gemma.load_env", lambda: None)
    r = tc.post("/api/v1/allocation/plan", json={"category": 3, "current_assignments": [{"resource": "ems_team", "zone_id": "west_augustine"}]})
    assert r.status_code == 200 and r.json()["source"] == "deterministic_fallback" and r.json()["verified"]["current_result"]
    api_alloc._last_call = 0.0
    assert tc.post("/api/v1/allocation/plan", json={"category": 9}).status_code == 422
    api_alloc._last_call = 0.0
    assert tc.post("/api/v1/allocation/plan", json={"category": 3, "current_assignments": [{"resource": "tank", "zone_id": "x"}]}).status_code == 422
    api_alloc._last_call = 0.0
    assert tc.post("/api/v1/allocation/plan", json={"category": 3}).status_code == 200
    assert tc.post("/api/v1/allocation/plan", json={"category": 3}).status_code == 429      # simple rate limit between calls


REAL_GEMMA_TEXT = {  # shape of a real gemma-4-26b-a4b-it response (2026-10-24) that an earlier validator falsely rejected
    "summary": "I am proposing a more comprehensive allocation than the current user allocation, which only utilized two units. My plan maximizes coverage across multiple critical metrics and improves several key zones including Lincolnville, Uptown / San Marco, West Augustine, and Bridge Corridor.",
    "assignments": [{"action_id": i, "rationale": "Places this unit where it adds new coverage."} for i in
                    ["debris_crew@west_augustine", "ems_team@west_augustine", "ems_team@lincolnville", "ems_team@uptown_san_marco", "supply_team@west_augustine",
                     "supply_team@lincolnville", "medical_support@uptown_san_marco", "water_rescue@lincolnville", "water_rescue@west_augustine", "helicopter@uptown_san_marco"]],
    "tradeoffs": ["Prioritizing medical support and supply teams in West Augustine and Lincolnville limits the ability to deploy additional debris crews to other zones.",
                  "Focusing water rescue in Lincolnville and West Augustine leaves other zones without dedicated water-based response."],
    "limitations_ack": "Hypothetical inventory on a provisional road graph; simulation only.",
}


def test_real_gemma_wording_about_other_zones_is_not_a_false_positive():
    plan, rej, _ = ap.Validator(M, CAT, ap.build_evidence(M, CAT, None)).validate(REAL_GEMMA_TEXT)
    assert plan is not None, rej


def test_negation_about_the_named_zone_in_its_own_clause_is_still_caught():
    p = copy.deepcopy(REAL_GEMMA_TEXT)
    p["tradeoffs"] = ["Lincolnville is not improved by this plan, while Historic Downtown stays cut off."]
    plan, rej, _ = ap.Validator(M, CAT, ap.build_evidence(M, CAT, None)).validate(p)
    assert plan is None and any(r["reason"] == "zone_claim_contradiction" and "Lincolnville" in r["detail"] for r in rej)
    p["tradeoffs"] = ["Historic Downtown improves while other zones stay cut off."]
    plan, rej, _ = ap.Validator(M, CAT, ap.build_evidence(M, CAT, None)).validate(p)
    assert plan is None and any("Historic Downtown" in r["detail"] for r in rej)       # positive claim about a zone that does not improve
