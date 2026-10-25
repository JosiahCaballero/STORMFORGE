# STORMFORGE — 3-minute demo script (matches the in-app ▶ Guided demo)

Story in one line: **revised NOAA storm-surge data blocked the roads, you have 11 limited rescue units, decide where they go, then see whether AI would do better.**
Everything on screen carries one of three labels: **REAL DATA** (NOAA surge modeling, OpenStreetMap roads, operator-listed emergency departments), **CALCULATED** (flooded roads, connectivity, emergency-department access, coverage after each deployment), **SIMULATED** (debris, the 11-unit inventory, response base, rescue assumptions).

Setup: backend on :8000, `npm run dev` on :5173. Open the app in a fresh browser profile so the welcome card shows. **Read every number from the screen; they come live from the API and change if the data or rules change.** Do not memorise them. The "[…]" markers below are the figures to read aloud.

| Time | Do (guided demo step) | Say |
|---|---|---|
| 0:00–0:25 | Welcome card (green **Powered by NOAA Storm-Surge Data** strip shows *NOAA SLOSH MOM v4 — updated 6/18/2026*). Click **Start guided demo** (Step 1, *Impact* tab, Cat 3) | "This runs on NOAA's revised storm-surge maps, version 4, updated June 18, 2026 (real data). STORMFORGE turns them into blocked roads and cut-off locations (calculated). The debris and the 11 rescue units are simulated. A Category 3 surge blocks […] road segments; […] of […] road-network locations can still reach a verified 24-hour emergency department." |
| 0:25–0:55 | Point at the **Emergency care access** card and the **Map key**. Press 1…5 once, then back to 3 | "Emergency-department access, hospital access, and EMS coverage from my deployments are three different things. ED access is a separate regional calculation and my deployments do not change it. If the allocation model disagrees, it says so. 'Location' means a point on the road network, not a person." |
| 0:55–1:20 | **Step 2**: *Next* selects **West Augustine** (Deploy tab) | "Select a neighborhood on the map or from the list. Here […]% of locations are cut off and […] roads are blocked by simulated debris. A crew can fix that." |
| 1:20–1:50 | **Step 3**: *Next* sends a debris-clearing crew; read the coach sentence and the **What improved?** box | "One click. The green roads were just reopened: cut-off locations go from […] to […]. The panel names the roads the crew cleared; clearing debris never reopens flood-closed roads." |
| 1:50–2:15 | **Step 4**: *Next* sends an EMS team (and a water-rescue team). Use + / − to add a second unit to the same zone and read the "next unit adds…" hint | "EMS coverage is a different layer: […] locations within 1.5 km of road travel. We never add coverage types together. Extra units help less and less; the model says when a unit adds little." |
| 2:15–2:50 | **Step 5**: *Next* asks Gemma (15–30 s). Read the green label. Show both columns, **Apply Gemma Plan to the Map**, then **Restore My Plan** | "Gemma gets the same 11 units and proposes an allocation. The label says whether it is a real Gemma response or the deterministic fallback; it is never disguised. Every number is verified by the road-network model, not by Gemma, and my plan is kept so I can restore it." |
| 2:50–3:00 | **Data & Sources** button | "NOAA planning envelopes, OpenStreetMap roads, hypothetical resources. Educational planning simulator, not an operational dispatch system, not for real emergency decisions." |

If the Gemma call is slow, stay on the coach's "Asking Gemma…" state and talk through *Why Gemma chose these assignments* when it appears. If the key is unavailable the card says "Deterministic demo fallback — NOT a Gemma response"; say so out loud.

Free exploration after the demo: pick any zone, use + / − on the six unit types (the row explains why a unit cannot be added), expand **All assigned units** to move or remove units, open the **Map key → All layers** to toggle overlays, change the hurricane category (this resets the allocation; debris counts grow with category: scenario targets are 12 / 25 / 45 / 65 / 85, illustrative not empirical).

Facts to avoid claiming: casualties, people served, response times, real closures, rescue feasibility, or that NOAA measured debris.
