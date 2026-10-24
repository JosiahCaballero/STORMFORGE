import pandas as pd
import pytest

from app.engine import DATA, Engine, Interventions


@pytest.fixture(scope="module")
def eng():
    return Engine.load()


def test_edge_counts_match_prototype_summary(eng):
    ref = pd.read_csv(DATA / "access/access_summary.csv").set_index("category")
    for c in range(6):
        s = eng.summary(c)
        assert s["directed_edges_open"] == ref.loc[c, "directed_edges_open"]
        assert s["directed_edges_closed"] == ref.loc[c, "directed_edges_closed"]


def test_hospital_isolated_cat3_to_5_like_prototype(eng):
    for c in (3, 4, 5):
        assert eng.summary(c)["origins_with_route"] == 0


def test_monotone_degradation_and_baseline(eng):
    r = [eng.summary(c)["nodes_with_route"] for c in range(6)]
    assert r == sorted(r, reverse=True)
    assert r[0] > 0.95 * len(eng.node_ids)


def test_deterministic(eng):
    assert Engine.load().summary(2) == eng.summary(2)


def test_closed_edge_never_traversed(eng):
    g = eng.graph(2)
    closed = eng.edges[eng.edges.cat2_closed == 1]
    for r in closed.head(200).itertuples():
        e = g.get_edge_data(r.u, r.v)
        assert e is None or e["edge_id"] != r.edge_id


def test_staging_node_changes_reachability_only_by_graph(eng):
    base = eng.summary(3)["nodes_with_route"]
    node = eng.node_ids[100]
    withstage = eng.summary(3, Interventions(staging_nodes=frozenset({node})))["nodes_with_route"]
    assert withstage >= base + 1  # at least the staging node itself
