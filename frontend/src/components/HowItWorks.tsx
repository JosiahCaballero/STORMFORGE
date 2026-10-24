import type { Setup } from '../lib/api'
import { computeStats, type Cat, type RoadCollection } from '../lib/data'
import { useMemo } from 'react'

export function HowItWorks({ onClose, setup, roads, cat }: { onClose: () => void; setup: Setup | null; roads: RoadCollection | null; cat: Cat }) {
  const stats = useMemo(() => (roads && cat > 0 ? computeStats(roads, cat) : null), [roads, cat])
  const rows: [string, string][] = [
    ['The storm', 'NOAA NHC National Storm Surge Risk Maps v4 (June 2026): modeled high-tide surge “planning envelopes” for Category 1–5 hurricanes. They are not forecasts and not event-specific depths. A road segment counts as flooded when part of it is at least about 2 ft under water under this illustrative rule (OSM bridges are exempt; their deck heights are unknown).'],
    ['The roads', 'OpenStreetMap roads for central St. Augustine, treated as a network of road-network locations (intersections) joined by road segments. A “location” is a point on that network, not a person or household, and the numbers say nothing about population.'],
    ['What the model calculates', 'A network-analysis library (NetworkX) re-runs travel over the road network after every change you make. Clearing debris reopens segments; EMS and supply teams cover locations within 1.5 km of road travel; water-rescue teams screen flooded locations within 500 m of a road-reachable entry point; the helicopter targets one hypothetical cluster of up to 10 locations; the medical site covers locations with a route to it. Different kinds of coverage are never added together.'],
    ['Where the AI fits', 'Gemma only suggests where to send the same 11 units and explains why. The backend validates the suggestion and computes every number. If Gemma is not available, a clearly labeled deterministic fallback is shown instead. It is never presented as Gemma.'],
    ['Hypothetical inputs', 'The inventory (11 units), the simulated debris, the response base and the medical-site candidates are made up for this demo, and the six neighborhoods are provisional shapes, not official districts.'],
    ['Not claimed', 'No casualties, population coverage, observed outcomes, official closures, wind, rainfall or traffic. Educational simulator, not for real emergency decisions.'],
  ]
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="panel max-h-full w-full max-w-2xl overflow-y-auto p-5" style={{ background: '#0b1120' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="How it works">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">How it works</h2><button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 hover:bg-white/10">✕</button></div>
        <dl className="mt-3 space-y-3 text-[13px]">
          {rows.map(([k, v]) => (<div key={k}><dt className="label">{k}</dt><dd className="mt-0.5 leading-relaxed">{v}</dd></div>))}
          {setup && (
            <>
              <div><dt className="label">Response base (provisional)</dt><dd className="mt-0.5 leading-relaxed">{setup.base.label}. {setup.base.disclosure}</dd></div>
              <div><dt className="label">Assumptions reported by the model</dt><dd className="mt-0.5"><ul className="list-disc space-y-1 pl-5">{setup.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></dd></div>
            </>
          )}
          {stats && <div><dt className="label">Technical detail · Category {cat}</dt><dd className="mt-0.5 leading-relaxed">{stats.closedSegments.toLocaleString()} of {stats.segments.toLocaleString()} one-way road segments ({stats.closedPct.toFixed(0)}% of road length) are blocked by modeled flooding; two-way streets count twice.</dd></div>}
          <div><dt className="label">Attribution</dt><dd className="mt-0.5 leading-relaxed">Hazard: NOAA NHC SLOSH MOM storm-surge maps v4. Roads and hospital: © OpenStreetMap contributors. Basemap © CARTO. Map rendering: MapLibre GL.</dd></div>
        </dl>
      </div>
    </div>
  )
}
