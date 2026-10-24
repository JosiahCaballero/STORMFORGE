# STORMFORGE — Resource-allocation API (v2). Backend is live; shapes below are verified against the running code.

All numbers are computed by the backend (NetworkX). The UI must never invent numbers. "Location" = a road-network graph node
(NOT a person/household). Never sum coverage categories. Everything is hypothetical/simulated and labelled so.

## Resources (fixed hypothetical inventory, 11 units)
| id | label | action button | total |
|---|---|---|---|
| `debris_crew` | Debris-clearing crew | Clear Debris | 2 |
| `ems_team` | Road-based EMS team | Send EMS | 3 |
| `supply_team` | Supply distribution team | Deliver Supplies | 2 |
| `medical_support` | Temporary medical support site | Set Up Medical Site | 1 |
| `water_rescue` | Water-rescue team | Deploy Rescue Team | 2 |
| `helicopter` | Helicopter rescue unit | Send Helicopter | 1 |

Zones (`zone_id`): `historic_downtown, lincolnville, davis_shores, uptown_san_marco, west_augustine, bridge_corridor` (provisional demo zones).
Category `category` 0..5 (0 = no storm, no debris). Changing category must reset the allocation and any plan (client side).

## GET `/api/v1/allocation/setup?category=3`
`{category, inventory:[{id,label,action,total,used:0,remaining}], total_units:11, base:{node_id,lon,lat,label,zone_id,provenance:"hypothetical",disclosure},
 zones:[{zone_id,name,kind,flooded_road_segments,debris_blocked,locations,cut_off_locations,hospital_locations,flood_exposed_locations,cut_off_pct}],
 attention_order:[zone_id…]  /* most cut-off first */,
 debris:[Obstruction…], debris_meta:{seed,…,rule}, medical_candidates:[{id,name,zone_id,lon,lat,node_id}],
 assumptions:[str…], settings:{service_radius_m:1500, water_rescue_radius_m:500, helicopter_max_locations:10, crew_capacity:2},
 global_before:{locations_total,hospital_locations,response_reach_locations,ems_locations,…}, provenance}`
`Obstruction = {id:"D3-01", zone_id|null, name, highway, length_m, edge_ids:[int], flood_closed_edge_ids:[int], reason:"debris"|"debris + flooding", cut_off_locations_if_blocked, cleared:bool}`
`edge_ids` equal the `id` property of features in `frontend/public/data/roads.geojson` (source uses `promoteId:'id'`), so debris/cleared roads are drawn by
filtering that source on `['in', ['get','id'], ['literal', ids]]` — no new geometry needed. A physical road = both directions (several ids).
`cut_off_locations` = zone locations that cannot be reached by road from the response base (flooding + debris). First call per category can take ~5 s (debris generation; warmed in background at startup).

## POST `/api/v1/allocation/evaluate`  `{category, assignments:[{resource, zone_id, candidate_id?}]}`  (max 40; 422 on unknown resource/zone/category)
The result does NOT depend on the order of assignments. Call with `[]` for the "before" picture. Response (`AllocationResult`):
```
{category, inventory:[{id,label,action,total,used,remaining}], units_used, units_total:11,
 assignments:[{index, resource, zone_id, zone_name, status:"placed"|"rejected", reason|null, message, new_locations, consumed, details?}],   // canonical order; `index` = position in the request
 rejected:[…subset…],
 roads:{flooded_segments, debris_total, debris_cleared, debris_remaining, cleared_obstruction_ids:[…], cleared_edge_ids:[int], debris:[Obstruction with cleared flag], passable_directed_edges, flood_only_directed_edges},
 metrics:{before:M, after:M, delta:M},   M={locations_total, hospital_locations, response_reach_locations, ems_locations, supply_locations, medical_support_locations, water_rescue_locations, helicopter_locations}
 zones:[{zone_id,name,flooded_road_segments, before:Z, after:Z, delta:Z, resources:[{resource,message}], remaining:[{kind:"debris"|"cut_off"|"hospital"|"water",count,text}]}],
      Z={zone_nodes,hospital_locations,response_reach_locations,cut_off_locations,ems_locations,supply_locations,medical_support_locations,water_rescue_locations,helicopter_locations,flood_exposed_locations,debris_blocked,debris_cleared}
 layers:{ems:[{zone_id,node_id,point:[lon,lat],street,coverage:[[lon,lat]…]}], supply:[same], medical:[{…,candidate_id,name,coverage}],
         water:[{zone_id,node_id,point,street,radius_m:500,targets:[[lon,lat]…]}], helicopter:[{zone_id,node_id,point,street,cluster:[[lon,lat]…≤10]}]},
 base:{…}, assumptions:[…], provenance:"simulated", notes}
```
"before" = flood closures + all simulated debris, no deployments. `message` is the one-sentence, user-ready explanation for each deployment, e.g.
"This crew cleared 2 blocked road segments in West Augustine, allowing access to 18 additional road-network locations." — show it as the deployment notification.
Rejected assignments (`status:"rejected"`, `consumed:false`) give a plain-English `message`; they never consume inventory.
`reason` codes: inventory_exceeded, no_eligible_debris, debris_not_reachable, no_reachable_point, no_candidate_site, candidate_not_in_region, no_flood_exposed_locations, no_target_within_radius, no_isolated_locations.
Meanings: `response_reach_locations` = locations reachable by road from the provisional response base (the "road access" measure; rises when crews clear debris). `hospital_locations` = locations with a route to the (provisional) hospital — separate metric. `ems_locations` = within 1.5 km of road travel from the EMS points; `supply_locations` = within 1.5 km that can drive TO the supply point; `water_rescue_locations` = flood-exposed locations within 500 m of a road-reachable entry point (screening only); `helicopter_locations` = one hypothetical priority cluster (≤10); `medical_support_locations` = locations with a route to the temporary site.

## POST `/api/v1/allocation/compare` `{category, plans:[{label, assignments}]}` (1–4 plans)
`{category, plans:[{label, result:AllocationResult}], assignment_diff:[{resource,zone_id,<labelA>:n,<labelB>:n}] (2 plans), metric_diff:{…M keys, planB.after − planA.after}}`

## GET `/api/v1/allocation/actions?category=3`
36 entries `{id:"ems_team@west_augustine", resource, zone_id, zone_name, valid, reason, message, standalone_new_locations, details}` — the standalone result of one unit in one region.
Use it to hint/disable buttons ("No debris to clear here"). A crew that is "rejected: debris_not_reachable" alone may become valid after another crew clears upstream debris.

## Gemma allocation planner — POST `/api/v1/allocation/plan`  `{category, current_assignments?:[{resource,zone_id}]}`  *(lands during this work; GET `/api/v1/plan/status` already works)*
```
{category, source:"gemma"|"deterministic_fallback", source_label:"Real Gemma response (model …)"|"Deterministic demo fallback — NOT a Gemma response", model|null,
 fallback_reason|null, latency_ms,
 plan:{summary, assignments:[{action_id:"ems_team@west_augustine", resource, zone_id, rationale}], tradeoffs:[str], limitations_ack},
 validation:{ok, rejected:[{reason,detail}], repairs:[str]},
 verified:{result:AllocationResult /* for the plan's assignments */, assignments:[{resource,zone_id}],
           current_result:AllocationResult|null, assignment_diff:[…], metric_diff:{…}}}
```
Must never silently overwrite the user's plan: keep "My Response" and "Gemma's Recommendation" as two separate allocations; "Apply Gemma Plan" copies the Gemma assignments into the working allocation (remember the user's previous allocation so "Restore My Plan" works); "Reset Allocation" clears.

## Deterministic facts for the demo (Category 3; verified)
West Augustine: 3 debris obstructions, ~30% of locations cut off. One crew there clears 2 segments → +18 reachable locations; EMS there covers 186 locations; supply 188; water rescue 37 flood-exposed locations;
Uptown/San Marco is ~99% cut off with 3 debris obstructions but a crew alone there is rejected (`debris_not_reachable`) until a West Augustine crew clears upstream debris (both crews → +68 total).
Historic Downtown and Davis Shores are 100% cut off from the base: EMS/supply/water are rejected (no reachable point) but the helicopter can target a 10-location cluster there.
