# STORMFORGE — 3-minute demo script (matches the in-app ▶ Guided demo)
Everything on screen is labelled: NOAA hazard = source data; closures = illustrative rule; sites = hypothetical; hospital = provisional.

| Time | Do | Say |
|---|---|---|
| 0:00–0:20 | Welcome card → **Start guided demo** (Step 1, Cat 3) | "A hurricane doesn't only damage buildings — flooded roads cut neighborhoods off from care. This is NOAA's June 2026 surge planning envelope applied to 4,691 real road segments. Under an illustrative rule, 63% of road length is closed." |
| 0:20–0:40 | Press 1…5 to flip categories; click a downtown road | "Each category is real NOAA data. The inspector shows depth bins; 'no NOAA value' means unknown, not dry." |
| 0:40–1:05 | **Step 2** Zones | "Six provisional demo zones — not official districts, no population invented. Closures and modeled care access per zone." |
| 1:05–1:30 | **Step 3** Modules → Medical | "Four deterministic modules: Transportation, Medical, Logistics, Community. Not chatbots. Medical access is provisional — one OSM hospital, entrance unverified; zero modeled access is not zero real care." |
| 1:30–2:10 | **Step 4** Gemma plan (≈7–10 s) | "Gemma is the Incident Commander. It reads the module evidence and ranks hypothetical staging sites. The backend rejects invented IDs or numbers, redundant sites, and zone claims that contradict its own results." |
| 2:10–2:45 | **Step 5** Apply & verify | "Green dots are nodes that gain a route: care access 1 → 505 of 1,820 nodes, 0 → 29 sample origins. Hospital access is unchanged — staging is basic care. NetworkX computed that, not Gemma. Remove/Apply to see before/after." |
| 2:45–3:00 | Methodology button | "Educational simulator: planning envelopes, not forecasts. Every number is traceable, every assumption labelled." |
