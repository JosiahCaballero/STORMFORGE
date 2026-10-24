"""Incident-Commander planner: Gemma proposes, the backend validates and independently scores.

The model never supplies metrics. `verified.evaluate` is always produced by evaluate_plan() on the
accepted recommended ids. Any invalid output -> one repair retry -> deterministic fallback, which is
labelled as NOT a Gemma response.

Number rule (documented in docs/GEMMA.md): every number in model free text must appear in the evidence
JSON supplied to the model, OR be an explicitly allowed small ordinal: integers 1..len(candidates),
max_candidates, and the category. Candidate ids/names are masked before scanning so digits in them
are fine. Coordinates (decimals with >=3 places or lat/lon keys) are always rejected.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from typing import Any, Callable

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .gemma import GemmaClient, GemmaError, extract_json

FALLBACK_LABEL = "Deterministic demo fallback — NOT a Gemma response"
AGENTS = ("transportation", "medical", "logistics", "community")
MAX_TEXT = 700
SCORE_KEY = "nodes_with_any_care_route"


# ---------------------------------------------------------------- schema
class Ranked(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_id: str = Field(max_length=80)
    rank: int
    rationale: str = Field(max_length=MAX_TEXT)


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent: str = Field(max_length=40)
    finding_id: str = Field(max_length=120)


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(max_length=MAX_TEXT * 2)
    ranked: list[Ranked] = Field(max_length=20)
    recommended_ids: list[str] = Field(max_length=20)
    tradeoffs: list[str] = Field(max_length=8)
    agent_citations: list[Citation] = Field(max_length=20)
    limitations_ack: str = Field(max_length=MAX_TEXT)


# ---------------------------------------------------------------- simulation access (injectable)
class Sim:
    """Bundle of the Simulation teammate's interfaces; each is lazily imported so tests can inject fakes
    and the fallback path works even if agents.py is unavailable."""

    def __init__(self, list_candidates=None, evaluate_plan=None, build_report=None):
        self._lc, self._ep, self._br = list_candidates, evaluate_plan, build_report

    def list_candidates(self):
        if self._lc is None:
            from .interventions import list_candidates as f
            self._lc = f
        return self._lc()

    def evaluate_plan(self, cat, ids):
        if self._ep is None:
            from .interventions import evaluate_plan as f
            self._ep = f
        return self._ep(cat, ids)

    def build_report(self, cat, ids):
        if self._br is None:
            from .agents import build_report as f
            self._br = f
        return self._br(cat, ids)


# ---------------------------------------------------------------- evidence
def build_evidence(cat: int, max_candidates: int, sim: Sim) -> dict:
    cands = sim.list_candidates()
    base = sim.evaluate_plan(cat, [])
    report = sim.build_report(cat, [])
    standalone = []
    for c in cands:
        ev = sim.evaluate_plan(cat, [c["id"]])
        standalone.append({"candidate_id": c["id"], "delta_vs_baseline_if_applied_alone": ev["delta"]})
    agents = {}
    for a in AGENTS:
        f = report.get(a) or {}
        agents[a] = {
            "headline": f.get("headline"),
            "findings": [{k: x.get(k) for k in ("id", "text", "value", "unit") if x.get(k) is not None}
                         for x in f.get("findings", [])],
            "limitations": f.get("limitations", []),
        }
    return {
        "category": cat,
        "max_candidates": max_candidates,
        "baseline_metrics": base["baseline"],
        "candidates": [{"id": c["id"], "name": c.get("name"), "zone_id": c.get("zone_id"),
                        "kind": c.get("kind"), "provenance": c.get("provenance")} for c in cands],
        "standalone_scores": standalone,
        "agent_reports": agents,
    }


def build_prompt(evidence: dict, repair: list[dict] | None = None, previous: str | None = None) -> str:
    n = evidence["max_candidates"]
    p = (
        "You are the Incident Commander for a storm-surge medical-access simulation (hackathon demo, not for real decisions).\n"
        "Choose which HYPOTHETICAL basic-care staging sites to activate, using ONLY the evidence JSON below.\n"
        "Rules:\n"
        f"- recommended_ids: between 1 and {n} candidate ids copied exactly from evidence.candidates, no duplicates.\n"
        "- ranked: every candidate you consider, best first, rank = 1,2,3...; candidate_id copied exactly.\n"
        "- agent_citations: [{agent, finding_id}] copied exactly from evidence.agent_reports (agent in transportation|medical|logistics|community).\n"
        "- Do NOT output coordinates, new facility/place names, or any metric you computed yourself.\n"
        "- Avoid digits in free text. If you use a number it must be copied verbatim from the evidence.\n"
        "- Staging sites are hypothetical basic-care staging, never hospitals. State limits honestly in limitations_ack.\n"
        "- Output ONLY one JSON object, no markdown, with exactly these keys:\n"
        '{"summary": str, "ranked": [{"candidate_id": str, "rank": int, "rationale": str}], "recommended_ids": [str],'
        ' "tradeoffs": [str], "agent_citations": [{"agent": str, "finding_id": str}], "limitations_ack": str}\n\n'
        "EVIDENCE:\n" + json.dumps(evidence, sort_keys=True)
    )
    if repair:
        p += ("\n\nYour previous answer was REJECTED by the validator. Fix every item and output the full corrected JSON only.\n"
              "VALIDATION_FEEDBACK:\n" + json.dumps(repair))
        if previous:
            p += "\nPREVIOUS_ANSWER:\n" + previous[:3000]
    return p


# ---------------------------------------------------------------- validation
_NUM = re.compile(r"(?<![A-Za-z_])\d[\d,]*(?:\.\d+)?")
_COORD = re.compile(r"-?\d{1,3}\.\d{3,}")
_FAC_KW = (r"Hospital|Medical Center|Medical Centre|Clinic|Shelter|School|Fire Station|Police Station|Station|Library|"
           r"Church|Park|Airport|Center|Centre|Bridge|Hall|Fort|Pier|Marina|Stadium|University|College")
_FAC = re.compile(rf"((?:[A-Z][\w.'&-]*\s+){{1,5}}(?:{_FAC_KW}))\b")
_STOP = {"the", "a", "an", "this", "that", "these", "those", "both", "all", "each", "any", "our", "its", "their", "for",
         "to", "and", "of", "in", "at", "on", "with", "from", "by", "prioritize", "prioritise", "recommend", "select",
         "activate", "use", "staging", "also", "but", "while", "if", "as", "near", "new", "other", "nearest"}


def _numbers(text: str) -> set[float]:
    out = set()
    for m in _NUM.findall(text):
        try:
            out.add(float(m.replace(",", "")))
        except ValueError:
            pass
    return out


def _walk(o: Any, nums: set[float], strs: list[str]) -> None:
    if isinstance(o, bool) or o is None:
        return
    if isinstance(o, (int, float)):
        nums.add(float(o))
    elif isinstance(o, str):
        strs.append(o)
        nums |= _numbers(o)
    elif isinstance(o, dict):
        for k, v in o.items():
            _walk(v, nums, strs)
    elif isinstance(o, list):
        for v in o:
            _walk(v, nums, strs)


class Validator:
    def __init__(self, evidence: dict):
        self.ev = evidence
        self.max = int(evidence["max_candidates"])
        self.cat = int(evidence["category"])
        self.cand_ids = [c["id"] for c in evidence["candidates"]]
        self.mask = [c["id"] for c in evidence["candidates"]] + [c["name"] for c in evidence["candidates"] if c.get("name")]
        self.mask.sort(key=len, reverse=True)
        self.finding_ids = {(a, f["id"]) for a, rep in evidence["agent_reports"].items() for f in rep["findings"]}
        nums: set[float] = set()
        strs: list[str] = []
        _walk(evidence, nums, strs)
        self.allowed = nums | {float(i) for i in range(1, len(self.cand_ids) + 1)} | {float(self.max), float(self.cat)}
        self.corpus = "\n".join(strs).lower()

    def _texts(self, p: Plan) -> list[tuple[str, str]]:
        t = [("summary", p.summary), ("limitations_ack", p.limitations_ack)]
        t += [(f"ranked[{i}].rationale", r.rationale) for i, r in enumerate(p.ranked)]
        t += [(f"tradeoffs[{i}]", s) for i, s in enumerate(p.tradeoffs)]
        return t

    def check_text(self, where: str, text: str, rej: list[dict]) -> None:
        if _COORD.search(text):
            rej.append({"reason": "coordinates_not_allowed", "detail": where})
        masked = text
        for m in self.mask:
            masked = re.sub(re.escape(m), " ", masked, flags=re.I)
        for n in sorted(_numbers(masked)):
            if n not in self.allowed:
                rej.append({"reason": "number_not_in_evidence", "detail": f"{where}: {n:g}"})
        for m in _FAC.finditer(masked):
            words = m.group(1).split()
            while len(words) > 1 and words[0].lower() in _STOP:
                words = words[1:]
            phrase = " ".join(words)
            if len(words) > 1 and phrase.lower() not in self.corpus:
                rej.append({"reason": "unknown_facility_name", "detail": f"{where}: {phrase}"})

    def validate(self, data: Any) -> tuple[Plan | None, list[dict]]:
        rej: list[dict] = []
        if isinstance(data, dict):
            for k in data:
                if str(k).lower() in {"lat", "lon", "lng", "latitude", "longitude", "coordinates", "coords", "metrics", "delta"}:
                    rej.append({"reason": "forbidden_field", "detail": str(k)})
        try:
            plan = Plan.model_validate(data)
        except ValidationError as e:
            for err in e.errors()[:8]:
                rej.append({"reason": "schema_error", "detail": f"{'.'.join(str(x) for x in err['loc'])}: {err['type']}"})
            return None, rej
        known = set(self.cand_ids)
        if not plan.recommended_ids:
            rej.append({"reason": "empty_recommendation", "detail": "recommended_ids is empty"})
        if len(plan.recommended_ids) > self.max:
            rej.append({"reason": "too_many_recommended", "detail": f"{len(plan.recommended_ids)} > max {self.max}"})
        for label, ids in (("recommended_ids", plan.recommended_ids), ("ranked", [r.candidate_id for r in plan.ranked])):
            seen: set[str] = set()
            for i in ids:
                if i not in known:
                    rej.append({"reason": "unknown_candidate_id", "detail": f"{label}: {i}"})
                if i in seen:
                    rej.append({"reason": "duplicate_candidate_id", "detail": f"{label}: {i}"})
                seen.add(i)
        ranks = [r.rank for r in plan.ranked]
        if sorted(ranks) != list(range(1, len(ranks) + 1)):
            rej.append({"reason": "bad_ranks", "detail": "ranks must be 1..n without gaps/duplicates"})
        ranked_ids = {r.candidate_id for r in plan.ranked}
        for i in plan.recommended_ids:
            if i in known and i not in ranked_ids:
                rej.append({"reason": "recommended_not_ranked", "detail": i})
        for c in plan.agent_citations:
            if (c.agent, c.finding_id) not in self.finding_ids:
                rej.append({"reason": "unknown_finding_id", "detail": f"{c.agent}:{c.finding_id}"})
        for where, text in self._texts(plan):
            self.check_text(where, text, rej)
        if not plan.limitations_ack.strip():
            rej.append({"reason": "missing_limitations_ack", "detail": "empty"})
        return (None if rej else plan), rej


# ---------------------------------------------------------------- deterministic fallback
MIN_NODE_GAIN = 5  # minimum marginal graph-node gain for the deterministic fallback to recommend a site


def _gain(ev: dict) -> tuple[int, int]:
    d = ev["delta"]
    return int(d.get(SCORE_KEY, 0)), int(d.get("origins_with_any_care_route", 0))


def deterministic_plan(cat: int, max_candidates: int, sim: Sim, evidence: dict | None = None) -> dict:
    """Greedy marginal-benefit selection with evaluate_plan. Ties broken by candidate id. Pure function."""
    ids = sorted(c["id"] for c in sim.list_candidates())
    chosen: list[str] = []
    gains: dict[str, tuple[int, int]] = {}
    while len(chosen) < max_candidates:
        best = None
        for i in ids:
            if i in chosen:
                continue
            g = _gain(sim.evaluate_plan(cat, chosen + [i]))
            prev = _gain(sim.evaluate_plan(cat, chosen)) if chosen else (0, 0)
            m = (g[0] - prev[0], g[1] - prev[1])
            if best is None or m > best[0]:
                best = (m, i)
        # stop when the next site adds fewer than MIN_NODE_GAIN nodes: a +1 'gain' is just the site itself, not an improvement
        if best is None or best[0][0] < MIN_NODE_GAIN:
            break
        chosen.append(best[1])
        gains[best[1]] = best[0]
    names = {c["id"]: c.get("name") or c["id"] for c in sim.list_candidates()}
    ranked = [{"candidate_id": i, "rank": n + 1,
               "rationale": f"Selected greedily: adds {gains[i][0]} graph nodes with a route to care "
                            f"({gains[i][1]} sampled origins) beyond the sites ranked above it. Computed by the simulator."}
              for n, i in enumerate(chosen)]
    return {
        "summary": (f"Greedy marginal-benefit selection of {len(chosen)} hypothetical staging site(s) for category {cat}: "
                    + (", ".join(names[i] for i in chosen) if chosen else "no site improves modeled access") + "."),
        "ranked": ranked,
        "recommended_ids": chosen,
        "tradeoffs": ["Greedy selection is not guaranteed optimal and ignores cost, staffing and real-world feasibility.",
                      "Staging sites provide basic care only; they are not hospitals and are hypothetical."],
        "agent_citations": [],
        "limitations_ack": "Deterministic heuristic over a provisional road graph; hypothetical sites; simulated metrics, not for real emergency decisions.",
    }


# ---------------------------------------------------------------- orchestration
_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()


def cache_key(cat: int, max_candidates: int, model: str | None) -> str:
    return hashlib.sha256(f"{cat}|{max_candidates}|{model}".encode()).hexdigest()


def cache_peek(cat: int, max_candidates: int, model: str | None) -> dict | None:
    with _cache_lock:
        r = _cache.get(cache_key(cat, max_candidates, model))
    return {**r, "cached": True} if r else None


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _response(cat, source, model, reason, latency, plan, validation, sim) -> dict:
    label = f"Real Gemma response (model {model})" if source == "gemma" else FALLBACK_LABEL
    return {
        "category": cat, "source": source, "source_label": label,
        "model": model if source == "gemma" else None,
        "fallback_reason": reason, "latency_ms": latency, "plan": plan, "validation": validation,
        "verified": {"evaluate": sim.evaluate_plan(cat, plan["recommended_ids"])},
    }


def generate_plan(cat: int, max_candidates: int = 3, *, client: GemmaClient | None = None, sim: Sim | None = None,
                  use_cache: bool = True) -> dict:
    t0 = time.monotonic()
    sim = sim or Sim()
    client = client or GemmaClient()
    ms = lambda: int((time.monotonic() - t0) * 1000)  # noqa: E731

    if cat == 0:
        plan = {"summary": "Category 0 is the baseline (no surge). No storm-surge closures, so no staging plan is needed.",
                "ranked": [], "recommended_ids": [], "tradeoffs": [], "agent_citations": [],
                "limitations_ack": "No surge scenario selected; nothing was sent to a model."}
        return _response(cat, "deterministic_fallback", None, None, ms(), plan,
                         {"ok": True, "rejected": [], "repairs": ["no_surge_scenario"]}, sim)

    if not client.configured:
        return _fallback(cat, max_candidates, sim, "no_api_key", ms(), [], [])

    key = cache_key(cat, max_candidates, client.model)
    if use_cache:
        hit = cache_peek(cat, max_candidates, client.model)
        if hit:
            return hit

    evidence = build_evidence(cat, max_candidates, sim)
    validator = Validator(evidence)
    rejected: list[dict] = []
    repairs: list[str] = []
    prompt = build_prompt(evidence)
    prev_text: str | None = None
    for attempt in range(2):
        try:
            res = client.generate(prompt)
        except GemmaError as e:
            reason = {"timeout": "timeout", "no_api_key": "no_api_key"}.get(e.kind, "provider_error")
            return _fallback(cat, max_candidates, sim, reason, ms(), rejected, repairs, evidence)
        prev_text = res.text
        try:
            data = extract_json(res.text)
        except ValueError:
            plan, rej = None, [{"reason": "malformed_json", "detail": "no parseable JSON object"}]
        else:
            plan, rej = validator.validate(data)
        if plan is not None:
            if attempt:
                repairs.append("repair_retry_succeeded")
            out = _response(cat, "gemma", res.model, None, ms(), json.loads(plan.model_dump_json()),
                            {"ok": True, "rejected": rejected, "repairs": repairs}, sim)
            if use_cache:
                with _cache_lock:
                    _cache[key] = out
            return out
        rejected = rej
        if attempt == 0:
            repairs.append("repair_retry_requested")
            prompt = build_prompt(evidence, repair=rej, previous=prev_text)
    return _fallback(cat, max_candidates, sim, "invalid_output", ms(), rejected, repairs, evidence)


def _fallback(cat, max_candidates, sim, reason, latency, rejected, repairs, evidence=None) -> dict:
    plan = deterministic_plan(cat, max_candidates, sim, evidence)
    return _response(cat, "deterministic_fallback", None, reason, latency, plan,
                     {"ok": reason is None, "rejected": rejected, "repairs": repairs + ["deterministic_fallback_used"]}, sim)
