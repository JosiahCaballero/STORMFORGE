import { describe, expect, it } from 'vitest'
import { clearedRoads, COVERAGE_ROWS, improvedLines, indexesIn, LAYERS, stillNeedsLines } from './alloc'
import type { AllocationResult, Assignment, ResultZone, ZoneMetrics } from './api'
import { KEY_DEFS } from '../components/MapKey'
import { KIND } from '../components/ui'

const zm = (o: Partial<ZoneMetrics>): ZoneMetrics => ({ zone_nodes: 100, hospital_locations: 0, response_reach_locations: 50, cut_off_locations: 50, ems_locations: 0, supply_locations: 0, medical_support_locations: 0, water_rescue_locations: 0, helicopter_locations: 0, flood_exposed_locations: 40, debris_blocked: 3, debris_cleared: 0, ...o })
const rz = (before: Partial<ZoneMetrics>, after: Partial<ZoneMetrics>, remaining: ResultZone['remaining'] = []): ResultZone => {
  const b = zm(before), a = zm(after)
  const delta = Object.fromEntries(Object.keys(a).map((k) => [k, (a as never)[k] - (b as never)[k]])) as unknown as ZoneMetrics
  return { zone_id: 'z', name: 'Z', flooded_road_segments: 5, before: b, after: a, delta, resources: [], remaining }
}

describe('what improved / what still needs help', () => {
  it('reports only real positive changes, separately per coverage kind', () => {
    const l = improvedLines(rz({}, { cut_off_locations: 40, debris_blocked: 1, ems_locations: 30 }))
    expect(l).toEqual(['10 fewer locations cut off from the response base', '2 roads cleared of simulated debris', '+30 locations: EMS coverage'])
    expect(improvedLines(rz({}, {}))).toEqual([])
  })
  it('never lists hospital access from the 4 km model; emergency-department access comes from the regional calculation', () => {
    const z = rz({}, {}, [{ kind: 'hospital', count: 9, text: '9 of 100 locations cannot reach a hospital' }, { kind: 'cut_off', count: 5, text: '5 locations cut off' }])
    const l = stillNeedsLines(z, { nodes: 100, nodes_with_24h_ed_route: 60 })
    expect(l.some((t) => /cannot reach a hospital/.test(t))).toBe(false)
    expect(l).toContain('5 locations cut off')
    expect(l.some((t) => /40 of 100 locations cannot reach a verified 24-hour emergency department \(regional calculation/.test(t))).toBe(true)
    expect(stillNeedsLines(z, { nodes: 100, nodes_with_24h_ed_route: 100 }).length).toBe(1)
  })
  it('coverage rows no longer include the single-hospital metric', () => expect(COVERAGE_ROWS.map((c) => c.key)).not.toContain('hospital_locations'))
})

describe('multi-unit helpers', () => {
  const list: Assignment[] = [{ resource: 'ems_team', zone_id: 'a' }, { resource: 'debris_crew', zone_id: 'a' }, { resource: 'ems_team', zone_id: 'a' }, { resource: 'ems_team', zone_id: 'b' }]
  it('indexesIn returns the last matching unit first (the one the minus button removes)', () => {
    expect(indexesIn(list, 'ems_team', 'a')).toEqual([2, 0])
    expect(indexesIn(list, 'ems_team', 'b')).toEqual([3])
    expect(indexesIn(list, 'helicopter', 'a')).toEqual([])
    expect(indexesIn(list, 'ems_team', null)).toEqual([])
  })
  it('clearedRoads names the cleared obstructions and flags flood overlap', () => {
    const res = { roads: { debris: [{ id: 'D3-01', name: 'Ashbrook Street', cut_off_locations_if_blocked: 114, reason: 'debris' }, { id: 'D3-02', name: 'Oak Road', cut_off_locations_if_blocked: 8, reason: 'debris + flooding' }] } } as unknown as AllocationResult
    expect(clearedRoads(res, ['D3-02', 'nope', 'D3-01'])).toEqual([{ id: 'D3-02', name: 'Oak Road', reopened: 8, flooded: true }, { id: 'D3-01', name: 'Ashbrook Street', reopened: 114, flooded: false }])
  })
})

describe('map key and source labels', () => {
  it('key colors come from the same table as the map layers', () => {
    for (const l of LAYERS) expect(KEY_DEFS.find((d) => d.key === l.key)?.color).toBe(l.color)
  })
  it('every layer has a plain-English description and a source class; simulated items are never labelled real', () => {
    for (const d of KEY_DEFS) expect(d.desc.length).toBeGreaterThan(10)
    for (const k of ['debris', 'cleared', 'ems', 'supply', 'water', 'heli', 'medical']) expect(KEY_DEFS.find((d) => d.key === k)?.kind).toBe('simulated')
    expect(KEY_DEFS.find((d) => d.key === 'flood')?.kind).toBe('calculated')
    expect(KEY_DEFS.find((d) => d.key === 'ed')?.kind).toBe('real')
  })
  it('exact label vocabulary', () => expect(Object.values(KIND).map((k) => k.label)).toEqual(['REAL DATA', 'CALCULATED', 'SIMULATED']))
})
