"""Validate the regional sampler against data/access/directed_edges.csv on overlapping (u,v,key) edges, and report
before/after hospital reachability using Engine.load on both directories. Read-only."""
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.engine import Engine  # noqa: E402

a = pd.read_csv(ROOT / "data/access/directed_edges.csv")
b = pd.read_csv(ROOT / "data/regional/directed_edges.csv")
m = a.merge(b, on=["u", "v", "key"], suffixes=("_a", "_b"))
print(f"existing edges={len(a)} regional edges={len(b)} overlapping={len(m)}")
for c in range(1, 6):
    for f in ("closed", "raw_closed"):
        eq = (m[f"cat{c}_{f}_a"] == m[f"cat{c}_{f}_b"]).sum()
        print(f"cat{c} {f}: agree {eq}/{len(m)}")
    ma, mb = m[f"cat{c}_max_bin_a"], m[f"cat{c}_max_bin_b"]
    same = ((ma == mb) | (ma.isna() & mb.isna())).sum()
    print(f"cat{c} max_bin: agree {same}/{len(m)}")
    d = m[(m[f"cat{c}_closed_a"] != m[f"cat{c}_closed_b"])]
    if len(d):
        print(d[["u", "v", "name_a", f"cat{c}_max_bin_a", f"cat{c}_max_bin_b", "length_m_a", "length_m_b"]].head(10).to_string())

for label, path in (("4km access", ROOT / "data/access"), ("regional", ROOT / "data/regional")):
    e = Engine.load(path)
    print(label, "nodes", len(e.node_ids), "origins", len(e.origins), "destinations", e.destinations)
    for k in range(6):
        s = e.summary(k)
        print(f"  cat{k}: origins_with_route {s['origins_with_route']}/{s['origins_sampled']}  nodes_with_route {s['nodes_with_route']}/{s['nodes_total']}")
