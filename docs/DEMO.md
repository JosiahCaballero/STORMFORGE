# STORMFORGE — 3-minute demo script (matches the in-app ▶ Guided demo)

Story in one line: **a hurricane blocked the roads, you have 11 limited rescue units, decide where they go, then see whether AI would do better.**
Everything on screen is labelled: storm = NOAA surge planning envelope, debris / inventory / response base = hypothetical, numbers = computed by the road-network model (not by the AI).

Setup: backend on :8000, `npm run dev` on :5173. Open the app in a fresh browser profile so the welcome card shows. Numbers below are Category 3 and are read live from the API in the app; they are stable (seeded debris).

| Time | Do (guided demo step) | Say |
|---|---|---|
| 0:00–0:20 | Welcome card, read it aloud, click **Start guided demo** (Step 1, *Impact* tab, Cat 3) | "A hurricane has hit. Roads are blocked. You have limited rescue resources. Decide where to send them. In a Category 3 storm, modeled flooding blocks about 1,600 road segments and simulated debris blocks 10 more; only 1 of 1,820 road-network locations can still reach a hospital." |
| 0:20–0:50 | Point at the neighborhood list and the red/amber map regions. Press 1…5 once to show other storm strengths, then back to 3 | "These are the neighborhoods that need attention, most cut off first. 'Location' means a point on the road network, not a person." |
| 0:50–1:15 | **Step 2**: *Next* selects **West Augustine** (Deploy tab) | "West Augustine is only 31% cut off, but three roads are blocked by debris. That is something a crew can fix. The outline is the selected neighborhood; the others are dimmed." |
| 1:15–1:50 | **Step 3**: *Next* sends a debris-clearing crew. A toast and the coach read the model's sentence ("This crew cleared 2 blocked road segments in West Augustine, allowing access to 18 additional road-network locations") | "One click. The green roads on the map were just reopened and cut-off locations drop from 137 to 124 — computed, not scripted." |
| 1:50–2:15 | **Step 4**: *Next* sends an EMS team (and a water-rescue team to Lincolnville). Open **Map layers** to show the layers are separate | "EMS coverage is a different layer: 186 locations within 1.5 km of road travel. We never add coverage types together." |
| 2:15–2:50 | **Step 5**: *Next* asks Gemma (progress bar, about 15–30 s). Read the green label. Show the two columns, **Apply Gemma Plan**, then **Restore My Plan** | "Gemma gets the same 11 units and proposes a full allocation. The label says whether this is a real Gemma response or the deterministic fallback. It is never disguised. Every number in the comparison is verified by the road-network model, and my plan is kept safe so I can restore it." |
| 2:50–3:00 | **How it works** button | "Educational simulator: planning envelopes, hypothetical resources, provisional base. Not for real emergency decisions." |

If the Gemma call is slow, stay on the coach's "Asking Gemma…" state and talk through the *Why Gemma chose these assignments* section once it appears. If the key is unavailable the card says "Deterministic demo fallback — NOT a Gemma response"; say so out loud.

Free exploration after the demo: pick any region, use the six action buttons (disabled ones show the reason, e.g. "No debris-blocked roads to clear in Historic Downtown."), move or remove units in *Assigned units*, toggle layers, change the hurricane category (this resets the allocation).
