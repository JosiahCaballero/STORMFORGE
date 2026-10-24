"""Merge road geometry (road_exposure.geojson) with engine closure flags (directed_edges.csv)
into one compact browser asset. Closure flags come from directed_edges (bridge exemption applied)."""
import json
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
feats = json.loads((ROOT / "data/roads/road_exposure.geojson").read_text())["features"]
edges = pd.read_csv(ROOT / "data/access/directed_edges.csv").set_index("edge_id")

def nn(v):
    return None if pd.isna(v) else v

out = []
for f in feats:
    p = f["properties"]
    e = edges.loc[p["road_id"]]
    hw = p["highway"]
    if isinstance(hw, str) and hw.startswith("["):
        hw = "trunk" if "trunk" in hw else "primary"
    props = {"id": int(p["road_id"]), "name": p["name"], "hw": hw, "len": round(float(e.length_m), 1),
             "bridge": nn(e.bridge) is not None}
    for k in range(1, 6):
        b = nn(e[f"cat{k}_max_bin"])
        props[f"b{k}"] = int(b) if b is not None else 0          # max NOAA depth bin on segment (0 = none sampled)
        props[f"f{k}"] = round(float(e[f"cat{k}_exposed_fraction"]), 2)
        props[f"c{k}"] = int(e[f"cat{k}_closed"])               # illustrative closure (bridge-exempt)
        props[f"r{k}"] = int(e[f"cat{k}_raw_closed"])           # raw closure before bridge exemption
    coords = [[round(x, 5), round(y, 5)] for x, y in f["geometry"]["coordinates"]]
    out.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": props})

dst = ROOT / "frontend/public/data/roads.geojson"
dst.write_text(json.dumps({"type": "FeatureCollection", "features": out}, separators=(",", ":")))
print(len(out), "features,", dst.stat().st_size // 1024, "KB")

# Facilities: provisional snap shown explicitly (nearest node distance is part of the story)
import math
nodes = pd.read_csv(ROOT / "data/access/nodes.csv").set_index("node_id")
fac = pd.read_csv(ROOT / "data/access/facilities.csv")
fout = []
for _, r in fac.iterrows():
    n = nodes.loc[int(r.nearest_node)]
    dx = (n.lon - r.lon) * 111320 * math.cos(math.radians(r.lat)); dy = (n.lat - r.lat) * 110574
    fout.append({"name": r["name"], "lon": r.lon, "lat": r.lat, "snap_lon": float(n.lon), "snap_lat": float(n.lat),
                 "snap_m": round(math.hypot(dx, dy), 1), "source": "OpenStreetMap (emergency=yes tag)", "verified": False})
(ROOT / "frontend/public/data/facilities.json").write_text(json.dumps(fout, indent=1))
print(fout)
