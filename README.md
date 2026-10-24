# STORMFORGE — Critical Access Intelligence
*Break the city. See the consequences. Rebuild access.* Educational what-if simulator, **not** for real emergency decisions.

## Run (two terminals)
```
cd backend  && python -m pip install fastapi "uvicorn[standard]" networkx pandas pytest httpx
cd backend  && python -m uvicorn app.main:app --port 8000
cd frontend && npm install && npm run dev        # http://localhost:5173 (proxies /api to :8000)
cd backend  && python -m pytest -q               # backend tests (77)
cd frontend && npx vitest run                    # frontend data tests
# Gemma (optional): cp backend/.env.example backend/.env, set GEMMA_API_KEY, then python backend/scripts/gemma_smoke.py
# Without a key the planner returns a clearly labelled deterministic fallback (not Gemma).
python scripts/build_map_data.py                 # regenerate frontend/public/data/*.{geojson,json}
```
The map works without the backend; the "Route to hospital" card needs it. Basemap (CARTO) falls back to roads-only if offline.

## Data & caveats
NOAA SLOSH MOM HIGH-tide Cat 1–5 planning envelopes (not forecasts; NoData 255 = unknown). OSM roads, 4 km prototype graph.
Closure = illustrative rule (any ~20 m sample in bin ≥ 3; OSM bridges exempt). Hospital destination is provisional and unverified.
