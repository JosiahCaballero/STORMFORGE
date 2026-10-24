# STORMFORGE — TASKS (updated 2026-10-24)

Deadline: Sun 2026-10-25 17:00 ET. Contract: `docs/CONTRACT.md`. Primary milestone: **storm → candidates → Gemma plan → deterministic before/after verification**.

Legend: ✅ done+verified · 🔧 in progress · ⬜ not started · ⚠ blocked

## Baseline (committed: 7a2d7dc map, b298608 engine)
- ✅ Map + NOAA-derived road exposure per category, KPIs, inspector, comparison, methodology
- ✅ Engine reachability + 6 pytest tests (edge counts match `access_summary.csv`)

## P1 Data integrity / inspector — owner Lead
- 🔧 Audit: closure == (bin>=3 & !bridge) holds for all 4,691 edges × 5 cats (verified); direction pairs agree except 6 bridge-related pairs
- 🔧 Inspector: stop labelling NoData as "open"; show NOAA-valued sample %, "no NOAA value (unknown, not confirmed dry)"; unit tests (vitest)
- 🔧 KPI labels: directed edges vs length vs sampled origins vs all nodes distinguished

## P2 Medical validity — owner Simulation teammate (time-boxed), Lead reviews
- ⬜ Document Flagler snap limitation (hospital lies outside graph; 354 m)
- ⬜ Regional graph (OSM, covering hospital + downtown) in `data/regional/`, NOAA-sampled with same rule; verified real EDs only from OSM tags; never invent entrances
- ⬜ If too risky: keep 4 km graph, label "network-bounded, provisional"

## P3 Intervention engine — Simulation teammate
- ⬜ `interventions.py`, candidates, evaluate/compare endpoints, tests (determinism, category effects, invalid ids, closed edge traversal, consistency)

## P4 Gemma planner — AI teammate
- ⬜ `gemma.py` provider, `planner.py` (schema validation, number/ID guards, fallback), `api_plan.py`, tests, `docs/GEMMA.md`
- ⚠ Needs `GEMMA_API_KEY` in `backend/.env` for real-model verification (mock tests do not need it)

## P5 Agent modules — Simulation teammate (`agents.py`) ; UI by Lead
- ⬜ Transportation / Medical / Logistics / Community findings; transit marked **planned** (no data)

## P6 Zones — Simulation teammate (backend) ; Lead (map overlay/panel)
- ⬜ 6 provisional demo zones, zone impact endpoint, map selection + panel

## P7 UI / demo — Lead
- ⬜ Collapsible panels, candidate markers, apply/remove, Gemma plan panel, agent inspector, guided demo flow, provenance labels

## Decisions log
- Original 100-origin sample unrecoverable; deterministic 102-origin sample (every 18th node by sorted id).
- Teammates don't commit; Lead commits verified milestones.
