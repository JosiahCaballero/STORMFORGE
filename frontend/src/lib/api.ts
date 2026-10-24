// Typed client for docs/CONTRACT_V2.md (resource-allocation API). Every number shown in the UI comes from these
// responses (backend-owned, NetworkX). "Location" = a road-network graph node, never a person or household.

export type ResourceId = 'debris_crew' | 'ems_team' | 'supply_team' | 'medical_support' | 'water_rescue' | 'helicopter'
export type ZoneId = 'historic_downtown' | 'lincolnville' | 'davis_shores' | 'uptown_san_marco' | 'west_augustine' | 'bridge_corridor'

export interface Assignment { resource: ResourceId; zone_id: string; candidate_id?: string }

export interface InventoryItem { id: ResourceId; label: string; action: string; total: number; used: number; remaining: number }

export interface SetupZone {
  zone_id: string
  name: string
  kind: 'neighborhood' | 'infrastructure'
  flooded_road_segments: number
  debris_blocked: number
  locations: number
  cut_off_locations: number
  hospital_locations: number
  flood_exposed_locations: number
  cut_off_pct: number
}

export interface Obstruction {
  id: string
  zone_id: string | null
  name: string
  highway: string
  length_m: number
  edge_ids: number[]
  flood_closed_edge_ids: number[]
  reason: 'debris' | 'debris + flooding'
  cut_off_locations_if_blocked: number
  cleared: boolean
}

export interface BaseSite { node_id: number; lon: number; lat: number; label: string; zone_id: string; provenance: string; disclosure: string }

export interface Setup {
  category: number
  inventory: InventoryItem[]
  total_units: number
  base: BaseSite
  zones: SetupZone[]
  attention_order: string[]
  debris: Obstruction[]
  debris_meta: Record<string, unknown>
  medical_candidates: { id: string; name: string; zone_id: string; lon: number; lat: number; node_id: number }[]
  assumptions: string[]
  settings: { service_radius_m: number; water_rescue_radius_m: number; helicopter_max_locations: number; crew_capacity: number }
  global_before: Metrics
  provenance: string
}

export interface Metrics {
  locations_total: number
  hospital_locations: number
  response_reach_locations: number
  ems_locations: number
  supply_locations: number
  medical_support_locations: number
  water_rescue_locations: number
  helicopter_locations: number
}

export interface ZoneMetrics {
  zone_nodes: number
  hospital_locations: number
  response_reach_locations: number
  cut_off_locations: number
  ems_locations: number
  supply_locations: number
  medical_support_locations: number
  water_rescue_locations: number
  helicopter_locations: number
  flood_exposed_locations: number
  debris_blocked: number
  debris_cleared: number
}

export type RejectReason =
  | 'inventory_exceeded' | 'no_eligible_debris' | 'debris_not_reachable' | 'no_reachable_point' | 'no_candidate_site'
  | 'candidate_not_in_region' | 'no_flood_exposed_locations' | 'no_target_within_radius' | 'no_isolated_locations'

export interface PlacedAssignment {
  index: number
  resource: ResourceId
  zone_id: string
  zone_name: string
  status: 'placed' | 'rejected'
  reason: RejectReason | null
  message: string
  new_locations: number
  consumed: boolean
  details?: Record<string, unknown>
}

export interface ResultZone {
  zone_id: string
  name: string
  flooded_road_segments: number
  before: ZoneMetrics
  after: ZoneMetrics
  delta: ZoneMetrics
  resources: { resource: ResourceId; message: string }[]
  remaining: { kind: 'debris' | 'cut_off' | 'hospital' | 'water'; count: number; text: string }[]
}

type LonLat = [number, number]
interface UnitPoint { zone_id: string; node_id: number; point: LonLat; street: string }

export interface Layers {
  ems: (UnitPoint & { coverage: LonLat[] })[]
  supply: (UnitPoint & { coverage: LonLat[] })[]
  medical: (UnitPoint & { candidate_id: string; name: string; coverage: LonLat[] })[]
  water: (UnitPoint & { radius_m: number; targets: LonLat[] })[]
  helicopter: (UnitPoint & { cluster: LonLat[] })[]
}

export interface AllocationResult {
  category: number
  inventory: InventoryItem[]
  units_used: number
  units_total: number
  assignments: PlacedAssignment[]
  rejected: PlacedAssignment[]
  roads: {
    flooded_segments: number
    debris_total: number
    debris_cleared: number
    debris_remaining: number
    cleared_obstruction_ids: string[]
    cleared_edge_ids: number[]
    debris: Obstruction[]
    passable_directed_edges: number
    flood_only_directed_edges: number
  }
  metrics: { before: Metrics; after: Metrics; delta: Metrics }
  zones: ResultZone[]
  layers: Layers
  base: BaseSite
  assumptions: string[]
  provenance: string
  notes?: string
}

export interface ActionHint {
  id: string
  resource: ResourceId
  zone_id: string
  zone_name: string
  valid: boolean
  reason: RejectReason | null
  message: string
  standalone_new_locations: number
  details: Record<string, unknown>
}

export interface DiffRow { resource: ResourceId; zone_id: string; [label: string]: string | number }

export interface Compared { category: number; plans: { label: string; result: AllocationResult }[]; assignment_diff: DiffRow[]; metric_diff: Partial<Metrics> }

export interface PlanStatus { provider: string; configured: boolean; model: string | null; fallback_available: boolean }

export interface GemmaPlan {
  category: number
  source: 'gemma' | 'deterministic_fallback'
  source_label: string
  model: string | null
  fallback_reason: string | null
  latency_ms: number
  plan: {
    summary: string
    assignments: { action_id: string; resource: ResourceId; zone_id: string; rationale: string }[]
    tradeoffs: string[]
    limitations_ack: string
  }
  validation: { ok: boolean; rejected: { reason: string; detail: string }[]; repairs: string[] }
  verified: {
    result: AllocationResult
    assignments: Assignment[]
    current_result: AllocationResult | null
    assignment_diff: DiffRow[]
    metric_diff: Partial<Metrics>
  }
}

/** Boundary geometry for the map (from /api/v1/zones; allocation setup has no geometry). */
export interface ZoneGeo {
  id: string
  name: string
  kind: 'neighborhood' | 'infrastructure'
  center: [number, number]
  boundary: { type: 'Polygon'; coordinates: number[][][] } | null
}

export class ApiError extends Error {
  status: number
  constructor(status: number, msg: string) { super(msg); this.status = status }
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}: ${(await r.text()).slice(0, 200)}`)
  return r.json() as Promise<T>
}
const post = (url: string, body: unknown, ms = 60000) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })
const get = (url: string, ms = 60000) => fetch(url, { signal: AbortSignal.timeout(ms) })
const clean = (a: Assignment[]) => a.map(({ resource, zone_id, candidate_id }) => (candidate_id ? { resource, zone_id, candidate_id } : { resource, zone_id }))

export const api = {
  zoneGeo: () => get('/api/v1/zones').then(j<ZoneGeo[]>),
  setup: (category: number) => get(`/api/v1/allocation/setup?category=${category}`).then(j<Setup>),
  actions: (category: number) => get(`/api/v1/allocation/actions?category=${category}`).then(j<ActionHint[]>),
  evaluate: (category: number, assignments: Assignment[]) =>
    post('/api/v1/allocation/evaluate', { category, assignments: clean(assignments) }).then(j<AllocationResult>),
  compare: (category: number, plans: { label: string; assignments: Assignment[] }[]) =>
    post('/api/v1/allocation/compare', { category, plans: plans.map((p) => ({ label: p.label, assignments: clean(p.assignments) })) }).then(j<Compared>),
  planStatus: () => get('/api/v1/plan/status').then(j<PlanStatus>),
  gemmaPlan: (category: number, current: Assignment[]) =>
    post('/api/v1/allocation/plan', { category, current_assignments: clean(current) }, 150000).then(j<GemmaPlan>),
}
