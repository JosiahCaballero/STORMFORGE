"""Deterministic 'agent' findings (P5). No LLM here: text is assembled from computed values only.

Each finding has a stable id (agent.topic) so an LLM planner can cite it. Transit is a stub: no data, not modeled.
"""
from __future__ import annotations

from .interventions import default_sim

TRANSIT = {"status": "planned", "note": "No verified transit data; not modeled."}


def _f(fid, text, value=None, unit=None, provenance="simulated"):
    d = {"id": fid, "text": text, "provenance": provenance}
    if value is not None:
        d["value"] = value
    if unit is not None:
        d["unit"] = unit
    return d


def _pct(a, b):
    return round(100 * a / b, 1) if b else 0.0


def build_report(category: int, candidate_ids: list[str]) -> dict:
    sim = default_sim()
    ev = sim.evaluate(category, list(candidate_ids))
    ids = ev["candidate_ids"]
    b, i, d = ev["baseline"], ev["intervention"], ev["delta"]
    eng = sim.eng
    ed = eng.edges
    cat = category
    label = "baseline (no surge)" if cat == 0 else f"Category {cat} surge envelope"

    # ---- Transportation ----
    n_edges = len(ed)
    if cat:
        closed = ed[ed[f"cat{cat}_closed"] == 1]
        n_closed, len_pct = len(closed), _pct(closed.length_m.sum(), ed.length_m.sum())
        exp = closed[closed.name.notna()].groupby("name").agg(n=("edge_id", "size"), m=("length_m", "sum")).reset_index()
        exp = exp.sort_values(["m", "name"], ascending=[False, True]).head(3)
        top = [{"name": r.name, "closed_segments": int(r.n), "closed_length_m": round(float(r.m))} for r in exp.itertuples()]
    else:
        n_closed, len_pct, top = 0, 0.0, []
    trans_f = [
        _f("transportation.closed_edges",
           f"{n_closed} of {n_edges} directed road segments are modeled closed ({len_pct}% of length) under {label}.",
           n_closed, "directed_edges"),
        _f("transportation.nodes_unreachable_to_hospital",
           f"{b['nodes_total'] - b['nodes_with_hospital_route']} of {b['nodes_total']} graph nodes have no modeled open route to the provisional hospital destination.",
           b["nodes_total"] - b["nodes_with_hospital_route"], "nodes"),
    ]
    if top:
        trans_f.append(_f("transportation.top_closed_roads",
                          "Longest closed named roads: " + "; ".join(
                              f"{t['name']} ({t['closed_segments']} segments, {t['closed_length_m']} m)" for t in top) + ".",
                          provenance="derived"))
    trans = {
        "agent": "transportation", "title": "Transportation", "headline":
            f"{label}: {n_closed} directed segments modeled closed ({len_pct}% of road length).",
        "findings": trans_f,
        "limitations": ["Closure rule is illustrative: any ~20 m sample in NOAA bin >= 3 closes a segment.",
                        "OSM bridge=yes segments are exempt from surge closure (deck heights unknown); this is not a structural assessment.",
                        "NOAA NoData is unknown, not confirmed dry. No debris, wind, congestion or travel-time modeling."],
        "evidence": {"category": cat, "directed_edges_total": n_edges, "directed_edges_closed": n_closed,
                     "closed_length_pct": len_pct, "top_closed_roads": top, "provenance": "simulated"},
    }

    # ---- Medical access ----
    med_f = [
        _f("medical.hospital_origins",
           f"{b['origins_with_hospital_route']} of {b['origins_total']} sampled origins have a modeled open route to the provisional hospital destination under {label}.",
           b["origins_with_hospital_route"], "origins"),
        _f("medical.hospital_nodes",
           f"{b['nodes_with_hospital_route']} of {b['nodes_total']} graph nodes ({_pct(b['nodes_with_hospital_route'], b['nodes_total'])}%) can reach the hospital destination.",
           b["nodes_with_hospital_route"], "nodes"),
    ]
    if ids:
        med_f += [
            _f("medical.staging_origins",
               f"With {len(ids)} hypothetical staging site(s) applied, {i['origins_with_staging_route']} sampled origins can reach basic staging (separate from hospital access).",
               i["origins_with_staging_route"], "origins"),
            _f("medical.any_care_gain",
               f"Any-care access (hospital or staging) changes by {d['origins_with_any_care_route']:+d} origins and {d['nodes_with_any_care_route']:+d} nodes; hospital access itself changes by {d['origins_with_hospital_route']:+d} origins.",
               d["origins_with_any_care_route"], "origins"),
        ]
    else:
        med_f.append(_f("medical.no_staging_applied", "No hypothetical staging applied; staging access is 0 by construction.", 0, "origins"))
    med = {
        "agent": "medical_access", "title": "Medical Access",
        "headline": f"{b['origins_with_hospital_route']}/{b['origins_total']} sampled origins have modeled hospital access under {label}"
                    + (f"; staging adds {d['origins_with_any_care_route']:+d} origins with any-care access." if ids else "."),
        "findings": med_f,
        "limitations": [
            "Hospital destination is PROVISIONAL and UNVERIFIED: an OSM-tagged emergency department snapped to the nearest graph node (~356 m away); entrance not verified.",
            "Zero modeled access does not mean zero real-world access: the model ignores boats, high-water vehicles, helicopters, and roads outside the 4 km graph.",
            "Staging sites are hypothetical basic-medical staging, never hospitals, with no capacity modeled.",
            "Counts are graph nodes / 102 deterministic origins, not population or patients."],
        "evidence": {"category": cat, "baseline": b, "intervention": i, "delta": d, "applied_candidate_ids": ids,
                     "hospital_destination_status": "provisional_unverified", "provenance": "simulated"},
    }

    # ---- Logistics ----
    cands = {c["id"]: c for c in sim.candidates}
    pc = ev["per_candidate"]
    log_f = [_f("logistics.candidates_applied", f"{len(ids)} of {len(cands)} hypothetical staging candidates applied.", len(ids), "candidates", "hypothetical")]
    best = None
    if pc:
        best = max(pc, key=lambda p: (p["marginal"]["nodes_with_any_care_route"], p["id"]))
        log_f.append(_f("logistics.largest_single_gain",
                        f"Largest single-candidate gain is {best['id']}: {best['marginal']['nodes_with_any_care_route']:+d} nodes and {best['marginal']['origins_with_any_care_route']:+d} sampled origins with any-care access.",
                        best["marginal"]["nodes_with_any_care_route"], "nodes"))
        cut = [p["id"] for p in pc if p["marginal"]["nodes_with_any_care_route"] <= 3]
        if cut and cat:
            log_f.append(_f("logistics.cut_off_candidates",
                            f"{len(cut)} applied candidate(s) are largely cut off by closures (gain of 3 nodes or fewer): {', '.join(sorted(cut))}.",
                            len(cut), "candidates"))
    else:
        feas = [(c["id"], c["feasibility_by_category"][str(cat)]["nodes_that_can_reach"]) for c in sim.candidates] if cat else []
        if feas:
            top_c = max(feas, key=lambda t: (t[1], t[0]))
            log_f.append(_f("logistics.most_reachable_candidate",
                            f"Most reachable candidate under {label} is {top_c[0]}: {top_c[1]} nodes could reach it.", top_c[1], "nodes"))
    log = {
        "agent": "logistics", "title": "Logistics",
        "headline": (f"{len(ids)} hypothetical staging site(s) applied; any-care nodes {d['nodes_with_any_care_route']:+d}." if ids
                     else "No staging applied; candidate reachability shown for planning."),
        "findings": log_f,
        "limitations": ["No crew, vehicle, supply or capacity quantities are modeled or assumed.",
                        "Candidates are hypothetical graph nodes chosen by a fixed rule, not vetted sites.",
                        "Reachability is graph connectivity by road length, not travel time."],
        "evidence": {"category": cat, "per_candidate": pc, "applied_candidate_ids": ids,
                     "feasibility": {c: cands[c]["feasibility_by_category"].get(str(cat)) for c in ids},
                     "provenance": "simulated"},
    }

    # ---- Community impact (no population) ----
    pz = ev["per_zone"]
    zone_rows = []
    for z in pz:
        zone_rows.append({**z, "baseline_pct": _pct(z["baseline_any_care_nodes"], z["zone_nodes"]),
                          "intervention_pct": _pct(z["intervention_any_care_nodes"], z["zone_nodes"])})
    worst = min(zone_rows, key=lambda z: (z["intervention_pct"], z["zone_id"]))
    gain = [z for z in zone_rows if z["intervention_any_care_nodes"] > z["baseline_any_care_nodes"]]
    com_f = [_f("community.lowest_access_zone",
                f"Lowest share of nodes with any-care access: {worst['zone_id']} at {worst['intervention_pct']}% ({worst['intervention_any_care_nodes']}/{worst['zone_nodes']} nodes).",
                worst["intervention_pct"], "percent_of_zone_nodes")]
    com_f.append(_f("community.zones_improved",
                    f"{len(gain)} of {len(zone_rows)} provisional zones gain any-care access from the applied staging."
                    + (f" Improved: {', '.join(z['zone_id'] for z in gain)}." if gain else ""), len(gain), "zones"))
    com = {
        "agent": "community_impact", "title": "Community Impact",
        "headline": f"{worst['zone_id']} has the lowest modeled any-care node coverage ({worst['intervention_pct']}%) under {label}.",
        "findings": com_f,
        "limitations": ["Zones are provisional demo areas (nearest-centre node assignment), not official boundaries.",
                        "No population, demographics, vulnerability or medical demand is modeled; coverage is a share of graph nodes.",
                        "Not for real emergency decisions."],
        "evidence": {"category": cat, "per_zone": zone_rows, "applied_candidate_ids": ids, "provenance": "simulated"},
    }
    return {"category": cat, "applied_candidate_ids": ids, "transportation": trans, "medical": med,
            "logistics": log, "community": com, "transit": dict(TRANSIT)}
