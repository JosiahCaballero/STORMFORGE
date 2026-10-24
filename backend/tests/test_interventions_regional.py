import pandas as pd
import pytest

from app.engine import DATA, Engine

REG = DATA / "regional"
pytestmark = pytest.mark.skipif(not (REG / "directed_edges.csv").exists(), reason="regional graph not built")


def test_regional_loads_and_hospital_is_connected_at_baseline():
    e = Engine.load(REG)
    fac = pd.read_csv(REG / "facilities.csv")
    assert len(fac) == 1 and fac.osm[0].startswith("way/") and fac.snap_distance_m[0] < 100
    s = e.summary(0)
    assert s["origins_with_route"] == s["origins_sampled"]
    assert all(e.summary(k)["origins_with_route"] == 0 for k in (3, 4, 5))  # access roads to the hospital are surge-exposed


def test_regional_closure_rule_matches_methodology():
    e = pd.read_csv(REG / "directed_edges.csv")
    bridge = e.bridge.notna() & e.bridge.fillna("").str.contains("yes")
    for k in range(1, 6):
        assert ((e[f"cat{k}_raw_closed"] == 1) == (e[f"cat{k}_max_bin"] >= 3)).all()
        assert (e[f"cat{k}_closed"] == ((e[f"cat{k}_raw_closed"] == 1) & ~bridge).astype(int)).all()


def test_regional_sampler_reproduces_existing_closures():
    a = pd.read_csv(DATA / "access/directed_edges.csv")
    b = pd.read_csv(REG / "directed_edges.csv")
    m = a.merge(b, on=["u", "v", "key"], suffixes=("_a", "_b"))
    assert len(m) == len(a)
    for k in range(1, 6):
        assert (m[f"cat{k}_closed_a"] == m[f"cat{k}_closed_b"]).all()
