import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { roadStatus, computeStats, type RoadProps, type RoadCollection } from './data'

const fc = JSON.parse(fs.readFileSync('public/data/roads.geojson', 'utf8')) as RoadCollection
const props = (o: Partial<RoadProps>): RoadProps => ({ id: 1, name: 'x', hw: 'residential', len: 10, bridge: false, ...o }) as RoadProps

describe('roadStatus', () => {
  it('closed when c=1', () => expect(roadStatus(props({ c3: 1, r3: 1, b3: 12 }), 3).state).toBe('closed'))
  it('bridge exempt when raw closed but not closed', () => expect(roadStatus(props({ c3: 0, r3: 1, b3: 12 }), 3).state).toBe('bridge-exempt'))
  it('shallow is open under rule', () => expect(roadStatus(props({ c1: 0, r1: 0, b1: 2, f1: 0.4 }), 1).state).toBe('below-threshold'))
  it('NoData is never labelled plain open', () => {
    const s = roadStatus(props({ c1: 0, r1: 0, b1: 0, f1: 0 }), 1)
    expect(s.state).toBe('no-noaa-value'); expect(s.label).not.toMatch(/^open/i)
  })
})

describe('real data consistency', () => {
  it('status agrees with source flags for every feature and category', () => {
    for (const { properties: p } of fc.features) for (const k of [1, 2, 3, 4, 5] as const) {
      const st = roadStatus(p, k).state
      expect(st === 'closed').toBe(p[`c${k}`] === 1)
      if (p[`c${k}`] === 0 && (p[`b${k}`] as number) >= 3) expect(p.bridge).toBe(true) // only bridges may be >=3 yet open
    }
  })
  it('not every road is closed: Cat 1 has open and NoData segments', () => {
    const s = computeStats(fc, 1)
    expect(s.closedSegments).toBe(1615)
    expect(s.segments - s.closedSegments).toBeGreaterThan(2000)
    const states = new Set(fc.features.map((f) => roadStatus(f.properties, 1).state))
    expect(states).toEqual(new Set(['closed', 'bridge-exempt', 'below-threshold', 'no-noaa-value']))
  })
  it('closed counts match engine summary per category', () => {
    const ref = [0, 1615, 2787, 3255, 3568, 3712]
    for (const k of [1, 2, 3, 4, 5] as const) expect(computeStats(fc, k).closedSegments).toBe(ref[k])
  })
})
