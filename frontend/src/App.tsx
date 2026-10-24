import { useEffect, useMemo, useRef, useState } from 'react'
import { AgentsPanel, Badge, ResponsePanel, ZonePanel } from './components/Panels'
import { api, type Candidate, type EvalResult, type PlanResponse, type PlanStatus, type Zone } from './lib/api'
import MapView, { type FlyApi, type Selection } from './components/MapView'
import {
  CATS, computeStats, depthLabel, isArterial, roadStatus, type RoadState,
  type Cat, type CatStats, type Facility, type RoadCollection,
} from './lib/data'

const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })

function Kpi({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: 'coral' | 'cyan' | 'amber' }) {
  const color = tone === 'coral' ? 'var(--coral)' : tone === 'amber' ? 'var(--amber)' : tone === 'cyan' ? 'var(--cyan)' : 'var(--ink)'
  return (
    <div className="panel px-3 py-2.5">
      <div className="label">{label}</div>
      <div className="mono mt-1 text-[26px] leading-none font-semibold transition-colors" style={{ color }}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal" style={{ color: 'var(--mute)' }}>{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--mute)' }}>{sub}</div>}
    </div>
  )
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center gap-2 py-1 text-left text-xs">
      <span className="relative h-4 w-7 rounded-full transition-colors" style={{ background: on ? 'var(--cyan)' : '#27324d' }}>
        <span className="absolute top-0.5 h-3 w-3 rounded-full bg-[#060a13] transition-all" style={{ left: on ? 14 : 2 }} />
      </span>
      {children}
    </button>
  )
}

function Legend() {
  const ramp = 'linear-gradient(90deg,#7dd3fc,#38bdf8,#6366f1,#a855f7,#e879f9,#fdf4ff)'
  return (
    <div className="panel p-3">
      <div className="label mb-2">Legend</div>
      <div className="h-2 rounded-full" style={{ background: ramp }} />
      <div className="mono mt-1 flex justify-between text-[10px]" style={{ color: 'var(--mute)' }}>
        <span>shallow</span><span>NOAA depth bin</span><span>&gt;20 ft</span>
      </div>
      <ul className="mt-3 space-y-1.5 text-[11px]">
        <li className="flex items-center gap-2"><i className="inline-block h-1 w-6 rounded" style={{ background: 'var(--coral)', boxShadow: '0 0 8px var(--coral)' }} />Illustrative closure — major road</li>
        <li className="flex items-center gap-2"><i className="inline-block w-6 border-t-2 border-dashed" style={{ borderColor: 'var(--coral)' }} />Illustrative closure — local street</li>
        <li className="flex items-center gap-2"><i className="inline-block w-6 border-t-2 border-dotted" style={{ borderColor: 'var(--amber)' }} />OSM bridge (exempt from rule)</li>
        <li className="flex items-center gap-2"><i className="inline-block h-1 w-6 rounded" style={{ background: '#41577f' }} />Open / not exposed</li>
      </ul>
    </div>
  )
}

interface Access { category: number; nodes_with_route_pct: number; origins_with_route: number; origins_sampled: number }

function Compare({ all, cat, onPick, access }: { all: CatStats[]; cat: Cat; onPick: (c: Cat) => void; access: Access[] | null }) {
  const [mode, setMode] = useState<'roads' | 'access'>('roads')
  const val = (id: Cat) => (mode === 'roads' || !access ? all[id].closedPct : access[id].nodes_with_route_pct)
  return (
    <div className="panel p-3">
      <div className="mb-2 flex gap-1.5">
        {(['roads', 'access'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className="rounded px-2 py-0.5 text-[10px] tracking-wider uppercase" style={{ background: mode === m ? 'rgba(34,211,238,.14)' : 'transparent', color: mode === m ? 'var(--cyan)' : 'var(--mute)' }}>
            {m === 'roads' ? 'Roads closed' : 'Route to hospital*'}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        {CATS.map((c) => {
          const s = { closedPct: val(c.id) }
          const on = c.id === cat
          return (
            <button key={c.id} onClick={() => onPick(c.id)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-white/5" aria-label={`${c.label}: ${fmt(s.closedPct, 1)} percent`}>
              <span className="mono w-11 text-[10px]" style={{ color: on ? 'var(--cyan)' : 'var(--mute)' }}>{c.short}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-sm" style={{ background: '#141d33' }}>
                <span className="block h-full rounded-sm transition-all duration-500" style={{ width: `${s.closedPct}%`, background: mode === 'access' ? (on ? 'var(--cyan)' : '#245a66') : on ? 'var(--coral)' : '#7a3a4c' }} />
              </span>
              <span className="mono w-11 text-right text-[11px]" style={{ color: on ? 'var(--ink)' : 'var(--mute)' }}>{fmt(s.closedPct)}%</span>
            </button>
          )
        })}
      </div>
      {mode === 'access' && <div className="mt-2 text-[10px] leading-snug" style={{ color: 'var(--mute)' }}>*% of 1,820 graph nodes with an open directed route to the OSM-tagged hospital's nearest node. PROVISIONAL: single unverified destination, node ~356 m away; not population coverage.</div>}
    </div>
  )
}

const STATE_COLOR: Record<RoadState, string> = { closed: 'var(--coral)', 'bridge-exempt': 'var(--amber)', 'below-threshold': 'var(--ink)', 'no-noaa-value': 'var(--mute)' }

function Detail({ sel, cat, onClose, onLocate }: { sel: Selection; cat: Cat; onClose: () => void; onLocate: () => void }) {
  if (!sel) {
    return (
      <div className="panel p-3 text-xs" style={{ color: 'var(--mute)' }}>
        <div className="label mb-1">Inspector</div>
        Click any road to see its NOAA depth bin and illustrative closure status for every category.
      </div>
    )
  }
  if (sel.kind === 'facility') {
    const f = sel.facility
    return (
      <div className="panel p-3 text-xs">
        <div className="flex items-start justify-between"><div className="label">Facility · provisional</div><button onClick={onClose} className="text-[var(--mute)]" aria-label="Close">✕</button></div>
        <div className="mt-1 text-sm font-semibold">{f.name}</div>
        <p className="mt-2 leading-relaxed" style={{ color: 'var(--mute)' }}>
          OSM-tagged hospital. Emergency-department entrance <b className="text-[var(--amber)]">not verified</b>. It lies <span className="mono text-[var(--ink)]">{fmt(f.snap_m)} m</span> from its nearest graph node (dashed line) and just outside the current 4 km prototype network, so reachability to it is <b>provisional</b>.
        </p>
        <button onClick={onLocate} className="mt-2 rounded border border-[var(--line)] px-2 py-1 hover:bg-white/5">Fly to facility</button>
      </div>
    )
  }
  const p = sel.props
  return (
    <div className="panel p-3 text-xs">
      <div className="flex items-start justify-between"><div className="label">Road segment #{p.id}</div><button onClick={onClose} className="text-[var(--mute)]" aria-label="Close">✕</button></div>
      <div className="mt-1 text-sm font-semibold">{p.name || 'Unnamed road'}</div>
      <div className="mono mt-0.5 text-[11px]" style={{ color: 'var(--mute)' }}>
        {p.hw}{p.bridge ? ' · bridge (OSM)' : ''} · {fmt(p.len)} m · {isArterial(p.hw) ? 'major' : 'local'}
      </div>
      <table className="mono mt-2 w-full text-[11px]">
        <tbody>
          {CATS.slice(1).map((c) => {
            const st = roadStatus(p, c.id as 1 | 2 | 3 | 4 | 5)
            const bin = p[`b${c.id}`] as number
            return (
              <tr key={c.id} className={c.id === cat ? 'bg-white/5' : ''} title={st.detail}>
                <td className="py-0.5 pl-1" style={{ color: c.id === cat ? 'var(--cyan)' : 'var(--mute)' }}>{c.short}</td>
                <td>{bin > 0 ? depthLabel(bin) : '—'}</td>
                <td className="pr-1 text-right" style={{ color: STATE_COLOR[st.state] }}>{st.label}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-2 text-[10px] leading-snug" style={{ color: 'var(--mute)' }}>*Illustrative rule: ≥1 sample (~20 m) in NOAA bin ≥ 3 (≥ 2 ft lower bound). Not an observed or official closure. “No NOAA value” = NoData (unknown, not confirmed dry). Both travel directions of a street share one geometry and the same exposure.</div>
    </div>
  )
}

function Method({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Hazard data', 'NOAA NHC National Storm Surge Risk Maps v4 (June 2026 reprocessing), SLOSH MOM HIGH-tide inundation, Categories 1–5. Multi-storm planning envelopes — not forecasts, not event-specific depths.'],
    ['NoData', 'NOAA value 255 means unknown, not confirmed dry. Bins 1–20 are 1-ft classes; 21 is > 20 ft.'],
    ['Roads', 'OpenStreetMap contributors via OSMnx; 4,691 directed edges / 1,820 nodes in a ~4 km prototype graph. Segments sampled every ~20 m against each raster.'],
    ['Closure rule', 'ILLUSTRATIVE: a segment is “closed” if any sample falls in NOAA bin ≥ 3 (lower bound ≥ 2 ft). OSM bridge=yes edges are exempt; real deck heights are unknown, and this is not a structural assessment.'],
    ['Facilities', 'One OSM-tagged hospital. Emergency entrance unverified; nearest graph node ~356 m away. Medical accessibility is PROVISIONAL.'],
    ['Zones', 'Planned: five proposed neighborhood analysis zones + one Bridge Corridor infrastructure zone. Custom demo zones, not official districts. Not yet drawn.'],
    ['Not claimed', 'No population coverage, casualties, observed outcomes, official closures, wind effects, rainfall, or congestion. Educational simulator — not for real emergency decisions.'],
  ]
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="panel max-h-full w-full max-w-2xl overflow-y-auto p-5" style={{ background: '#0b1120' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Methodology and sources">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Methodology & sources</h2><button onClick={onClose} aria-label="Close">✕</button></div>
        <dl className="mt-3 space-y-3 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k}><dt className="label">{k}</dt><dd className="mt-0.5 leading-relaxed">{v}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  )
}

type Tab = 'impact' | 'zones' | 'response' | 'agents'
const TABS: { id: Tab; label: string }[] = [
  { id: 'impact', label: 'Impact' }, { id: 'zones', label: 'Zones' }, { id: 'agents', label: 'Modules' }, { id: 'response', label: 'Response' },
]
const STEPS: { n: number; label: string; tab: Tab; cat?: Cat }[] = [
  { n: 1, label: 'Select storm', tab: 'impact', cat: 3 },
  { n: 2, label: 'Inspect communities', tab: 'zones' },
  { n: 3, label: 'Module findings', tab: 'agents' },
  { n: 4, label: 'Gemma plan', tab: 'response' },
  { n: 5, label: 'Apply & verify', tab: 'response' },
]

export default function App() {
  const [cat, setCat] = useState<Cat>(3)
  const [roads, setRoads] = useState<RoadCollection | null>(null)
  const [facility, setFacility] = useState<Facility | null>(null)
  const [selected, setSelected] = useState<Selection>(null)
  const [showLocal, setShowLocal] = useState(true)
  const [showBridges, setShowBridges] = useState(true)
  const [basemap, setBasemap] = useState<boolean | null>(null)
  const [method, setMethod] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [access, setAccess] = useState<Access[] | null>(null)
  const [tab, setTab] = useState<Tab>('impact')
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [zones, setZones] = useState<Zone[] | null>(null)
  const [zoneSel, setZoneSel] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [applied, setApplied] = useState<string[]>([])
  const [evalRes, setEvalRes] = useState<EvalResult | null>(null)
  const [evalErr, setEvalErr] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planErr, setPlanErr] = useState<string | null>(null)
  const [planStatus, setPlanStatus] = useState<PlanStatus | null>(null)
  const [agentOpen, setAgentOpen] = useState<string | null>('medical')
  const [backendDown, setBackendDown] = useState(false)
  const fly = useRef<FlyApi | null>(null)

  useEffect(() => {
    fetch('/data/roads.geojson').then((r) => r.json()).then(setRoads).catch((e) => setErr(String(e)))
    fetch('/api/v1/scenarios').then((r) => r.json()).then(setAccess).catch(() => { setAccess(null); setBackendDown(true) })
    fetch('/data/facilities.json').then((r) => r.json()).then((f: Facility[]) => setFacility(f[0] ?? null)).catch(() => {})
    api.zones().then(setZones).catch(() => setZones(null))
    api.candidates().then(setCandidates).catch(() => setCandidates(null))
    api.planStatus().then(setPlanStatus).catch(() => setPlanStatus(null))
  }, [])

  useEffect(() => {
    let dead = false
    setEvalErr(null)
    api.evaluate(cat, applied).then((r) => !dead && setEvalRes(r)).catch((e) => !dead && setEvalErr(String(e)))
    return () => { dead = true }
  }, [cat, applied])

  useEffect(() => { setPlan(null); setPlanErr(null) }, [cat])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return
      if (/^[0-5]$/.test(e.key)) setCat(Number(e.key) as Cat)
      if (e.key === 'Escape') { setSelected(null); setMethod(false) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const all = useMemo(() => (roads ? CATS.map((c) => computeStats(roads, c.id)) : null), [roads])
  const s = all?.[cat]
  const toggle = (id: string) => setApplied((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))
  const recommended = plan?.plan.recommended_ids ?? []

  async function generate() {
    setPlanBusy(true); setPlanErr(null)
    try { setPlan(await api.generatePlan(cat, 3)) } catch (e) { setPlanErr(String(e)) } finally { setPlanBusy(false) }
  }
  const focusCandidate = (c: Candidate) => fly.current?.to(c.lon, c.lat, 15.8)
  const step = (st: (typeof STEPS)[number]) => { if (st.cat !== undefined) setCat(st.cat); setTab(st.tab); setRightOpen(true) }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView
        cat={cat} showLocal={showLocal} showBridges={showBridges} facility={facility} selected={selected} onSelect={setSelected} flyRef={fly} onBasemap={setBasemap}
        zones={zones} zoneSel={zoneSel} onZone={(id) => { setZoneSel(id); if (id) { setTab('zones'); setRightOpen(true) } }}
        candidates={candidates} applied={applied} recommended={recommended} onCandidate={toggle}
      />
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(6,10,19,.7) 100%)' }} />

      <header className="panel absolute top-3 right-3 left-3 z-10 flex items-center gap-4 px-4 py-2">
        <div>
          <div className="text-[17px] font-bold tracking-[.22em]">STORM<span style={{ color: 'var(--cyan)' }}>FORGE</span></div>
          <div className="text-[10px] tracking-wide" style={{ color: 'var(--mute)' }}>Critical Access Intelligence · St. Augustine, FL</div>
        </div>
        <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex" aria-label="Demo flow">
          {STEPS.map((st) => (
            <button key={st.n} onClick={() => step(st)} className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] hover:bg-white/5" style={{ color: tab === st.tab ? 'var(--cyan)' : 'var(--mute)' }}>
              <span className="mono grid h-4 w-4 place-items-center rounded-full border text-[9px]" style={{ borderColor: 'currentColor' }}>{st.n}</span>{st.label}
            </button>
          ))}
        </nav>
        <span className="rounded border px-2 py-1 text-[10px] tracking-wider uppercase" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>Educational simulator · not for emergency decisions</span>
        <button onClick={() => setMethod(true)} className="rounded border border-[var(--line)] px-3 py-1 text-xs hover:bg-white/5">Methodology</button>
      </header>

      <button onClick={() => setLeftOpen(!leftOpen)} aria-label="Toggle left panel" title="Toggle left panel" className="panel absolute top-[84px] z-20 h-7 w-5 text-[11px] hover:bg-white/10" style={{ left: leftOpen ? 266 : 4 }}>{leftOpen ? '‹' : '›'}</button>
      <button onClick={() => setRightOpen(!rightOpen)} aria-label="Toggle right panel" title="Toggle right panel" className="panel absolute top-[84px] z-20 h-7 w-5 text-[11px] hover:bg-white/10" style={{ right: rightOpen ? 316 : 4 }}>{rightOpen ? '›' : '‹'}</button>

      {leftOpen && (
        <aside className="absolute top-[76px] bottom-10 left-3 z-10 flex w-[250px] flex-col gap-3 overflow-y-auto">
          <div className="panel p-3">
            <div className="label mb-2">Hurricane category · surge envelope</div>
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Hurricane category">
              {CATS.map((c) => (
                <button
                  key={c.id} role="radio" aria-checked={cat === c.id} onClick={() => setCat(c.id)}
                  className="mono rounded border py-2 text-xs font-semibold transition-all"
                  style={{
                    borderColor: cat === c.id ? 'var(--cyan)' : 'var(--line)',
                    background: cat === c.id ? 'rgba(34,211,238,.14)' : 'transparent',
                    color: cat === c.id ? 'var(--cyan)' : 'var(--mute)',
                    boxShadow: cat === c.id ? '0 0 14px rgba(34,211,238,.25)' : 'none',
                  }}
                >{c.id === 0 ? 'BASE' : `CAT ${c.id}`}</button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug" style={{ color: 'var(--mute)' }}>
              NOAA SLOSH MOM high-tide planning envelope — <b>not a forecast</b>. Keys 0–5 switch category.
            </p>
          </div>
          <Legend />
          <div className="panel p-3">
            <div className="label mb-1">Layers</div>
            <Toggle on={showLocal} onChange={setShowLocal}>Local streets (zoom in for detail)</Toggle>
            <Toggle on={showBridges} onChange={setShowBridges}>OSM bridges</Toggle>
            <div className="mt-2 flex gap-2">
              <button onClick={() => fly.current?.home()} className="flex-1 rounded border border-[var(--line)] py-1 text-[11px] hover:bg-white/5">Reset view</button>
              {facility && <button onClick={() => fly.current?.to(facility.lon, facility.lat, 14.6)} className="flex-1 rounded border border-[var(--line)] py-1 text-[11px] hover:bg-white/5">Locate hospital</button>}
            </div>
          </div>
        </aside>
      )}

      {rightOpen && (
        <aside className="absolute top-[76px] right-3 bottom-10 z-10 flex w-[300px] flex-col gap-3 overflow-y-auto">
          <div className="panel flex items-center justify-between px-3 py-2">
            <div>
              <div className="label">Scenario</div>
              <div className="text-sm font-semibold">{CATS[cat].label}{cat === 0 ? '' : ' envelope'}</div>
            </div>
            <Badge tone="amber">Derived · illustrative</Badge>
          </div>
          <div className="grid grid-cols-4 gap-1" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="panel py-1.5 text-[11px] font-semibold" style={{ color: tab === t.id ? 'var(--cyan)' : 'var(--mute)', borderColor: tab === t.id ? 'var(--cyan)' : 'var(--line)' }}>{t.label}</button>
            ))}
          </div>
          {backendDown && <div className="panel p-2 text-[11px]" style={{ color: 'var(--amber)' }}>Backend not reachable — start it (uvicorn, port 8000). Map exposure still works; simulation panels need the API.</div>}

          {tab === 'impact' && (s && all ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Kpi label="Closed · directed length" value={cat === 0 ? '0' : fmt(s.closedPct)} unit="%" tone={cat === 0 ? undefined : 'coral'} sub={`${fmt(s.closedSegments)} of ${fmt(s.segments)} directed edges · two-way streets count twice`} />
                <Kpi label="NOAA-valued · directed length" value={cat === 0 ? '0' : fmt(s.exposedPct)} unit="%" tone="cyan" sub={`${fmt(s.exposedKm, 0)} of ${fmt(s.lenKm, 0)} directed-km with any NOAA inundation value; rest is NoData (unknown)`} />
                <Kpi label="Major edges closed" value={fmt(s.arterialClosed)} unit={`/ ${fmt(s.arterialTotal)}`} tone={s.arterialClosed ? 'coral' : undefined} sub="directed edges: trunk · primary · secondary · tertiary" />
                <Kpi label="Bridge-exempt" value={fmt(s.bridgesExempt)} tone="amber" sub="would close by raw rule; deck height unknown" />
              </div>
              {access && (
                <Kpi label="Graph nodes with hospital route · provisional" value={fmt(access[cat].nodes_with_route_pct)} unit="%" tone={access[cat].nodes_with_route_pct < 50 ? 'coral' : 'cyan'} sub={`all 1,820 nodes (headline) · ${access[cat].origins_with_route}/${access[cat].origins_sampled} fixed sample origins · one unverified hospital snap; network-bounded, not population coverage. Zero modeled access ≠ zero real-world care.`} />
              )}
              <Compare all={all} cat={cat} onPick={setCat} access={access} />
              <Detail sel={selected} cat={cat} onClose={() => setSelected(null)} onLocate={() => facility && fly.current?.to(facility.lon, facility.lat, 14.6)} />
            </>
          ) : (
            <div className="panel p-3 text-xs" style={{ color: err ? 'var(--coral)' : 'var(--mute)' }}>{err ?? 'Loading NOAA-derived road exposure…'}</div>
          ))}

          {tab === 'zones' && <ZonePanel zones={zones} sel={zoneSel} onSel={setZoneSel} cat={cat} applied={applied} />}
          {tab === 'agents' && <AgentsPanel cat={cat} applied={applied} plan={plan} open={agentOpen} setOpen={setAgentOpen} />}
          {tab === 'response' && (
            <ResponsePanel
              cat={cat} candidates={candidates} applied={applied} recommended={recommended} onToggle={toggle} onSet={setApplied} onFocus={focusCandidate}
              evalRes={evalRes} evalErr={evalErr} plan={plan} planBusy={planBusy} planErr={planErr} planStatus={planStatus} onGenerate={generate}
              onCite={(a) => { setAgentOpen(a); setTab('agents') }}
            />
          )}
        </aside>
      )}

      <footer className="absolute bottom-2 left-3 z-10 text-[10px]" style={{ color: 'var(--mute)' }}>
        <span>Hazard: NOAA NHC SLOSH MOM v4 (Jun 2026) · Roads: © OpenStreetMap contributors{basemap === false ? ' · basemap offline (roads-only mode)' : ' · basemap © CARTO'} · Zones &amp; staging sites are hypothetical demo constructs</span>
      </footer>
      {method && <Method onClose={() => setMethod(false)} />}
    </div>
  )
}
