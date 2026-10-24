export type Cat = 0 | 1 | 2 | 3 | 4 | 5

export interface RoadProps {
  id: number
  name: string | null
  hw: string
  len: number
  bridge: boolean
  [k: string]: string | number | boolean | null
}
export interface RoadCollection {
  features: { properties: RoadProps }[]
}
export interface Facility {
  name: string
  lon: number
  lat: number
  snap_lon: number
  snap_lat: number
  snap_m: number
  source: string
  verified: boolean
}

export const ARTERIAL = ['trunk', 'primary', 'secondary', 'tertiary', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']
export const isArterial = (hw: string) => ARTERIAL.includes(hw)

export const CATS: { id: Cat; label: string; short: string }[] = [
  { id: 0, label: 'Baseline', short: 'BASE' },
  { id: 1, label: 'Category 1', short: 'CAT 1' },
  { id: 2, label: 'Category 2', short: 'CAT 2' },
  { id: 3, label: 'Category 3', short: 'CAT 3' },
  { id: 4, label: 'Category 4', short: 'CAT 4' },
  { id: 5, label: 'Category 5', short: 'CAT 5' },
]

/** NOAA bins: 1-20 = 1-ft bins, 21 = >20 ft. */
export const depthLabel = (bin: number) => (bin <= 0 ? 'none sampled' : bin > 20 ? '> 20 ft' : `≤ ${bin} ft`)

export interface CatStats {
  segments: number
  closedSegments: number
  exposedSegments: number
  lenKm: number
  closedKm: number
  exposedKm: number
  arterialClosed: number
  arterialTotal: number
  bridgesExempt: number
  closedPct: number
  exposedPct: number
}

export function computeStats(fc: RoadCollection, cat: Cat): CatStats {
  const s: CatStats = {
    segments: 0, closedSegments: 0, exposedSegments: 0, lenKm: 0, closedKm: 0, exposedKm: 0,
    arterialClosed: 0, arterialTotal: 0, bridgesExempt: 0, closedPct: 0, exposedPct: 0,
  }
  for (const { properties: p } of fc.features) {
    const art = isArterial(p.hw)
    s.segments++
    s.lenKm += p.len / 1000
    if (art) s.arterialTotal++
    if (cat === 0) continue
    if ((p[`f${cat}`] as number) > 0) {
      s.exposedSegments++
      s.exposedKm += p.len / 1000
    }
    if (p[`c${cat}`] === 1) {
      s.closedSegments++
      s.closedKm += p.len / 1000
      if (art) s.arterialClosed++
    } else if (p[`r${cat}`] === 1) s.bridgesExempt++
  }
  s.closedPct = (100 * s.closedKm) / s.lenKm
  s.exposedPct = (100 * s.exposedKm) / s.lenKm
  return s
}
