from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .agents import build_report
from .engine import CATS
from .interventions import UnknownCandidates, default_sim

router = APIRouter()  # Simulation teammate owns this file


def _cat(category: int) -> int:
    if category not in CATS:
        raise HTTPException(422, "category must be an integer 0-5")
    return category


def _ids(candidate_ids: str | None) -> list[str]:
    return [s.strip() for s in candidate_ids.split(",") if s.strip()] if candidate_ids else []


def _unknown(e: UnknownCandidates):
    return HTTPException(422, {"error": "unknown_candidate_ids", "unknown_ids": e.ids})


class EvaluateBody(BaseModel):
    category: int
    candidate_ids: list[str] = Field(default_factory=list)


class Plan(BaseModel):
    label: str = ""
    candidate_ids: list[str] = Field(default_factory=list)


class CompareBody(BaseModel):
    category: int
    plans: list[Plan]


@router.get("/api/v1/candidates")
def candidates():
    return default_sim().candidates


@router.post("/api/v1/interventions/evaluate")
def evaluate(body: EvaluateBody):
    try:
        return default_sim().evaluate(_cat(body.category), body.candidate_ids)
    except UnknownCandidates as e:
        raise _unknown(e)


@router.post("/api/v1/interventions/compare")
def compare(body: CompareBody):
    try:
        return default_sim().compare(_cat(body.category), [p.model_dump() for p in body.plans])
    except UnknownCandidates as e:
        raise _unknown(e)


@router.get("/api/v1/zones")
def zones():
    return default_sim().zm.describe()


@router.get("/api/v1/zones/{zone_id}/impact")
def zone_impact(zone_id: str, category: int = Query(...), candidate_ids: str | None = None):
    sim = default_sim()
    cat = _cat(category)
    if sim.zm.zone_def(zone_id) is None:
        raise HTTPException(404, f"unknown zone '{zone_id}'")
    try:
        ids, _ = sim._clean(_ids(candidate_ids))
    except UnknownCandidates as e:
        raise _unknown(e)
    out = sim.zm.impact(zone_id, cat)
    zn = set(sim.zm.zone_nodes[zone_id])
    out["applied_candidate_ids"] = ids
    out["nodes_with_hospital_route"] = len(zn & sim.hospital_set(cat))
    out["nodes_with_any_care_route"] = len(zn & sim.any_care_nodes(cat, ids))
    out["limitations"].append(
        "Any-care = provisional hospital destination OR applied hypothetical staging; staging is never a hospital.")
    return out


@router.get("/api/v1/agents/report")
def agents_report(category: int = Query(...), candidate_ids: str | None = None):
    try:
        return build_report(_cat(category), _ids(candidate_ids))
    except UnknownCandidates as e:
        raise _unknown(e)
