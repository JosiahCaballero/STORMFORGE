# STORMFORGE — Master Product & Engineering Specification

**Version:** 1.2 — build-ready, updated with completed GIS feasibility tests  
**Prepared:** October 23, 2026  
**Status:** NOAA/OSM feasibility proven; application implementation pending  
**Event:** Gator Hack V / UF AI Days 2026  
**Project tagline:** *Break the city. See the consequences. Rebuild access.*  
**Working subtitle:** *Critical Access Intelligence*  
**Scope:** Hackathon demonstration and educational what-if planning tool; **not** live emergency guidance.

> **HACKATHON RULE GATE:** The official rules require all project code to be written during the hacking window **Friday October 23, 2026, 5:00 PM ET through Sunday October 25, 2026, 5:00 PM ET**. This document is a planning artifact, not implementation code. Do not generate, commit, or reuse project-specific code before the start. Open-source frameworks, libraries, public APIs and data are allowed. Verify any ambiguity with organizers.

---

## BUILD STATUS & VERIFIED DATA — October 23, 2026 (v1.2 update)

**Do not redo completed exploratory tests before building the first UI.** The hackathon is underway. The user has approximately one hour before changing workplaces, so prioritize a running vertical slice and a clean Git commit.

### Completed, tested, and available on the user's machine

- NOAA June 2026 reprocessed HIGH-tide SLOSH MOM inundation, Categories 1–5, cropped around St. Augustine. Five GeoTIFFs named `st_augustine_category{1..5}_HIGH.tif`, approximately 3674 × 4453 cells each, EPSG:4269, NoData 255. Values 1–20 denote 1-foot inundation bins; 21 denotes >20 ft. These are multi-storm *planning envelopes*, not forecasts or measured water levels.
- OSMnx initial 4 km-area drivable graph: **1,820 nodes, 4,691 directed edges**, projected EPSG:32617. Road exposure sampled against five NOAA rasters. Existing `road_exposure.csv` and `road_exposure.geojson` are demonstration artifacts, not a complete persisted routable graph.
- Initial routing test with one OSM-tagged hospital (`Flagler Hospital`), 100 deterministic sample origins. Experimental closure rule: **any approximately 20 m sample with NOAA class >=3** (lower bound >=2 feet); tagged `bridge=yes` edges exempt, but real bridge deck heights unknown. Baseline reachable **99/100**; Cat1 **49/100**; Cat2 **35/100**; Cat3–5 **0/100**. These are NOT population percentages or real-world accessibility estimates.
- Hospital snapping sensitivity: original snapped node **5500023299** was **356.2 m** from the hospital geometry; original Category 3 result 0/100, nearest-five candidate-node scenario 28/100. Nearby candidate nodes are NOT verified emergency entrances. The initial hospital destination is provisional; graph can artificially isolate it.
- Outputs on user's Windows machine in `C:\Users\josia\OneDrive\Documents\storm data\US_SLOSH_MOM_Inundation_v4\US_SLOSH_MOM_Inundation_v4_20260617\STORMFORGE_CROPS`. Subdirectories `ROAD_TEST`, `ACCESS_TEST`, `ACCESS_TEST\SENSITIVITY` contain CSV, GeoJSON, methodology and test results.
- Project directory: `C:\Users\josia\Projects\STORMFORGE`; last checked empty. Save this file as `SPEC.md` in project root, then copy datasets into `data/noaa`, `data/roads`, `data/access`.

### Locked presentation decisions

- **Visual camera:** ~4 × 4 km, downtown + Bridge of Lions + Davis Shores; zoom and selection reveal detail. Do not paint thousands of road segments red at once.
- **Six analysis zones:** Historic Downtown, Lincolnville, Davis Shores, Uptown / San Marco, West Augustine, and **Bridge Corridor** (infrastructure zone, not a residential population district). Boundaries must be drawn/verified; do not invent population counts.
- **Regional routing behind the scenes:** Greater St. Augustine road network and verified medical/EMS/shelter facilities. Facility completeness and emergency entrances are NOT yet established; the 4 km test graph is a provisional fallback.
- **Three signature interactions:** category slider → real hazard/road exposure; district resource allocation → deterministic route/score changes; Gemini structured commander plan → validated by deterministic engine.
- **Visual tone:** GIS operations dashboard with cinematic restraint. **Truthfulness:** clearly label source data, derived exposure, closure assumptions, and hypothetical interventions.

### Immediate implementation order — do this NOW

1. Create Vite + React + TypeScript + MapLibre frontend and FastAPI backend; inspect actual uploaded schemas before coding loaders. Render real road GeoJSON and category-specific exposure/closure styling, scenario counters, source/methodology drawer, six selectable *provisional* zones, and smooth camera. Avoid claiming finished district polygons if not yet computed.
2. Wire directed graph CSVs (`directed_edges.csv`, `nodes.csv`, `facilities.csv`, `methodology.json`) into deterministic NetworkX scenario endpoint; reproduce 99/49/35/0/0/0 sample-origin results as a regression test, clearly labeled **provisional single-hospital model**. Do not convert these counts to population coverage.
3. Add district resource allocation with explicit constraints and tested before/after recalculation. An intervention must change the graph/metric through code, not merely animate the UI.
4. Integrate Gemini with a backend-only API key, schema-validated proposals, independent simulation scoring, and a labeled offline fallback. Do not expose API secrets to browser.
5. If time permits, expand OSM road graph to encompass the hospital campus and additional facilities, verify real entrances from authoritative sources, persist GraphML and compact browser exports. This must not block a functional first demo.
6. Test the app locally, commit each working milestone, document run commands and remaining assumptions, and prepare 3-minute demo/deployment.

### Available file inventory to copy

`st_augustine_category1_HIGH.tif` through `st_augustine_category5_HIGH.tif`; `road_exposure.csv`, `road_exposure.geojson`; `access_summary.csv`, `directed_edges.csv`, `nodes.csv`, `facilities.csv`, `methodology.json`; optional `snap_sensitivity.csv`, `hospital_nearby_nodes.csv` for research. Original NOAA 1.5 GB archive should **not** be copied to Git. Keep source/provenance and OSM attribution.

**Scientific caution:** NOAA `255` is NoData, not verified dry. Bridge-exemption rules are hypothetical. A hospital disconnected by an unverified graph snap is not proof that real emergency services are inaccessible. Do not use STORMFORGE for operational emergency decisions.

---

## 1. Executive vision

**STORMFORGE** is an interactive, browser-based hurricane impact and emergency-response simulator focused on **St. Augustine, Florida**. Judges explore a geographically grounded 3D city, choose a storm scenario, watch infrastructure and road access deteriorate, then allocate scarce rescue and medical resources over a simulated 24-hour recovery. They can compare their own allocation with an **AI Emergency Response Commander powered by Gemini**, whose proposed actions are checked and scored by a deterministic Python simulation engine.

The central insight is **critical access, not just destruction**: a bridge, road segment, or flooded corridor can disconnect people from emergency care and shelters, creating cascading consequences that aren't visible in a static flood map. STORMFORGE turns those dependencies into something the user can experiment with.

### Core user story

> As an emergency-planning learner or community stakeholder, I can simulate a hurricane, inspect how real geographic infrastructure is exposed, allocate a limited response budget, and see how different decisions affect access to care, shelters, and critical services—without confusing the demonstration with an official forecast or operational recommendation.

### Primary objective

**Locked product priorities (v1.1):** Balanced visual direction (credible GIS operations dashboard with selective cinematic storm effects); district-click resource allocation (no drag-and-drop requirement); Gemini as a structured response planner with grounded plan rationale (no conversational assistant); balanced delivery across functional simulation, attractive UI, and substantive Gemini integration.

Ship a **reliable, visually exceptional, interactive end-to-end demo** that judges can use without assistance. Aim for first place, plus credible consideration for Best Use of Gemini (subject to organizer confirmation), Best Design, Best AI Hack, and Best Social Impact. Do not sacrifice demo reliability to chase extra tracks.

### Non-goals

- Not an operational dispatch platform, real-time hurricane forecast, or emergency alert system.
- Not a scientifically validated hydrodynamic or structural damage model.
- Not a prediction of deaths, injuries, or individual medical outcomes.
- Not a photorealistic digital twin of every building.
- Not a full-scale machine-learning research project unless a credible labeled dataset and validation can be established within the timebox.
- Not a live integration with 911, hospital patient records, or real responder availability.

---

## 2. Hackathon requirements, constraints, and success definition

**Official event:** Gator Hack V, Oct 23–25, 2026, Newell Hall, UF. Team size 2–5 enrolled students; current working team has three people: one primary developer and two pre-med collaborators. At least one team member must attend finalist presentations Monday Oct 26, 10:15 AM at Reitz Union to remain award-eligible.

**Submission by Sunday Oct 25, 5:00 PM ET:**
1. Title and concise project description, including implementation.
2. **Public** source repository URL; it may remain private during development, then become public before submission.
3. Demo video **3 minutes maximum** or slides; ideally both if time permits, with a working live link.
4. Full registered team roster.
5. Applicable tracks/sponsor challenges.

**Official judging criteria:** Impact; Technical Execution; Design & Usability; Presentation & Demo. Finalists are selected from offline judging before Monday; prioritize a recorded demo that stands alone.

**Fresh-code constraint:** All STORMFORGE-specific code created during official hacking window. Record repository commit chronology. Planning/specification and ordinary preexisting tools/frameworks are distinct from project code; check with organizers if needed.

**Definition of a successful minimum demo:**
1. Page loads and shows an identifiable, navigable St. Augustine map with genuine geographic geometry.
2. User selects a hurricane preset and sees a clear, animated transition to a deterministic damage state.
3. At least some flood exposure, blocked roads, and facility accessibility outcomes are calculated from real geographic inputs plus clearly labeled synthetic assumptions.
4. User assigns a constrained set of emergency resources, runs a 24-hour response, and sees meaningful metric changes.
5. Gemini returns a structured allocation recommendation (or a clearly labeled offline fallback if unavailable); the same simulator scores both plans.
6. The comparison makes trade-offs visually obvious and provides explanations grounded in actual model outputs.
7. Demo runs repeatably with no secret API key exposed and a prepared fallback for unreliable network/API access.

---

## 3. Product experience and user journey

### Stage A — Explore the city

- Open the operations dashboard on a dark navy interface.
- Main view is a **stylized, interactive 3D map** centered on St. Augustine, Florida, with real road alignments, bridges, building footprints where available, coast/water context, and named emergency facilities.
- Controls: pan, zoom, rotate, and tilt/pitch; **no unrestricted free-flight**.
- Map should be legible at laptop resolution (1366×768) and compelling on a presentation screen.
- City is divided into **6–8 meaningful districts** for readable interaction and summary statistics. District boundaries should be explicitly documented: official polygons if available, otherwise transparent analysis zones generated from documented geography, not presented as official administrative districts.
- Select a district to view population estimate, exposed infrastructure, road connectivity, critical facilities, and scenario status.

### Stage B — Choose a hurricane

- Three selectable presets: **Tropical Storm**, **Category 3**, **Category 5**.
- Presets are **hypothetical planning scenarios**, not actual historical tracks. Wind category is not a direct one-to-one prediction of local flood depth.
- Press **Simulate Storm**. A bottom timeline advances through an accelerated storm sequence (suggested 45–75 seconds; adjustable for demo).
- Animate storm indicator/path, wind/debris particles, storm-surge exposure, road interruptions, district status, and selected building damage cues.
- **Damage is precomputed** for the chosen preset and progressively revealed for smooth playback. Playback speed must not alter final damage state.
- Damage persists when playback ends. User can pause, scrub, reset, or select a different preset.
- A clear on-screen disclaimer says: *Illustrative scenario. Flood hazard from NOAA modeled risk maps; impacts and timing simulated for demonstration.*

### Stage C — Assess critical access

- Display district impact overview, roads closed, hospitals/clinics/shelters reachable, population with reduced access, and high-priority bottlenecks.
- Emphasize a visible causal chain: **surge-exposed road → inaccessible bridge/corridor → slower/unavailable EMS access → alternative intervention**.
- A facility detail panel displays its name, facility type, source, and current route status. Do not invent real facility names or label a synthetic point as an official facility.
- Show road closure reasons separately: **flooded** vs **debris-blocked**. This distinction drives resource feasibility.

### Stage D — Allocate resources

- **Locked interaction (v1.1): district-based click-to-assign.** User clicks a district on the map or district list, selects a resource type and quantity in the right sidebar, reviews feasibility/availability, then confirms the assignment. Assignments appear in a readable queue and may be edited or removed before the run. No drag-and-drop assignment UI is required or in scope.
- After storm, enter a **24-hour response planning phase**.
- User assigns **all resources before running** the response timeline; allocations are then simulated in a deterministic, event-based sequence.
- Five types:
  1. Rescue teams — assist high-need districts and reduce unmet simulated rescue demand.
  2. Road-clearing crews — remove **debris closures only**, with task durations and access prerequisites.
  3. Mobile medical units — provide temporary local treatment capacity, with feasible deployment constraints.
  4. Shelter teams — activate/support shelter access and capacity.
  5. Ambulances / EMS — transport/serve simulated medical demand **only via passable routes**.
- Show resource availability, assignment destination, travel feasibility, action duration, and remaining budget. No infinite resources or instantaneous teleportation.
- Example initial resource quantities (CONFIGURABLE, **not historical data**): 3 rescue teams, 2 clearing crews, 2 mobile medical units, 2 shelter teams, 3 ambulances. Tune after feasibility testing; display all quantities as scenario assumptions.
- On invalid assignment, show **why**: road inaccessible, flooded corridor cannot be cleared, insufficient resources, unavailable shelter capacity, or assignment conflict.

### Stage E — Run, compare, understand

- Click **Run My Plan**; show time advancing from hour 0 to hour 24 with crews moving or working, roads reopening where feasible, facility access changing, and summary metrics updating.
- Click **Generate Gemini Plan** to produce an alternate allocation using the **same starting damage state, resources, time budget, and scoring engine**.
- Gemini must submit a machine-readable plan. Python validates it, rejects or repairs invalid actions with a documented procedure, and simulates the accepted plan. The model cannot supply the final score.
- Comparison view: side-by-side or toggled map + metrics, highlighting resource decisions and why they helped/hurt.
- User can reset and experiment. Gemini returns concise, grounded reasons alongside its generated plan; do **not** build a conversational Ask Gemini interface or interactive district Q&A for the MVP.

---

## 4. Geographic scope and source-of-truth policy

**Primary geography:** St. Augustine, St. Johns County, Florida. **LOCKED VISUAL SCOPE:** approximately 4 × 4 km centered on the historic downtown / Bridge of Lions / Davis Shores corridor, with a readable camera and progressively disclosed roads. **LOCKED ANALYSIS ZONES:** five neighborhood zones (Historic Downtown, Lincolnville, Davis Shores, Uptown / San Marco, West Augustine) and one infrastructure zone (Bridge Corridor). These are custom demonstration zones, NOT official districts; final polygon boundaries and exact camera bounds remain to be validated. **BACKEND SCOPE:** a larger connected regional graph encompassing the hospital and alternative emergency facilities, without cluttering the default map. Avoid trying to process all of St. Johns County. Store precise polygons and provenance.

### Source inventory and usage

| Layer | Preferred source | Intended use | Caveats / validation |
|---|---|---|---|
| Storm surge exposure | **NOAA NHC National Storm Surge Risk Maps Version 4**, Texas-to-Maine update **June 18, 2026** | **Central new dataset** for inundation hazard and corridor exposure | High-tide SLOSH MOM climatological maximum risk; not time-dependent event prediction; check raster class codes and metadata |
| Roads, bridges, building footprints | OpenStreetMap via OSMnx / Overpass, with St. Johns County GIS where helpful | Map geometry and routable graph | OSM incompleteness, one-way restrictions, disconnected edges, access tags, bridges, attribution |
| Local facilities, roads, hazard polygons | St. Johns County GIS / ArcGIS services, official emergency-management datasets | Verify shelters, road classifications, local GIS features | Endpoint/field availability, licensing, currency; don't assume a service exists until tested |
| Elevation | USGS 3DEP / National Map | Contextual topography, cross-check exposure | Vertical datum, units, raster size, coverage |
| Population | US Census ACS / decennial geography | District population weights and exposure estimates | Areal interpolation is approximate; avoid person-level claims |
| Basemap / 3D styling | MapLibre-compatible vector tile source with permitted attribution | Render roads, terrain/context, building extrusion | Check tile hosting, API limits, terms, network reliability |
| Optional storm context | NOAA/NHC advisories and publicly documented historic events | Narrative context only | Don't misrepresent unrelated storms as St. Augustine observations |

**Verified NOAA provenance:** Official NOAA NHC site identifies Version 4 and its reprocessing of US Gulf/East Coast data; download list specifies **Texas to Maine Updated Version 4 – 6/18/2026**. This is a strong candidate for the “released in the past 12 months” challenge, **subject to the sponsor's exact eligibility rules**. Do not imply that the entire Version 4 product first appeared in 2026. Cite the **specific updated coastal dataset**, its date, and actual transformation into our analysis.

**NOAA raster handling:** Download only relevant Florida coverage if feasible; identify which category layers are provided. Read GeoTIFF CRS, nodata, class bins, metadata. NOAA inundation rasters encode 1-foot classes; class 21 means over 20 feet, 99 indicates leveed areas. Clip to study area; reproject accurately; derive per-road-segment exposure and district summaries. Retain source IDs, extraction dates, and processing script. Do not silently convert category or depth classes into precise local predictions.

**Tropical Storm handling:** NOAA hurricane-category MOM risk layers do not inherently represent a tropical-storm forecast. For this preset, use a separately documented **illustrative low-intensity exposure assumption** or a genuinely applicable source if found. Clearly label this synthetic derivation; do not present it as an official NOAA tropical-storm raster.

**Data provenance classes:** Every displayed metric and layer must be tagged in the code and documentation as one of:
- `observed` / `source_data` — factual map or dataset attribute.
- `derived` — reproducible transformation of source data.
- `assumed` — chosen scenario parameter.
- `simulated` — computed hypothetical state/outcome.
- `ai_proposed` — model-suggested action, not validated truth.

**Attribution and ethics:** Display NOAA, OSM contributors, USGS, Census, county data attribution as applicable. Never present inferred patient counts or casualties as actual people. Add a short methodology/about panel.

### Data feasibility gate (highest early priority)

Before elaborate UI or optimization, prove the following with real artifacts:
1. Fetch one small real road graph and building sample for study area.
2. Load relevant NOAA surge raster and demonstrate a correctly projected clip/intersection.
3. Locate and validate at least one genuine critical facility or use clearly labeled synthetic facility positions if source unavailable.
4. Show at least one flood-exposed road edge and recompute a route around it.
5. Export compact, browser-friendly GeoJSON and scenario JSON.

If this gate fails, simplify to a smaller geographically valid study area; do **not** fake a realistic-looking map and call it source-grounded.

---

## 5. Simulation and analytical engine

### Guiding principle

A deterministic **Python engine** owns scenario generation, graph connectivity, resource constraints, and scoring. Gemini is a **planner/explainer**, not the source of physical facts or outcome metrics.

### 5.1 Spatial/network model

- Directed/undirected routable road graph as appropriate; nodes are intersections, edges are traversable segments.
- Edge fields: `edge_id`, endpoints, geometry, length, baseline travel time, road class, bridge flag, source, surge-exposure class, blockage type, passability, clearing duration (if debris), and recovery state.
- Facilities: `facility_id`, type (`hospital`, `clinic`, `shelter`, `staging`, etc.), source, location, nearest network node, capacity assumptions, current accessibility.
- Districts: `district_id`, polygon, population estimate, medical-demand proxy, exposure, priority weights, reachable facilities.
- Route analysis: Dijkstra / shortest path via NetworkX, with closed edges removed or infinite cost. Recompute on time-based edge restoration.
- Precompute or cache common origin-destination routes for speed.

### 5.2 Storm scenario model

Inputs: preset, study-area dataset version, random seed, explicit assumptions. Output: stable snapshot of hazard-exposed roads/buildings, debris closures, facility access, and district-level needs.

- Cat 3 and Cat 5 may draw on the respective NOAA category risk layers **as potential surge exposure**, then use transparent scenario-specific assumptions to select or weight closures and wind damage.
- Tropical Storm is synthetic low-intensity scenario unless an appropriate official source is found.
- No claim that wind speed alone determines flood depth; category is only a scenario selector.
- Wind/debris effects are visually plausible but analytically labeled as simulated.
- For fixed input and seed, same final damage snapshot every time.
- Hurricane animation uses timeline interpolation/reveal of that snapshot, **not** a hydrodynamic solver.
- Optional seed variation is disabled in primary judge demo to ensure repeatability.

### 5.3 Recovery simulation

Time domain `t = 0..24h`; use discrete events or fixed 15–30 minute ticks. A resource assignment has type, target, start time, duration, prerequisite, and resulting state change. Resource availability is tracked to prevent double booking.

**Critical rules:**
- A debris-clearing crew may reopen a debris-blocked road after a nonzero clearing time, provided the crew can reach it; **cannot reopen a flooded road** during an unchanged flood state.
- EMS requires a passable path; no crossing flooded or blocked edges.
- Rescue and mobile medical units must obey defined deployment/reachability constraints, with any off-road capability explicitly modeled rather than assumed.
- Shelter teams only benefit a shelter that exists in the model and is accessible/deployable.
- When an edge reopens, recompute affected routes; metrics change over time.
- Do not assume floodwater recedes within 24h unless a separate, labeled recession model is implemented and tested. Default to persistent flooding to avoid invented recovery physics.
- Plans that use identical resources and initial state are evaluated under identical assumptions.

### 5.4 Metrics and scoring

**Primary ranking:** (1) life safety proxy, (2) access to emergency medical care, (3) access to shelters and critical services. Transportation clearing is an **enabler**, not an end goal.

Candidate metrics, with clear units and formulas:
- `population_with_ems_access`: estimated district-weighted population with at least one reachable eligible care facility / EMS route within threshold.
- `medical_demand_served`: count of **synthetic modeled demand units** served, not actual patients or lives saved.
- `weighted_unmet_medical_demand`: remaining synthetic district need weighted by vulnerability/access assumptions.
- `critical_facilities_reachable`: number / share of facilities accessible from defined staging nodes.
- `road_access_restored`: number/length of debris edges reopened and resulting connectivity benefit.
- `shelter_capacity_accessible`: modeled shelter spaces reachable, when verified or labeled assumptions available.
- `resource_utilization`: crew-hours used and idle time.
- `time_to_recovery_milestones`: simulated time until key access thresholds restored.

**Proposed scoring rule (must be finalized and unit-tested):** Normalize outcomes to 0–100 based on fixed scenario-specific baseline/targets; weighted score `0.50 * medical_demand_served_score + 0.30 * ems_access_score + 0.20 * critical_services_score`, with safety/feasibility penalties for invalid actions. The exact weights are **design assumptions**, not FEMA doctrine or evidence of real-world optimality. Prefer displaying raw interpretable metrics alongside any composite score. Consider lexicographic priorities if a weighted sum rewards unsafe tradeoffs.

**Guardrail:** Do not display a fabricated number of “lives saved.” If needed, say **“modeled medical demand served”** or **“population with improved access.”**

### 5.5 Validation tests

- Same scenario seed → identical outputs.
- Closed road cannot appear in a computed traversable path.
- Debris clearing changes reachability only after crew arrival and work duration.
- Flooded road cannot be cleared by debris crew.
- No negative crew counts, duplicate resource assignments, or impossible travel.
- No plan gets more resources or a different hazard state than its comparator.
- Plan score computed by backend, independent of Gemini text.
- Changing resource allocation changes at least one measurable outcome in a curated fixture.
- Category selection produces explainable, internally consistent scenario differences.
- GIS projection test: a known feature intersects the expected geographic region after reprojection.

---

## 6. Gemini AI Emergency Response Commander

### Core integration

Use the **Google Gemini API** through a **server-side FastAPI adapter**. Never expose the API key in frontend source, browser requests, screenshots, or repository. The model's job is to propose **valid resource allocation actions** and explain prioritization; all decisions are subject to simulator constraints.

### Planner workflow

1. Backend serializes a bounded **planning snapshot**: district IDs, exposure/access metrics, closures and blockage types, candidate actions, resource inventory, time horizon, objective, and assumptions.
2. Gemini returns **structured JSON** matching a versioned `ResponsePlan` schema, ideally using schema-constrained output or function calling.
3. Backend validates schema, IDs, resource totals, travel feasibility, and prerequisites.
4. On invalid output, retry once with machine-readable validation feedback; otherwise fall back to a deterministic heuristic baseline and visibly label it as fallback (not Gemini-generated).
5. Backend simulates accepted plan under same rules as manual plan.
6. Gemini may generate a concise narrative based on **computed results** after simulation; numeric claims must match supplied values.

### Proposed `ResponsePlan` shape (conceptual contract)

```json
{
  "schema_version": "1.0",
  "scenario_id": "cat3-seed42",
  "strategy_summary": "Restore emergency medical access first",
  "assignments": [
    {
      "resource_type": "road_clearing_crew",
      "resource_id": "crew-01",
      "target_type": "road_edge",
      "target_id": "edge-123",
      "priority": 1,
      "rationale": "Debris blockage cuts the shortest feasible EMS route"
    }
  ]
}
```

This JSON is a **schema illustration**, not an assertion that these IDs exist in the actual dataset. Resource-specific assignment fields will be formalized in `ARCHITECTURE.md` after data feasibility.

### Meaningful Gemini-specific features

**Locked Gemini scope (v1.1):** A structured, constraint-aware response planner with a concise explanation of its proposed priorities. Gemini does not act as a general chat assistant, accept open-ended user questions, or own final scoring. The planning output, validated execution, and fair comparison are the complete prize-track integration.

- Primary: **AI response plan generation** with structured outputs and deterministic validation.
- Required: Provide a short, grounded rationale for the generated plan and major tradeoffs, citing the supplied model evidence and uncertainty.
- Optional only if ahead of schedule: add non-conversational expandable rationale details for individual actions. No separate `/api/v1/explain` endpoint is required for MVP.
- Compare plan A/B tradeoffs using computed metrics; do not have Gemini grade its own plan.
- Optional only if reliable: conversational what-if queries that translate into allowed scenario modifications; no unbounded command execution.

### Cost/reliability

- Claude Max subscription for **Claude Code development** is distinct from Gemini API billing/quota. Check Gemini API access, free-tier limits, latency, and model availability before committing.
- Add backend timeout, bounded retries, response size limits, cache by scenario hash, and offline demo plan fixture **clearly labeled as cached/fallback**.
- Never describe fallback heuristic output as live Gemini inference.
- No personally identifiable medical records or actual emergency call data.

---

## 7. Frontend design and interaction specification

### Visual direction

**Locked visual direction (v1.1): balanced, professional GIS operations dashboard with selectively cinematic storm effects.** Credibility and readable information come first; dramatic effects support the storm narrative without obscuring roads, districts, facilities, controls, or metrics. Do not pursue photorealistic rendering or a movie-like cutscene at the expense of map legibility and reliable interaction. Dark navy/charcoal foundation; restrained cyan/teal for informational overlays, amber for warnings, coral/red for severe disruptions, green for restored access. Use high contrast, readable type, disciplined spacing, minimal decorative glow, and purposeful motion. Consistent visual language between map, charts, and timeline.

### Desktop layout

- **Top command bar:** STORMFORGE wordmark; current city; scenario; phase; data-source/methodology access; reset.
- **Main canvas (majority of viewport):** MapLibre map with 3D building extrusions, roads, surge overlay, animated markers and selection highlights.
- **Left or floating compact controls:** storm preset cards, simulate/play, map layer toggles, legend, camera reset.
- **Collapsible right sidebar:** context-aware district/facility detail, **click-selected district resource assignment** (type, quantity, confirm, edit/remove), Gemini plan, and comparison details.
- **Bottom timeline:** storm playback then response hours 0–24, with events and scrub/play/pause/speed.
- **Summary KPI strip:** high-signal metrics with units, tooltips and scenario labels; no fabricated numbers.
- **Compare mode:** A/B plan metrics with directional deltas and shared baseline; map highlights restored routes.

### Camera and map behavior

- Pan, zoom, rotate, pitch. No free-flight.
- Start with an aesthetically framed oblique view that reveals bridges/coastal terrain.
- Use building extrusions with height if verified; otherwise style by modest fixed or source-tagged height and disclose approximation.
- Flood areas are translucent, distinguishable from water bodies, with a clear legend and provenance tooltip.
- Roads colored by passability: normal, debris-blocked, surge-exposed/flooded, reopened.
- District click selects without losing map context; right sidebar updates and becomes the primary resource assignment surface in response-planning mode.
- Map markers show confirmed assignments and response activity, but users do not need to drag markers or resources to assign them.
- Animation should be smooth and optional reduced-motion mode respected.

### UX/accessibility

- One prominent primary action per phase: **Simulate Storm → Select District & Assign Resources → Run My Plan → Generate/Compare Gemini Plan**.
- Short first-run onboarding (maximum 3 steps) or embedded guided hints.
- Keyboard operability for non-map controls; semantic buttons, focus indicators, screen-readable metric labels.
- Do not encode severity by color alone; use patterns/icons/text.
- Responsive enough for laptop, but optimize judge demo for desktop widescreen.
- Clear loading, empty, invalid assignment, Gemini timeout, and data unavailable states.
- Render meaningful metrics even without external Gemini connectivity.

### Motion principles

- Storm transition creates anticipation, not a distracting cutscene.
- Wind particles, rain bands, and impact pulses should be GPU-friendly and decoupled from analytical state.
- Damage/flood reveal progresses along timeline but final values are precomputed.
- Response actions visibly move across network paths when feasible; no teleporting icons.
- Microanimations explain cause/effect: closed edge → route unavailable; reopened edge → connectivity returns.
- Avoid complex particle systems until vertical slice works at target laptop FPS.

---

## 8. Architecture and stack

### Frontend

- React + TypeScript + Vite.
- Tailwind CSS + shadcn/ui for accessible components.
- MapLibre GL JS for map navigation, vector layers, 3D building extrusions, and geographic overlays.
- Recharts for time-series and plan comparison visualizations.
- Lightweight state management: React context/hooks initially; add Zustand only if complexity warrants.
- Strongly typed API client and shared TypeScript interfaces generated or maintained against backend JSON schemas.

### Backend

- Python FastAPI + Pydantic for REST endpoints and schema validation.
- NetworkX for road routing, connectivity, and response graph algorithms.
- GeoPandas / Shapely / Rasterio / OSMnx in **offline preprocessing scripts** where possible; avoid heavyweight geospatial preprocessing during browser requests.
- Preprocessed GeoJSON/JSON assets and small immutable scenario fixtures; **no database required** for hackathon MVP.
- Optional optimization baseline: greedy marginal-benefit heuristic with explicit objective; sophisticated solver only if validated and timely.
- Gemini adapter isolated behind service interface; offline fallback planner for resilience.

### Deployment

- Frontend: Vercel or equivalent static host.
- Backend: Python-capable hosting (e.g., Render/Railway/Fly), subject to availability, cold starts, cost, and allowed deployment during hacking window.
- Local development: Vite dev server + Uvicorn API with CORS limited to configured origins.
- Backup: full localhost demo with preprocessed assets and cached/heuristic plan if deployment fails.
- No public API secrets, no hardcoded credentials, no dependency on a database.

### Suggested repository layout

```text
STORMFORGE/
├── SPEC.md                       # This document
├── CLAUDE.md                     # Concise repo-wide agent rules
├── ARCHITECTURE.md               # Frozen module/API contracts
├── README.md                     # Setup, provenance, demo, limitations
├── .gitignore
├── .env.example
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/{layout,map,storm,response,comparison}/
│   │   ├── features/{scenario,planning,gemini}/
│   │   ├── api/
│   │   ├── types/
│   │   └── styles/
│   └── tests/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── services/{scenario,network,recovery,scoring,gemini}/
│   │   └── main.py
│   └── tests/
├── data/
│   ├── processed/               # Compact redistributable demo data
│   ├── fixtures/                # Explicitly labeled synthetic inputs
│   └── SOURCES.md               # URLs, dates, license, CRS, processing
├── scripts/                      # Reproducible data prep
├── docs/                         # Pitch, demo script, methodology
└── .claude/
    ├── agents/                   # Role descriptions
    └── skills/                   # Project-specific skill instructions
```

**Data sizes:** Avoid committing huge raw rasters or proprietary tile assets. Commit derived compact artifacts only where license permits. Provide source download/preprocessing instructions for reproducibility.

---

## 9. API and shared contracts — provisional, to freeze before parallel agents

Version prefix: `/api/v1`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Deployment/readiness status |
| `/api/v1/metadata` | GET | City bounds, data versions, attribution, available layers |
| `/api/v1/map/roads` | GET | Processed road GeoJSON or static asset URL |
| `/api/v1/map/buildings` | GET | Building GeoJSON or static asset URL |
| `/api/v1/map/districts` | GET | District polygons, IDs, baseline stats |
| `/api/v1/map/facilities` | GET | Facility locations, types, source, capacity assumptions |
| `/api/v1/scenarios` | GET | Presets, assumptions, allowed controls |
| `/api/v1/scenarios/{id}` | GET | Deterministic precomputed damage snapshot and timeline events |
| `/api/v1/plans/validate` | POST | Validate manual/AI assignments and return errors |
| `/api/v1/plans/simulate` | POST | Run deterministic 24h response and return events/metrics |
| `/api/v1/plans/gemini` | POST | Generate and validate Gemini response plan |
| `/api/v1/plans/compare` | POST | Evaluate two plans against same baseline |
| `/api/v1/explain` | POST | **Deferred, optional:** action-level explanation only if time remains; not required for v1.1 MVP |

**Required shared IDs:** Stable `scenario_id`, `district_id`, `edge_id`, `facility_id`, `resource_id`, `plan_id`. Coordinate order in GeoJSON **longitude, latitude**; all timestamps in hours relative to simulated landfall; include schema version and provenance. Do not create duplicate incompatible definitions in separate agents.

**Representative `ScenarioSnapshot`:** scenario metadata, geographic bounds, time horizon, hazard provenance, districts, edge states, facilities, resources, scenario assumptions, events. **Representative `SimulationResult`:** accepted assignments, warnings, event log, hourly metrics, final metrics, scoring explanation. Exact Pydantic schemas and TypeScript mirrors are Lead Architect's first deliverable.

**Contract freeze:** Lead agent owns shared types and API schemas. Specialists propose contract changes through the lead rather than silently editing each other's interfaces.

---

## 10. AI development workflow: Claude Code agents, skills, worktrees

### Environment

- Windows 11 Alienware; PowerShell in Windows Terminal; VS Code.
- Git, Node.js/npm, Python 3.13, Claude Code installed.
- Claude Max subscription covers Claude Code usage within plan limits; Gemini API billing/quota separate.
- Repo location: `C:\Users\josia\Projects\STORMFORGE`.
- No Superset required. Claude Code Agent Teams (experimental) may coordinate messages/tasks; Git worktrees isolate file changes. **Neither alone guarantees integration**.

### Pre-agent setup (after 5 PM start)

1. Ensure repo initialized on `main` (already done, empty); first project-code commit only after start.
2. Add `SPEC.md` and data provenance checklist; create `CLAUDE.md` concise policies.
3. Lead Architect scaffolds runnable frontend/backend, health endpoint, smoke tests, and typed contracts.
4. Commit green foundation before parallelizing; use separate branches/worktrees or explicit file ownership.
5. Do not launch parallel agents against empty/undefined contracts.

### Agent roles

**Lead / Integrator (primary developer supervising):** owns architecture, common schemas, build, merges, integration, CI/smoke tests, deploy, and judge demo. Challenges assumptions; refuses fake metrics. Reviews every agent's results.

**Agent A — GIS / Map:** downloads/validates geodata, extracts surge exposure, builds browser-ready GeoJSON, 3D MapLibre scene, map selection and overlays. Owns geospatial scripts, processed map assets, map components. Coordinates edge IDs and CRS with Simulation Agent.

**Agent B — Simulation / EMS:** owns graph model, hazard snapshot interpretation, response feasibility, route access, resource timing, deterministic scoring, API endpoints, and tests. Uses shared schemas. Coordinates facility/district IDs with Map Agent.

**Agent C — UI / Gemini:** owns polished balanced-style operations dashboard, onboarding, timelines, **district click-to-assign controls (not drag-and-drop)**, comparison charts, Gemini structured planner adapter and plan rationale (not chat), graceful API fallback. Coordinate server endpoint ownership with Agent B to avoid overlapping backend edits.

**Human pre-med teammates:** review medical response plausibility, ethical language, emergency-care prioritization, accessibility, narrative, demo, and pitch. They should own meaningful work: verify facility/shelter descriptions, construct plausible scenario assumptions, validate medical terminology, test the app as nontechnical judges, record demo/pitch, and document limitations. Do not represent them as clinical authorities unless appropriate.

### Skills to consider

- JMO `interview`: specification gap check only; do not restart settled decisions.
- JMO `better-ui` + Anthropic `frontend-design`: deliberate interface polish.
- JMO `animate`: purposeful storm and response motion.
- JMO `agentation`: optional annotated visual feedback after running UI.
- Custom `gis-validation`: source provenance, CRS, intersections, licenses, edge connectivity.
- Custom `simulation-verification`: determinism, feasible actions, reproducible scoring.
- Custom `demo-readiness`: 3-minute walkthrough, offline mode, critical flows, deployment smoke checks.

**Important:** Skills are reusable workflows, not agents; Agent Teams is for messaging/task coordination; worktrees are for code isolation. Inspect third-party skill contents before enabling executable behavior. Do not install irrelevant integrations or expensive MCP tools.

### Collaboration protocol

- Shared source of truth: `SPEC.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `data/SOURCES.md`.
- Lead creates explicit task tickets with owner, owned files, dependencies, acceptance tests, and expected integration contract.
- Every agent reports: commits, files changed, tests run, screenshots if relevant, assumptions, blockers, contract changes.
- Agent messaging communicates API/schema questions, not unreviewed cross-worktree file edits.
- Prefer small PR-sized changes; merge into `main` after tests. Avoid three agents rewriting the same file.
- Check `/usage` and keep concurrency aligned with Max plan limits; one lead plus two specialists may outperform four active agents.
- Protect secrets in `.env`; never commit keys. Avoid auto-approve modes for destructive shell commands.

---

## 11. Build order and 48-hour execution schedule

**Rule:** vertical slice first. Every phase must leave a runnable demo; don't build three isolated half-products.

### Before hacking begins — planning only

- Confirm team registration, venue, deadline, sponsor track rules, account access, API quota, and roles.
- Finalize specification, references, storyboard, and public source URLs; **no STORMFORGE-specific code before 5 PM ET**.
- Decide the 6–8 districts and exact map boundary only after checking data feasibility.

### H+0 to H+3 — Data + foundation gate

- Scaffold frontend/backend and schemas; commit.
- Verify NOAA raster, roads, facility data extraction in actual study area.
- Create a small static data fixture and demonstrate graph edge closures.
- Produce first working map and backend health route.
- **Go/no-go:** If NOAA processing fails, pivot to smaller geographic area or a valid preprocessed subset; preserve provenance.

### H+3 to H+10 — Vertical slice

- One storm preset (Cat 3), one district, one blocked route, one valid resource action, one changing accessibility metric.
- Browser interaction end-to-end; deterministic test.
- First rough Gemini plan integration or a documented heuristic fallback.
- **Do not start elaborate animations until this works.**

### H+10 to H+22 — Full MVP

- Expand to 6–8 districts, three presets, five resource types.
- Complete 24-hour response simulation and score metrics.
- Add manual vs Gemini comparison and typed validation.
- UI responsive dashboard and map overlays.

### H+22 to H+34 — Technical robustness and design

- Validate edge cases, optimize map performance, add graceful error states.
- Add storm/response timeline and visually meaningful recovery animation.
- Pre-med teammates verify language, workflows, and narrative.
- Deploy and smoke-test from an external browser.

### H+34 to H+42 — Demo and submission preparation

- Freeze major features. Record reliable ≤3-minute demo video.
- Prepare README with setup, sources, methodology, limitations, and Gemini details.
- Make repo public in time, confirm team roster and tracks.
- Run full judge path at least three times.

### H+42 to H+46 — Buffer and submission

- Submit **well before** Sunday 5 PM ET; reserve a 2-hour safety buffer where possible.
- Fix only high-severity bugs; no new feature dependencies.
- Prepare Monday finalist pitch and backup recording.

### Hard scope-cut order (when behind)

1. Conversational Gemini Q&A, voice, and drag-and-drop resource allocation are **out of scope from the start**; do not spend time implementing them.
2. Cut extra chart variants and nonessential cinematic map effects; retain readable hazard overlays and a convincing storm transition.
3. Simplify buildings to extrusions/footprints and animations to timed overlays.
4. Reduce district count and scenario variety **temporarily**; retain one coherent Cat 3 end-to-end path.
5. Use a simple deterministic greedy baseline rather than unvalidated sophisticated optimizer.
6. Never cut: working map, real data provenance, **district click-to-assign**, resource feasibility, measurable A/B comparison, substantive Gemini planning, truthful limitations, or submission materials.

**Balanced delivery rule (v1.1):** Do not spend the entire timebox on visual effects, GIS research, or AI prompts in isolation. Secure a working end-to-end vertical slice early, then improve scientific grounding, visual quality, and Gemini reliability together. Prioritize demo correctness over speculative sophistication.

---

## 12. Demo storyboard and judging strategy

### The 20-second hook

> “A hurricane doesn't just damage buildings. It can cut off entire neighborhoods from medical care. STORMFORGE lets you test which emergency decisions restore access fastest—and compare your choices with Gemini.”

### 3-minute recorded demo (suggested)

| Time | Visual/action | Judge takeaway |
|---|---|---|
| 0:00–0:20 | St. Augustine 3D map, zoom to bridge/corridor; introduce problem | Real, tangible community impact |
| 0:20–0:50 | Select Cat 3; start storm timelapse; roads and districts change | Visually memorable simulation |
| 0:50–1:20 | Click isolated district and medical facility; show blocked route | Critical-access insight, not decorative damage |
| 1:20–1:55 | Allocate limited resources manually; run 24-hour response | Interactive consequences and constraints |
| 1:55–2:30 | Gemini generates feasible plan; side-by-side score and map routes | Substantive Gemini use and algorithmic evaluation |
| 2:30–2:50 | Show provenance and key limitation: 2026 NOAA hazard dataset vs simulated outcomes | Scientific/ethical credibility |
| 2:50–3:00 | End with impact and future potential | Memorable finish |

### Prize-track positioning

- **Overall / first place:** strong end-to-end experience, clear impact, sophisticated but defensible GIS + graph + AI integration.
- **Best Use of Gemini:** structured, constraint-aware emergency plan generation and explanation; **Gemini is central to planning**, not a generic chatbot. Verify that this sponsor track is officially listed and any special eligibility terms.
- **Best AI Hack:** meaningful LLM planning plus deterministic validation; avoid calling hand-coded simulation “trained ML.”
- **Best Design:** polished operations dashboard, visual hierarchy, purposeful animation, accessible interactions.
- **Best Social Impact:** education around emergency medical access and resource tradeoffs; clearly communicate non-operational scope.
- **Past-12-month technology/dataset challenge:** center the **June 18, 2026 NOAA coastal surge dataset update**, show precisely where its data enters calculations, and confirm challenge sponsor's interpretation before submitting.

### Presentation credibility

- Show a *before/after route* and numeric delta from actual backend output, not a scripted fake number.
- Explain one difficult technical problem (raster-to-road intersection + graph reachability) in plain English.
- Be candid about approximations, data uncertainty, and inability to predict real patient outcomes.
- Have one clean backup video and a tested offline path.

---

## 13. Security, safety, scientific integrity, and performance

### Safety and truthfulness

- Prominent notice: **“Educational scenario simulator — not for real emergency decisions.”**
- Label NOAA hazard surfaces separately from hypothetical event timing/damage.
- No actual medical patient records, casualty predictions, or unverified facility status.
- Model should not recommend real-world emergency routing during an active event.
- Explicitly identify hypothetical resource quantities, response times, and scoring weights.

### Security

- All LLM calls server-side; secrets from environment variables only.
- Validate Pydantic request payloads and allowlisted action types/IDs.
- Rate limit Gemini endpoint where possible; avoid arbitrary command execution.
- CORS configured for frontend origins, not wildcards in production if credentials used.
- Public repo contains only approved, redistributable datasets and no keys.

### Performance targets (aspirational, validate on demo hardware)

- First useful dashboard render within ~5 seconds on stable network or local demo.
- Smooth pan/zoom and animation on a modern laptop; aim for 30+ FPS with reduced effects available.
- Scenario load and manual simulation ideally under ~2 seconds using precomputed graph/fixtures.
- Gemini planning may take longer; display honest progress and enforce timeout/fallback.
- Process NOAA rasters offline, not per browser frame or request.

### Observability

- Log scenario ID, schema version, simulation duration, validation errors, Gemini success/fallback, and data provenance version (without API keys or private user data).
- Provide `/health` and startup checks for processed assets.

---

## 14. Acceptance checklist

### Data integrity
- [ ] NOAA Version 4 June 18, 2026 dataset provenance recorded and source files/metadata verified.
- [ ] NOAA risk maps not described as event-specific forecasts.
- [ ] St. Augustine roads/buildings/facilities genuinely sourced or synthetic elements explicitly labeled.
- [ ] CRS, raster bins, OSM attribution, and population assumptions validated.

### Functionality
- [ ] Map supports pan, zoom, rotate, tilt, district and facility selection.
- [ ] Three presets selectable; at least one fully functional deterministic storm animation.
- [ ] Damage state persists and reset works.
- [ ] Five resource types enforce constraints.
- [ ] Debris vs flood road closure behavior correct.
- [ ] 24h response updates graph accessibility and modeled demand.
- [ ] Manual and Gemini plans use same baseline, budget, scoring.
- [ ] Gemini response is schema-validated; graceful fallback works.
- [ ] Meaningful A/B metrics and explanations shown.

### Engineering
- [ ] Frontend builds; backend starts; tests pass.
- [ ] Stable shared IDs and typed API contracts.
- [ ] No secrets committed; license/attribution included.
- [ ] Runs from documented local setup and ideally a public URL.
- [ ] No pre-hackathon project code.

### Submission
- [ ] Public repository URL.
- [ ] Accurate Devpost description, roster, and track selections.
- [ ] Demo video ≤3 minutes or slides, submitted before deadline.
- [ ] At least one team member available Monday Oct 26 finals.

---

## 15. Locked product decisions and remaining technical verification

**Decisions locked in v1.1 (do not reopen without explicit owner approval):**

- **Visual style:** Balanced — professional GIS command center with cinematic but restrained storm effects.
- **Response control:** District click-to-assign through the sidebar; no drag-and-drop requirement.
- **Gemini interaction:** Structured emergency response planner plus concise plan rationale; no general chat or interactive Ask Gemini workflow.
- **Development priority:** Balanced execution — functioning simulation, polished UI, and meaningful Gemini planning all receive attention.

The following are **not** excuses to block building; defaults are proposed so agents can proceed once the event starts. Ask the human owner before irreversible or expensive choices.

1. **Study-area boundary:** Approx. 4 × 4 km visible downtown-centered camera, five neighborhood zones + one Bridge Corridor infrastructure zone are LOCKED. Exact zone polygons and regional graph boundary remain to be validated against roads and performance.
2. **Map hosting:** Select a MapLibre-compatible tile source with safe free-tier/attribution and reliable demo performance; confirm terms and token requirements.
3. **Official critical facilities:** Validate hospital/clinic/shelter coordinates and current status; use labeled hypothetical response staging points if necessary.
4. **Response inventory and duration parameters:** Proposed values in §3 are assumptions; pre-med collaborators review for plausible classroom-style illustration.
5. **Scoring function:** Validate weights/normalization and avoid gaming or nonsensical tradeoffs.
6. **Gemini model and quota:** Choose a currently available Gemini model with reliable structured outputs and acceptable latency; do not hardcode a model without checking.
7. **Sponsor eligibility:** Confirm “Best Use of Gemini” track and past-12-month NOAA update challenge rules on official Devpost/Discord; do not overclaim eligibility.
8. **Deployment:** Confirm Python backend hosting limits, secrets configuration, and fallback demo.
9. **GitHub:** Repo may be private during work but must be public for submission. Invite teammates when ready.
10. **Team workflow:** Decide how much work pre-med teammates want to own beyond domain review and pitch.

---

## 16. Source links and provenance references

- Gator Hack V Devpost: https://gatorhack2026.devpost.com/
- Official hackathon rules: https://gatorhack2026.devpost.com/rules
- Official schedule: https://ufgatorhack.com/schedule.html
- NOAA NHC National Storm Surge Risk Maps Version 4: https://www.nhc.noaa.gov/nationalsurge/
- NOAA official data download section: see “Texas to Maine (high tide scenario) (Updated Version 4 – 6/18/2026)” on the page above.
- OpenStreetMap: https://www.openstreetmap.org/
- OSMnx documentation: https://osmnx.readthedocs.io/
- USGS National Map / 3DEP: https://www.usgs.gov/programs/national-geospatial-program/national-map
- U.S. Census data: https://data.census.gov/
- MapLibre GL JS: https://maplibre.org/maplibre-gl-js/docs/
- Gemini API: https://ai.google.dev/gemini-api/docs
- St. Johns County official GIS/EM services: discover and verify exact service URLs during data feasibility phase.

**Document principle:** Every important claim in the demo must be traceable to a real source, a reproducible calculation, or a clearly labeled hypothetical assumption. STORMFORGE wins by making infrastructure dependencies understandable—not by pretending to predict a real disaster.
