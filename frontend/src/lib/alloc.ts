// Pure helpers for the allocation workflow (unit-tested). No numbers are invented here: everything is read from API results.
import type { ActionHint, AllocationResult, Assignment, DiffRow, InventoryItem, Metrics, ResourceId, ResultZone, SetupZone, ZoneMetrics } from './api'

export type LayerKey = 'flood' | 'debris' | 'cleared' | 'ems' | 'supply' | 'water' | 'heli' | 'medical'

export const LAYERS: { key: LayerKey; label: string; color: string; hint: string }[] = [
  { key: 'flood', label: 'Flood-exposed roads', color: '#fb5d73', hint: 'Roads blocked by modeled flooding' },
  { key: 'debris', label: 'Simulated debris', color: '#fbbf24', hint: 'Roads blocked by hypothetical debris' },
  { key: 'cleared', label: 'Cleared roads', color: '#4ade80', hint: 'Debris removed by your crews' },
  { key: 'ems', label: 'EMS coverage', color: '#60a5fa', hint: 'Locations within 1.5 km of road travel' },
  { key: 'supply', label: 'Supply coverage', color: '#fb923c', hint: 'Locations that can drive to a supply point' },
  { key: 'water', label: 'Potential water rescue', color: '#2dd4bf', hint: 'Flooded locations within 500 m of a rescue entry point' },
  { key: 'heli', label: 'Helicopter priority target', color: '#c4b5fd', hint: 'Hypothetical cluster of up to 10 locations' },
  { key: 'medical', label: 'Medical support', color: '#f472b6', hint: 'Locations with a route to the temporary site' },
]

export const RESOURCES: { id: ResourceId; action: string; short: string; icon: string; layer: LayerKey; noun: string }[] = [
  { id: 'debris_crew', action: 'Clear Debris', short: 'Debris crew', icon: '🚧', layer: 'cleared', noun: 'debris-clearing crew' },
  { id: 'ems_team', action: 'Send EMS', short: 'EMS', icon: '🚑', layer: 'ems', noun: 'EMS team' },
  { id: 'supply_team', action: 'Deliver Supplies', short: 'Supplies', icon: '📦', layer: 'supply', noun: 'supply team' },
  { id: 'medical_support', action: 'Set Up Medical Site', short: 'Medical site', icon: '⛑', layer: 'medical', noun: 'medical support site' },
  { id: 'water_rescue', action: 'Deploy Rescue Team', short: 'Water rescue', icon: '🛟', layer: 'water', noun: 'water-rescue team' },
  { id: 'helicopter', action: 'Send Helicopter', short: 'Helicopter', icon: '🚁', layer: 'heli', noun: 'helicopter' },
]
export const RES = Object.fromEntries(RESOURCES.map((r) => [r.id, r])) as Record<ResourceId, (typeof RESOURCES)[number]>

export const COVERAGE_ROWS: { key: keyof Metrics; label: string; zoneKey: keyof ZoneMetrics }[] = [
  { key: 'ems_locations', label: 'EMS coverage', zoneKey: 'ems_locations' },
  { key: 'supply_locations', label: 'Supply access', zoneKey: 'supply_locations' },
  { key: 'water_rescue_locations', label: 'Potential water rescue', zoneKey: 'water_rescue_locations' },
  { key: 'helicopter_locations', label: 'Potential helicopter rescue', zoneKey: 'helicopter_locations' },
  { key: 'medical_support_locations', label: 'Medical support access', zoneKey: 'medical_support_locations' },
]

export const fmt = (n: number) => n.toLocaleString()

/** Plain-English "x% of locations cut off from help" for a region (setup data). */
export function cutOffLine(z: SetupZone): string {
  if (z.cut_off_locations === 0) return 'No locations cut off from help'
  return `${Math.round(z.cut_off_pct)}% of locations cut off from help`
}

export function pctCutOff(m: ZoneMetrics): number {
  return m.zone_nodes ? (100 * m.cut_off_locations) / m.zone_nodes : 0
}

export function invById(inv: InventoryItem[] | undefined, id: ResourceId): InventoryItem | undefined {
  return inv?.find((i) => i.id === id)
}

export interface ActionState {
  /** hard-disabled: cannot be clicked */
  disabled: boolean
  /** plain-English reason shown under/over the button (also tooltip) */
  reason: string | null
  /** true when the standalone hint says "invalid" but another unit could unlock it (click still allowed) */
  soft: boolean
}

/** Combine live inventory with the backend's standalone action hint for one resource in one region. */
export function actionState(resource: ResourceId, zoneId: string | null, inv: InventoryItem[] | undefined, hints: ActionHint[] | null): ActionState {
  const item = invById(inv, resource)
  if (item && item.remaining <= 0) return { disabled: true, soft: false, reason: `All ${item.total} ${RES[resource].short.toLowerCase()} unit${item.total === 1 ? ' is' : 's are'} already assigned. Remove one to reuse it.` }
  if (!zoneId) return { disabled: true, soft: false, reason: 'Select a neighborhood first.' }
  const h = hints?.find((x) => x.resource === resource && x.zone_id === zoneId)
  if (h && !h.valid) {
    // Nothing can ever make "no eligible debris" valid; other reasons may change once upstream debris is cleared.
    if (h.reason === 'no_eligible_debris') return { disabled: true, soft: false, reason: h.message }
    return { disabled: false, soft: true, reason: h.message }
  }
  return { disabled: false, soft: false, reason: null }
}

/** One-line plain-language problem list for a region from setup data. */
export function problemLines(z: SetupZone): { key: string; text: string; tone: 'coral' | 'amber' | 'mute' }[] {
  return [
    { key: 'flood', text: `${fmt(z.flooded_road_segments)} flooded road segment${z.flooded_road_segments === 1 ? '' : 's'}`, tone: 'coral' },
    { key: 'debris', text: z.debris_blocked ? `${z.debris_blocked} road${z.debris_blocked === 1 ? '' : 's'} blocked by debris` : 'No debris-blocked roads', tone: z.debris_blocked ? 'amber' : 'mute' },
    { key: 'cut', text: z.cut_off_locations ? `${fmt(z.cut_off_locations)} of ${fmt(z.locations)} locations cut off from help (${Math.round(z.cut_off_pct)}%)` : 'No locations cut off from help', tone: z.cut_off_locations ? 'coral' : 'mute' },
  ]
}

export interface BeforeAfterRow { key: string; label: string; before: number; after: number; better: 'down' | 'up' }

/** At most 4 rows for one region: cut-off + debris always, then up to two coverage metrics that changed (else EMS). */
export function regionBeforeAfter(z: ResultZone): BeforeAfterRow[] {
  const rows: BeforeAfterRow[] = [
    { key: 'cut', label: 'Locations cut off from help', before: z.before.cut_off_locations, after: z.after.cut_off_locations, better: 'down' },
    { key: 'debris', label: 'Debris-blocked roads', before: z.before.debris_blocked, after: z.after.debris_blocked, better: 'down' },
  ]
  const changed = COVERAGE_ROWS.filter((c) => z.after[c.zoneKey] !== z.before[c.zoneKey]).slice(0, 2)
  const extra = changed.length ? changed : [COVERAGE_ROWS[0]]
  for (const c of extra) rows.push({ key: c.zoneKey, label: c.label, before: z.before[c.zoneKey], after: z.after[c.zoneKey], better: 'up' })
  return rows.slice(0, 4)
}

/** Which overlay(s) to switch on after placing a unit. */
export function layersFor(resource: ResourceId): LayerKey[] {
  return resource === 'debris_crew' ? ['cleared', 'debris'] : [RES[resource].layer]
}

/** Map assignment (request index) to the result entry. */
export function entryFor(res: AllocationResult | null, index: number) {
  return res?.assignments.find((a) => a.index === index) ?? null
}

/** Group my assignment list into rows with their evaluation status. */
export function assignedRows(list: Assignment[], res: AllocationResult | null) {
  return list.map((a, index) => ({ ...a, index, entry: entryFor(res, index) }))
}

export function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index)
}

/** Move one assignment to another region (appended last, so its result index is list.length-1). */
export function moveTo(list: Assignment[], index: number, zoneId: string): Assignment[] {
  const a = list[index]
  return [...removeAt(list, index), { ...a, zone_id: zoneId }]
}

export function sameAllocation(a: Assignment[], b: Assignment[]): boolean {
  const k = (l: Assignment[]) => l.map((x) => `${x.resource}@${x.zone_id}`).sort().join('|')
  return k(a) === k(b)
}

/** Render the label-keyed assignment diff from /compare as readable rows. */
export function diffRows(diff: DiffRow[], zoneName: (id: string) => string, a = 'mine', b = 'gemma') {
  return diff
    .map((d) => ({ resource: d.resource, zone: zoneName(d.zone_id), mine: Number(d[a] ?? 0), gemma: Number(d[b] ?? 0) }))
    .filter((d) => d.mine !== d.gemma)
}

/** Zones that still have locations cut off from help, most affected first. */
export function stillCutOff(zones: ResultZone[]): { zone: string; count: number; zone_id: string }[] {
  return zones
    .map((z) => ({ zone: z.name, zone_id: z.zone_id, count: z.after.cut_off_locations }))
    .filter((z) => z.count > 0)
    .sort((x, y) => y.count - x.count)
}

/** Closed polygon approximating a circle (for the 500 m water-rescue ring). */
export function circlePolygon(lon: number, lat: number, radiusM: number, steps = 48): [number, number][] {
  const dLat = radiusM / 111320
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180))
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = (2 * Math.PI * i) / steps
    pts.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)])
  }
  return pts
}

export const ZONE_SHORT: Record<string, string> = {
  historic_downtown: 'Historic Downtown', lincolnville: 'Lincolnville', davis_shores: 'Davis Shores',
  uptown_san_marco: 'Uptown / San Marco', west_augustine: 'West Augustine', bridge_corridor: 'Bridge Corridor',
}

/** Demo region: West Augustine when a debris crew is useful there (verified for Cat 3), else the most-cut-off region that has eligible debris. */
export function pickDemoZone(setup: { attention_order: string[] }, hints: ActionHint[]): string | null {
  const ok = (id: string) => hints.some((h) => h.resource === 'debris_crew' && h.zone_id === id && h.valid)
  if (ok('west_augustine')) return 'west_augustine'
  return setup.attention_order.find(ok) ?? null
}

/** "What improved?" lines for one region, from backend before/after deltas only. */
export function improvedLines(z: ResultZone): string[] {
  const d = z.delta
  const out: string[] = []
  if (d.cut_off_locations < 0) out.push(`${fmt(-d.cut_off_locations)} fewer locations cut off from the response base`)
  if (d.debris_blocked < 0) out.push(`${fmt(-d.debris_blocked)} road${d.debris_blocked === -1 ? '' : 's'} cleared of simulated debris`)
  for (const c of COVERAGE_ROWS) if (d[c.zoneKey] > 0) out.push(`+${fmt(d[c.zoneKey])} locations: ${c.label}`)
  return out
}

/** "What still needs help?" lines. Hospital kind from the 4 km model is dropped; emergency-department access comes from the regional calculation. */
export function stillNeedsLines(z: ResultZone, ed: { nodes: number; nodes_with_24h_ed_route: number } | undefined): string[] {
  const out = z.remaining.filter((r) => r.kind !== 'hospital').map((r) => r.text)
  if (ed && ed.nodes > ed.nodes_with_24h_ed_route) out.push(`${fmt(ed.nodes - ed.nodes_with_24h_ed_route)} of ${fmt(ed.nodes)} locations cannot reach a verified 24-hour emergency department (regional calculation; deployments do not change this)`)
  return out
}

/** Assignments of one resource in one region, as result-request indexes (last one first, for the "−" button). */
export function indexesIn(list: Assignment[], resource: ResourceId, zoneId: string | null): number[] {
  const out: number[] = []
  list.forEach((a, i) => { if (a.resource === resource && a.zone_id === zoneId) out.unshift(i) })
  return out
}

/** Short name of the road(s) a crew cleared, from the result's debris list. */
export function clearedRoads(res: AllocationResult, ids: string[]): { id: string; name: string; reopened: number; flooded: boolean }[] {
  return ids.map((id) => res.roads.debris.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => ({ id: o.id, name: o.name, reopened: o.cut_off_locations_if_blocked, flooded: o.reason !== 'debris' }))
}
