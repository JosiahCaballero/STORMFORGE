# STORMFORGE API contract (v0.2) — frozen by Lead; propose changes to Lead, do not edit silently

All metrics are **simulated** over the provisional road graph (see `data/access/methodology.json`). Provenance classes:
`source_data | derived | assumed | simulated | hypothetical | ai_proposed`. Never invent facilities, coordinates, travel times or population.

## Ownership (no two owners edit the same file)
| Owner | Files |
|---|---|
| Lead | `backend/app/main.py`, `backend/app/engine.py` (core), `frontend/**`, `TASKS.md`, `docs/**`, git commits |
| Simulation teammate | `backend/app/interventions.py`, `zones.py`, `agents.py`, `api_sim.py`, `scripts/build_*regional*`, `data/regional/**`, `backend/tests/test_interventions*.py`, `test_zones*.py`, `test_agents*.py` |
| AI teammate | `backend/app/gemma.py`, `planner.py`, `api_plan.py`, `backend/tests/test_gemma*.py`, `test_planner*.py`, `backend/.env.example`, `docs/GEMMA.md` |

Teammates do **not** commit. Lead commits. If you need a change in a file you don't own, message Lead via your final report.
`main.py` already includes `api_sim.router` and `api_plan.router`; each router is a FastAPI `APIRouter` named `router`.

## Category
`category` is an int 0..5 (0 = baseline, no surge). Unknown → HTTP 422.

## Metrics object (`Metrics`)
```json
{
  "nodes_total": 1820,
  "nodes_with_hospital_route": 0,          // can reach a full-hospital destination node (provisional snap)
  "nodes_with_staging_route": 0,           // can reach >=1 APPLIED hypothetical staging site (basic care only)
  "nodes_with_any_care_route": 0,          // union of the two
  "origins_total": 102,
  "origins_with_hospital_route": 0,
  "origins_with_staging_route": 0,
  "origins_with_any_care_route": 0,
  "provenance": "simulated"
}
```
Hospital access and temporary-staging access must always be reported separately; never merge them into "hospital access".

## Endpoints (Simulation teammate: `api_sim.py`)
- `GET /api/v1/zones` → `[{id, name, kind: "neighborhood"|"infrastructure", center:[lon,lat], boundary: GeoJSON Polygon|null, boundary_status: "provisional"|"verified", method: str, node_count, notes}]`
  Zones ids: `historic_downtown, lincolnville, davis_shores, uptown_san_marco, west_augustine, bridge_corridor`. Boundaries are approximate demo zones; document the construction rule (e.g. nearest-centre assignment of graph nodes). No population.
- `GET /api/v1/zones/{id}/impact?category=N&candidate_ids=a,b` → `{zone, category, edges_total, edges_closed, closed_length_pct, nodes, nodes_with_hospital_route, nodes_with_any_care_route, most_exposed_roads:[{edge_id,name,max_bin}], provenance, limitations:[]}`
- `GET /api/v1/candidates` → `[{id, name, kind: "hypothetical_staging", zone_id, lon, lat, node_id, snap_distance_m, selection_rule, provenance: "hypothetical", feasibility_by_category: {"1": {...}, ...}, limitations: []}]`
  Small fixed set (target 6–8), graph-snapped, deterministic. These are NOT real facilities. Staging = basic medical staging only, never a hospital.
- `POST /api/v1/interventions/evaluate` body `{category, candidate_ids: [str]}` → `{category, candidate_ids, baseline: Metrics, intervention: Metrics, delta: {...ints}, per_candidate: [{id, marginal: delta-vs-baseline-if-alone, standalone: Metrics}], per_zone: [{zone_id, baseline_any_care_nodes, intervention_any_care_nodes, zone_nodes}], warnings: [], provenance: "simulated"}`
  Invalid/unknown candidate id → 422 with the offending ids. Duplicates → dedupe + warning. Pure function of inputs (deterministic).
- `POST /api/v1/interventions/compare` body `{category, plans: [{label, candidate_ids}]}` → `{category, baseline: Metrics, plans: [{label, candidate_ids, metrics, delta}]}`
- `GET /api/v1/agents/report?category=N&candidate_ids=a,b` → `{category, applied_candidate_ids, transportation: AgentFinding, medical: AgentFinding, logistics: AgentFinding, community: AgentFinding, transit: {status: "planned", note: "No verified transit data; not modeled."}}`
  `AgentFinding = {agent, title, headline: str, findings: [{id, text, value?, unit?, provenance}], limitations: [str], evidence: {...machine readable...}}`. Findings are deterministic text built from computed values only.

## Endpoints (AI teammate: `api_plan.py`)
- `GET /api/v1/plan/status` → `{provider: "gemma", configured: bool, model: str|null, fallback_available: true}` (never returns keys)
- `POST /api/v1/plan/generate` body `{category, max_candidates?: int (default 3)}` → `PlanResponse`:
```json
{
  "category": 3,
  "source": "gemma" | "deterministic_fallback",
  "source_label": "Real Gemma response (model gemma-…)" | "Deterministic demo fallback — NOT a Gemma response",
  "model": "gemma-…" | null,
  "fallback_reason": null | "no_api_key" | "timeout" | "provider_error" | "invalid_output",
  "latency_ms": 0,
  "plan": {
    "summary": "...", "ranked": [{"candidate_id": "...", "rank": 1, "rationale": "..."}],
    "recommended_ids": ["..."], "tradeoffs": ["..."], "agent_citations": [{"agent":"medical","finding_id":"..."}],
    "limitations_ack": "..."
  },
  "validation": {"ok": true, "rejected": [{"reason": "unknown_candidate_id", "detail": "..."}], "repairs": []},
  "verified": {"evaluate": <same as /interventions/evaluate result for recommended_ids>}
}
```
  Backend owns every number: all metrics come from `verified.evaluate`. The model's free text may not contain numbers absent from the supplied evidence (validator rejects), may not name facilities/IDs not supplied, and cannot return coordinates.
- Provider: **Google Gemma** (not Gemini) via the Google AI Studio / Generative Language REST API, key from env `GEMMA_API_KEY` (fallback `GOOGLE_API_KEY`), model from env `GEMMA_MODEL`. Verify model availability with `models.list` once a key exists; document what was actually tested real vs mocked in `docs/GEMMA.md`. Never log or return the key (send it in the `x-goog-api-key` header, not the URL).

## Python interfaces (for AI teammate to import)
```python
from app.interventions import list_candidates, evaluate_plan   # Simulation teammate
from app.agents import build_report                            # Simulation teammate
```
`evaluate_plan(category:int, candidate_ids: list[str]) -> dict` (same JSON as the endpoint), `list_candidates() -> list[dict]`, `build_report(category:int, candidate_ids: list[str]) -> dict`.
Until these exist, AI teammate tests use fakes injected through function parameters.
