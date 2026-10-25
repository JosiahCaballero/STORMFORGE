"""Regional emergency-care ACCESSIBILITY (separate from the 4 km allocation engine).

Scope: routes over the 6 km regional OSM graph (data/regional) to verified 24h emergency departments
(data/regional/facilities_verified.csv). Nothing here feeds allocation, zones, candidates or inventory.

Mapping to the local 4 km graph: both graphs come from OSMnx, so a 4 km node id IS the same OSM node in the regional graph.
`mapping_report()` checks that all local nodes exist in the regional graph at the same coordinates and that closure flags
agree on every shared edge for all categories (same NOAA rule), so the two calculations never use different flood assumptions.

Denominators are never mixed: every result states its basis -- "local_4km_nodes" (the local nodes / local origins,
routed over the regional graph so paths may leave the 4 km clip) or "regional_nodes" (regional nodes / regional origins).
An ED node never counts itself: ED destination nodes are excluded from numerators and denominators, and an ED is "accessible"
only if at least one other node can reach it.
"""
from __future__ import annotations

from dataclasses import replace  # noqa: F401  (kept for callers building alternative facility sets)
from functools import lru_cache

import networkx as nx
import pandas as pd

from .engine import CATS, DATA, Engine

REG = DATA / "regional"
SCOPE = [
    "Regional model (6 km OSM drive graph) used ONLY for emergency-care accessibility; the allocation engine stays on the 4 km graph.",
    "Facilities are operator-listed 24h EDs; positions are approximate (see position_quality / snap_distance_m) and entrances are unverified.",
    "Same illustrative NOAA closure rule as the 4 km graph (any ~20 m sample in bin >= 3; bridge=yes exempt); NoData is unknown, not dry.",
    "Shortest-path reachability over open directed roads only: no ambulance speeds, congestion, surge timing, or air/boat access.",
    "Full-service hospital access and freestanding-ER access are reported separately; origins are deterministic, not population-weighted.",
]


@lru_cache(maxsize=1)
def _load():
    reg = Engine.load(REG)
    fac = pd.read_csv(REG / "facilities_verified.csv")
    from .interventions import default_engine
    return reg, fac, default_engine()


@lru_cache(maxsize=1)
def mapping_report() -> dict:
    reg, _, local = _load()
    rn = reg.nodes.set_index("node_id")
    ln = local.nodes.set_index("node_id")
    missing = [n for n in ln.index if n not in rn.index]
    shared = ln.index.intersection(rn.index)
    drift = int(((rn.loc[shared, ["lat", "lon"]] - ln.loc[shared, ["lat", "lon"]]).abs() > 1e-6).any(axis=1).sum())
    m = local.edges.merge(reg.edges, on=["u", "v", "key"], suffixes=("_l", "_r"))
    mismatch = {k: int((m[f"cat{k}_closed_l"] != m[f"cat{k}_closed_r"]).sum()) for k in range(1, 6)}
    return {"method": "identical OSM node ids; validated by coordinates and per-edge closure flags",
            "local_nodes": len(ln), "regional_nodes": len(rn), "local_nodes_missing_in_regional": len(missing),
            "node_coordinate_mismatches": drift, "local_edges": len(local.edges), "local_edges_matched": len(m),
            "closure_flag_mismatches_by_category": mismatch,
            "valid": not missing and not drift and len(m) == len(local.edges) and not any(mismatch.values())}


@lru_cache(maxsize=None)
def _reach(cat: int) -> dict[str, frozenset[int]]:
    """Per facility name: nodes (excluding ED destination nodes) with an open directed route to it."""
    reg, fac, _ = _load()
    g = reg.graph(cat)
    dest = {int(n) for n in fac.nearest_node}
    return {r.name: frozenset(nx.ancestors(g, int(r.nearest_node)) - dest) for r in fac.itertuples(index=False)}


def _sets(cat: int) -> tuple[set[int], set[int]]:
    _, fac, _ = _load()
    per = _reach(cat)
    full_names = fac[fac.facility_type == "full_service_hospital"].name
    full: set[int] = set().union(*[per[n] for n in full_names])
    return set().union(*per.values()), full


def _count(nodes: list[int], origins: list[int], reach: set[int]) -> dict:
    return {"nodes": len(nodes), "nodes_with_route": len(reach & set(nodes)),
            "origins": len(origins), "origins_with_route": len(reach & set(origins))}


def summary(cat: int) -> dict:
    if cat not in CATS:
        raise ValueError(f"category must be 0-5, got {cat}")
    reg, fac, local = _load()
    per = _reach(cat)
    er, full = _sets(cat)
    dest = {int(n) for n in fac.nearest_node}
    ln, lo = [n for n in local.node_ids if n not in dest], [o for o in local.origins if o not in dest]
    rn, ro = [n for n in reg.node_ids if n not in dest], [o for o in reg.origins if o not in dest]
    facs = [{"name": r.name, "facility_type": r.facility_type, "position_quality": r.position_quality,
             "snap_distance_m": float(r.snap_distance_m), "source": r.source, "lon": float(r.lon), "lat": float(r.lat),
             "accessible": len(per[r.name]) > 0, "nodes_that_reach_it": len(per[r.name])} for r in fac.itertuples(index=False)]
    return {"category": cat, "provenance": "simulated", "provisional": True, "model": "regional_6km_access",
            "any_24h_ed": {"local_4km_nodes": _count(ln, lo, er), "regional_nodes": _count(rn, ro, er)},
            "full_service_hospital": {"local_4km_nodes": _count(ln, lo, full), "regional_nodes": _count(rn, ro, full)},
            "facilities": facs, "scope": SCOPE, "mapping_valid": mapping_report()["valid"]}


def zone_summary(cat: int) -> list[dict]:
    from .interventions import default_sim
    zm = default_sim().zm
    _, fac, _ = _load()
    dest = {int(n) for n in fac.nearest_node}
    er, full = _sets(cat)
    out = []
    for zid, ns in zm.zone_nodes.items():
        z = {n for n in ns if n not in dest}
        out.append({"zone": zid, "category": cat, "basis": "local_4km_nodes_routed_on_regional_graph", "nodes": len(z),
                    "nodes_with_24h_ed_route": len(z & er), "nodes_with_full_service_hospital_route": len(z & full)})
    return out
