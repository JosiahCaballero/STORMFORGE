import { useState } from 'react'
import { LAYERS, type LayerKey } from '../lib/alloc'
import { KIND, type Kind } from './ui'

type Sample = 'dash' | 'solid' | 'dots' | 'dot' | 'ring' | 'halo' | 'plus'
interface Def { key: LayerKey | 'passable' | 'ed'; label: string; color: string; sample: Sample; desc: string; kind: Kind; toggle: boolean }

const colorOf = (k: LayerKey) => LAYERS.find((l) => l.key === k)!.color
/** Colors come from LAYERS, the same table the map layers use, so key and map cannot drift apart. */
export const KEY_DEFS: Def[] = [
  { key: 'flood', label: 'Flood-exposed roads', color: colorOf('flood'), sample: 'dash', kind: 'calculated', toggle: true, desc: 'Roads blocked by modeled NOAA surge (about 2 ft or deeper).' },
  { key: 'passable', label: 'Passable roads', color: '#41577f', sample: 'solid', kind: 'calculated', toggle: false, desc: 'Roads not closed by modeled flooding.' },
  { key: 'debris', label: 'Simulated debris', color: colorOf('debris'), sample: 'dots', kind: 'simulated', toggle: true, desc: 'Hypothetical blockage on an otherwise open road.' },
  { key: 'cleared', label: 'Cleared roads', color: colorOf('cleared'), sample: 'solid', kind: 'simulated', toggle: true, desc: 'Debris removed by your crews. Flooded roads stay closed.' },
  { key: 'ems', label: 'EMS coverage', color: colorOf('ems'), sample: 'dot', kind: 'simulated', toggle: true, desc: 'Locations within 1.5 km of road travel from an EMS team.' },
  { key: 'supply', label: 'Supply coverage', color: colorOf('supply'), sample: 'dot', kind: 'simulated', toggle: true, desc: 'Locations that can drive to a supply point.' },
  { key: 'water', label: 'Potential water rescue', color: colorOf('water'), sample: 'ring', kind: 'simulated', toggle: true, desc: 'Flooded locations within 500 m of a rescue entry point.' },
  { key: 'heli', label: 'Potential helicopter rescue', color: colorOf('heli'), sample: 'halo', kind: 'simulated', toggle: true, desc: 'One hypothetical cluster of up to 10 locations.' },
  { key: 'medical', label: 'Medical support', color: colorOf('medical'), sample: 'dot', kind: 'simulated', toggle: true, desc: 'Locations with a route to the temporary medical site (not a hospital).' },
  { key: 'ed', label: 'Emergency departments', color: '#fbbf24', sample: 'plus', kind: 'real', toggle: false, desc: 'Verified 24-hour EDs. Amber = full-service hospital, cyan = freestanding ED.' },
]

function Swatch({ d }: { d: Def }) {
  const c = d.color
  return (
    <svg width="30" height="14" viewBox="0 0 30 14" aria-hidden className="shrink-0">
      {d.sample === 'dash' && <><line x1="2" y1="7" x2="28" y2="7" stroke={c} strokeWidth="7" strokeOpacity=".25" strokeLinecap="round" /><line x1="2" y1="7" x2="28" y2="7" stroke={c} strokeWidth="2.6" strokeDasharray="4 3" strokeLinecap="round" /></>}
      {d.sample === 'solid' && <line x1="2" y1="7" x2="28" y2="7" stroke={c} strokeWidth="3" strokeLinecap="round" />}
      {d.sample === 'dots' && <line x1="2" y1="7" x2="28" y2="7" stroke={c} strokeWidth="3.2" strokeDasharray="2 2.2" />}
      {d.sample === 'dot' && [6, 15, 24].map((x) => <circle key={x} cx={x} cy="7" r="3" fill={c} />)}
      {d.sample === 'ring' && <circle cx="15" cy="7" r="5.5" fill={`${c}22`} stroke={c} strokeWidth="1.6" strokeDasharray="3 2" />}
      {d.sample === 'halo' && <><circle cx="15" cy="7" r="6.5" fill={`${c}55`} /><circle cx="15" cy="7" r="2.6" fill="#fff" /></>}
      {d.sample === 'plus' && <><circle cx="15" cy="7" r="6" fill="#0b1120" stroke={c} strokeWidth="1.6" /><text x="15" y="10.6" textAnchor="middle" fontSize="10" fontWeight="700" fill={c}>+</text></>}
    </svg>
  )
}

/** Active key entries: layers that are on, plus base roads and emergency departments (always drawn). */
export function activeKeys(on: Set<LayerKey>): Def[] {
  return KEY_DEFS.filter((d) => (d.key === 'passable' || d.key === 'ed' ? true : on.has(d.key as LayerKey)))
}

/** Expandable map key. Shows only the items for layers that are on; "All layers" reveals the rest as toggles. */
export function MapKey({ on, onToggle, available, bottomReserve = 0 }: { on: Set<LayerKey>; onToggle: (k: LayerKey) => void; available: Record<LayerKey, boolean>; bottomReserve?: number }) {
  const [open, setOpen] = useState(true)
  const [all, setAll] = useState(false)
  const shown = all ? KEY_DEFS : activeKeys(on)
  return (
    <div className="panel absolute top-[64px] left-3 z-10 flex w-[262px] flex-col text-[12px]" style={{ maxHeight: `calc(100% - 64px - ${bottomReserve + 44}px)` }} aria-label="Map key">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5" style={{ borderRadius: 10 }}>
        <span className="label" style={{ letterSpacing: '.12em' }}>Map key</span>
        {!open && KEY_DEFS.filter((d) => d.toggle && on.has(d.key as LayerKey)).map((d) => <i key={d.key} title={d.label} className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />)}
        <span className="ml-auto" style={{ color: 'var(--mute)' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="overflow-y-auto border-t px-3 py-1.5" style={{ borderColor: 'var(--line)' }}>
          <ul>
            {shown.map((d) => {
              const isOn = d.toggle ? on.has(d.key as LayerKey) : true
              const none = d.toggle && !available[d.key as LayerKey]
              return (
                <li key={d.key} className="flex items-start gap-2 py-1" style={{ opacity: isOn ? 1 : 0.55 }}>
                  <Swatch d={d} />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">{d.label}</span>
                      <i title={KIND[d.kind].label} className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: KIND[d.kind].color }} />
                      {none && <span className="text-[10px]" style={{ color: 'var(--mute)' }}>none yet</span>}
                    </div>
                    <div className="text-[10.5px]" style={{ color: 'var(--mute)' }}>{d.desc}</div>
                  </div>
                  {d.toggle && all && <input type="checkbox" aria-label={`Show ${d.label}`} checked={isOn} onChange={() => onToggle(d.key as LayerKey)} className="mt-0.5 accent-cyan-400" />}
                </li>
              )
            })}
          </ul>
          <div className="mt-1 flex items-center justify-between border-t pt-1.5 text-[10.5px]" style={{ borderColor: 'rgba(255,255,255,.07)' }}>
            <span style={{ color: 'var(--mute)' }}>
              <i className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: KIND.real.color }} />real
              <i className="mr-1 ml-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: KIND.calculated.color }} />calc.
              <i className="mr-1 ml-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: KIND.simulated.color }} />simulated
            </span>
            <button onClick={() => setAll(!all)} aria-pressed={all} className="rounded border px-1.5 py-0.5 hover:bg-white/5" style={{ borderColor: 'var(--line)', color: 'var(--cyan)' }}>{all ? 'Active only' : 'All layers'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
