import random

import pytest
from fastapi.testclient import TestClient

from app.allocation import (CREW_CAPACITY, HELI_MAX_NODES, ORDER, SEED, SERVICE_RADIUS_M, TOTALS, WATER_RADIUS_M, AllocationError,
                            AllocationModel, default_model)
from app.main import app
from app.zones import _dist_m

M = default_model()
CAT = 3
tc = TestClient(app)
A = lambda r, z, c=None: {"resource": r, "zone_id": z, "candidate_id": c}  # noqa: E731


def placed(res, resource=None):
    return [e for e in res["assignments"] if e["status"] == "placed" and (resource is None or e["resource"] == resource)]


# ------------------------------------------------------------------ debris
def test_debris_is_deterministic_across_instances_and_calls():
    other = AllocationModel()
    for cat in (1, 3, 5):
        a = [(o.id, o.segment, o.zone_id) for o in M.debris(cat)]
        assert a == [(o.id, o.segment, o.zone_id) for o in other.debris(cat)]
        assert a and len(a) <= 10
    assert M.debris_meta(3)["seed"] == SEED and str(SEED) in M.debris_meta(3)["per_category_seed"]
    assert {o.id for o in M.debris(3)} != {o.id for o in M.debris(1)}      # category-specific
    assert M.debris(0) == []


def test_flood_and_debris_closures_are_separate_and_debris_only_on_passable_roads():
    for cat in (1, 3, 5):
        g = M.flood_graph(cat)
        for o in M.debris(cat):
            assert o.open_edges, "debris must sit on roads that are otherwise passable"
            assert any(g.has_edge(u, v) for u, v, _ in o.open_edges)
            assert o.criticality >= 5
            assert not any(M.edge_row[e][5] for e in o.edge_ids)          # no bridges
            # flood-closed edges of a segment are reported separately from the debris-removed ones
            assert set(o.flood_closed_edge_ids).isdisjoint({e for e in o.edge_ids if (M.edge_row[e][0], M.edge_row[e][1]) in {(u, v) for u, v, _ in o.open_edges}})


def test_clearing_never_reopens_flood_closed_roads():
    g = M.graph_with_debris(CAT)
    flood_only = M.flood_graph(CAT)
    cleared = set()
    for z in ("west_augustine", "lincolnville"):
        pl, _ = M._place_crew(CAT, g, z, cleared)
        assert pl is not None
        cleared |= set(pl.extra["cleared_obstruction_ids"])
    assert set(g.edges()) <= set(flood_only.edges())                       # nothing beyond the flood-open network
    assert g.number_of_edges() < flood_only.number_of_edges()              # remaining debris still blocks
    closed = M.eng.edges[M.eng.edges[f"cat{CAT}_closed"] == 1]
    for r in closed.itertuples(index=False):
        if not flood_only.has_edge(int(r.u), int(r.v)):
            assert not g.has_edge(int(r.u), int(r.v))


def test_crew_clears_at_most_two_and_reports_real_gain():
    res = M.evaluate(CAT, [A("debris_crew", "west_augustine")])
    e = res["assignments"][0]
    assert e["status"] == "placed" and len(e["details"]["cleared_obstruction_ids"]) == CREW_CAPACITY == 2
    assert e["new_locations"] == res["metrics"]["delta"]["response_reach_locations"] > 0
    assert f"{e['new_locations']} additional road-network locations" in e["message"]
    assert res["roads"]["debris_cleared"] == 2 and res["roads"]["debris_remaining"] == res["roads"]["debris_total"] - 2
    # paired directions: an obstruction removes every directed edge between its two nodes
    ob = next(o for o in M.debris(CAT) if o.id == e["details"]["cleared_obstruction_ids"][0])
    assert set(ob.edge_ids) <= set(res["roads"]["cleared_edge_ids"])


def test_crew_with_single_obstruction_clears_only_that_one_and_empty_region_is_rejected_unconsumed():
    n_lin = sum(1 for o in M.debris(CAT) if o.zone_id == "lincolnville")
    assert n_lin == 1
    res = M.evaluate(CAT, [A("debris_crew", "lincolnville"), A("debris_crew", "davis_shores")])
    by = {e["zone_id"]: e for e in res["assignments"]}
    assert len(by["lincolnville"]["details"]["cleared_obstruction_ids"]) == 1
    assert by["davis_shores"]["status"] == "rejected" and by["davis_shores"]["reason"] == "no_eligible_debris"
    assert by["davis_shores"]["consumed"] is False
    assert next(i for i in res["inventory"] if i["id"] == "debris_crew")["remaining"] == 1   # only 1 of 2 consumed


def test_crews_can_unlock_each_other_regardless_of_click_order():
    a = [A("debris_crew", "uptown_san_marco"), A("debris_crew", "west_augustine")]
    r1, r2 = M.evaluate(CAT, a), M.evaluate(CAT, a[::-1])
    assert all(e["status"] == "placed" for e in r1["assignments"])
    assert r1["metrics"] == r2["metrics"]
    assert r1["metrics"]["delta"]["response_reach_locations"] > 18


# ------------------------------------------------------------------ inventory
def test_inventory_limits_and_rejections_do_not_consume():
    assert sum(TOTALS.values()) == 11 and TOTALS == {"debris_crew": 2, "ems_team": 3, "supply_team": 2, "medical_support": 1, "water_rescue": 2, "helicopter": 1}
    res = M.evaluate(CAT, [A("helicopter", "west_augustine"), A("helicopter", "uptown_san_marco")])
    assert [e["status"] for e in res["assignments"]] == ["placed", "rejected"]
    assert res["assignments"][1]["reason"] == "inventory_exceeded"
    # 4 EMS requests: infeasible ones never consume, so up to 3 feasible ones still fit
    res = M.evaluate(CAT, [A("ems_team", "davis_shores")] * 2 + [A("ems_team", z) for z in ("west_augustine", "uptown_san_marco", "bridge_corridor")])
    assert sum(e["status"] == "placed" for e in res["assignments"]) == 3
    assert [e["reason"] for e in res["assignments"] if e["status"] == "rejected"] == ["no_reachable_point"] * 2
    ems = next(i for i in res["inventory"] if i["id"] == "ems_team")
    assert ems["used"] == 3 and ems["remaining"] == 0
    with pytest.raises(AllocationError):
        M.evaluate(CAT, [A("tank", "west_augustine")])
    with pytest.raises(AllocationError):
        M.evaluate(CAT, [A("ems_team", "narnia")])


# ------------------------------------------------------------------ EMS / supply / medical
def test_ems_and_supply_need_a_reachable_point_and_report_separate_coverage():
    res = M.evaluate(CAT, [A("ems_team", "west_augustine"), A("supply_team", "west_augustine")])
    g = M.graph_with_debris(CAT)
    reach = M._reach(g, M.base)
    for e in placed(res):
        assert e["details"]["street"]
    ems, sup = res["layers"]["ems"][0], res["layers"]["supply"][0]
    assert ems["node_id"] in reach and M.node_zone[ems["node_id"]] == "west_augustine"
    m = res["metrics"]["after"]
    assert m["ems_locations"] == len(ems["coverage"]) and m["supply_locations"] == len(sup["coverage"])
    assert m["hospital_locations"] == res["metrics"]["before"]["hospital_locations"]            # hospital access is separate
    assert 0 < m["ems_locations"] < M.node_total
    rej = M.evaluate(CAT, [A("ems_team", "historic_downtown"), A("supply_team", "davis_shores")])
    assert [e["reason"] for e in rej["assignments"]] == ["no_reachable_point"] * 2 and rej["units_used"] == 0


def test_service_radius_bounds_ems_coverage():
    res = M.evaluate(CAT, [A("ems_team", "west_augustine")])
    p = res["layers"]["ems"][0]
    import networkx as nx
    g = M.graph_with_debris(CAT)
    d = nx.single_source_dijkstra_path_length(g, p["node_id"], weight="length")
    pts = {tuple(x) for x in p["coverage"]}
    for n, dist in d.items():
        la, lo = M.coords[n]
        assert ((round(lo, 6), round(la, 6)) in pts) == (dist <= SERVICE_RADIUS_M)


def test_medical_support_uses_candidates_separately_from_hospital():
    res = M.evaluate(CAT, [A("medical_support", "west_augustine")])
    e = res["assignments"][0]
    assert e["status"] == "placed" and e["details"]["name"] and "Not a hospital" in e["message"]
    assert res["metrics"]["delta"]["medical_support_locations"] > 0 and res["metrics"]["delta"]["hospital_locations"] == 0
    bad = M.evaluate(CAT, [A("medical_support", "bridge_corridor")])
    assert bad["assignments"][0]["reason"] == "no_candidate_site"
    wrong = M.evaluate(CAT, [A("medical_support", "west_augustine", "stage_lincolnville")])
    assert wrong["assignments"][0]["reason"] == "candidate_not_in_region"


# ------------------------------------------------------------------ water rescue / helicopter
def test_water_rescue_screening_radius_and_targets():
    res = M.evaluate(CAT, [A("water_rescue", "lincolnville")])
    w = res["layers"]["water"][0]
    assert w["radius_m"] == WATER_RADIUS_M == 500.0 and w["targets"]
    elat, elon = M.coords[w["node_id"]][0], M.coords[w["node_id"]][1]
    flood = M.flood_nodes(CAT)
    for lon, lat in w["targets"]:
        assert _dist_m(elat, elon, lat, lon) <= WATER_RADIUS_M + 1.0
    node_by_pt = {(round(M.coords[n][1], 6), round(M.coords[n][0], 6)): n for n in M.coords}
    assert all(node_by_pt[tuple(t)] in flood and M.node_zone[node_by_pt[tuple(t)]] == "lincolnville" for t in w["targets"])
    assert w["node_id"] in M._reach(M.graph_with_debris(CAT), M.base)
    # no road-reachable entry -> rejected without consuming
    rej = M.evaluate(CAT, [A("water_rescue", "davis_shores")])
    assert rej["assignments"][0]["status"] == "rejected" and rej["units_used"] == 0
    assert "Screening only" in res["assignments"][0]["message"]


def test_helicopter_single_region_ten_node_cap_and_roads_unchanged():
    res = M.evaluate(CAT, [A("helicopter", "davis_shores")])
    h = res["layers"]["helicopter"][0]
    assert 0 < len(h["cluster"]) <= HELI_MAX_NODES == 10
    assert "No flight" in res["assignments"][0]["message"]
    base = M.evaluate(CAT, [])
    assert res["roads"]["passable_directed_edges"] == base["roads"]["passable_directed_edges"]
    assert res["metrics"]["after"]["response_reach_locations"] == base["metrics"]["after"]["response_reach_locations"]
    assert res["metrics"]["after"]["helicopter_locations"] == len(h["cluster"]) <= 10
    two = M.evaluate(CAT, [A("helicopter", "davis_shores"), A("helicopter", "historic_downtown")])
    assert two["assignments"][1]["reason"] == "inventory_exceeded" and len(two["layers"]["helicopter"]) == 1


def test_helicopter_avoids_locations_already_covered_by_ground_teams():
    solo = M.evaluate(CAT, [A("helicopter", "west_augustine")])["layers"]["helicopter"][0]["cluster"]
    both = M.evaluate(CAT, [A("helicopter", "west_augustine"), A("water_rescue", "west_augustine"), A("ems_team", "west_augustine")])
    cluster = {tuple(x) for x in both["layers"]["helicopter"][0]["cluster"]}
    ground = {tuple(x) for x in both["layers"]["water"][0]["targets"]} | {tuple(x) for x in both["layers"]["ems"][0]["coverage"]}
    assert cluster.isdisjoint(ground) and cluster != {tuple(x) for x in solo}


# ------------------------------------------------------------------ whole-allocation properties
FULL = [A("debris_crew", "west_augustine"), A("debris_crew", "uptown_san_marco"), A("ems_team", "west_augustine"), A("ems_team", "lincolnville"),
        A("ems_team", "uptown_san_marco"), A("supply_team", "west_augustine"), A("supply_team", "bridge_corridor"),
        A("medical_support", "west_augustine"), A("water_rescue", "lincolnville"), A("water_rescue", "uptown_san_marco"), A("helicopter", "davis_shores")]


def test_allocation_order_does_not_change_the_result():
    base = M.evaluate(CAT, FULL)
    assert base["units_used"] == 11 and all(i["remaining"] == 0 for i in base["inventory"])
    rng = random.Random(7)
    for _ in range(4):
        shuffled = FULL[:]
        rng.shuffle(shuffled)
        r = M.evaluate(CAT, shuffled)
        assert r["metrics"] == base["metrics"] and r["roads"] == base["roads"] and r["layers"] == base["layers"]
        key = lambda x: (x["resource"], x["zone_id"])  # noqa: E731
        assert sorted((key(e), e["status"], e["new_locations"]) for e in r["assignments"]) == sorted((key(e), e["status"], e["new_locations"]) for e in base["assignments"])
        # every original click index is accounted for exactly once
        assert sorted(e["index"] for e in r["assignments"]) == list(range(11))


def test_no_double_counting_and_coverage_categories_not_summed():
    res = M.evaluate(CAT, FULL)
    m = res["metrics"]["after"]
    ems_union = {tuple(p) for t in res["layers"]["ems"] for p in t["coverage"]}
    sup_union = {tuple(p) for t in res["layers"]["supply"] for p in t["coverage"]}
    assert m["ems_locations"] == len(ems_union) < sum(len(t["coverage"]) for t in res["layers"]["ems"])
    assert m["supply_locations"] == len(sup_union)
    assert m["water_rescue_locations"] == len({tuple(p) for t in res["layers"]["water"] for p in t["targets"]})
    assert "total_coverage" not in m and not any("total" in k and "coverage" in k for k in m)
    inc = sum(e["new_locations"] for e in placed(res, "ems_team"))
    assert inc == m["ems_locations"]                                        # incremental effects sum to the union, no overlap


def test_per_region_metrics_match_global_and_before_after_are_consistent():
    res = M.evaluate(CAT, FULL)
    zsum = {k: sum(z["after"][k] for z in res["zones"]) for k in ("ems_locations", "supply_locations", "water_rescue_locations", "helicopter_locations", "medical_support_locations")}
    for k, v in zsum.items():
        assert v <= res["metrics"]["after"][k]                              # unzoned locations only appear globally
    for z in res["zones"]:
        assert z["delta"]["zone_nodes"] == 0 and z["after"]["debris_cleared"] + z["after"]["debris_blocked"] == z["before"]["debris_blocked"]
        assert z["after"]["cut_off_locations"] == z["after"]["zone_nodes"] - z["after"]["response_reach_locations"]
    wa = next(z for z in res["zones"] if z["zone_id"] == "west_augustine")
    assert wa["after"]["ems_locations"] > 0 and wa["resources"] and wa["remaining"]


def test_category_changes_are_independent_and_baseline_has_no_debris():
    r0 = M.evaluate(0, [A("debris_crew", "west_augustine")])
    assert r0["roads"]["debris_total"] == 0 and r0["assignments"][0]["reason"] == "no_eligible_debris"
    assert M.evaluate(1, FULL)["metrics"] != M.evaluate(5, FULL)["metrics"]


# ------------------------------------------------------------------ API
def test_api_setup_evaluate_compare_actions():
    s = tc.get("/api/v1/allocation/setup", params={"category": 3}).json()
    assert s["total_units"] == 11 and len(s["zones"]) == 6 and s["base"]["provenance"] == "hypothetical" and s["debris_meta"]["seed"] == SEED
    assert s["attention_order"][0] in {z["zone_id"] for z in s["zones"]}
    r = tc.post("/api/v1/allocation/evaluate", json={"category": 3, "assignments": [{"resource": "debris_crew", "zone_id": "west_augustine"}]}).json()
    assert r["assignments"][0]["status"] == "placed"
    c = tc.post("/api/v1/allocation/compare", json={"category": 3, "plans": [{"label": "mine", "assignments": []}, {"label": "ai", "assignments": [{"resource": "ems_team", "zone_id": "west_augustine"}]}]}).json()
    assert c["assignment_diff"] and c["metric_diff"]["ems_locations"] > 0
    acts = tc.get("/api/v1/allocation/actions", params={"category": 3}).json()
    assert len(acts) == 36 and all("@" in a["id"] for a in acts)
    assert tc.get("/api/v1/allocation/setup", params={"category": 9}).status_code == 422
    assert tc.post("/api/v1/allocation/evaluate", json={"category": 3, "assignments": [{"resource": "tank", "zone_id": "x"}]}).status_code == 422
    assert tc.post("/api/v1/allocation/evaluate", json={"category": 3, "assignments": [{"resource": "ems_team", "zone_id": "x"}]}).status_code == 422
