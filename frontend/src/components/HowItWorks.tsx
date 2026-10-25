import { useMemo } from 'react'
import type { RegionalBundle, Setup, Sources } from '../lib/api'
import { computeStats, type Cat, type RoadCollection } from '../lib/data'
import { SourceBadge } from './ui'

/** NOAA dataset chip for the header: always visible, opens the Data & Sources dialog. */
export function NoaaChip({ sources, onOpen }: { sources: Sources | null; onOpen: () => void }) {
  return (
    <button onClick={onOpen} aria-label="Data and sources: NOAA storm-surge data" title={sources?.noaa.revision_basis ?? 'NOAA SLOSH MOM v4 storm-surge data'}
      className="hidden min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1 text-left leading-tight hover:bg-white/5 lg:flex" style={{ borderColor: 'rgba(74,222,128,.4)' }}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px]" style={{ background: 'rgba(74,222,128,.14)', color: '#4ade80' }} aria-hidden>≈</span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-semibold">Powered by NOAA Storm-Surge Data</span>
        <span className="block truncate text-[10px]" style={{ color: 'var(--mute)' }}>{sources?.noaa.headline ?? 'SLOSH MOM v4 · 2026 revision'} · OpenStreetMap roads · NetworkX</span>
      </span>
    </button>
  )
}

export function HowItWorks({ onClose, setup, roads, cat, sources, regional }: { onClose: () => void; setup: Setup | null; roads: RoadCollection | null; cat: Cat; sources: Sources | null; regional: RegionalBundle | null }) {
  const stats = useMemo(() => (roads && cat > 0 ? computeStats(roads, cat) : null), [roads, cat])
  const rows: [string, string][] = [
    ['The storm', 'NOAA NHC National Storm Surge Risk Maps v4 (SLOSH MOM, high tide): modeled surge “planning envelopes” for Category 1–5 hurricanes. They are not forecasts and not event-specific depths. A road segment counts as flooded when part of it is at least about 2 ft under water under this illustrative rule (OSM bridges are exempt; their deck heights are unknown). NOAA does not report actual road closures, debris or rescue feasibility.'],
    ['The roads', 'OpenStreetMap roads for central St. Augustine, treated as a network of road-network locations (intersections) joined by road segments. A “location” is a point on that network, not a person or household, and the numbers say nothing about population.'],
    ['Emergency care access', 'Computed on a larger 6 km regional road network so the verified 24-hour emergency departments are properly connected. Each local location is the same OpenStreetMap node in both networks, and flood closures were checked to match edge by edge. Full-service hospital access, access to any 24-hour ED, and EMS coverage from your deployments are three different things and are never added together.'],
    ['What the allocation model calculates', 'A network-analysis library (NetworkX) re-runs travel over the 4 km road network after every change you make. Clearing debris reopens segments; EMS and supply teams cover locations within 1.5 km of road travel; water-rescue teams screen flooded locations within 500 m of a road-reachable entry point; the helicopter targets one hypothetical cluster of up to 10 locations; the medical site covers locations with a route to it.'],
    ['Where the AI fits', 'Gemma only suggests where to send the same 11 units and explains why. The backend validates the suggestion and computes every number. If Gemma is not available, a clearly labeled deterministic fallback is shown instead. It is never presented as Gemma.'],
    ['Hypothetical inputs', 'The inventory (11 units), the simulated debris (target counts grow with storm category and are illustrative, not empirical), the response base and the medical-site candidates are made up for this demo, and the six response zones are provisional shapes, not official districts. Bridge Corridor is a transportation/infrastructure response zone, not a residential neighborhood.'],
    ['Not claimed', 'No casualties, population coverage, response times, observed outcomes, official closures, wind, rainfall or traffic. Educational planning simulator, not an operational dispatch system and not for real emergency decisions.'],
  ]
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="panel max-h-full w-full max-w-2xl overflow-y-auto p-5" style={{ background: '#0b1120' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Data and sources">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Data &amp; Sources</h2><button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 hover:bg-white/10">✕</button></div>

        {sources && (
          <section className="mt-3 rounded-lg border p-3" style={{ borderColor: 'rgba(74,222,128,.45)', background: 'rgba(74,222,128,.06)' }} aria-label="NOAA dataset">
            <div className="flex items-center gap-2"><SourceBadge kind="real" /><span className="text-[15px] font-semibold">{sources.noaa.headline}</span></div>
            <div className="mt-1 text-[12.5px]">{sources.noaa.name}</div>
            <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--mute)' }}>{sources.noaa.revision_basis}</p>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--mute)' }}>{sources.noaa.local_processing}</p>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--mute)' }}>{sources.noaa.interpretation}</p>
            <a href={sources.noaa.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] underline" style={{ color: 'var(--cyan)' }}>nhc.noaa.gov/nationalsurge ↗</a>
          </section>
        )}

        {sources && (
          <>
            <ul className="mt-3 space-y-1 text-[13px]">{sources.plain_english.map((t) => <li key={t} className="flex gap-2"><span style={{ color: 'var(--cyan)' }}>›</span>{t}</li>)}</ul>
            <div className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Data classes">
              {sources.classes.map((c) => (
                <div key={c.id} className="rounded-lg border p-2.5 text-[12px]" style={{ borderColor: `${c.color}55` }}>
                  <SourceBadge kind={c.id} />
                  <p className="mt-1.5 leading-snug" style={{ color: 'var(--mute)' }}>{c.text}</p>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4">{c.items.map((i) => <li key={i}>{i}</li>)}</ul>
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-lg px-3 py-2 text-[12px] leading-relaxed" style={{ background: 'rgba(251,191,36,.08)' }}>{sources.separate_calculations}</p>
          </>
        )}

        <h3 className="label mt-4">Methodology details</h3>
        <dl className="mt-2 space-y-3 text-[13px]">
          {rows.map(([k, v]) => (<div key={k}><dt className="label">{k}</dt><dd className="mt-0.5 leading-relaxed">{v}</dd></div>))}
          {regional && (
            <div><dt className="label">Verified emergency departments (positions approximate; entrances unverified)</dt>
              <dd className="mt-0.5"><ul className="list-disc space-y-1 pl-5">{regional.access.facilities.map((f) => <li key={f.name}><b>{f.name}</b> — {f.facility_type === 'full_service_hospital' ? 'full-service hospital' : 'freestanding 24-hour ED'}; {Math.round(f.snap_distance_m)} m to nearest road node</li>)}</ul></dd></div>
          )}
          {setup && (
            <>
              <div><dt className="label">Response base (provisional)</dt><dd className="mt-0.5 leading-relaxed">{setup.base.label}. {setup.base.disclosure}</dd></div>
              <div><dt className="label">Assumptions reported by the allocation model</dt><dd className="mt-0.5"><ul className="list-disc space-y-1 pl-5">{setup.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></dd></div>
            </>
          )}
          {stats && <div><dt className="label">Technical detail · Category {cat}</dt><dd className="mt-0.5 leading-relaxed">{stats.closedSegments.toLocaleString()} of {stats.segments.toLocaleString()} one-way road segments ({stats.closedPct.toFixed(0)}% of road length) are blocked by modeled flooding; two-way streets count twice.</dd></div>}
          <div><dt className="label">Attribution</dt><dd className="mt-0.5 leading-relaxed">Hazard: NOAA NHC SLOSH MOM storm-surge maps v4. Roads: © OpenStreetMap contributors. Emergency departments: operator websites and OpenStreetMap. Basemap © CARTO. Map rendering: MapLibre GL.</dd></div>
        </dl>
      </div>
    </div>
  )
}
