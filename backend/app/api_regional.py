from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from . import regional_access as ra
from .engine import CATS

router = APIRouter()


@router.get("/api/v1/regional-access")
def regional_access(category: int | None = Query(None)):
    """Emergency-care accessibility on the regional graph. Separate from allocation; never mixes denominators."""
    if category is not None and category not in CATS:
        raise HTTPException(422, "category must be an integer 0-5")
    cats = [category] if category is not None else list(CATS)
    return {"scope": ra.SCOPE, "mapping": ra.mapping_report(), "results": [ra.summary(c) for c in cats]}


@router.get("/api/v1/regional-access/zones")
def regional_access_zones(category: int = Query(...)):
    if category not in CATS:
        raise HTTPException(422, "category must be an integer 0-5")
    return ra.zone_summary(category)
