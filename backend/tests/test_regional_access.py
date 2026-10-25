import networkx as nx
import pandas as pd
from fastapi.testclient import TestClient

from app import regional_access as ra
from app.engine import DATA, Engine
from app.main import app

client = TestClient(app)


def test_local_to_regional_mapping_and_closure_consistency():
    m = ra.mapping_report()
    assert m["valid"] and m["local_nodes_missing_in_regional"] == 0 and m["node_coordinate_mismatches"] == 0
    assert m["local_edges_matched"] == m["local_edges"]
    assert all(v == 0 for v in m["closure_flag_mismatches_by_category"].values())


def test_zone_nodes_all_exist_in_regional_graph():
    from app.interventions import default_sim
    reg = set(Engine.load(DATA / "regional").node_ids)
    for ns in default_sim().zm.zone_nodes.values():
        assert set(ns) <= reg


def test_ed_never_counts_itself_and_reachability_matches_independent_networkx():
    reg, fac, _ = ra._load()
    dest = {int(n) for n in fac.nearest_node}
    for c in range(6):
        s = ra.summary(c)
        g = reg.graph(c)
        want = set()
        for d in dest:
            want |= nx.ancestors(g, d)
        want -= dest
        r = s["any_24h_ed"]["regional_nodes"]
        assert r["nodes_with_route"] == len(want)
        assert r["nodes"] == len(reg.node_ids) - len(dest)
        # an ED node can be neither a counted node nor a counted origin
        assert not (set(ra._reach(c)[fac.name[0]]) & dest)


def test_flagler_alone_reaches_nobody_at_cat3_to_5_and_is_not_accessible():
    for c in (3, 4, 5):
        s = ra.summary(c)
        flagler = next(f for f in s["facilities"] if f["facility_type"] == "full_service_hospital")
        assert not flagler["accessible"] and flagler["nodes_that_reach_it"] == 0
        assert s["full_service_hospital"]["regional_nodes"]["nodes_with_route"] == 0
        assert s["any_24h_ed"]["regional_nodes"]["origins_with_route"] > 0  # freestanding EDs reachable


def test_denominators_are_labelled_and_not_mixed():
    s = ra.summary(3)
    loc, regn = s["any_24h_ed"]["local_4km_nodes"], s["any_24h_ed"]["regional_nodes"]
    assert loc["nodes"] <= 1820 and loc["origins"] <= 102
    assert regn["nodes"] <= 3129 and regn["origins"] <= 174
    assert loc["origins_with_route"] <= loc["origins"] and regn["origins_with_route"] <= regn["origins"]


def test_monotone_in_category_and_unaffected_by_local_graph():
    got = [ra.summary(c)["any_24h_ed"]["regional_nodes"]["nodes_with_route"] for c in range(6)]
    assert got == sorted(got, reverse=True)


def test_api_regional_access_and_zones():
    j = client.get("/api/v1/regional-access").json()
    assert [r["category"] for r in j["results"]] == [0, 1, 2, 3, 4, 5] and j["mapping"]["valid"]
    assert any("allocation engine stays on the 4 km graph" in x for x in j["scope"])
    assert client.get("/api/v1/regional-access?category=9").status_code == 422
    z = client.get("/api/v1/regional-access/zones?category=3").json()
    assert len(z) == 6 and all(x["basis"].startswith("local_4km") for x in z)
    assert all(x["nodes_with_full_service_hospital_route"] == 0 for x in z)


def test_allocation_graph_and_default_facilities_unchanged():
    e = Engine.load()
    assert len(e.nodes) == 1820 and len(e.facilities) == 1
    assert len(pd.read_csv(DATA / "access" / "facilities.csv")) == 1
    assert client.get("/api/v1/scenarios/3").json()["nodes_with_route"] == 1
