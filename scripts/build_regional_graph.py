"""Build a LARGER OSM drivable graph covering Flagler Hospital + downtown, NOAA-sampled with the SAME closure rule as
data/access/methodology.json. Writes the same CSV schema into data/regional/ so Engine.load(DATA/'regional') works.

Rule reproduced (validated against data/access/directed_edges.csv by scripts/validate_regional_sampler.py):
  * sample every ~20 m along each directed edge geometry (n = max(2, ceil(length/20)+1) evenly spaced points)
  * NOAA value at nearest pixel of st_augustine_category{k}_HIGH.tif (EPSG:4269 lon/lat); 255 = NoData = unknown
  * catk_max_bin = max valued sample (blank if none); catk_exposed_fraction = fraction of samples with a NOAA value
  * raw_closed = any sample bin >= 3 ; closed = raw_closed AND NOT bridge=yes (bridge-exempt, deck heights unknown)
Facilities: ONLY real OSM-tagged amenity=hospital / emergency=yes elements inside the graph bbox (Overpass). No entrances
invented; nearest drivable node snap distance is reported honestly.

Usage: python scripts/build_regional_graph.py [--dist 6000] [--center 29.885,-81.315] [--cache DIR]
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import osmnx as ox
import pandas as pd
import rasterio
import requests
from shapely.geometry import LineString, Polygon

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "regional"
UA = {"User-Agent": "STORMFORGE-hackathon/0.1 (educational)"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]


def sample_edge(coords, length_m, step=20.0):
    ls = LineString(coords)
    n = max(2, int(math.ceil(length_m / step)) + 1)
    pts = [ls.interpolate(i / (n - 1), normalized=True) for i in range(n)]
    return [(p.x, p.y) for p in pts]


class Noaa:
    def __init__(self):
        self.ds, self.arr = {}, {}
        for c in range(1, 6):
            p = ROOT / "data" / "noaa" / f"st_augustine_category{c}_HIGH.tif"
            self.ds[c] = rasterio.open(p)
            self.arr[c] = self.ds[c].read(1)

    def values(self, c, xs, ys):
        r, a = self.ds[c], self.arr[c]
        rows, cols = rasterio.transform.rowcol(r.transform, xs, ys)
        rows, cols = np.asarray(rows), np.asarray(cols)
        ok = (rows >= 0) & (rows < r.height) & (cols >= 0) & (cols < r.width)
        out = np.full(len(xs), 255, dtype=np.int32)
        out[ok] = a[rows[ok], cols[ok]]
        return out


def edge_row(noaa, pts, bridge_exempt):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    res = {}
    for c in range(1, 6):
        v = noaa.values(c, xs, ys)
        valid = v[v != 255]
        mb = int(valid.max()) if len(valid) else None
        raw = bool(mb is not None and mb >= 3)
        res[f"cat{c}_max_bin"] = mb
        res[f"cat{c}_exposed_fraction"] = round(len(valid) / len(v), 3)
        res[f"cat{c}_raw_closed"] = int(raw)
        res[f"cat{c}_closed"] = int(raw and not bridge_exempt)
    return res


def join_tag(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, list):
        return "; ".join(str(x) for x in v)
    return str(v)


def overpass(q):
    last = None
    for u in OVERPASS:
        for _ in range(2):
            try:
                r = requests.post(u, data={"data": q}, headers=UA, timeout=120)
                if r.status_code == 200:
                    return r.json()
                last = r.status_code
            except Exception as ex:  # noqa: BLE001
                last = ex
            time.sleep(3)
    raise RuntimeError(f"Overpass failed: {last}")


def get_facilities(south, west, north, east):
    q = (f'[out:json][timeout:90];(nwr["amenity"="hospital"]({south},{west},{north},{east});'
         f'nwr["emergency"="yes"]({south},{west},{north},{east}););out geom tags;')
    rows = []
    for e in overpass(q)["elements"]:
        t = e.get("tags", {})
        if not (t.get("amenity") == "hospital" or t.get("emergency") == "yes"):
            continue
        if e["type"] == "node":
            lon, lat = e["lon"], e["lat"]
        elif e["type"] == "way" and "geometry" in e:
            g = [(p["lon"], p["lat"]) for p in e["geometry"]]
            c = Polygon(g).centroid if len(g) >= 4 and g[0] == g[-1] else LineString(g).centroid
            lon, lat = c.x, c.y
        else:
            continue  # relations skipped (not needed here); documented
        rows.append({"name": t.get("name", f"{e['type']}/{e['id']}"), "lon": lon, "lat": lat,
                     "emergency_tag": t.get("emergency", ""), "osm": f"{e['type']}/{e['id']}", "amenity": t.get("amenity", "")})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", type=int, default=6000)
    ap.add_argument("--center", default="29.885,-81.315")
    ap.add_argument("--cache", default=str(OUT / "_cache"))
    a = ap.parse_args()
    lat0, lon0 = map(float, a.center.split(","))
    OUT.mkdir(parents=True, exist_ok=True)
    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)
    gml = cache / f"drive_{a.dist}.graphml"
    if gml.exists():
        G = ox.load_graphml(gml)
    else:
        ox.settings.requests_headers = UA
        G = ox.graph_from_point((lat0, lon0), dist=a.dist, network_type="drive")
        ox.save_graphml(G, gml)
    noaa = Noaa()
    nodes = pd.DataFrame([{"node_id": int(n), "lon": d["x"], "lat": d["y"]} for n, d in G.nodes(data=True)])
    nodes = nodes.sort_values("node_id").reset_index(drop=True)
    npos = {int(r.node_id): (r.lon, r.lat) for r in nodes.itertuples()}
    rows = []
    for eid, (u, v, k, d) in enumerate(G.edges(keys=True, data=True)):
        geom = d.get("geometry")
        coords = list(geom.coords) if geom is not None else [npos[int(u)], npos[int(v)]]
        length = float(d["length"])
        bridge = join_tag(d.get("bridge"))
        exempt = bool(bridge and "yes" in bridge.split("; "))
        row = {"edge_id": eid, "u": int(u), "v": int(v), "key": int(k), "name": join_tag(d.get("name")),
               "highway": join_tag(d.get("highway")), "bridge": bridge, "tunnel": join_tag(d.get("tunnel")),
               "layer": join_tag(d.get("layer")), "length_m": round(length, 2)}
        row.update(edge_row(noaa, sample_edge(coords, length), exempt))
        rows.append(row)
    cols = ["edge_id", "u", "v", "key", "name", "highway", "bridge", "tunnel", "layer", "length_m"]
    for c in range(1, 6):
        cols += [f"cat{c}_max_bin", f"cat{c}_exposed_fraction", f"cat{c}_raw_closed", f"cat{c}_closed"]
    edges = pd.DataFrame(rows)[cols]
    edges.to_csv(OUT / "directed_edges.csv", index=False)
    nodes.to_csv(OUT / "nodes.csv", index=False)

    south, north = nodes.lat.min(), nodes.lat.max()
    west, east = nodes.lon.min(), nodes.lon.max()
    fac = get_facilities(south, west, north, east)
    ids = nodes.node_id.to_numpy()
    nx_, ny_ = nodes.lon.to_numpy(), nodes.lat.to_numpy()
    out = []
    for f in fac:
        dx = (nx_ - f["lon"]) * 111320 * math.cos(math.radians(f["lat"]))
        dy = (ny_ - f["lat"]) * 110574
        d = np.hypot(dx, dy)
        i = int(d.argmin())
        out.append({**f, "nearest_node": int(ids[i]), "snap_distance_m": round(float(d[i]), 1)})
    pd.DataFrame(out)[["name", "lon", "lat", "emergency_tag", "nearest_node", "osm", "amenity", "snap_distance_m"]].to_csv(
        OUT / "facilities.csv", index=False)
    meth = json.loads((ROOT / "data/access/methodology.json").read_text())
    meth.update({
        "study_area": f"St. Augustine, FL; REGIONAL OSM drive network, {a.dist} m around ({lat0},{lon0}); bbox "
                      f"lat {south:.4f}..{north:.4f}, lon {west:.4f}..{east:.4f}. EXPERIMENTAL / PROVISIONAL.",
        "origins": "every 18th node by sorted id (Engine rule); NOT population-weighted and NOT the same nodes as the 4 km graph",
        "facilities": "OSM amenity=hospital / emergency=yes elements in bbox (Overpass); emergency-department entrances NOT verified; snap distance reported in facilities.csv",
        "regional_note": "Same closure rule as data/access; sampler validated against data/access/directed_edges.csv (see docs/MEDICAL_ACCESS.md).",
    })
    (OUT / "methodology.json").write_text(json.dumps(meth, indent=2))
    print(f"nodes={len(nodes)} edges={len(edges)} facilities={len(out)}")
    print(pd.DataFrame(out)[["name", "osm", "snap_distance_m", "nearest_node"]].to_string())


if __name__ == "__main__":
    main()
