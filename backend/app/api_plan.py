"""Plan endpoints: GET /api/v1/plan/status, POST /api/v1/plan/generate. Never returns key material."""
from __future__ import annotations

import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import planner
from .gemma import GemmaClient

router = APIRouter()

MIN_INTERVAL_S = 2.0  # min seconds between uncached generate calls (global, in-memory)
MAX_BODY_BYTES = 200_000  # bound on serialized response
_last_call = 0.0
_lock = threading.Lock()


class GenerateIn(BaseModel):
    category: int = Field(ge=0, le=5)
    max_candidates: int = Field(default=3, ge=1, le=8)


def get_client() -> GemmaClient:  # patched in tests
    return GemmaClient()


def get_sim() -> planner.Sim:  # patched in tests
    return planner.Sim()


@router.get("/api/v1/plan/status")
def plan_status():
    c = get_client()
    return {"provider": "gemma", "configured": c.configured, "model": c.model if c.configured else None,
            "fallback_available": True}


@router.post("/api/v1/plan/generate")
def plan_generate(body: GenerateIn):
    global _last_call
    client = get_client()
    sim = get_sim()
    if body.category != 0 and client.configured and not planner.cache_peek(body.category, body.max_candidates, client.model):
        with _lock:
            wait = MIN_INTERVAL_S - (time.monotonic() - _last_call)
            if wait > 0:
                raise HTTPException(429, "plan generation rate-limited; retry shortly",
                                    headers={"Retry-After": str(int(wait) + 1)})
            _last_call = time.monotonic()
    try:
        out = planner.generate_plan(body.category, body.max_candidates, client=client, sim=sim)
    except ImportError:
        raise HTTPException(503, "simulation modules not available") from None
    except ValueError as e:  # e.g. invalid ids from evaluator
        raise HTTPException(422, str(e)) from None
    if len(str(out)) > MAX_BODY_BYTES:
        raise HTTPException(502, "plan response too large")
    return out
