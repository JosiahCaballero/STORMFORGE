"""Provisional demo zones over the 4 km graph (P6).

CONSTRUCTION RULE (transparent, deterministic, NOT official boundaries, NO population):
  1. bridge_corridor (kind=infrastructure): every graph node within BRIDGE_RADIUS_M of an endpoint of any
     OSM bridge=yes edge (includes Bridge of Lions). Those nodes are NOT also assigned to a neighbourhood.
  2. Every remaining node is assigned to the NEAREST of the five neighbourhood centres (planar distance),
     provided it is within MAX_ASSIGN_M of that centre; otherwise it belongs to no zone.
  3. Display boundary = convex hull of the zone's nodes (neighbourhoods). Hulls may overlap and are only a
     display aid. bridge_corridor has boundary=null (its nodes are scattered along separate bridges).
Centres were checked against street names in data/access/directed_edges.csv (see CENTER_NOTES).
All zones: boundary_status = "provisional".
"""
from __future__ import annotations

import math
from functools import lru_cache

from shapely.geometry import MultiPoint, mapping

from .engine import Engine

BRIDGE_RADIUS_M = 150.0
MAX_ASSIGN_M = 2500.0

# (id, name, kind, (lat, lon), note). lat/lon verified against node/street data; see CENTER_NOTES.
ZONE_DEFS = [
    ("historic_downtown", "Historic Downtown", "neighborhood", (29.892, -81.313),
     "Nearest graph node 31 m away is King St / Saint George St."),
    ("lincolnville", "Lincolnville", "neighborhood", (29.886, -81.3165),
     "Moved slightly east of the suggested point to sit on Riberia/Weeden/Kings Ferry streets in the data."),
    ("davis_shores", "Davis Shores", "neighborhood", (29.8895, -81.301),
     "Moved from the suggested point (no nodes within ~490 m) to the Zoratoa Ave / Dolphin Dr nodes on Anastasia Island."),
    ("uptown_san_marco", "Uptown / San Marco", "neighborhood", (29.9055, -81.3195),
     "Moved west of the suggested point so it sits on San Marco Avenue (mean node lon -81.3205 in the data)."),
    ("west_augustine", "West Augustine", "neighborhood", (29.889, -81.335),
     "On West King St / Park Ave / Rodriquez St nodes."),
    ("bridge_corridor", "Bridge Corridor", "infrastructure", (29.8929, -81.3077),
     "Centre is the Bridge of Lions; the zone covers all OSM bridge=yes edges, not residential land."),
]
CENTER_NOTES = {z[0]: z[4] for z in ZONE_DEFS}


def _dist_m(lat1, lon1, lat2, lon2):
    return math.hypot((lat1 - lat2) * 110574.0, (lon1 - lon2) * 111320.0 * math.cos(math.radians(lat1)))


class ZoneModel:
    def __init__(self, eng: Engine):
        self.eng = eng
        nodes = eng.nodes
        coords = {int(r.node_id): (float(r.lat), float(r.lon)) for r in nodes.itertuples(index=False)}
        self.coords = coords
        br = eng.edges[eng.edges.bridge.notna()]
        bridge_pts = sorted({int(x) for x in [*br.u, *br.v]})
        self.bridge_edge_ids = sorted(int(x) for x in br.edge_id)
        self.node_zone: dict[int, str | None] = {}
        hoods = [z for z in ZONE_DEFS if z[2] == "neighborhood"]
        for nid in sorted(coords):
            la, lo = coords[nid]
            if any(_dist_m(la, lo, *coords[b]) <= BRIDGE_RADIUS_M for b in bridge_pts):
                self.node_zone[nid] = "bridge_corridor"
                continue
            best = min(hoods, key=lambda z: (_dist_m(la, lo, *z[3]), z[0]))
            self.node_zone[nid] = best[0] if _dist_m(la, lo, *best[3]) <= MAX_ASSIGN_M else None
        self.zone_nodes: dict[str, list[int]] = {z[0]: [] for z in ZONE_DEFS}
        for nid, z in self.node_zone.items():
            if z:
                self.zone_nodes[z].append(nid)
        # edge -> zone by its tail node (u); documented in /impact
        self.edge_zone = {int(r.edge_id): self.node_zone.get(int(r.u)) for r in eng.edges.itertuples(index=False)}

    def zone_def(self, zid):
        return next((z for z in ZONE_DEFS if z[0] == zid), None)

    def boundary(self, zid):
        if zid == "bridge_corridor":
            return None
        pts = [(self.coords[n][1], self.coords[n][0]) for n in self.zone_nodes[zid]]
        if len(pts) < 3:
            return None
        hull = MultiPoint(pts).convex_hull
        return mapping(hull) if hull.geom_type == "Polygon" else None

    def describe(self):
        out = []
        for zid, name, kind, (la, lo), note in ZONE_DEFS:
            if kind == "infrastructure":
                method = (f"Nodes within {BRIDGE_RADIUS_M:.0f} m of any OSM bridge=yes edge endpoint. "
                          "No polygon (nodes are scattered along separate bridges).")
            else:
                method = (f"Graph nodes nearest to this centre among the 5 neighbourhood centres (within {MAX_ASSIGN_M:.0f} m), "
                          "excluding bridge-corridor nodes; boundary = convex hull of those nodes. Provisional demo zone.")
            out.append({"id": zid, "name": name, "kind": kind, "center": [lo, la], "boundary": self.boundary(zid),
                        "boundary_status": "provisional", "method": method,
                        "node_count": len(self.zone_nodes[zid]),
                        "notes": note + " Not an official boundary; no population is modeled.",
                        **({"bridge_edge_ids": self.bridge_edge_ids} if kind == "infrastructure" else {})})
        return out

    def impact(self, zid: str, cat: int, applied: dict | None = None):
        """applied: optional {'any_care_nodes': set, 'hospital_nodes': set} computed by interventions."""
        eng = self.eng
        zn = set(self.zone_nodes[zid])
        ed = eng.edges
        ids = [e for e, z in self.edge_zone.items() if z == zid]
        sub = ed.loc[ids]
        if cat:
            closed = sub[sub[f"cat{cat}_closed"] == 1]
            tl = float(sub.length_m.sum())
            pct = round(100 * float(closed.length_m.sum()) / tl, 1) if tl else 0.0
            exposed = sub[sub[f"cat{cat}_max_bin"].notna()].sort_values(
                [f"cat{cat}_max_bin", "length_m", "edge_id"], ascending=[False, False, True]).head(5)
            roads = [{"edge_id": int(r.edge_id), "name": (r.name if isinstance(r.name, str) else None),
                      "max_bin": int(getattr(r, f"cat{cat}_max_bin")), "closed": bool(getattr(r, f"cat{cat}_closed"))}
                     for r in exposed.itertuples(index=False)]
        else:
            closed, pct, roads = sub.iloc[0:0], 0.0, []
        return {"zone": zid, "category": cat, "edges_total": len(sub), "edges_closed": int(len(closed)),
                "closed_length_pct": pct, "nodes": len(zn),
                "most_exposed_roads": roads, "provenance": "simulated",
                "limitations": [
                    "Zone is a provisional demo area (nearest-centre node assignment), not an official boundary.",
                    "Edges are attributed to the zone of their start node; no population is modeled.",
                    "Closure rule is illustrative (any ~20 m sample in NOAA bin >= 3; OSM bridge=yes exempt).",
                    "NOAA NoData is unknown, not confirmed dry.",
                ]}


@lru_cache(maxsize=1)
def default_zone_model() -> ZoneModel:
    from .interventions import default_engine
    return ZoneModel(default_engine())
