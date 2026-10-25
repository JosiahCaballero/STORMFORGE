# Medical access validity (P2) — Flagler Hospital and the 4 km graph

Status: PROVISIONAL. Educational simulator, not for real emergency decisions.

## Why the hospital is outside the default graph
- Default graph: OSMnx drive network, 4 km radius around the St. Augustine centre (about 29.901, -81.315). Its southern edge is
  `min(node lat) = 29.8653821`.
- Facility in `data/access/facilities.csv`: **Flagler Hospital**, OSM `way/326113100` (tags `amenity=hospital`, `emergency=yes`,
  `healthcare=hospital`, `name=Flagler Hospital`, `addr:street=Health Park Boulevard`, `beds=335`). Stored point is the building
  polygon centroid, lon -81.3194 lat 29.8627. This is the only `amenity=hospital` / `emergency=yes` element in the study bbox
  (Overpass query, 2026-10-24).
- Latitude 29.8627 is south of the graph's southern edge (29.8654), so the hospital lies **outside** the clipped graph by roughly 300 m.
  The nearest node inside the clip (`5500023299`) is **354.4 m** from the stored point and sits on Coke Road at the clip boundary.
- That node is a dead end of the clipped network: its only edges are the two Coke Road directions (119 m), which are closed from
  Category 3 up. Consequence: in the default graph the hospital destination is reachable by 0/102 origins in Cat 3-5, and the
  Cat 1-2 numbers rely on one 354 m snap across land the graph does not contain.
- The emergency-department entrance is not tagged in OSM; no entrance location is invented.

## Regional graph (experimental, `data/regional/`)
- Built by `scripts/build_regional_graph.py`: OSMnx drive graph, 6000 m around (29.885, -81.315): 3,129 nodes, 7,921 directed edges, lat 29.831..29.938,
  lon -81.377..-81.265. It covers the hospital and the downtown.
- Same schema as `data/access/`, so `Engine.load(DATA / "regional")` works. Existing `data/access` files are unchanged.
- Same closure rule as `data/access/methodology.json`: samples about every 20 m along each directed edge geometry from
  `st_augustine_category{1..5}_HIGH.tif` (EPSG:4269, nearest pixel); 255 = NoData = unknown (ignored, not "dry");
  closed if any valued sample bin >= 3; OSM `bridge=yes` edges exempt.
- Facilities: only OSM-tagged elements from Overpass (`amenity=hospital` or `emergency=yes`) inside the graph bbox. One result: Flagler Hospital
  (`way/326113100`), polygon centroid, snapped to node `5500023310` (Health Park Boulevard) at **39.2 m**. Entrance still unverified.

### Sampler validation (`scripts/build_regional_validate.py`)
Regional edges overlapping the existing 4,691 directed edges (matched on u, v, key): 4,691 of 4,691.
- `catK_closed` and `catK_raw_closed` agree on **4,691/4,691 edges for every category 1-5** (100%).
- `catK_max_bin` agrees on 4,663-4,679 of 4,691 (99.4-99.7%); the small differences come from sample-point placement and never change a closure flag.

### Before / after hospital reachability (same Engine, same rule; origins = every 18th node by sorted id, so the origin sets differ)
| Cat | 4 km graph: origins with hospital route | nodes | Regional graph: origins | nodes |
|---|---|---|---|---|
| 0 | 100/102 | 1803/1820 | 174/174 | 3127/3129 |
| 1 | 47/102 | 872/1820 | 132/174 | 2301/3129 |
| 2 | 31/102 | 650/1820 | 90/174 | 1559/3129 |
| 3 | 0/102 | 1/1820 | 0/174 | 1/3129 |
| 4 | 0/102 | 1/1820 | 0/174 | 1/3129 |
| 5 | 0/102 | 1/1820 | 0/174 | 1/3129 |

Interpretation: the regional graph raises Cat 0-2 hospital access (the hospital is now properly connected), but Cat 3-5 stay at zero because the
hospital's own access roads (Health Park Blvd, Coke Road) have NOAA bin >= 5 at Cat 3. This is a modeled result under the illustrative closure rule;
zero modeled access does not mean zero real-world access (boats, high-water vehicles, air transport and roads outside the model are ignored).

## Not changed
The API still uses the 4 km graph. Switching requires Lead's decision (`Engine.load(DATA / "regional")` in `main.py`; zones/candidates/agents
build from whichever Engine they are given, but zone centres and candidate selection were tuned against the 4 km graph).

## Facility-set verification (2026-10-25)
The 1/1,820 (Cat 3) result had two causes. (1) Modeled: Flagler's own access edges are NOAA bin 5-7 at Cat 3 (89-100% of samples exposed), so the hospital node is genuinely cut off in the model. (2) Artifact: Flagler was the only facility, and in the 4 km graph it is snapped across a ~354 m clip gap to a dead end. `data/regional/facilities_verified.csv` adds two operator-confirmed 24h freestanding EDs inside the regional bbox (HCA Florida St. Augustine Emergency, 1780 Woodlawn Rd; AdventHealth Treaty Oaks ER, 1775 SR 207). Their positions are approximate (60 / 130 m snap), entrances unverified. Baptist & Wolfson St. Augustine ER (461 Outlet Mall Blvd) is real but lies west of the regional bbox and is not modeled. Reproduce: `python scripts/recompute_access.py`. The API default graph and allocation engine are unchanged (switching to regional fails 13 tests tuned to the 4 km graph).

### Separate regional ED accessibility (API: `/api/v1/regional-access`, `/api/v1/regional-access/zones?category=N`)
Implemented in `backend/app/regional_access.py`; the allocation engine and 4 km default graph are unchanged. Local nodes map to regional nodes by identical OSM id (validated: 1,820/1,820 nodes, 4,691/4,691 edges, 0 closure-flag mismatches in Cat 1-5). Results are reported per basis (`local_4km_nodes`: 1,820 nodes / 102 origins routed over the regional graph; `regional_nodes`: 3,129 / 174) and separately for any verified 24h ED vs full-service hospital (Flagler). ED destination nodes are excluded from numerators and denominators, and an ED is "accessible" only if another node can reach it.
