"""Resource-allocation API (see docs/CONTRACT_V2.md). All numbers come from app.allocation (NetworkX)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import time

from .alloc_planner import MIN_GAIN, generate_allocation_plan
from .allocation import ORDER, TOTALS, AllocationError, default_model

router = APIRouter(prefix="/api/v1/allocation")

Resource = Literal["debris_crew", "ems_team", "supply_team", "medical_support", "water_rescue", "helicopter"]


class Assignment(BaseModel):
    resource: Resource
    zone_id: str
    candidate_id: str | None = None


class EvaluateBody(BaseModel):
    category: int
    assignments: list[Assignment] = Field(default_factory=list, max_length=40)


class Plan(BaseModel):
    label: str = Field(max_length=40)
    assignments: list[Assignment] = Field(default_factory=list, max_length=40)


class CompareBody(BaseModel):
    category: int
    plans: list[Plan] = Field(min_length=1, max_length=4)


def _run(fn, *a):
    try:
        return fn(*a)
    except AllocationError as e:
        raise HTTPException(422, str(e)) from None


@router.get("/setup")
def setup(category: int):
    return _run(default_model().setup, category)


@router.post("/evaluate")
def evaluate(body: EvaluateBody):
    return _run(default_model().evaluate, body.category, [a.model_dump() for a in body.assignments])


@router.post("/compare")
def compare(body: CompareBody):
    return _run(default_model().compare, body.category, [{"label": p.label, "assignments": [a.model_dump() for a in p.assignments]} for p in body.plans])


@router.get("/actions")
def actions(category: int):
    return _run(default_model().actions, category)


class PlanBody(BaseModel):
    category: int
    current_assignments: list[Assignment] | None = Field(default=None, max_length=40)


_last_call = 0.0


@router.post("/plan")
def plan(body: PlanBody):
    """Gemma (or the labelled deterministic fallback) proposes an allocation; the backend validates and scores it."""
    global _last_call
    now = time.monotonic()
    if now - _last_call < 2.0:
        raise HTTPException(429, "Please wait a moment before requesting another plan.")
    _last_call = now
    cur = [a.model_dump() for a in body.current_assignments] if body.current_assignments is not None else None
    return _run(generate_allocation_plan, body.category, cur)


class MarginalBody(BaseModel):
    category: int
    zone_id: str
    assignments: list[Assignment] = Field(default_factory=list, max_length=40)


@router.post("/marginal")
def marginal(body: MarginalBody):
    """For each resource type: what ONE MORE unit in this zone would add on top of the current allocation (backend-computed).
    `useful` = adds at least MIN_GAIN new road-network locations (or clears debris that reopens locations)."""
    m = default_model()
    cur = [a.model_dump() for a in body.assignments]
    base = _run(m.evaluate, body.category, cur)
    used = {i["id"]: i["remaining"] for i in base["inventory"]}
    out = []
    for r in ORDER:
        if used[r] <= 0:
            out.append({"resource": r, "remaining": 0, "valid": False, "useful": False, "new_locations": 0, "reason": "inventory_exceeded",
                        "message": f"All {TOTALS[r]} units of this type are already assigned. Remove one to reuse it."})
            continue
        res = _run(m.evaluate, body.category, [*cur, {"resource": r, "zone_id": body.zone_id}])
        e = next(x for x in res["assignments"] if x["index"] == len(cur))
        ok = e["status"] == "placed"
        out.append({"resource": r, "remaining": used[r], "valid": ok, "useful": ok and e["new_locations"] >= MIN_GAIN, "new_locations": e["new_locations"],
                    "reason": e["reason"], "message": e["message"]})
    return {"category": body.category, "zone_id": body.zone_id, "min_gain": MIN_GAIN, "resources": out}
