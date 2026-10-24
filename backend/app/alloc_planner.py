"""Gemma allocation planner: Gemma proposes a region-level allocation; the backend validates and scores it.

Gemma returns ONLY action ids ("ems_team@west_augustine") plus explanatory text. The backend:
  * rejects unknown ids, inventory overruns, infeasible deployments and redundant units (leave-one-out gain < MIN_GAIN),
  * rejects numbers / zone-improvement claims that its own results do not support,
  * recomputes the whole allocation (verified.result) - the model never supplies a metric,
  * falls back to a deterministic bounded-greedy plan, clearly labelled as NOT a Gemma response.
No exhaustive search: the greedy generator evaluates at most (units x zones) = 66 allocations.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from collections import defaultdict
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .allocation import ORDER, TOTALS, AllocationError, AllocationModel, default_model
from .gemma import GemmaClient, GemmaError, extract_json
from .planner import _COORD, _NEG, _NO_ZONES, _POS, _ALL_ZONES, _ZONE_COUNT, FALLBACK_LABEL, _numbers

# Zone-claim checks work per CLAUSE: a negation only counts for a zone named in the SAME clause, and a clause about
# "other / remaining" zones is not a claim about the named ones (found with a real Gemma response: "leaves other zones without ...").
_CLAUSES = re.compile(r"[.;\n,:]|\b(?:while|whereas|but|although|though|however|yet)\b")
_OTHERS = re.compile(r"\b(?:other|others|remaining|rest of|elsewhere|except|beyond)\b")
MIN_GAIN = 5  # each unit must add at least this many NEW locations in its own coverage metric (leave-one-out)
MAX_TEXT = 500
RES_METRIC = {"debris_crew": "response_reach_locations", "ems_team": "ems_locations", "supply_team": "supply_locations",
              "medical_support": "medical_support_locations", "water_rescue": "water_rescue_locations", "helicopter": "helicopter_locations"}
RES_WORDS = {"debris_crew": "roads reopened to the response base", "ems_team": "EMS coverage", "supply_team": "supply access",
             "medical_support": "temporary medical support access", "water_rescue": "potential water-rescue coverage", "helicopter": "potential helicopter priority cluster"}
_cache: dict[str, dict] = {}
_lock = threading.Lock()


# ---------------------------------------------------------------- schema
class AssignmentOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action_id: str = Field(max_length=80)
    rationale: str = Field(max_length=MAX_TEXT)


class PlanOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(max_length=MAX_TEXT * 2)
    assignments: list[AssignmentOut] = Field(max_length=11)
    tradeoffs: list[str] = Field(max_length=6)
    limitations_ack: str = Field(max_length=MAX_TEXT)


def split_action(action_id: str) -> tuple[str, str] | None:
    r, _, z = action_id.partition("@")
    return (r, z) if r in TOTALS and z else None


def _asg(a: dict) -> dict:
    return {"resource": a["resource"], "zone_id": a["zone_id"]}


# ---------------------------------------------------------------- evaluation helpers
def leave_one_out(m: AllocationModel, cat: int, asg: list[dict]) -> list[dict]:
    """For each PLACED assignment: how many locations (in its own metric) disappear if it is removed. Order independent."""
    full = m.evaluate(cat, asg)
    out = []
    for e in full["assignments"]:
        if e["status"] != "placed":
            continue
        rest = [a for i, a in enumerate(asg) if i != e["index"]]
        key = RES_METRIC[e["resource"]]
        gain = full["metrics"]["after"][key] - m.evaluate(cat, rest)["metrics"]["after"][key]
        out.append({"index": e["index"], "resource": e["resource"], "zone_id": e["zone_id"], "gain": gain, "metric": key})
    return out


def zone_changes(res: dict) -> dict[str, dict]:
    """Per-zone improvement summary of an allocation result (any coverage/road-access metric rising)."""
    out = {}
    for z in res["zones"]:
        d = z["delta"]
        keys = [k for k in ("response_reach_locations", "ems_locations", "supply_locations", "medical_support_locations", "water_rescue_locations", "helicopter_locations") if d[k] > 0]
        out[z["zone_id"]] = {"name": z["name"], "improved": bool(keys), "improved_metrics": keys}
    return out


# ---------------------------------------------------------------- deterministic bounded greedy
def greedy_plan(m: AllocationModel, cat: int) -> tuple[list[dict], list[dict]]:
    """One unit at a time, resource types in fixed priority order (enabler first); each unit goes to the region with the largest
    NEW coverage in that resource's own metric (ties: more cut-off locations, then zone id). Stops a resource when the best gain < MIN_GAIN."""
    cut = {z["zone_id"]: z["cut_off_locations"] for z in m.setup(cat)["zones"]}
    chosen: list[dict] = []
    steps: list[dict] = []
    for r in ORDER:
        key = RES_METRIC[r]
        for _ in range(TOTALS[r]):
            cur = m.evaluate(cat, chosen)["metrics"]["after"][key]
            best = None
            for z in m.zone_ids:
                res = m.evaluate(cat, chosen + [{"resource": r, "zone_id": z}])
                e = next(x for x in res["assignments"] if x["index"] == len(chosen))
                if e["status"] != "placed":
                    continue
                gain = res["metrics"]["after"][key] - cur
                k = (gain, cut[z], tuple(-ord(c) for c in z))
                if best is None or k > best[0]:
                    best = (k, z, gain)
            if best is None or best[2] < MIN_GAIN:
                break
            chosen.append({"resource": r, "zone_id": best[1]})
            steps.append({"step": len(chosen), "action_id": f"{r}@{best[1]}", "resource": r, "zone_id": best[1], "new_locations": best[2], "metric": key})
    return chosen, steps


# ---------------------------------------------------------------- evidence / prompt
def build_evidence(m: AllocationModel, cat: int, current: list[dict] | None) -> dict:
    setup = m.setup(cat)
    acts = m.actions(cat)
    chosen, steps = greedy_plan(m, cat)
    gres = m.evaluate(cat, chosen)
    zones = [{"zone_id": z["zone_id"], "name": z["name"], "flooded_road_segments": z["flooded_road_segments"], "debris_blocked": z["debris_blocked"],
              "locations": z["locations"], "cut_off_locations": z["cut_off_locations"], "flood_exposed_locations": z["flood_exposed_locations"]} for z in setup["zones"]]
    ev: dict[str, Any] = {
        "category": cat,
        "inventory": {r: TOTALS[r] for r in ORDER},
        "zones_before": zones,
        "candidate_actions": [{"id": a["id"], "available_alone": a["valid"], **({"new_locations_alone": a["standalone_new_locations"]} if a["valid"] else {"why_not_alone": a["reason"]})} for a in acts],
        "metric_meaning": {r: RES_WORDS[r] for r in ORDER},
        "backend_greedy_sequence": steps,
        "backend_greedy_zone_effects": [{"zone_id": z["zone_id"], "name": z["name"], "cut_off_before": z["before"]["cut_off_locations"], "cut_off_after": z["after"]["cut_off_locations"],
                                         "ems_after": z["after"]["ems_locations"], "supply_after": z["after"]["supply_locations"], "improved": zone_changes(gres)[z["zone_id"]]["improved"]} for z in gres["zones"]],
        "min_new_locations_per_unit": MIN_GAIN,
    }
    if current:
        cres = m.evaluate(cat, current)
        ev["current_user_allocation"] = {"assignments": [{"action_id": f"{a['resource']}@{a['zone_id']}"} for a in current],
                                         "units_used": cres["units_used"], "rejected": [{"action_id": f"{e['resource']}@{e['zone_id']}", "reason": e["reason"]} for e in cres["rejected"]],
                                         "zones_improved": [z["name"] for z in cres["zones"] if zone_changes(cres)[z["zone_id"]]["improved"]]}
    return ev


def build_prompt(ev: dict, feedback: list[dict] | None = None, previous: str | None = None) -> str:
    p = (
        "You are the Incident Commander in a hurricane-response SIMULATION (hackathon demo, hypothetical resources, not for real decisions).\n"
        "Allocate the hypothetical inventory across neighborhoods using ONLY the evidence JSON below.\n"
        "Rules:\n"
        "- assignments: list of {action_id, rationale}. action_id must be copied exactly from evidence.candidate_actions (format resource@zone). "
        "Repeat an id to place two units of the same resource in the same region. Never exceed evidence.inventory per resource.\n"
        f"- Every unit you place must add at least {MIN_GAIN} NEW locations in its own metric (see evidence.backend_greedy_sequence, which the backend computed sequentially). "
        "Leaving a unit unassigned is fine. A debris crew listed as unavailable alone can become available after another crew clears upstream debris.\n"
        "- The user allocates at region level; the backend does the road-network math. You only choose ids and explain.\n"
        "- Do NOT output coordinates, new place names, or metrics you computed. Avoid digits in free text; any number you use must appear in the evidence.\n"
        "- Claims about which regions improve must match evidence.backend_greedy_zone_effects if you adopt the backend greedy sequence; otherwise make no per-region improvement claims.\n"
        "- Coverage categories (EMS, supply, water rescue, helicopter, medical support, hospital access) are different things; never add them together.\n"
        "- If evidence.current_user_allocation exists, propose your own best allocation (it may differ) and say briefly how it differs.\n"
        "- Output ONLY one JSON object, no markdown, with exactly these keys: "
        '{"summary": str, "assignments": [{"action_id": str, "rationale": str}], "tradeoffs": [str], "limitations_ack": str}\n\n'
        "EVIDENCE:\n" + json.dumps(ev, sort_keys=True)
    )
    if feedback:
        p += "\n\nYour previous answer was REJECTED by the validator. Fix every item and output the full corrected JSON only.\nVALIDATION_FEEDBACK:\n" + json.dumps(feedback)
        if previous:
            p += "\nPREVIOUS_ANSWER:\n" + previous[:3000]
    return p


# ---------------------------------------------------------------- validation
class Validator:
    def __init__(self, m: AllocationModel, cat: int, ev: dict):
        self.m, self.cat, self.ev = m, cat, ev
        self.ids = {a["id"] for a in ev["candidate_actions"]}
        nums: set[float] = set()
        self.corpus: list[str] = []

        def walk(o):
            if isinstance(o, bool) or o is None:
                return
            if isinstance(o, (int, float)):
                nums.add(float(o))
            elif isinstance(o, str):
                nums.update(_numbers(o))
            elif isinstance(o, dict):
                [walk(v) for v in o.values()]
            elif isinstance(o, list):
                [walk(v) for v in o]
        walk(ev)
        self.allowed = nums | {float(i) for i in range(0, 12)} | {float(cat)}
        self.mask = sorted({a for a in self.ids} | {z["zone_id"] for z in ev["zones_before"]}, key=len, reverse=True)

    def validate(self, data: Any) -> tuple[PlanOut | None, list[dict], list[dict]]:
        rej: list[dict] = []
        if isinstance(data, dict):
            for k in data:
                if str(k).lower() in {"lat", "lon", "latitude", "longitude", "coordinates", "metrics", "delta", "result"}:
                    rej.append({"reason": "forbidden_field", "detail": str(k)})
        try:
            plan = PlanOut.model_validate(data)
        except ValidationError as e:
            return None, [*rej, *({"reason": "schema_error", "detail": f"{'.'.join(map(str, x['loc']))}: {x['type']}"} for x in e.errors()[:8])], []
        asg = []
        counts: dict[str, int] = defaultdict(int)
        for i, a in enumerate(plan.assignments):
            sp = split_action(a.action_id)
            if a.action_id not in self.ids or sp is None:
                rej.append({"reason": "unknown_action_id", "detail": a.action_id})
                continue
            counts[sp[0]] += 1
            asg.append({"resource": sp[0], "zone_id": sp[1]})
        for r, n in counts.items():
            if n > TOTALS[r]:
                rej.append({"reason": "inventory_exceeded", "detail": f"{r}: {n} > {TOTALS[r]}"})
        if not plan.assignments:
            rej.append({"reason": "empty_plan", "detail": "no assignments"})
        for where, text in [("summary", plan.summary), ("limitations_ack", plan.limitations_ack),
                            *[(f"assignments[{i}].rationale", a.rationale) for i, a in enumerate(plan.assignments)],
                            *[(f"tradeoffs[{i}]", t) for i, t in enumerate(plan.tradeoffs)]]:
            if _COORD.search(text):
                rej.append({"reason": "coordinates_not_allowed", "detail": where})
            masked = text
            for mk in self.mask:
                masked = re.sub(re.escape(mk), " ", masked, flags=re.I)
            for n in sorted(_numbers(masked)):
                if n not in self.allowed:
                    rej.append({"reason": "number_not_in_evidence", "detail": f"{where}: {n:g}"})
        if rej:
            return None, rej, asg
        res = self.m.evaluate(self.cat, asg)
        for e in res["rejected"]:
            rej.append({"reason": "infeasible_assignment", "detail": f"{e['resource']}@{e['zone_id']}: {e['reason']} - {e['message']}"})
        if not rej:
            for g in leave_one_out(self.m, self.cat, asg):
                if g["gain"] < MIN_GAIN:
                    rej.append({"reason": "redundant_assignment", "detail": f"{g['resource']}@{g['zone_id']} adds only {g['gain']} new locations ({g['metric']}); minimum {MIN_GAIN}. Drop it or move it."})
        if not rej:
            self.check_zone_claims(plan, res, rej)
        return (None if rej else plan), rej, asg

    def check_zone_claims(self, plan: PlanOut, res: dict, rej: list[dict]) -> None:
        zc = zone_changes(res)
        improved = [z for z in zc.values() if z["improved"]]
        truth = (f"For this allocation {len(improved)} of {len(zc)} zones improve ({', '.join(z['name'] for z in improved) or 'none'}); "
                 f"no change: {', '.join(z['name'] for z in zc.values() if not z['improved']) or 'none'}")
        texts = [("summary", plan.summary), *[(f"assignments[{i}].rationale", a.rationale) for i, a in enumerate(plan.assignments)], *[(f"tradeoffs[{i}]", t) for i, t in enumerate(plan.tradeoffs)]]
        for where, text in texts:
            masked = text
            for mk in sorted(self.ids, key=len, reverse=True):  # mask action ids only: zone names must stay visible
                masked = re.sub(re.escape(mk), " ", masked, flags=re.I)
            low = masked.lower()
            for mm in _ZONE_COUNT.finditer(low):
                if int(mm.group(1)) != len(improved) or int(mm.group(2)) != len(zc):
                    rej.append({"reason": "zone_claim_contradiction", "detail": f"{where}: says '{mm.group(0)}'. {truth}"})
            if improved and _NO_ZONES.search(low):
                rej.append({"reason": "zone_claim_contradiction", "detail": f"{where}: claims no zone improves. {truth}"})
            if len(improved) < len(zc) and _ALL_ZONES.search(low):
                rej.append({"reason": "zone_claim_contradiction", "detail": f"{where}: claims all zones improve. {truth}"})
            for sent in _CLAUSES.split(low):
                if not sent or not sent.strip():
                    continue
                neg, pos = bool(_NEG.search(sent)) and not _OTHERS.search(sent), bool(_POS.search(sent))
                for zid, z in zc.items():
                    aliases = {z["name"].lower(), zid.replace("_", " "), z["name"].lower().split(" /")[0]}
                    if not any(a and re.search(rf"\b{re.escape(a)}\b", sent) for a in aliases):
                        continue
                    if z["improved"] and neg:
                        rej.append({"reason": "zone_claim_contradiction", "detail": f"{where}: says {z['name']} does not improve, but it does ({', '.join(z['improved_metrics'])}). {truth}"})
                    elif not z["improved"] and pos and not neg:
                        rej.append({"reason": "zone_claim_contradiction", "detail": f"{where}: says {z['name']} improves, but nothing changes there. {truth}"})


# ---------------------------------------------------------------- orchestration
def _verified(m: AllocationModel, cat: int, asg: list[dict], current: list[dict] | None) -> dict:
    result = m.evaluate(cat, asg)
    out = {"result": result, "assignments": asg, "current_result": None, "assignment_diff": [], "metric_diff": {}}
    if current is not None:
        cmp_ = m.compare(cat, [{"label": "mine", "assignments": current}, {"label": "gemma", "assignments": asg}])
        out["current_result"] = cmp_["plans"][0]["result"]
        out["assignment_diff"] = cmp_["assignment_diff"]
        out["metric_diff"] = cmp_["metric_diff"]
    return out


def _fallback_plan(m: AllocationModel, cat: int) -> tuple[dict, list[dict]]:
    chosen, steps = greedy_plan(m, cat)
    asg = [{"action_id": s["action_id"], "resource": s["resource"], "zone_id": s["zone_id"],
            "rationale": f"Greedy: adds {s['new_locations']} new locations of {RES_WORDS[s['resource']]}, computed by the backend."} for s in steps]
    names = {z["zone_id"]: z["name"] for z in m.setup(cat)["zones"]}
    plan = {"summary": f"Deterministic greedy allocation of {len(chosen)} of {sum(TOTALS.values())} units: each unit goes where it adds the most new coverage in its own category.",
            "assignments": asg,
            "tradeoffs": [f"A unit is only placed if it adds at least {MIN_GAIN} new locations, so some units may stay in reserve.",
                          "Greedy placement is not guaranteed optimal and ignores real-world cost and staffing.",
                          "Coverage categories are reported separately and never summed."],
            "limitations_ack": "Hypothetical inventory and debris on a provisional road graph; locations are road-network nodes, not people; not for real emergency decisions."}
    return plan, chosen


def _key(cat, current, model) -> str:
    cur = sorted((a["resource"], a["zone_id"]) for a in (current or []))
    return hashlib.sha256(json.dumps([cat, cur, model]).encode()).hexdigest()


def generate_allocation_plan(cat: int, current: list[dict] | None = None, *, client: GemmaClient | None = None,
                             model: AllocationModel | None = None, use_cache: bool = True) -> dict:
    t0 = time.monotonic()
    m = model or default_model()
    client = client or GemmaClient()
    ms = lambda: int((time.monotonic() - t0) * 1000)  # noqa: E731
    if cat not in range(0, 6):
        raise AllocationError("category must be an integer 0-5")
    current = [_asg(a) for a in current] if current is not None else None

    def out(source, mdl, reason, plan, validation, asg):
        label = f"Real Gemma response (model {mdl})" if source == "gemma" else FALLBACK_LABEL
        return {"category": cat, "source": source, "source_label": label, "model": mdl if source == "gemma" else None,
                "fallback_reason": reason, "latency_ms": ms(), "plan": plan, "validation": validation,
                "verified": _verified(m, cat, asg, current)}

    if cat == 0:
        plan = {"summary": "No storm scenario selected, so there is nothing to allocate.", "assignments": [], "tradeoffs": [], "limitations_ack": "Select a hurricane category."}
        return out("deterministic_fallback", None, None, plan, {"ok": True, "rejected": [], "repairs": ["no_storm_scenario"]}, [])

    def fallback(reason, rejected, repairs):
        plan, chosen = _fallback_plan(m, cat)
        return out("deterministic_fallback", None, reason, plan, {"ok": False, "rejected": rejected, "repairs": repairs + ["deterministic_fallback_used"]}, chosen)

    if not client.configured:
        plan, chosen = _fallback_plan(m, cat)
        return out("deterministic_fallback", None, "no_api_key", plan, {"ok": False, "rejected": [], "repairs": ["deterministic_fallback_used"]}, chosen)
    key = _key(cat, current, client.model)
    if use_cache:
        with _lock:
            hit = _cache.get(key)
        if hit:
            return {**hit, "cached": True}
    ev = build_evidence(m, cat, current)
    val = Validator(m, cat, ev)
    rejected: list[dict] = []
    repairs: list[str] = []
    prompt = build_prompt(ev)
    prev = None
    for attempt in range(2):
        try:
            res = client.generate(prompt)
        except GemmaError as e:
            return fallback({"timeout": "timeout", "no_api_key": "no_api_key"}.get(e.kind, "provider_error"), rejected, repairs)
        prev = res.text
        try:
            data = extract_json(res.text)
        except ValueError:
            plan, rej, asg = None, [{"reason": "malformed_json", "detail": "no parseable JSON object"}], []
        else:
            plan, rej, asg = val.validate(data)
        if plan is not None:
            if attempt:
                repairs.append("repair_retry_succeeded")
            rat = {}
            full = []
            for a in plan.assignments:
                r, z = split_action(a.action_id)
                full.append({"action_id": a.action_id, "resource": r, "zone_id": z, "rationale": a.rationale})
            body = {"summary": plan.summary, "assignments": full, "tradeoffs": plan.tradeoffs, "limitations_ack": plan.limitations_ack}
            result = out("gemma", res.model, None, body, {"ok": True, "rejected": rejected, "repairs": repairs}, asg)
            if use_cache:
                with _lock:
                    _cache[key] = result
            return result
        rejected = rej
        if attempt == 0:
            repairs.append("repair_retry_requested")
            prompt = build_prompt(ev, feedback=rej, previous=prev)
    return fallback("invalid_output", rejected, repairs)


def clear_cache() -> None:
    with _lock:
        _cache.clear()
