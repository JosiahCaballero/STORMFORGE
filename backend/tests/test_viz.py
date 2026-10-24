from fastapi.testclient import TestClient

from app.interventions import evaluate_plan, list_candidates
from app.main import app

tc = TestClient(app)


def test_reach_counts_match_evaluate_and_coordinates_are_real_nodes():
    best = max(list_candidates(), key=lambda c: evaluate_plan(3, [c["id"]])["delta"]["nodes_with_any_care_route"])["id"]
    r = tc.get("/api/v1/interventions/reach", params={"category": 3, "candidate_ids": best}).json()
    ev = evaluate_plan(3, [best])
    assert r["counts"]["gained_nodes"] == ev["delta"]["nodes_with_any_care_route"] == len(r["gained"])
    assert r["counts"]["after_any_care_nodes"] == ev["intervention"]["nodes_with_any_care_route"]
    assert r["counts"]["baseline_any_care_nodes"] == ev["baseline"]["nodes_with_any_care_route"] == len(r["baseline_care"])
    assert r["sites"][0]["id"] == best
    for lon, lat in r["gained"]:
        assert -81.36 < lon < -81.27 and 29.86 < lat < 29.94


def test_reach_empty_plan_gains_nothing_and_is_deterministic():
    a = tc.get("/api/v1/interventions/reach", params={"category": 2}).json()
    b = tc.get("/api/v1/interventions/reach", params={"category": 2}).json()
    assert a == b and a["counts"]["gained_nodes"] == 0 and a["gained"] == []


def test_reach_validation():
    assert tc.get("/api/v1/interventions/reach", params={"category": 9}).status_code == 422
    r = tc.get("/api/v1/interventions/reach", params={"category": 3, "candidate_ids": "nope"})
    assert r.status_code == 422 and r.json()["detail"]["unknown_ids"] == ["nope"]
