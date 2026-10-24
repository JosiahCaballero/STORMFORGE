# STORMFORGE — Critical Access Intelligence
*Break the city. See the consequences. Rebuild access.*
Emergency resource-allocation **decision-support simulator** for the aftermath of a hurricane (St. Augustine, FL). Educational — **not for real emergency decisions**.

**What it does:** pick a hurricane category (NOAA SLOSH MOM surge envelopes on OpenStreetMap roads) → see which neighborhoods are cut off → deploy a *hypothetical* inventory
(2 debris crews, 3 EMS, 2 supply teams, 1 medical site, 2 water-rescue teams, 1 helicopter) → the NetworkX backend computes the effects → ask **Gemma** for an alternative allocation and compare.
Gemma proposes `resource@region` actions; the backend validates and scores everything (Gemma never supplies a number).

## Run
```
# backend (Python 3.13)
cd backend
python -m pip install fastapi "uvicorn[standard]" networkx pandas geopandas shapely rasterio pytest httpx python-dotenv
python -m uvicorn app.main:app --port 8000
# frontend
cd frontend && npm install && npm run dev            # http://localhost:5173  (proxies /api -> :8000)
```
**Gemma (optional):** `cp backend/.env.example backend/.env`, set `GEMMA_API_KEY` (Google AI Studio). Model default `gemma-4-26b-a4b-it` (`GEMMA_MODEL`, `GEMMA_THINKING_LEVEL=minimal`).
Check it: `python backend/scripts/gemma_smoke.py`. Without a key the planner returns a clearly labelled **deterministic fallback (not Gemma)**.

## Test
```
cd backend  && python -m pytest -q          # 144 tests, offline (no live Gemma calls)
cd frontend && npx tsc -b && npx vitest run && npx vite build
# browser end-to-end (puppeteer-core in a scratch dir, see scripts/e2e/README.md): qa.mjs, demo.mjs at 1366x768 and 1920x1080
```

## Honesty notes
NOAA layers are planning envelopes, not forecasts (NoData = unknown). Closures use an illustrative rule. Debris, inventory, the response base and staging sites are **hypothetical**;
a "location" is a road-network node, not a person. EMS/supply coverage uses an assumed 1.5 km service radius; water rescue is a 500 m screening radius; the helicopter targets at most 10 locations
(no flight/landing claims). The only OSM hospital is a dead end that floods shut at Cat 3+. See `docs/CONTRACT_V2.md`, `docs/GEMMA.md`, `docs/MEDICAL_ACCESS.md`, `docs/DEMO.md`.
