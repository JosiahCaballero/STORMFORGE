"""Deterministic access engine over the provisional 4 km OSM graph.

Everything here is a pure function of the data files + explicit parameters. No randomness, no network.
Closure rule and facility snapping are ILLUSTRATIVE / PROVISIONAL (see methodology.json).
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

import networkx as nx
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
CATS = (0, 1, 2, 3, 4, 5)
ORIGIN_STRIDE = 18  # every 18th node by sorted id -> 102 origins; fixed, not population-weighted


@dataclass(frozen=True)
class Interventions:
    """Hypothetical, independently computed what-if levers. Never imply any makes a road safe."""
    # edge ids that a high-water emergency vehicle is ASSUMED able to traverse (bin <= max_bin)
    high_water_edges: frozenset[int] = frozenset()
    # extra hypothetical care/staging nodes (not verified facilities)
    staging_nodes: frozenset[int] = frozenset()


@dataclass
class Engine:
    edges: pd.DataFrame
    nodes: pd.DataFrame
    facilities: pd.DataFrame
    methodology: dict
    _cache: dict = field(default_factory=dict)

    # ---- loading ----
    @classmethod
    def load(cls, data_dir: Path = DATA / "access") -> "Engine":
        return cls(
            edges=pd.read_csv(data_dir / "directed_edges.csv"),
            nodes=pd.read_csv(data_dir / "nodes.csv"),
            facilities=pd.read_csv(data_dir / "facilities.csv"),
            methodology=json.loads((data_dir / "methodology.json").read_text()),
        )

    @cached_property
    def node_ids(self) -> list[int]:
        return sorted(int(n) for n in self.nodes.node_id)

    @cached_property
    def origins(self) -> list[int]:
        return self.node_ids[::ORIGIN_STRIDE]

    @cached_property
    def destinations(self) -> list[int]:
        return [int(n) for n in self.facilities.nearest_node]

    # ---- graph ----
    def graph(self, cat: int, iv: Interventions = Interventions()) -> nx.DiGraph:
        """Directed graph of OPEN edges for a category. cat 0 = baseline (nothing closed)."""
        if cat not in CATS:
            raise ValueError(f"category must be 0-5, got {cat}")
        g = nx.DiGraph()
        g.add_nodes_from(self.node_ids)
        col = f"cat{cat}_closed"
        for r in self.edges.itertuples(index=False):
            closed = bool(getattr(r, col)) if cat else False
            if closed and int(r.edge_id) in iv.high_water_edges:
                closed = False
            if closed:
                continue
            # parallel edges: keep the shortest
            if g.has_edge(r.u, r.v) and g[r.u][r.v]["length"] <= r.length_m:
                continue
            g.add_edge(int(r.u), int(r.v), length=float(r.length_m), edge_id=int(r.edge_id))
        return g

    def reach_set(self, cat: int, iv: Interventions = Interventions()) -> set[int]:
        """Nodes that can reach at least one care destination along open directed edges."""
        key = (cat, iv)
        if key not in self._cache:
            g = self.graph(cat, iv)
            reach: set[int] = set()
            for d in [*self.destinations, *sorted(iv.staging_nodes)]:
                if d in g:
                    reach |= nx.ancestors(g, d) | {d}
            self._cache[key] = reach
        return self._cache[key]

    # ---- metrics ----
    def summary(self, cat: int, iv: Interventions = Interventions()) -> dict:
        reach = self.reach_set(cat, iv)
        col = f"cat{cat}_closed"
        closed = int(self.edges[col].sum()) if cat else 0
        closed -= sum(1 for e in iv.high_water_edges if cat and self.edges.at[e, col])
        n_edges = len(self.edges)
        reachable_origins = sum(1 for o in self.origins if o in reach)
        return {
            "category": cat,
            "directed_edges_total": n_edges,
            "directed_edges_closed": closed,
            "directed_edges_open": n_edges - closed,
            "origins_sampled": len(self.origins),
            "origins_with_route": reachable_origins,
            "origins_without_route": len(self.origins) - reachable_origins,
            "nodes_total": len(self.node_ids),
            "nodes_with_route": len(reach),
            "nodes_with_route_pct": round(100 * len(reach) / len(self.node_ids), 1),
            "provenance": "simulated",
            "provisional": True,
        }

    def exposure_bins(self, cat: int) -> pd.Series:
        return self.edges[f"cat{cat}_max_bin"] if cat else pd.Series(dtype=float)

    def facility_snap(self) -> list[dict]:
        nodes = self.nodes.set_index("node_id")
        out = []
        for r in self.facilities.itertuples(index=False):
            n = nodes.loc[int(r.nearest_node)]
            dx = (n.lon - r.lon) * 111320 * math.cos(math.radians(r.lat))
            dy = (n.lat - r.lat) * 110574
            out.append({
                "name": r.name, "lon": r.lon, "lat": r.lat, "nearest_node": int(r.nearest_node),
                "snap_distance_m": round(math.hypot(dx, dy), 1),
                "source": "OpenStreetMap emergency tag", "verified": False,
                "note": "Emergency-department entrance NOT verified; medical accessibility is provisional.",
            })
        return out
