"""Resource-allocation API (see docs/CONTRACT_V2.md). All numbers come from app.allocation (NetworkX)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .allocation import AllocationError, default_model

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
