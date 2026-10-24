from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .engine import CATS, Engine

app = FastAPI(title="STORMFORGE API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
engine = Engine.load()

ATTRIBUTION = [
    "Hazard: NOAA NHC National Storm Surge Risk Maps v4, SLOSH MOM HIGH-tide inundation (June 2026 reprocessing), Categories 1-5",
    "Roads: © OpenStreetMap contributors (via OSMnx)",
]
LIMITATIONS = [
    "NOAA layers are multi-storm planning envelopes, not forecasts or event-specific depths.",
    "NOAA NoData=255 means unknown, not confirmed dry.",
    "Closure rule is illustrative: any ~20 m sample in NOAA bin >= 3 closes a segment; OSM bridge=yes edges are exempt (deck heights unknown).",
    "Hospital destination is provisional: OSM-tagged, emergency entrance unverified, nearest graph node ~356 m away.",
    "Counts are over graph nodes / 100-ish deterministic origins, NOT population or real-world accessibility.",
    "Not for real emergency decisions.",
]


@app.get("/health")
def health():
    return {"status": "ok", "edges": len(engine.edges), "nodes": len(engine.nodes), "facilities": len(engine.facilities)}


@app.get("/api/v1/metadata")
def metadata():
    return {"attribution": ATTRIBUTION, "limitations": LIMITATIONS, "methodology": engine.methodology,
            "origin_rule": f"every {18}th node by sorted id ({len(engine.origins)} origins), not population-weighted"}


@app.get("/api/v1/facilities")
def facilities():
    return engine.facility_snap()


@app.get("/api/v1/scenarios")
def scenarios():
    return [engine.summary(c) for c in CATS]


@app.get("/api/v1/scenarios/{cat}")
def scenario(cat: int):
    if cat not in CATS:
        raise HTTPException(404, "category must be 0-5")
    return engine.summary(cat)
