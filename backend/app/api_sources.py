"""Data & Sources: one backend-owned description of what is REAL, CALCULATED and SIMULATED (shown by the UI)."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()

NOAA = {
    "name": "NOAA NHC National Storm Surge Risk Maps, Version 4 (SLOSH MOM, high tide)",
    "headline": "NOAA SLOSH MOM v4 — updated 6/18/2026",
    "short": "2026 revised dataset",
    "revision_date": "2026-06-18",
    "revision_basis": "The NHC page lists the Texas-to-Maine download as “Updated Version 4 - 6/18/2026” (verified at nhc.noaa.gov/nationalsurge, 2026-10-25). "
                      "The page also says the Gulf and East Coast data were reprocessed in 2025; the GeoTIFF files carry no embedded date.",
    "local_processing": "St. Augustine crops (categories 1-5, HIGH tide) were saved locally on 2026-10-23. That is a processing date, not the publication date.",
    "url": "https://www.nhc.noaa.gov/nationalsurge/",
    "interpretation": "Multi-storm potential planning envelopes, not a forecast, not event-specific depths and not observed road closures. NoData (255) means unknown, not dry.",
}

SOURCES = {
    "noaa": NOAA,
    "classes": [
        {"id": "real", "label": "REAL DATA", "color": "#4ade80",
         "text": "Published or mapped by others: NOAA storm-surge modeling, OpenStreetMap road geography, and operator-listed emergency-department locations.",
         "items": ["NOAA SLOSH MOM v4 surge exposure", "OpenStreetMap roads", "Emergency departments named by their operators (positions approximate; entrances unverified)"]},
        {"id": "calculated", "label": "CALCULATED", "color": "#22d3ee",
         "text": "Computed by STORMFORGE with NetworkX from the real data plus the stated closure rule. Illustrative, not observed.",
         "items": ["Road exposure and modeled flooded roads", "Road-network connectivity and cut-off locations", "Emergency-department and hospital accessibility", "Response coverage after each deployment"]},
        {"id": "simulated", "label": "SIMULATED", "color": "#fbbf24",
         "text": "Hypothetical inputs made up for this demo. NOAA does not measure any of these.",
         "items": ["Debris obstructions (seeded, category-dependent scenario counts)", "The 11-unit resource inventory", "The response base and medical-site candidates", "Rescue radii, service radius and helicopter cluster assumptions"]},
    ],
    "plain_english": [
        "NOAA supplies modeled storm-surge exposure.",
        "OpenStreetMap supplies road geography.",
        "STORMFORGE calculates road accessibility and resource coverage.",
        "Simulated debris and response inventories are hypothetical.",
        "Gemma recommends allocations, but the backend verifies every number.",
    ],
    "separate_calculations": "Regional emergency-department accessibility (6 km road network, verified 24-hour EDs) and local resource allocation (4 km network, hypothetical units) are separate calculations. "
                             "They can disagree: for example a neighborhood can gain EMS coverage and still be cut off from every emergency department.",
}


@router.get("/api/v1/sources")
def sources():
    return SOURCES
