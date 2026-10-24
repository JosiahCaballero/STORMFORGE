import { describe, expect, it } from 'vitest'
import { actionState, circlePolygon, cutOffLine, moveTo, pickDemoZone, regionBeforeAfter, removeAt, sameAllocation, stillCutOff } from './alloc'
import type { ActionHint, InventoryItem, ResultZone, SetupZone, ZoneMetrics } from './api'

const inv = (id: string, remaining: number, total = 2) => ({ id, label: id, action: '', total, used: total - remaining, remaining }) as InventoryItem
const hint = (resource: string, zone_id: string, valid: boolean, reason: string | null = null) => ({ id: `${resource}@${zone_id}`, resource, zone_id, zone_name: zone_id, valid, reason, message: valid ? 'ok' : 'No debris-blocked roads to clear here.', standalone_new_locations: 0, details: {} }) as ActionHint
const zm = (o: Partial<ZoneMetrics>): ZoneMetrics => ({ zone_nodes: 100, hospital_locations: 0, response_reach_locations: 50, cut_off_locations: 50, ems_locations: 0, supply_locations: 0, medical_support_locations: 0, water_rescue_locations: 0, helicopter_locations: 0, flood_exposed_locations: 40, debris_blocked: 3, debris_cleared: 0, ...o })

describe('actionState', () => {
  it('disables with a reason when inventory is exhausted', () => {
    const s = actionState('ems_team', 'lincolnville', [inv('ems_team', 0, 3)], null)
    expect(s.disabled).toBe(true); expect(s.reason).toMatch(/already assigned/)
  })
  it('requires a selected region', () => expect(actionState('ems_team', null, [inv('ems_team', 1)], null).disabled).toBe(true))
  it('hard-disables no_eligible_debris with the backend message', () => {
    const s = actionState('debris_crew', 'davis_shores', [inv('debris_crew', 2)], [hint('debris_crew', 'davis_shores', false, 'no_eligible_debris')])
    expect(s.disabled).toBe(true); expect(s.reason).toMatch(/No debris/)
  })
  it('soft-hints (still clickable) when another unit could unlock it', () => {
    const s = actionState('debris_crew', 'uptown_san_marco', [inv('debris_crew', 2)], [hint('debris_crew', 'uptown_san_marco', false, 'debris_not_reachable')])
    expect(s.disabled).toBe(false); expect(s.soft).toBe(true)
  })
  it('enabled when valid', () => expect(actionState('ems_team', 'west_augustine', [inv('ems_team', 3, 3)], [hint('ems_team', 'west_augustine', true)])).toEqual({ disabled: false, soft: false, reason: null }))
})

describe('allocation list helpers', () => {
  const l = [{ resource: 'ems_team', zone_id: 'a' }, { resource: 'debris_crew', zone_id: 'b' }] as const
  it('removeAt / moveTo (moved unit goes last)', () => {
    expect(removeAt([...l], 0)).toHaveLength(1)
    expect(moveTo([...l], 0, 'z')).toEqual([l[1], { resource: 'ems_team', zone_id: 'z' }])
  })
  it('sameAllocation ignores order', () => expect(sameAllocation([...l], [l[1], l[0]])).toBe(true))
})

describe('region summaries', () => {
  it('cutOffLine is plain English', () => {
    expect(cutOffLine({ cut_off_locations: 137, cut_off_pct: 30.5 } as SetupZone)).toBe('31% of locations cut off from help')
    expect(cutOffLine({ cut_off_locations: 0, cut_off_pct: 0 } as SetupZone)).toMatch(/No locations/)
  })
  it('regionBeforeAfter has at most 4 rows and picks changed coverage', () => {
    const z = { before: zm({}), after: zm({ cut_off_locations: 40, debris_blocked: 1, ems_locations: 174, supply_locations: 9, water_rescue_locations: 3 }) } as ResultZone
    const rows = regionBeforeAfter(z)
    expect(rows.length).toBe(4); expect(rows.map((r) => r.key)).toEqual(['cut', 'debris', 'ems_locations', 'supply_locations'])
  })
  it('stillCutOff sorts and drops zero', () => {
    const z = [{ name: 'A', zone_id: 'a', after: zm({ cut_off_locations: 0 }) }, { name: 'B', zone_id: 'b', after: zm({ cut_off_locations: 5 }) }, { name: 'C', zone_id: 'c', after: zm({ cut_off_locations: 9 }) }] as ResultZone[]
    expect(stillCutOff(z).map((x) => x.zone)).toEqual(['C', 'B'])
  })
})

describe('demo zone + geometry', () => {
  it('prefers West Augustine, else first zone with a valid crew', () => {
    const o = { attention_order: ['davis_shores', 'lincolnville', 'west_augustine'] }
    expect(pickDemoZone(o, [hint('debris_crew', 'west_augustine', true), hint('debris_crew', 'lincolnville', true)])).toBe('west_augustine')
    expect(pickDemoZone(o, [hint('debris_crew', 'west_augustine', false), hint('debris_crew', 'lincolnville', true)])).toBe('lincolnville')
    expect(pickDemoZone(o, [])).toBeNull()
  })
  it('circlePolygon closes and has ~500 m radius', () => {
    const p = circlePolygon(-81.3, 29.9, 500)
    expect(p[0]).toEqual(p[p.length - 1])
    expect(Math.abs((p[0][0] - -81.3) * 111320 * Math.cos(29.9 * Math.PI / 180))).toBeCloseTo(500, 0)
  })
})
