"""Deterministic resource-allocation engine (hypothetical inventory, simulated debris, NetworkX road calculations).

The user allocates at REGION level; NetworkX does the road-network work. Everything here is a pure function of
(category, assignments): no randomness at evaluation time (debris uses a fixed documented seed), and the result does not
depend on the order in which assignments were clicked.

Honesty rules baked in:
  * Debris is HYPOTHETICAL and separate from NOAA flooding. Clearing debris never reopens a flood-closed road.
  * "Locations" are road-graph nodes, NOT people or households. Coverage categories are never summed.
  * EMS / supply / medical teams dispatch from ONE provisional (hypothetical) response base; real station locations are
    not in the dataset. Hospital access is a separate metric.
  * Water-rescue = conservative 500 m screening radius from a road-reachable entry point; not a navigable route.
  * Helicopter = one hypothetical priority cluster of at most 10 locations; no flight/landing/hoist claims; roads unchanged.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from functools import lru_cache

import networkx as nx

from .engine import CATS
from .interventions import default_engine, default_sim
from .zones import ZONE_DEFS, _dist_m, default_zone_model

SEED = 20261024
# Illustrative scenario parameters (NOT empirical hurricane debris rates). Actual counts can be lower when too few eligible roads exist.
DEBRIS_TARGETS = {1: 12, 2: 25, 3: 45, 4: 65, 5: 85}
DEBRIS_ZONE_SHARE = 0.4     # preferred max share of a category's debris in one zone; relaxed only when nothing else is eligible
DEBRIS_CLUSTER_P = 0.5      # chance that a pick is drawn from segments within DEBRIS_CLUSTER_M of an earlier pick
DEBRIS_CLUSTER_M = 350.0
DEBRIS_MIN_CRITICALITY = 1  # blocking the segment must cut >= 1 location off from the response base (a relevant connector)
CREW_CAPACITY = 2           # obstructions per clearing crew
WATER_RADIUS_M = 500.0
HELI_MAX_NODES = 10
HELI_CLUSTER_RADIUS_M = 400.0
SERVICE_RADIUS_M = 1500.0  # assumed EMS / supply service radius along the passable road network (not response time)
EMS_CANDIDATE_LIMIT = 40    # deployment-point candidates examined per team (nearest to the zone centre)

RESOURCES = [
    {"id": "debris_crew", "label": "Debris-clearing crew", "action": "Clear Debris", "total": 2},
    {"id": "ems_team", "label": "Road-based EMS team", "action": "Send EMS", "total": 3},
    {"id": "supply_team", "label": "Supply distribution team", "action": "Deliver Supplies", "total": 2},
    {"id": "medical_support", "label": "Temporary medical support site", "action": "Set Up Medical Site", "total": 1},
    {"id": "water_rescue", "label": "Water-rescue team", "action": "Deploy Rescue Team", "total": 2},
    {"id": "helicopter", "label": "Helicopter rescue unit", "action": "Send Helicopter", "total": 1},
]
ORDER = [r["id"] for r in RESOURCES]  # evaluation order: debris -> EMS -> supply -> medical -> water -> helicopter
TOTALS = {r["id"]: r["total"] for r in RESOURCES}
LABELS = {r["id"]: r["label"] for r in RESOURCES}

ASSUMPTIONS = [
    "Inventory is hypothetical (11 units); not real agency resources.",
    "Debris obstructions are simulated (fixed seed, documented) and separate from NOAA flooding.",
    "Clearing debris never reopens roads closed by modeled flooding.",
    "EMS, supply and medical teams start from one provisional, hypothetical response base; real station locations are not modeled.",
    "A 'location' is a road-network graph node, not a person or household; no population is modeled.",
    f"EMS coverage = locations within {SERVICE_RADIUS_M:.0f} m of road travel from the team's point; supply access = locations within {SERVICE_RADIUS_M:.0f} m of road travel TO the supply point. The radius is an assumption, not a response-time estimate.",
    f"Potential water rescue = flood-exposed locations within {WATER_RADIUS_M:.0f} m (straight line) of a road-reachable entry point; not a navigable route and not confirmed feasibility.",
    f"Potential helicopter rescue = one hypothetical priority cluster of at most {HELI_MAX_NODES} locations; no flight, landing or hoist feasibility is claimed and roads are unchanged.",
    "Coverage categories (EMS, supply, medical support, water rescue, helicopter) are reported separately and never summed; hospital access is separate again.",
]


class AllocationError(ValueError):
    """Invalid request shape (unknown resource / zone / category) -> HTTP 422."""


def _norm(label: str | None) -> str:
    return label if isinstance(label, str) and label else "unnamed road"


@dataclass
class Obstruction:
    id: str
    segment: tuple[int, int]
    zone_id: str | None
    name: str
    highway: str
    length_m: float
    criticality: int
    edge_ids: list[int]
    flood_closed_edge_ids: list[int]
    open_edges: list[tuple[int, int, float]]  # directed edges that debris actually removes (not flood-closed)

    def public(self, cleared: bool) -> dict:
        return {"id": self.id, "zone_id": self.zone_id, "name": self.name, "highway": self.highway,
                "length_m": round(self.length_m, 1), "edge_ids": self.edge_ids,
                "flood_closed_edge_ids": self.flood_closed_edge_ids,
                "reason": "debris" + (" + flooding" if self.flood_closed_edge_ids else ""),
                "cut_off_locations_if_blocked": self.criticality, "cleared": cleared}


@dataclass
class Placement:
    resource: str
    zone_id: str
    node_id: int | None = None
    candidate_id: str | None = None
    coverage: set[int] = field(default_factory=set)
    new: int = 0
    extra: dict = field(default_factory=dict)


class AllocationModel:
    def __init__(self):
        self.eng = default_engine()
        self.sim = default_sim()
        self.zm = default_zone_model()
        e = self.eng.edges
        self.coords = self.zm.coords  # node -> (lat, lon)
        self.node_zone = self.zm.node_zone
        self.zone_ids = [z[0] for z in ZONE_DEFS]
        self.zone_name = {z[0]: z[1] for z in ZONE_DEFS}
        self.zone_center = {z[0]: z[3] for z in ZONE_DEFS}
        self.zone_sets = {z: set(ns) for z, ns in self.zm.zone_nodes.items()}
        self.hospital = int(self.eng.destinations[0])
        self.node_total = len(self.eng.node_ids)
        # labels
        self.node_label: dict[int, str] = {}
        for r in e.sort_values("edge_id").itertuples(index=False):
            nm = r.name if isinstance(r.name, str) and r.name else None
            if nm:
                self.node_label.setdefault(int(r.u), nm)
                self.node_label.setdefault(int(r.v), nm)
        # physical segments (unordered node pair); debris obstructs ALL directed edges between the pair
        self.seg_edges: dict[tuple[int, int], list[int]] = defaultdict(list)
        self.edge_row: dict[int, tuple] = {}
        for r in e.itertuples(index=False):
            k = (min(int(r.u), int(r.v)), max(int(r.u), int(r.v)))
            self.seg_edges[k].append(int(r.edge_id))
            self.edge_row[int(r.edge_id)] = (int(r.u), int(r.v), float(r.length_m), r.name, r.highway, isinstance(r.bridge, str))
        self.base = self._pick_base()
        self._debris: dict[int, list[Obstruction]] = {}
        self._flood_nodes: dict[int, frozenset[int]] = {}
        self._eval_cache: dict = {}

    # ------------------------------------------------------------------ response base
    def _pick_base(self) -> int:
        """Node in the largest strongly connected road component at Category 5 (it stays inside the main component in every
        category since closures only grow), nearest that component's centroid. HYPOTHETICAL, not a real station."""
        g5 = self.sim.graph(5)
        comp = max(nx.strongly_connected_components(g5), key=len)
        la = sum(self.coords[n][0] for n in comp) / len(comp)
        lo = sum(self.coords[n][1] for n in comp) / len(comp)
        return min(comp, key=lambda n: (_dist_m(self.coords[n][0], self.coords[n][1], la, lo), n))

    def base_info(self) -> dict:
        la, lo = self.coords[self.base]
        return {"node_id": self.base, "lon": lo, "lat": la, "label": f"Provisional response base ({self.node_label.get(self.base, 'unnamed road')})",
                "zone_id": self.node_zone.get(self.base), "provenance": "hypothetical",
                "disclosure": "Hypothetical response base chosen on a road that stays connected in every category. Real EMS/station locations are not in the dataset. "
                              "The only OSM hospital node is a dead end that floods shut at Category 3+, so it cannot serve as a dispatch origin."}

    # ------------------------------------------------------------------ graphs
    def flood_graph(self, cat: int) -> nx.DiGraph:
        return self.sim.graph(cat)

    def flood_nodes(self, cat: int) -> frozenset[int]:
        """Nodes touching at least one flood-closed directed edge (modeled flooded roads)."""
        if cat not in self._flood_nodes:
            if cat == 0:
                self._flood_nodes[cat] = frozenset()
            else:
                c = self.eng.edges[self.eng.edges[f"cat{cat}_closed"] == 1]
                self._flood_nodes[cat] = frozenset(int(x) for x in [*c.u, *c.v])
        return self._flood_nodes[cat]

    def _reach(self, g: nx.DiGraph, n: int) -> set[int]:
        return (nx.descendants(g, n) | {n}) if n in g else set()

    def _within(self, g: nx.DiGraph, n: int, forward: bool) -> set[int]:
        """Nodes within SERVICE_RADIUS_M of road travel FROM n (forward) or TO n (reverse), on the passable graph."""
        if n not in g:
            return set()
        view = g if forward else g.reverse(copy=False)
        return set(nx.single_source_dijkstra_path_length(view, n, cutoff=SERVICE_RADIUS_M, weight="length"))

    def _anc(self, g: nx.DiGraph, n: int) -> set[int]:
        return (nx.ancestors(g, n) | {n}) if n in g else set()

    # ------------------------------------------------------------------ debris
    def debris(self, cat: int) -> list[Obstruction]:
        if cat not in self._debris:
            self._debris[cat] = self._gen_debris(cat) if cat else []
        return self._debris[cat]

    def _gen_debris(self, cat: int) -> list[Obstruction]:
        g = self.flood_graph(cat)
        reach0 = self._reach(g, self.base)
        closed = self.eng.edges.set_index("edge_id")[f"cat{cat}_closed"]
        pool = []
        for key in sorted(self.seg_edges):
            a, b = key
            eids = self.seg_edges[key]
            if any(self.edge_row[e][5] for e in eids):          # bridges excluded
                continue
            if not (g.has_edge(a, b) or g.has_edge(b, a)):       # already fully flood-closed
                continue
            if a not in reach0 and b not in reach0:              # unreachable from base: irrelevant to useful connectivity
                continue
            h = g.copy()
            h.remove_edges_from([(a, b), (b, a)])
            crit = len(reach0) - len(self._reach(h, self.base))
            if crit >= DEBRIS_MIN_CRITICALITY:
                pool.append((key, crit))
        rng = random.Random(f"stormforge-debris-{SEED}-{cat}")
        rng.shuffle(pool)
        target = DEBRIS_TARGETS[cat]
        cap = max(1, math.ceil(target * DEBRIS_ZONE_SHARE))
        per_zone: dict = defaultdict(int)
        chosen: list = []

        def mid(key):
            (la1, lo1), (la2, lo2) = self.coords[key[0]], self.coords[key[1]]
            return (la1 + la2) / 2, (lo1 + lo2) / 2

        def near(key):
            la, lo = mid(key)
            return any(_dist_m(la, lo, *mid(c[0])) <= DEBRIS_CLUSTER_M for c in chosen)

        remaining = [(k, c) for k, c in pool]
        while remaining and len(chosen) < target:
            ok = [i for i, (k, _) in enumerate(remaining) if per_zone[self.node_zone.get(k[0])] < cap]
            if not ok:  # zone share is a preference for spread; if nothing else is eligible, allow it so targets are still met
                ok = list(range(len(remaining)))
            pick = ok[0]
            if chosen and rng.random() < DEBRIS_CLUSTER_P:
                close = [i for i in ok if near(remaining[i][0])]
                if close:
                    pick = rng.choice(close)
            key, crit = remaining.pop(pick)
            per_zone[self.node_zone.get(key[0])] += 1
            chosen.append((key, crit))
        chosen.sort(key=lambda t: t[0])
        out = []
        for i, (key, crit) in enumerate(chosen, 1):
            eids = self.seg_edges[key]
            rows = [self.edge_row[e] for e in eids]
            fc = [e for e in eids if int(closed.loc[e]) == 1]
            open_edges = [(self.edge_row[e][0], self.edge_row[e][1], self.edge_row[e][2]) for e in eids if int(closed.loc[e]) != 1]
            nm = next((_norm(r[3]) for r in rows if isinstance(r[3], str) and r[3]), "unnamed road")
            out.append(Obstruction(id=f"D{cat}-{i:02d}", segment=key, zone_id=self.node_zone.get(key[0]), name=nm,
                                   highway=str(rows[0][4]), length_m=max(r[2] for r in rows), criticality=crit,
                                   edge_ids=eids, flood_closed_edge_ids=fc, open_edges=open_edges))
        return out

    def debris_meta(self, cat: int) -> dict:
        return {"seed": SEED, "per_category_seed": f"stormforge-debris-{SEED}-{cat}", "target_count": DEBRIS_TARGETS.get(cat), "actual_count": len(self.debris(cat)),
                "per_zone_cap": max(1, math.ceil((DEBRIS_TARGETS.get(cat) or 0) * DEBRIS_ZONE_SHARE)), "clustering": f"{int(DEBRIS_CLUSTER_P*100)}% of picks within {DEBRIS_CLUSTER_M:.0f} m of an earlier pick", "min_cut_off_locations": DEBRIS_MIN_CRITICALITY,
                "rule": "Seeded, mildly clustered sample of passable, non-bridge road segments whose blockage would cut >= 1 location off from the response base. "
                        "Target counts per category are illustrative scenario parameters, not empirical debris rates. Hypothetical; independent of NOAA flooding.", "provenance": "hypothetical"}

    def _block(self, g: nx.DiGraph, o: Obstruction) -> None:
        g.remove_edges_from([(u, v) for u, v, _ in o.open_edges if g.has_edge(u, v)])

    def _unblock(self, g: nx.DiGraph, o: Obstruction) -> None:
        for u, v, ln in o.open_edges:
            if not g.has_edge(u, v):
                g.add_edge(u, v, length=ln)

    def graph_with_debris(self, cat: int) -> nx.DiGraph:
        g = self.flood_graph(cat).copy()
        for o in self.debris(cat):
            self._block(g, o)
        return g

    # ------------------------------------------------------------------ placement helpers
    def _dist_center(self, zid: str, n: int) -> float:
        la, lo = self.zone_center[zid]
        return _dist_m(self.coords[n][0], self.coords[n][1], la, lo)

    def _zone_candidates(self, zid: str, base_reach: set[int], exclude: set[int]) -> list[int]:
        ns = [n for n in self.zone_sets[zid] if n in base_reach and n not in exclude]
        ns.sort(key=lambda n: (self._dist_center(zid, n), n))
        return ns[:EMS_CANDIDATE_LIMIT]

    def _place_crew(self, cat: int, g: nx.DiGraph, zid: str, cleared: set[str]) -> tuple[Placement | None, str | None]:
        eligible_all = [o for o in self.debris(cat) if o.zone_id == zid and o.id not in cleared]
        if not eligible_all:
            return None, "no_eligible_debris"
        picks: list[Obstruction] = []
        reach_before = self._reach(g, self.base)
        hosp_before = len(self._anc(g, self.hospital))
        for _ in range(CREW_CAPACITY):
            cur = self._reach(g, self.base)
            best = None
            for o in eligible_all:
                if o in picks or (o.segment[0] not in cur and o.segment[1] not in cur):
                    continue  # the crew must be able to reach the obstruction from the response base
                self._unblock(g, o)
                gain = len(self._reach(g, self.base)) - len(cur)
                self._block(g, o)
                if best is None or gain > best[0]:
                    best = (gain, o)
            if best is None:
                break
            self._unblock(g, best[1])
            picks.append(best[1])
        if not picks:
            return None, "debris_not_reachable"
        reach_after = self._reach(g, self.base)
        hosp_after = len(self._anc(g, self.hospital))
        pl = Placement("debris_crew", zid)
        pl.extra = {"cleared_obstruction_ids": [o.id for o in picks], "cleared_edge_ids": sorted(e for o in picks for e in o.edge_ids),
                    "cleared": [{"id": o.id, "name": o.name} for o in picks],
                    "response_reach_gain": len(reach_after) - len(reach_before), "hospital_gain": hosp_after - hosp_before}
        pl.new = len(reach_after) - len(reach_before)
        return pl, None

    def _place_forward(self, g: nx.DiGraph, zid: str, kind: str, covered: set[int], used: set[int], base_reach: set[int]):
        """EMS (kind='ems': locations drivable FROM the point) / supply (kind='supply': locations that can drive TO the point)."""
        cands = self._zone_candidates(zid, base_reach, used)
        if not cands:
            return None, "no_reachable_point"
        best = None
        for n in cands:
            cov = self._within(g, n, kind == "ems")
            new = len(cov - covered)
            key = (new, -self._dist_center(zid, n), -n)
            if best is None or key > best[0]:
                best = (key, n, cov, new)
        _, n, cov, new = best
        pl = Placement("ems_team" if kind == "ems" else "supply_team", zid, node_id=n, coverage=cov, new=new)
        pl.extra = {"street": self.node_label.get(n, "unnamed road")}
        return pl, None

    def _place_medical(self, g: nx.DiGraph, zid: str, cand_id: str | None, covered: set[int], used: set[str], base_reach: set[int]):
        cands = [c for c in self.sim.candidates if c["zone_id"] == zid and c["id"] not in used]
        if cand_id:
            c = next((c for c in self.sim.candidates if c["id"] == cand_id), None)
            if c is None:
                return None, "unknown_candidate"
            if c["zone_id"] != zid:
                return None, "candidate_not_in_region"
            cands = [c]
        if not cands:
            return None, "no_candidate_site"
        cands = [c for c in cands if int(c["node_id"]) in base_reach]
        if not cands:
            return None, "no_reachable_point"
        scored = []
        for c in cands:
            cov = self._anc(g, int(c["node_id"]))
            scored.append((-len(cov - covered), c["id"], c, cov))
        scored.sort(key=lambda t: (t[0], t[1]))
        best = (-scored[0][0], scored[0][2], scored[0][3])
        new, c, cov = best
        pl = Placement("medical_support", zid, node_id=int(c["node_id"]), candidate_id=c["id"], coverage=cov, new=new)
        pl.extra = {"name": c.get("name"), "street": self.node_label.get(int(c["node_id"]), "unnamed road")}
        return pl, None

    def _place_water(self, cat: int, zid: str, base_reach: set[int], covered: set[int], used: set[int]):
        targets_all = self.flood_nodes(cat) & self.zone_sets[zid]
        if not targets_all:
            return None, "no_flood_exposed_locations"
        # entry points: every road-reachable node in the region (deterministic centre-distance order)
        entries = [n for n in sorted(self.zone_sets[zid], key=lambda n: (self._dist_center(zid, n), n)) if n in base_reach and n not in used]
        if not entries:
            return None, "no_reachable_point"
        best = None
        for n in entries:
            la, lo = self.coords[n]
            tg = {t for t in targets_all if t != n and _dist_m(la, lo, *self.coords[t]) <= WATER_RADIUS_M}
            new = len(tg - covered)
            key = (new, -self._dist_center(zid, n), -n)
            if new > 0 and (best is None or key > best[0]):
                best = (key, n, tg, new)
        if best is None:
            return None, "no_target_within_radius"
        _, n, tg, new = best
        pl = Placement("water_rescue", zid, node_id=n, coverage=tg, new=new)
        pl.extra = {"street": self.node_label.get(n, "unnamed road"), "radius_m": WATER_RADIUS_M}
        return pl, None

    def _place_heli(self, cat: int, zid: str, g: nx.DiGraph, base_reach: set[int], ground: set[int]):
        flood = self.flood_nodes(cat)
        elig = sorted(n for n in self.zone_sets[zid] if (n in flood or n not in base_reach) and n not in ground)
        if not elig:
            return None, "no_isolated_locations"
        best = None
        for s in elig:
            la, lo = self.coords[s]
            near = sorted(((_dist_m(la, lo, *self.coords[t]), t) for t in elig if t != s and _dist_m(la, lo, *self.coords[t]) <= HELI_CLUSTER_RADIUS_M))
            cluster = [s] + [t for _, t in near[: HELI_MAX_NODES - 1]]
            weight = (2 if s not in base_reach else 0) + (1 if s in flood else 0)
            key = (len(cluster), weight, -s)
            if best is None or key > best[0]:
                best = (key, s, cluster, weight)
        _, s, cluster, weight = best
        pl = Placement("helicopter", zid, node_id=s, coverage=set(cluster), new=len(cluster))
        pl.extra = {"street": self.node_label.get(s, "unnamed road"), "seed_isolation_weight": weight, "max_nodes": HELI_MAX_NODES}
        return pl, None

    # ------------------------------------------------------------------ metrics
    def _metrics(self, cat: int, g: nx.DiGraph, pls: list[Placement], cleared: set[str]) -> dict:
        hosp = self._anc(g, self.hospital)
        reach = self._reach(g, self.base)
        cov = {k: set() for k in ORDER}
        for p in pls:
            cov[p.resource] |= p.coverage
        flood = self.flood_nodes(cat)
        glob = {"locations_total": self.node_total, "hospital_locations": len(hosp), "response_reach_locations": len(reach),
                "ems_locations": len(cov["ems_team"]), "supply_locations": len(cov["supply_team"]),
                "medical_support_locations": len(cov["medical_support"]), "water_rescue_locations": len(cov["water_rescue"]),
                "helicopter_locations": len(cov["helicopter"])}
        deb = self.debris(cat)
        zones = {}
        for z in self.zone_ids:
            zs = self.zone_sets[z]
            fl = flood & zs
            zones[z] = {"zone_nodes": len(zs), "hospital_locations": len(hosp & zs), "response_reach_locations": len(reach & zs),
                        "cut_off_locations": len(zs - reach), "ems_locations": len(cov["ems_team"] & zs),
                        "supply_locations": len(cov["supply_team"] & zs), "medical_support_locations": len(cov["medical_support"] & zs),
                        "water_rescue_locations": len(cov["water_rescue"] & zs), "helicopter_locations": len(cov["helicopter"] & zs),
                        "flood_exposed_locations": len(fl),
                        "debris_blocked": sum(1 for o in deb if o.zone_id == z and o.id not in cleared),
                        "debris_cleared": sum(1 for o in deb if o.zone_id == z and o.id in cleared)}
        return {"global": glob, "zones": zones, "_sets": {"reach": reach, "hosp": hosp, "cov": cov}}

    def zone_flood_segments(self, cat: int) -> dict[str, int]:
        out = {z: 0 for z in self.zone_ids}
        if cat == 0:
            return out
        closed = self.eng.edges[self.eng.edges[f"cat{cat}_closed"] == 1]
        seen = set()
        for r in closed.itertuples(index=False):
            k = (min(int(r.u), int(r.v)), max(int(r.u), int(r.v)))
            if k in seen:
                continue
            seen.add(k)
            z = self.node_zone.get(k[0])
            if z:
                out[z] += 1
        return out

    # ------------------------------------------------------------------ public: setup / evaluate
    def setup(self, cat: int) -> dict:
        self._check_cat(cat)
        g = self.graph_with_debris(cat)
        m = self._metrics(cat, g, [], set())
        flood_seg = self.zone_flood_segments(cat)
        zones = []
        for z in self.zone_ids:
            zm = m["zones"][z]
            zones.append({"zone_id": z, "name": self.zone_name[z], "kind": "infrastructure" if z == "bridge_corridor" else "neighborhood",
                          "flooded_road_segments": flood_seg[z], "debris_blocked": zm["debris_blocked"], "locations": zm["zone_nodes"],
                          "cut_off_locations": zm["cut_off_locations"], "hospital_locations": zm["hospital_locations"],
                          "flood_exposed_locations": zm["flood_exposed_locations"],
                          "cut_off_pct": round(100 * zm["cut_off_locations"] / zm["zone_nodes"], 1) if zm["zone_nodes"] else 0.0})
        order = sorted(zones, key=lambda z: (-z["cut_off_pct"], z["zone_id"]))
        return {"category": cat, "inventory": [{**r, "used": 0, "remaining": r["total"]} for r in RESOURCES],
                "total_units": sum(TOTALS.values()), "base": self.base_info(), "zones": zones,
                "attention_order": [z["zone_id"] for z in order],
                "debris": [o.public(False) for o in self.debris(cat)], "debris_meta": self.debris_meta(cat),
                "medical_candidates": [{"id": c["id"], "name": c["name"], "zone_id": c["zone_id"], "lon": c["lon"], "lat": c["lat"], "node_id": c["node_id"]} for c in self.sim.candidates],
                "assumptions": ASSUMPTIONS, "settings": {"service_radius_m": SERVICE_RADIUS_M, "water_rescue_radius_m": WATER_RADIUS_M, "helicopter_max_locations": HELI_MAX_NODES,
                                                          "crew_capacity": CREW_CAPACITY},
                "global_before": {k: v for k, v in m["global"].items()}, "provenance": "simulated"}

    def _check_cat(self, cat: int):
        if cat not in CATS:
            raise AllocationError("category must be an integer 0-5")

    def _pts(self, ns) -> list[list[float]]:
        return [[round(self.coords[n][1], 6), round(self.coords[n][0], 6)] for n in sorted(ns)]

    def evaluate(self, cat: int, assignments: list[dict]) -> dict:
        self._check_cat(cat)
        asg = []
        for i, a in enumerate(assignments):
            r, z = a.get("resource"), a.get("zone_id")
            if r not in TOTALS:
                raise AllocationError(f"unknown resource '{r}'")
            if z not in self.zone_ids:
                raise AllocationError(f"unknown zone '{z}'")
            asg.append({"index": i, "resource": r, "zone_id": z, "candidate_id": a.get("candidate_id")})
        canon_key = (cat, tuple((a["resource"], a["zone_id"], a["candidate_id"]) for a in sorted(asg, key=lambda a: (ORDER.index(a["resource"]), a["zone_id"], a["candidate_id"] or "", a["index"]))))
        if canon_key in self._eval_cache:
            return self._reindex(self._eval_cache[canon_key], asg)
        res = self._evaluate(cat, asg)
        if len(self._eval_cache) > 400:
            self._eval_cache.clear()
        self._eval_cache[canon_key] = res
        return self._reindex(res, asg)

    def _reindex(self, res: dict, asg: list[dict]) -> dict:
        """Cached results are canonical; map each effect back to the caller's original click index (stable, order-independent)."""
        canon = sorted(asg, key=lambda a: (ORDER.index(a["resource"]), a["zone_id"], a["candidate_id"] or "", a["index"]))
        out = dict(res)
        out["assignments"] = [{**e, "index": canon[i]["index"]} for i, e in enumerate(res["assignments"])]
        return out

    def _evaluate(self, cat: int, asg: list[dict]) -> dict:
        canon = sorted(asg, key=lambda a: (ORDER.index(a["resource"]), a["zone_id"], a["candidate_id"] or "", a["index"]))
        g0 = self.graph_with_debris(cat)
        before = self._metrics(cat, g0, [], set())
        g = g0.copy()
        cleared: set[str] = set()
        used = defaultdict(int)
        effects: list[dict] = []
        placements: list[Placement] = []
        pending: list[tuple[dict, dict]] = []  # (assignment, effect shell)

        def reject(a, reason, text):
            effects.append({"index": a["index"], "resource": a["resource"], "zone_id": a["zone_id"], "zone_name": self.zone_name[a["zone_id"]],
                            "status": "rejected", "reason": reason, "message": text, "new_locations": 0, "consumed": False})

        def accept(a, pl, text, extra=None):
            used[a["resource"]] += 1
            placements.append(pl)
            effects.append({"index": a["index"], "resource": a["resource"], "zone_id": a["zone_id"], "zone_name": self.zone_name[a["zone_id"]],
                            "status": "placed", "reason": None, "message": text, "new_locations": pl.new, "consumed": True,
                            "details": {**pl.extra, **(extra or {})}})

        zn = self.zone_name
        # 1-2. flood + debris already applied (g0). 3. debris crews.
        by_res = defaultdict(list)
        for a in canon:
            by_res[a["resource"]].append(a)

        def full(a) -> bool:
            if used[a["resource"]] >= TOTALS[a["resource"]]:
                reject(a, "inventory_exceeded", f"All {TOTALS[a['resource']]} {LABELS[a['resource']].lower()} unit(s) are already deployed.")
                return True
            return False

        # Crews are retried until no more progress: clearing upstream debris (another region's crew) can make a later
        # crew's obstructions reachable. Deterministic because the order is canonical.
        pending = list(by_res["debris_crew"])
        progress = True
        while pending and progress:
            progress, nxt = False, []
            for a in pending:
                if full(a):
                    continue
                pl, why = self._place_crew(cat, g, a["zone_id"], cleared)
                if pl is None:
                    if why == "debris_not_reachable":
                        nxt.append(a)
                    else:
                        reject(a, why, f"No debris-blocked roads to clear in {zn[a['zone_id']]}.")
                    continue
                progress = True
                cleared |= set(pl.extra["cleared_obstruction_ids"])
                n = len(pl.extra["cleared_obstruction_ids"])
                gain = pl.extra["response_reach_gain"]
                accept(a, pl, f"This crew cleared {n} blocked road segment{'s' if n != 1 else ''} in {zn[a['zone_id']]}"
                              + (f", allowing access to {gain} additional road-network locations." if gain > 0 else ", but no additional locations became reachable from the response base."))
            pending = nxt
        for a in pending:
            if not full(a):
                reject(a, "debris_not_reachable", f"Debris in {zn[a['zone_id']]} cannot be reached from the response base.")
        # 4. recompute passable network
        base_reach = self._reach(g, self.base)
        covered = {k: set() for k in ORDER}
        used_nodes: set[int] = set()
        used_med: set[str] = set()
        # 5. EMS, supply, medical
        for a in by_res["ems_team"]:
            if full(a):
                continue
            pl, why = self._place_forward(g, a["zone_id"], "ems", covered["ems_team"], used_nodes, base_reach)
            if pl is None:
                reject(a, why, f"No road location in {zn[a['zone_id']]} can be reached from the response base after flooding and debris.")
                continue
            covered["ems_team"] |= pl.coverage
            used_nodes.add(pl.node_id)
            accept(a, pl, f"EMS team positioned in {zn[a['zone_id']]} ({pl.extra['street']}): {len(pl.coverage)} road-network locations within {SERVICE_RADIUS_M:.0f} m of travel, {pl.new} newly covered.")
        for a in by_res["supply_team"]:
            if full(a):
                continue
            pl, why = self._place_forward(g, a["zone_id"], "supply", covered["supply_team"], used_nodes, base_reach)
            if pl is None:
                reject(a, why, f"No road location in {zn[a['zone_id']]} can be reached from the response base after flooding and debris.")
                continue
            covered["supply_team"] |= pl.coverage
            used_nodes.add(pl.node_id)
            accept(a, pl, f"Supply point set up in {zn[a['zone_id']]} ({pl.extra['street']}): {len(pl.coverage)} road-network locations within {SERVICE_RADIUS_M:.0f} m of travel can reach it, {pl.new} newly covered.")
        for a in by_res["medical_support"]:
            if full(a):
                continue
            pl, why = self._place_medical(g, a["zone_id"], a["candidate_id"], covered["medical_support"], used_med, base_reach)
            if pl is None:
                msg = {"no_candidate_site": f"No temporary medical site candidate exists in {zn[a['zone_id']]}.",
                       "no_reachable_point": f"The candidate site(s) in {zn[a['zone_id']]} cannot be reached from the response base.",
                       "candidate_not_in_region": "That candidate site is not in the selected region.", "unknown_candidate": "Unknown candidate site."}[why]
                reject(a, why, msg)
                continue
            covered["medical_support"] |= pl.coverage
            used_med.add(pl.candidate_id)
            accept(a, pl, f"Temporary medical support site set up in {zn[a['zone_id']]}: {len(pl.coverage)} locations can reach it, {pl.new} newly covered. Not a hospital.")
        # 6. water rescue
        for a in by_res["water_rescue"]:
            if full(a):
                continue
            pl, why = self._place_water(cat, a["zone_id"], base_reach, covered["water_rescue"], used_nodes)
            if pl is None:
                reject(a, why, {"no_flood_exposed_locations": f"{zn[a['zone_id']]} has no modeled flood-exposed locations.",
                                "no_reachable_point": f"No road entry point in {zn[a['zone_id']]} can be reached from the response base.",
                                "no_target_within_radius": f"No flood-exposed location in {zn[a['zone_id']]} lies within {WATER_RADIUS_M:.0f} m of a reachable entry point."}[why])
                continue
            covered["water_rescue"] |= pl.coverage
            used_nodes.add(pl.node_id)
            accept(a, pl, f"Water-rescue team staged in {zn[a['zone_id']]} ({pl.extra['street']}): potential coverage of {len(pl.coverage)} flood-exposed locations within {WATER_RADIUS_M:.0f} m ({pl.new} new). Screening only; not a confirmed rescue route.")
        # 7. helicopter
        for a in by_res["helicopter"]:
            if full(a):
                continue
            ground = covered["ems_team"] | covered["water_rescue"]
            pl, why = self._place_heli(cat, a["zone_id"], g, base_reach, ground)
            if pl is None:
                reject(a, why, f"No isolated, flood-exposed or cut-off locations in {zn[a['zone_id']]} remain outside ground-team coverage.")
                continue
            covered["helicopter"] |= pl.coverage
            accept(a, pl, f"Hypothetical helicopter priority target in {zn[a['zone_id']]}: a cluster of {len(pl.coverage)} locations. No flight, landing or hoist feasibility is claimed; roads are unchanged.")
        # 8. final metrics
        after = self._metrics(cat, g, placements, cleared)
        effects.sort(key=lambda e: next(i for i, a in enumerate(canon) if a["index"] == e["index"]))
        gb, ga = before["global"], after["global"]
        flood_seg = self.zone_flood_segments(cat)
        deb = self.debris(cat)
        zones_out = []
        for z in self.zone_ids:
            zb, za = before["zones"][z], after["zones"][z]
            delta = {k: za[k] - zb[k] for k in za}
            rem = []
            if za["debris_blocked"]:
                rem.append({"kind": "debris", "count": za["debris_blocked"], "text": f"{za['debris_blocked']} debris-blocked road segment{'s' if za['debris_blocked'] != 1 else ''} remain"})
            if cat and za["cut_off_locations"]:
                rem.append({"kind": "cut_off", "count": za["cut_off_locations"], "text": f"{za['cut_off_locations']} of {za['zone_nodes']} locations cannot be reached by road from the response base"})
            if cat and za["hospital_locations"] < za["zone_nodes"]:
                rem.append({"kind": "hospital", "count": za["zone_nodes"] - za["hospital_locations"], "text": f"{za['zone_nodes'] - za['hospital_locations']} of {za['zone_nodes']} locations cannot reach a hospital"})
            if za["flood_exposed_locations"] and za["water_rescue_locations"] < za["flood_exposed_locations"]:
                rem.append({"kind": "water", "count": za["flood_exposed_locations"] - za["water_rescue_locations"], "text": f"{za['flood_exposed_locations'] - za['water_rescue_locations']} flood-exposed locations lack potential water-rescue coverage"})
            zones_out.append({"zone_id": z, "name": self.zone_name[z], "flooded_road_segments": flood_seg[z], "before": zb, "after": za, "delta": delta,
                              "resources": [{"resource": e["resource"], "message": e["message"]} for e in effects if e["zone_id"] == z and e["status"] == "placed"],
                              "remaining": rem})
        inv = [{**r, "used": used[r["id"]], "remaining": r["total"] - used[r["id"]]} for r in RESOURCES]
        lay = {"ems": [], "supply": [], "water": [], "helicopter": [], "medical": []}
        for p in placements:
            la, lo = self.coords[p.node_id] if p.node_id is not None else (None, None)
            item = {"zone_id": p.zone_id, "node_id": p.node_id, "point": [lo, la], "street": p.extra.get("street")}
            if p.resource == "ems_team":
                lay["ems"].append({**item, "coverage": self._pts(p.coverage)})
            elif p.resource == "supply_team":
                lay["supply"].append({**item, "coverage": self._pts(p.coverage)})
            elif p.resource == "medical_support":
                lay["medical"].append({**item, "candidate_id": p.candidate_id, "name": p.extra.get("name"), "coverage": self._pts(p.coverage)})
            elif p.resource == "water_rescue":
                lay["water"].append({**item, "targets": self._pts(p.coverage), "radius_m": WATER_RADIUS_M})
            elif p.resource == "helicopter":
                lay["helicopter"].append({**item, "cluster": self._pts(p.coverage)})
        cleared_edges = sorted(e for o in deb if o.id in cleared for e in o.edge_ids)
        return {
            "category": cat, "inventory": inv, "units_used": sum(used.values()), "units_total": sum(TOTALS.values()),
            "assignments": effects, "rejected": [e for e in effects if e["status"] == "rejected"],
            "roads": {"flooded_segments": sum(flood_seg.values()), "debris_total": len(deb), "debris_cleared": len(cleared),
                      "debris_remaining": len(deb) - len(cleared), "cleared_obstruction_ids": sorted(cleared), "cleared_edge_ids": cleared_edges,
                      "debris": [o.public(o.id in cleared) for o in deb],
                      "passable_directed_edges": g.number_of_edges(), "flood_only_directed_edges": self.flood_graph(cat).number_of_edges()},
            "metrics": {"before": gb, "after": ga, "delta": {k: ga[k] - gb[k] for k in ga}},
            "zones": zones_out, "layers": lay, "base": self.base_info(), "assumptions": ASSUMPTIONS, "provenance": "simulated",
            "notes": "All numbers are computed by NetworkX over the provisional road graph; locations are graph nodes, not people.",
        }

    # ------------------------------------------------------------------ compare / candidate actions
    def compare(self, cat: int, plans: list[dict]) -> dict:
        outs = []
        for p in plans:
            r = self.evaluate(cat, p.get("assignments", []))
            outs.append({"label": p.get("label", "plan"), "result": r})
        out = {"category": cat, "plans": outs}
        if len(outs) == 2:
            a, b = outs
            sa = sorted((x["resource"], x["zone_id"]) for x in a["result"]["assignments"] if x["status"] == "placed")
            sb = sorted((x["resource"], x["zone_id"]) for x in b["result"]["assignments"] if x["status"] == "placed")
            ca, cb = defaultdict(int), defaultdict(int)
            for k in sa:
                ca[k] += 1
            for k in sb:
                cb[k] += 1
            keys = sorted(set(ca) | set(cb))
            out["assignment_diff"] = [{"resource": r, "zone_id": z, a["label"]: ca[(r, z)], b["label"]: cb[(r, z)]} for r, z in keys if ca[(r, z)] != cb[(r, z)]]
            ma, mb = a["result"]["metrics"]["after"], b["result"]["metrics"]["after"]
            out["metric_diff"] = {k: mb[k] - ma[k] for k in ma}
        return out

    def actions(self, cat: int) -> list[dict]:
        """Valid single-unit actions (resource @ region) with their standalone, backend-computed effect. IDs are stable."""
        self._check_cat(cat)
        out = []
        for r in ORDER:
            for z in self.zone_ids:
                res = self.evaluate(cat, [{"resource": r, "zone_id": z}])
                e = res["assignments"][0]
                out.append({"id": f"{r}@{z}", "resource": r, "zone_id": z, "zone_name": self.zone_name[z], "valid": e["status"] == "placed",
                            "reason": e["reason"], "message": e["message"], "standalone_new_locations": e["new_locations"],
                            "details": e.get("details", {})})
        return out


@lru_cache(maxsize=1)
def default_model() -> AllocationModel:
    return AllocationModel()
