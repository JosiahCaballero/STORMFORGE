import re

from fastapi.testclient import TestClient

from app.agents import build_report
from app.interventions import evaluate_plan, list_candidates
from app.main import app

client = TestClient(app)
IDS = [c["id"] for c in list_candidates()]


def test_report_shape_and_stable_ids():
    for k in range(6):
        r = build_report(k, IDS[:2])
        assert r["transit"] == {"status": "planned", "note": "No verified transit data; not modeled."}
        fids = []
        for a in ("transportation", "medical", "logistics", "community"):
            f = r[a]
            assert f["headline"] and f["findings"] and f["limitations"] and f["evidence"]
            fids += [x["id"] for x in f["findings"]]
            assert all(x["id"].startswith(f["agent"].split("_")[0]) for x in f["findings"])
        assert len(fids) == len(set(fids))
    assert build_report(3, IDS) == build_report(3, IDS)


def test_medical_limitations_and_numbers_match_engine():
    r = build_report(3, IDS)
    text = " ".join(r["medical"]["limitations"]).lower()
    assert "provisional" in text and "unverified" in text and "does not mean zero real-world access" in text
    ev = evaluate_plan(3, IDS)
    assert r["medical"]["evidence"]["delta"] == ev["delta"]
    f = {x["id"]: x for x in r["medical"]["findings"]}
    assert f["medical.hospital_origins"]["value"] == ev["baseline"]["origins_with_hospital_route"]
    # every integer in finding text is traceable to a computed value in the evidence
    assert str(ev["baseline"]["origins_with_hospital_route"]) in f["medical.hospital_origins"]["text"]


def test_no_staging_zero_and_cat0():
    r = build_report(0, [])
    assert r["applied_candidate_ids"] == []
    assert r["transportation"]["evidence"]["directed_edges_closed"] == 0
    assert build_report(3, [])["medical"]["findings"][-1]["id"] == "medical.no_staging_applied"


def test_endpoint():
    j = client.get(f"/api/v1/agents/report?category=3&candidate_ids={IDS[5]},{IDS[5]}").json()
    assert j["applied_candidate_ids"] == [IDS[5]]
    assert client.get("/api/v1/agents/report?category=3&candidate_ids=bad").status_code == 422
    assert client.get("/api/v1/agents/report?category=8").status_code == 422
    assert re.search(r"\d", j["medical"]["headline"])
