import networkx as nx
import pytest
from fastapi.testclient import TestClient

from app.engine import Engine
from app.interventions import Sim, UnknownCandidates, default_sim, evaluate_plan, list_candidates
from app.main import app

client = TestClient(app)
IDS = [c["id"] for c in list_candidates()]


def test_candidates_fixed_deterministic():
    a = Sim(Engine.load()).candidates
    assert [c["id"] for c in a] == IDS and 6 <= len(IDS) <= 8
    assert [c["node_id"] for c in a] == [c["node_id"] for c in list_candidates()]
    for c in a:
        assert c["provenance"] == "hypothetical" and c["kind"] == "hypothetical_staging"
        assert set(c["feasibility_by_category"]) == {"1", "2", "3", "4", "5"}
        assert c["limitations"] and c["selection_rule"]


def test_empty_plan_equals_baseline():
    for k in range(6):
        r = evaluate_plan(k, [])
        assert r["baseline"] == r["intervention"]
        assert all(v == 0 for v in r["delta"].values())
        assert r["baseline"]["nodes_with_staging_route"] == 0


def test_delta_and_union_consistency():
    for k in range(6):
        r = evaluate_plan(k, IDS)
        b, i, d = r["baseline"], r["intervention"], r["delta"]
        for key in d:
            assert d[key] == i[key] - b[key]
        assert i["nodes_with_any_care_route"] >= max(i["nodes_with_hospital_route"], i["nodes_with_staging_route"])
        assert i["nodes_with_any_care_route"] <= i["nodes_with_hospital_route"] + i["nodes_with_staging_route"]
        assert i["origins_with_any_care_route"] <= i["origins_with_hospital_route"] + i["origins_with_staging_route"]
        assert i["nodes_with_hospital_route"] == b["nodes_with_hospital_route"]  # staging never alters hospital access
        assert i["origins_total"] == 102


def test_deterministic_and_order_independent():
    assert evaluate_plan(3, IDS) == evaluate_plan(3, IDS)
    assert evaluate_plan(3, IDS)["intervention"] == evaluate_plan(3, IDS[::-1])["intervention"]


def test_monotonic_adding_candidate():
    for k in range(6):
        prev = evaluate_plan(k, [])["intervention"]["nodes_with_any_care_route"]
        for n in range(1, len(IDS) + 1):
            cur = evaluate_plan(k, IDS[:n])["intervention"]
            assert cur["nodes_with_any_care_route"] >= prev
            prev = cur["nodes_with_any_care_route"]


def test_category_specific_effects():
    d = {k: evaluate_plan(k, IDS)["delta"]["nodes_with_any_care_route"] for k in range(6)}
    assert d[0] == 0
    assert d[3] > d[2] > 0  # hospital cut off at cat3, staging recovers a dry component


def test_cut_off_candidate_has_tiny_benefit():
    r = evaluate_plan(5, ["stage_historic_downtown"])
    assert r["delta"]["nodes_with_any_care_route"] <= 3
    f = default_sim().by_id["stage_historic_downtown"]["feasibility_by_category"]["5"]
    assert f["nodes_that_can_reach"] <= 3


def test_invalid_and_duplicate():
    with pytest.raises(UnknownCandidates):
        evaluate_plan(3, ["nope"])
    r = evaluate_plan(3, [IDS[0], IDS[0]])
    assert r["candidate_ids"] == [IDS[0]] and r["warnings"]
    with pytest.raises(ValueError):
        evaluate_plan(9, [])


def test_closed_edges_never_traversed():
    sim = default_sim()
    for k in (2, 3):
        g = sim.graph(k)
        closed = sim.eng.edges[sim.eng.edges[f"cat{k}_closed"] == 1]
        closed_ids = set(closed.edge_id)
        for r in closed.itertuples():
            e = g.get_edge_data(r.u, r.v)
            assert e is None or e["edge_id"] != r.edge_id
        for cid in IDS:
            node = sim.by_id[cid]["node_id"]
            anc = sim.ancestors(k, node)
            for o in sim.eng.origins[:30]:
                if o in anc and o != node:
                    path = nx.shortest_path(g, o, node, weight="length")
                    for a, b in zip(path, path[1:]):
                        assert g[a][b]["edge_id"] not in closed_ids


def test_api_endpoints():
    assert len(client.get("/api/v1/candidates").json()) == len(IDS)
    r = client.post("/api/v1/interventions/evaluate", json={"category": 3, "candidate_ids": [IDS[5], IDS[5]]})
    assert r.status_code == 200 and r.json()["warnings"]
    assert r.json()["per_candidate"][0]["marginal"]["nodes_with_staging_route"] > 100
    bad = client.post("/api/v1/interventions/evaluate", json={"category": 3, "candidate_ids": ["x"]})
    assert bad.status_code == 422 and "x" in str(bad.json())
    assert client.post("/api/v1/interventions/evaluate", json={"category": 7, "candidate_ids": []}).status_code == 422
    c = client.post("/api/v1/interventions/compare", json={"category": 3, "plans": [
        {"label": "A", "candidate_ids": [IDS[5]]}, {"label": "B", "candidate_ids": IDS}]})
    j = c.json()
    assert c.status_code == 200
    assert j["plans"][1]["delta"]["nodes_with_any_care_route"] >= j["plans"][0]["delta"]["nodes_with_any_care_route"]
    bad2 = client.post("/api/v1/interventions/compare", json={"category": 3, "plans": [{"label": "A", "candidate_ids": ["q"]}]})
    assert bad2.status_code == 422
