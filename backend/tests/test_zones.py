from fastapi.testclient import TestClient

from app.interventions import default_sim
from app.main import app

client = TestClient(app)
IDS = ["historic_downtown", "lincolnville", "davis_shores", "uptown_san_marco", "west_augustine", "bridge_corridor"]


def test_zones_listing():
    z = client.get("/api/v1/zones").json()
    assert [x["id"] for x in z] == IDS
    for x in z:
        assert x["boundary_status"] == "provisional" and x["node_count"] > 0 and x["method"]
        assert "population" not in x
    assert z[-1]["kind"] == "infrastructure" and z[-1]["boundary"] is None
    assert all(x["boundary"]["type"] == "Polygon" for x in z[:-1])


def test_zone_nodes_disjoint_and_bridge_zone_has_bridge_nodes():
    sim = default_sim()
    seen = set()
    for ns in sim.zm.zone_nodes.values():
        assert not (seen & set(ns))
        seen |= set(ns)
    br = sim.eng.edges[sim.eng.edges.bridge.notna()]
    assert set(br.u) <= set(sim.zm.zone_nodes["bridge_corridor"])


def test_impact():
    r = client.get("/api/v1/zones/historic_downtown/impact?category=3").json()
    assert r["edges_closed"] > 0 and 0 < r["closed_length_pct"] <= 100 and r["most_exposed_roads"]
    assert r["nodes_with_hospital_route"] <= r["nodes"] and r["limitations"]
    r0 = client.get("/api/v1/zones/historic_downtown/impact?category=0").json()
    assert r0["edges_closed"] == 0 and r0["most_exposed_roads"] == []
    cid = default_sim().candidates[5]["id"]
    ra = client.get(f"/api/v1/zones/west_augustine/impact?category=3&candidate_ids={cid}").json()
    rb = client.get("/api/v1/zones/west_augustine/impact?category=3").json()
    assert ra["nodes_with_any_care_route"] >= rb["nodes_with_any_care_route"]
    assert ra["nodes_with_hospital_route"] == rb["nodes_with_hospital_route"]


def test_impact_errors():
    assert client.get("/api/v1/zones/nope/impact?category=3").status_code == 404
    assert client.get("/api/v1/zones/lincolnville/impact?category=9").status_code == 422
    assert client.get("/api/v1/zones/lincolnville/impact?category=3&candidate_ids=zzz").status_code == 422
