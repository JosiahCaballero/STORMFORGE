"""Map-visualisation endpoint: which graph nodes gain a modeled care route when staging sites are applied.

Pure read of the Simulation engine (same sets that produce the evaluate counts), so the map and the metrics cannot disagree.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from .engine import CATS
from .interventions import UnknownCandidates, default_sim

router = APIRouter()


@router.get("/api/v1/interventions/reach")
def reach(category: int, candidate_ids: str | None = Query(default=None)):
    if category not in CATS:
        raise HTTPException(422, "category must be an integer 0-5")
    ids = [s.strip() for s in candidate_ids.split(",") if s.strip()] if candidate_ids else []
    sim = default_sim()
    try:
        after = sim.any_care_nodes(category, ids)
        base = sim.any_care_nodes(category, [])
    except UnknownCandidates as e:
        raise HTTPException(422, {"error": "unknown_candidate_ids", "unknown_ids": e.ids}) from None
    nodes = sim.eng.nodes.set_index("node_id")

    def pts(ns):
        return [[round(float(nodes.at[n, "lon"]), 6), round(float(nodes.at[n, "lat"]), 6)] for n in sorted(ns)]

    gained = set(after) - set(base)
    return {
        "category": category,
        "candidate_ids": ids,
        "counts": {"baseline_any_care_nodes": len(base), "after_any_care_nodes": len(after), "gained_nodes": len(gained)},
        "gained": pts(gained),
        "baseline_care": pts(base),
        "sites": [{"id": c, "lon": sim.by_id[c]["lon"], "lat": sim.by_id[c]["lat"]} for c in dict.fromkeys(ids) if c in sim.by_id],
        "provenance": "simulated",
        "note": "Graph nodes with a directed open-road route to a care destination; not population, not travel time.",
    }
