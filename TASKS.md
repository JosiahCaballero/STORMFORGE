# STORMFORGE — TASKS (updated 2026-10-24)

Deadline: Sun 2026-10-25 17:00 ET. Contract: `docs/CONTRACT.md`. Primary milestone: **storm → candidates → Gemma plan → deterministic before/after verification**.

Legend: ✅ done+verified · 🔧 in progress · ⬜ not started · ⚠ blocked

## Baseline (committed: 7a2d7dc map, b298608 engine)
- ✅ Map + NOAA-derived road exposure per category, KPIs, inspector, comparison, methodology
- ✅ Engine reachability + tests (edge counts match `access_summary.csv`)

## P1 Data integrity / inspector — Lead ✅
- ✅ Audit: closure == (bin>=3 & !bridge) for all 4,691 edges x 5 cats; downtown core genuinely closed in every category (low-lying), open/NoData segments exist elsewhere
- ✅ Inspector: NoData shown as "NO NOAA VALUE" (unknown, not dry); vitest regression (7 tests)
- ✅ KPI denominators labelled (directed edges / directed length / all nodes / sample origins)

## P2 Medical validity — Simulation teammate ✅ (investigation), decision pending
- ✅ `docs/MEDICAL_ACCESS.md`: Flagler = OSM way/326113100, centroid 354 m from dead-end Coke Rd node at graph clip edge
- ✅ Regional graph (6 km, 3,129 nodes / 7,921 edges) in `data/regional/`; sampler reproduces closure flags on 4691/4691 overlapping edges; hospital snaps to 39 m node. Hospital access still 0 at Cat 3-5 (its access roads are NOAA bin>=5). Default API graph stays 4 km. Switching needs zones/candidates re-tuned.
- ⬜ Decide: keep 4 km default (current) vs regional

## P3 Intervention engine — ✅ (7 hypothetical candidates; evaluate/compare/candidates endpoints; tests)
## P4 Gemma planner — ✅ verified live (gemma-4-26b-a4b-it, thinkingLevel=minimal, ~7-10 s). Evidence now has sequential marginals (recomputed after each pick), per-zone impact of the greedy plan; validator rejects redundant sites (<5 new nodes) and zone claims contradicting the recommended set; response carries backend `sequential_marginals` + `zone_impact`
## P5 Agent modules — ✅ 4 deterministic modules + UI tab; transit marked planned
## P6 Zones — ✅ 6 provisional zones (hull boundaries, bridge corridor has no polygon), zone impact panel
## P7 UI — ✅ browser-tested (scripts/e2e: 0 problems at 1440x900 and 1366x768): tabs, collapsible panels, zones, modules, apply/remove, plan, welcome + 5-step guided demo coach with live numbers, gained-node map layer (/api/v1/interventions/reach), camera framing, plan progress state, candidate ranking + cut-off flags. Remaining: record 3-min video (docs/DEMO.md), deploy, README polish

## Test status
backend `python -m pytest -q` 97 passed; frontend `npx vitest run` 7 passed.

## Decisions log
- Original 100-origin sample unrecoverable; deterministic 102-origin sample (every 18th node by sorted id).
- Teammates don't commit; Lead commits verified milestones.
