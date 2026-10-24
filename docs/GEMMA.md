# Gemma planner (STORMFORGE)

## Provider and model
- Provider: Google **Gemma** (not Gemini) through the Google AI Studio / Generative Language REST API,
  `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, plain `httpx`, backend only.
- Default model: `gemma-4-31b-it` (override with `GEMMA_MODEL`). Chosen because Google's "Gemma on the Gemini API" page lists
  `gemma-4-31b-it` and `gemma-4-26b-a4b-it` as the hosted instruction-tuned Gemma models; 31B is the larger/more capable one.
  `gemma-4-26b-a4b-it` is the lower-latency alternative. Run `python scripts/gemma_smoke.py` to see what the key can actually use.
- Docs relied on: https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api (that page notes it is deprecated in favor of gemma.ai;
  model ids should be re-confirmed with `models.list`), https://ai.google.dev/gemini-api/docs (REST shape, `x-goog-api-key` header).
- Design choice: the prompt is a single user turn and the answer is parsed as JSON defensively. We do NOT rely on
  `systemInstruction` or a JSON response mode (historically unsupported for Gemma on this API; the docs say system instructions are
  now supported, but the adapter does not depend on it).

## Configure
Copy `backend/.env.example` to `backend/.env` (git-ignored) and set `GEMMA_API_KEY` (fallback `GOOGLE_API_KEY`), optionally
`GEMMA_MODEL`, `GEMMA_TIMEOUT_S` (default 25). The key is sent only in the `x-goog-api-key` header; it is redacted from errors and
never logged or returned. `GET /api/v1/plan/status` returns `{provider, configured, model, fallback_available}` only.

Real smoke test: `cd backend && python scripts/gemma_smoke.py` (lists Gemma models, makes one call, prints model + latency, never the key).

## Flow
1. Evidence = baseline metrics, candidate list (id/name/zone, no coordinates), each candidate's standalone delta from `evaluate_plan`,
   and the four agents' findings from `build_report`. 2. Gemma returns JSON (`summary, ranked, recommended_ids, tradeoffs,
   agent_citations, limitations_ack`). 3. Strict validation. 4. One repair retry with machine-readable feedback. 5. Else deterministic
   fallback. 6. Backend runs `evaluate_plan(category, recommended_ids)` and returns it as `verified.evaluate`. The model never supplies metrics.

## Validation rules (reject => repair once => fallback)
Unparseable JSON (fenced JSON and surrounding prose are tolerated); unknown/extra fields (pydantic `extra=forbid`; keys such as
lat/lon/coordinates/metrics/delta are rejected explicitly); unknown or duplicate candidate ids; empty or > `max_candidates`
recommendations; recommended ids not in `ranked`; ranks not 1..n; citations whose `(agent, finding_id)` is not in the report;
coordinate-like decimals in text; **any number in free text not present in the supplied evidence** (candidate ids/names are masked
first; allowed extra ordinals: integers 1..number of candidates, `max_candidates`, and the category); capitalised multi-word names
ending in a facility keyword (Hospital, Clinic, Shelter, School, Station, Park, Bridge, ...) that do not appear in the evidence text;
empty `limitations_ack`. The facility check is heuristic (can false-positive; the repair retry covers that).

## Fallback and labeling
`source: "deterministic_fallback"`, `source_label: "Deterministic demo fallback — NOT a Gemma response"`, `model: null`,
`fallback_reason` in `no_api_key | timeout | provider_error | invalid_output`. Algorithm: greedy marginal gain in
`nodes_with_any_care_route` (tie: origins, then candidate id), stops when gain is zero or `max_candidates` reached; deterministic.
`validation.ok` is false when a fallback replaced a failed model answer. Category 0 returns an empty "no surge scenario" plan
(labeled as deterministic, `fallback_reason: null`) without calling the model. Successful Gemma results are cached in memory by
(category, max_candidates, model); fallbacks are not cached. `/plan/generate` allows one uncached model call per 2 s (HTTP 429 otherwise).

## What was tested
- **Real Gemma: nothing.** No API key was available. The model id, response shape handling and prompt quality against a live
  Gemma response are unverified.
- Mocked (`httpx.MockTransport`, fully offline): provider success/headers, thought-part skipping, 429/500/400 retry behavior, timeout,
  oversize/bad payload, key redaction in errors/logs/responses, model listing, JSON extraction, every validation rule above,
  repair retry, fallback labeling, greedy fallback stability, cache, rate limit, category 0. Planner tests use a fake simulator; the
  fallback path was also run once against the real `interventions.py`. The Gemma path against real `agents.build_report` is untested
  until `agents.py` exists.


## Live findings (2026-10-24, real key)
- `models.list` shows exactly two Gemma models with `generateContent`: `gemma-4-26b-a4b-it`, `gemma-4-31b-it`.
- Ping latency: 31b ~36 s (2 attempts); 26b-a4b ~5-6 s.
- Gemma 4 is a *thinking* model. With default settings the real planner prompt (~2.7k tokens) produced only thought parts, hit
  `finishReason: MAX_TOKENS` (4093 thought tokens) after ~87 s and returned no answer, so the planner timed out/fell back.
- `thinkingConfig.thinkingBudget` is rejected (HTTP 400 "not supported for this model"); `thinkingLevel: "minimal"` works
  (~10 s, valid JSON). The adapter now sends `thinkingLevel` (env `GEMMA_THINKING_LEVEL`, default `minimal`) and defaults to 26b-a4b.
- Occasional transient HTTP 500 "Internal error encountered" from the API; the adapter retries once.
