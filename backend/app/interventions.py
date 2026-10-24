"""Hypothetical staging candidates + deterministic intervention evaluation (P3).

Every number is computed by NetworkX over the directed OPEN-edge graph of the Engine. Nothing is estimated.
Staging sites are HYPOTHETICAL basic-medical-staging points snapped to graph nodes. They are NOT facilities,
NOT hospitals, and carry no capacity/clinical assumption. Hospital access and staging access are reported
separately and never merged into "hospital access".

CANDIDATE SELECTION RULE (deterministic, fixed set):
  For each neighbourhood zone (zones.py) except the infrastructure zone, among zone nodes within FIRST_RADIUS_M of the
  zone centre that have >=1 incoming and >=1 outgoing edge and are not on an OSM bridge=yes edge, pick the node minimising
     exposure_score = sum over categories 1..5 of (max NOAA bin over all incident edges, NaN counted as 0);
  ties broken by planar distance to the zone centre, then by node id. A second candidate is taken in the two
  largest zones (uptown_san_marco, west_augustine): same rule, within SECOND_RADIUS_M of the centre and >= SECOND_MIN_SEP_M from the first.
  Per-category feasibility (is the node's own road exposure closed, how many nodes could reach it) is computed from
  the graph so a candidate that is cut off by closures shows honest, tiny benefit.
"""
from __future__ import annotations

from functools import lru_cache

import networkx as nx

from .engine import CATS, Engine
from .zones import ZONE_DEFS, ZoneModel, _dist_m

FIRST_RADIUS_M = 800.0
SECOND_RADIUS_M = 1800.0
SECOND_MIN_SEP_M = 700.0
SECOND_ZONES = ("uptown_san_marco", "west_augustine")
SELECTION_RULE = ("Near zone centre (<=800 m; 2nd pick <=1800 m and >=700 m from 1st), not on a bridge; lowest summed incident-road max NOAA bin (categories 1-5) among zone nodes with in+out edges; "
                  "tie-break nearest zone centre then node id. Hypothetical, not a real facility.")
CANDIDATE_LIMITATIONS = [
    "HYPOTHETICAL basic-medical-staging point, not a real facility; no capacity, staffing or clinical capability modeled.",
    "Staging is never a hospital; access to it is reported separately from hospital access.",
    "Snapped to the nearest graph node; location is not a vetted site (parking, power, land ownership unknown).",
    "Reachability uses the illustrative closure rule over the provisional 4 km graph; not for real emergency decisions.",
]
METRIC_KEYS = ["nodes_total", "nodes_with_hospital_route", "nodes_with_staging_route", "nodes_with_any_care_route",
               "origins_total", "origins_with_hospital_route", "origins_with_staging_route",
               "origins_with_any_care_route"]


@lru_cache(maxsize=1)
def default_engine() -> Engine:
    return Engine.load()


class UnknownCandidates(ValueError):
    def __init__(self, ids):
        self.ids = list(ids)
        super().__init__(f"unknown candidate ids: {self.ids}")


class Sim:
    """Caches per-category graphs and ancestor sets for one Engine."""

    def __init__(self, eng: Engine):
        self.eng = eng
        self.zm = ZoneModel(eng)
        self._graphs: dict[int, nx.DiGraph] = {}
        self._anc: dict[tuple[int, int], frozenset[int]] = {}
        self._hosp: dict[int, frozenset[int]] = {}
        self.candidates = self._select()
        self.by_id = {c["id"]: c for c in self.candidates}

    # ---- graph helpers ----
    def graph(self, cat: int) -> nx.DiGraph:
        if cat not in CATS:
            raise ValueError(f"category must be 0-5, got {cat}")
        if cat not in self._graphs:
            self._graphs[cat] = self.eng.graph(cat)
        return self._graphs[cat]

    def ancestors(self, cat: int, node: int) -> frozenset[int]:
        k = (cat, node)
        if k not in self._anc:
            g = self.graph(cat)
            self._anc[k] = frozenset(nx.ancestors(g, node) | {node}) if node in g else frozenset()
        return self._anc[k]

    def hospital_set(self, cat: int) -> frozenset[int]:
        if cat not in self._hosp:
            s: set[int] = set()
            for d in self.eng.destinations:
                s |= self.ancestors(cat, d)
            self._hosp[cat] = frozenset(s)
        return self._hosp[cat]

    # ---- candidates ----
    def _exposure(self):
        ed = self.eng.edges
        score: dict[int, float] = {}
        for c in range(1, 6):
            col = ed[f"cat{c}_max_bin"].fillna(0)
            m = {}
            for u, v, b in zip(ed.u, ed.v, col):
                for n in (int(u), int(v)):
                    if b > m.get(n, 0):
                        m[n] = b
            for n, b in m.items():
                score[n] = score.get(n, 0) + b
        return score

    def _select(self):
        ed = self.eng.edges
        bridge_nodes = {int(x) for x in [*ed[ed.bridge.notna()].u, *ed[ed.bridge.notna()].v]}
        has_in, has_out = set(map(int, ed.v)), set(map(int, ed.u))
        score = self._exposure()
        names = {}
        for r in ed.itertuples(index=False):
            if isinstance(r.name, str):
                for n in (int(r.u), int(r.v)):
                    names.setdefault(n, set()).add(r.name)
        picks = []
        for zid, zname, kind, (la, lo), _ in ZONE_DEFS:
            if kind != "neighborhood":
                continue
            base_elig = [n for n in self.zm.zone_nodes[zid] if n in has_in and n in has_out and n not in bridge_nodes]
            elig = [n for n in base_elig if _dist_m(*self.zm.coords[n], la, lo) <= FIRST_RADIUS_M]

            def key(n, la=la, lo=lo):
                return (score.get(n, 0), _dist_m(*self.zm.coords[n], la, lo), n)
            first = min(elig, key=key)
            picks.append((zid, zname, first, 1))
            if zid in SECOND_ZONES:
                far = [n for n in base_elig if _dist_m(*self.zm.coords[n], la, lo) <= SECOND_RADIUS_M
                       and _dist_m(*self.zm.coords[n], *self.zm.coords[first]) >= SECOND_MIN_SEP_M]
                picks.append((zid, zname, min(far, key=key), 2))
        out = []
        for zid, zname, n, idx in picks:
            la, lo = self.zm.coords[n]
            suffix = f" {idx}" if zid in SECOND_ZONES else ""
            street = sorted(names.get(n, []))
            cid = f"stage_{zid}" + (f"_{idx}" if zid in SECOND_ZONES else "")
            out.append({
                "id": cid,
                "name": f"Hypothetical staging - {zname}{suffix}" + (f" ({street[0]})" if street else ""),
                "kind": "hypothetical_staging", "zone_id": zid, "lon": lo, "lat": la, "node_id": n,
                "snap_distance_m": 0.0,  # the candidate IS a graph node (no off-graph snapping)
                "selection_rule": SELECTION_RULE, "exposure_score": float(score.get(n, 0)),
                "provenance": "hypothetical", "limitations": list(CANDIDATE_LIMITATIONS),
            })
        for c in out:
            c["feasibility_by_category"] = {str(k): self._feasibility(c["node_id"], k) for k in range(1, 6)}
        return out

    def _feasibility(self, node: int, cat: int):
        ed = self.eng.edges
        inc = ed[(ed.u == node) | (ed.v == node)]
        closed_inc = int(inc[f"cat{cat}_closed"].sum())
        anc = self.ancestors(cat, node)
        g = self.graph(cat)
        return {"incident_edges": int(len(inc)), "incident_edges_closed": closed_inc,
                "own_roads_closed": closed_inc > 0,
                "in_open_edges": g.in_degree(node), "out_open_edges": g.out_degree(node),
                "nodes_that_can_reach": len(anc), "origins_that_can_reach": len(anc & set(self.eng.origins)),
                "reaches_hospital_destination": node in self.hospital_set(cat),
                "provenance": "simulated"}

    # ---- evaluation ----
    def _metrics(self, cat: int, stage_ids: list[str]):
        hosp = self.hospital_set(cat)
        stg: set[int] = set()
        for cid in stage_ids:
            stg |= self.ancestors(cat, self.by_id[cid]["node_id"])
        anyc = hosp | stg
        og = set(self.eng.origins)
        return {"nodes_total": len(self.eng.node_ids), "nodes_with_hospital_route": len(hosp),
                "nodes_with_staging_route": len(stg), "nodes_with_any_care_route": len(anyc),
                "origins_total": len(og), "origins_with_hospital_route": len(og & hosp),
                "origins_with_staging_route": len(og & stg), "origins_with_any_care_route": len(og & anyc),
                "provenance": "simulated"}, anyc

    def _clean(self, candidate_ids):
        seen, ids, warnings = set(), [], []
        for c in candidate_ids:
            if c in seen:
                warnings.append(f"duplicate candidate id '{c}' ignored")
                continue
            seen.add(c)
            ids.append(c)
        unknown = [c for c in ids if c not in self.by_id]
        if unknown:
            raise UnknownCandidates(unknown)
        return ids, warnings

    @staticmethod
    def _delta(a: dict, b: dict) -> dict:
        return {k: b[k] - a[k] for k in METRIC_KEYS}

    def evaluate(self, category: int, candidate_ids: list[str]) -> dict:
        ids, warnings = self._clean(candidate_ids)
        base, base_any = self._metrics(category, [])
        inter, inter_any = self._metrics(category, ids)
        per_cand = []
        for cid in ids:
            m, _ = self._metrics(category, [cid])
            per_cand.append({"id": cid, "marginal": self._delta(base, m), "standalone": m})
        zn = self.zm.zone_nodes
        per_zone = [{"zone_id": z[0], "baseline_any_care_nodes": len(base_any & set(zn[z[0]])),
                     "intervention_any_care_nodes": len(inter_any & set(zn[z[0]])),
                     "zone_nodes": len(zn[z[0]])} for z in ZONE_DEFS]
        if category == 0:
            warnings.append("category 0 has no closures; baseline access is already near-complete.")
        return {"category": category, "candidate_ids": ids, "baseline": base, "intervention": inter,
                "delta": self._delta(base, inter), "per_candidate": per_cand, "per_zone": per_zone,
                "warnings": warnings, "provenance": "simulated",
                "limitations": ["Staging = hypothetical basic medical staging only, never a hospital.",
                                "Hospital destination is provisional (OSM tag, entrance unverified).",
                                "Counts are graph nodes / 102 deterministic origins, not population."]}

    def compare(self, category: int, plans: list[dict]) -> dict:
        base, _ = self._metrics(category, [])
        out = []
        for p in plans:
            ids, w = self._clean(p.get("candidate_ids", []))
            m, _ = self._metrics(category, ids)
            out.append({"label": p.get("label", ""), "candidate_ids": ids, "metrics": m,
                        "delta": self._delta(base, m), "warnings": w})
        return {"category": category, "baseline": base, "plans": out, "provenance": "simulated"}

    def any_care_nodes(self, category: int, candidate_ids: list[str]):
        ids, _ = self._clean(candidate_ids)
        return self._metrics(category, ids)[1]


@lru_cache(maxsize=1)
def default_sim() -> Sim:
    return Sim(default_engine())


def list_candidates() -> list[dict]:
    return [dict(c) for c in default_sim().candidates]


def evaluate_plan(category: int, candidate_ids: list[str]) -> dict:
    return default_sim().evaluate(category, list(candidate_ids))


def compare_plans(category: int, plans: list[dict]) -> dict:
    return default_sim().compare(category, plans)
