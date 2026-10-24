// Typed client for docs/CONTRACT.md. All numbers shown in the UI come from these responses (backend-owned).

export interface Metrics {
  nodes_total: number
  nodes_with_hospital_route: number
  nodes_with_staging_route: number
  nodes_with_any_care_route: number
  origins_total: number
  origins_with_hospital_route: number
  origins_with_staging_route: number
  origins_with_any_care_route: number
  provenance: string
}

export interface Zone {
  id: string
  name: string
  kind: 'neighborhood' | 'infrastructure'
  center: [number, number]
  boundary: { type: 'Polygon'; coordinates: number[][][] } | null
  boundary_status: 'provisional' | 'verified'
  method: string
  node_count: number
  notes?: string
}

export interface ZoneImpact {
  zone: string
  category: number
  edges_total: number
  edges_closed: number
  closed_length_pct: number
  nodes: number
  nodes_with_hospital_route: number
  nodes_with_any_care_route: number
  most_exposed_roads: { edge_id: number; name: string | null; max_bin: number }[]
  provenance: string
  limitations: string[]
}

export interface Candidate {
  id: string
  name: string
  kind: string
  zone_id: string
  lon: number
  lat: number
  node_id: number
  snap_distance_m: number
  selection_rule: string
  provenance: string
  feasibility_by_category: Record<string, Record<string, unknown>>
  limitations: string[]
}

export interface EvalResult {
  category: number
  candidate_ids: string[]
  baseline: Metrics
  intervention: Metrics
  delta: Record<string, number>
  per_candidate: { id: string; marginal: Record<string, number>; standalone: Metrics }[]
  per_zone: { zone_id: string; baseline_any_care_nodes: number; intervention_any_care_nodes: number; zone_nodes: number }[]
  warnings: string[]
  provenance: string
}

export interface Finding { id: string; text: string; value?: number | string; unit?: string; provenance: string }
export interface AgentFinding { agent: string; title: string; headline: string; findings: Finding[]; limitations: string[]; evidence: Record<string, unknown> }
export interface AgentReport {
  category: number
  applied_candidate_ids: string[]
  transportation: AgentFinding
  medical: AgentFinding
  logistics: AgentFinding
  community: AgentFinding
  transit: { status: string; note: string }
}

export interface PlanStatus { provider: string; configured: boolean; model: string | null; fallback_available: boolean }
export interface PlanResponse {
  category: number
  source: 'gemma' | 'deterministic_fallback'
  source_label: string
  model: string | null
  fallback_reason: string | null
  latency_ms: number
  plan: {
    summary: string
    ranked: { candidate_id: string; rank: number; rationale: string }[]
    recommended_ids: string[]
    tradeoffs: string[]
    agent_citations: { agent: string; finding_id: string }[]
    limitations_ack: string
  }
  validation: { ok: boolean; rejected: { reason: string; detail: string }[]; repairs: unknown[] }
  verified: {
    evaluate: EvalResult
    sequential_marginals: { step: number; candidate_id: string; marginal_nodes: number; marginal_origins: number; cumulative_nodes: number; meets_minimum: boolean }[]
    zone_impact: { zone_id: string; zone_name: string; zone_nodes: number; baseline_any_care_nodes: number; after_any_care_nodes: number; gained_nodes: number; improved: boolean }[]
    min_marginal_nodes_per_site: number
  }
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${(await r.text()).slice(0, 200)}`)
  return r.json() as Promise<T>
}
const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  zones: () => fetch('/api/v1/zones').then(j<Zone[]>),
  zoneImpact: (id: string, category: number, ids: string[]) =>
    fetch(`/api/v1/zones/${id}/impact?category=${category}&candidate_ids=${ids.join(',')}`).then(j<ZoneImpact>),
  candidates: () => fetch('/api/v1/candidates').then(j<Candidate[]>),
  evaluate: (category: number, candidate_ids: string[]) =>
    post('/api/v1/interventions/evaluate', { category, candidate_ids }).then(j<EvalResult>),
  report: (category: number, ids: string[]) =>
    fetch(`/api/v1/agents/report?category=${category}&candidate_ids=${ids.join(',')}`).then(j<AgentReport>),
  planStatus: () => fetch('/api/v1/plan/status').then(j<PlanStatus>),
  generatePlan: (category: number, max_candidates = 3) =>
    post('/api/v1/plan/generate', { category, max_candidates }).then(j<PlanResponse>),
}
