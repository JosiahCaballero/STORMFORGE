import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, type ActionHint, type AllocationResult, type Assignment, type Compared, type GemmaPlan, type Marginal, type PlacedAssignment, type RegionalBundle, type ResourceId, type Setup, type Sources, type ZoneGeo } from './lib/api'
import { layersFor, moveTo, pctCutOff, pickDemoZone, removeAt, RES, sameAllocation, type LayerKey } from './lib/alloc'
import { CATS, edgeGeometry, edgesInfo, type Cat, type EdgeGeo, type Facility, type RoadCollection } from './lib/data'
import MapView, { type FlyApi } from './components/MapView'
import { ImpactTab, DeployTab } from './components/ImpactDeploy'
import { CompareTab } from './components/CompareTab'
import { DemoCoach, Welcome } from './components/DemoCoach'
import { HowItWorks, NoaaChip } from './components/HowItWorks'
import { MapKey } from './components/MapKey'

type Tab = 'impact' | 'deploy' | 'compare'
const TABS: { id: Tab; label: string }[] = [{ id: 'impact', label: 'Impact' }, { id: 'deploy', label: 'Deploy' }, { id: 'compare', label: 'Compare' }]
const DEFAULT_LAYERS: LayerKey[] = ['flood', 'debris']
const COVER: LayerKey[] = ['ems', 'supply', 'water', 'heli', 'medical']
const PANEL_W = 384
const STORED = 'sf_welcomed'

interface Toast { id: number; text: string; tone: 'ok' | 'warn' }

const errText = (e: unknown) => {
  if (e instanceof ApiError) return e.status === 404 ? 'the Gemma planner is not available on this server' : e.status === 429 ? 'please wait a moment and try again' : e.message
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'the request took too long'
  return e instanceof Error ? e.message : String(e)
}

export default function App() {
  const [cat, setCat] = useState<Cat>(3)
  const [tab, setTab] = useState<Tab>('impact')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [hints, setHints] = useState<ActionHint[] | null>(null)
  const [assign, setAssign] = useState<Assignment[]>([])
  const [result, setResult] = useState<AllocationResult | null>(null)
  const [backup, setBackup] = useState<Assignment[] | null>(null)
  const [plan, setPlan] = useState<GemmaPlan | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planErr, setPlanErr] = useState<string | null>(null)
  const [cmp, setCmp] = useState<Compared | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [zoneSel, setZoneSel] = useState<string | null>(null)
  const [layers, setLayers] = useState<Set<LayerKey>>(new Set(DEFAULT_LAYERS))
  const [toast, setToast] = useState<Toast | null>(null)
  const [busy, setBusy] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [howOpen, setHowOpen] = useState(false)
  const [basemap, setBasemap] = useState<boolean | null>(null)
  const [zonesGeo, setZonesGeo] = useState<ZoneGeo[] | null>(null)
  const [roads, setRoads] = useState<RoadCollection | null>(null)
  const [geo, setGeo] = useState<EdgeGeo | null>(null)
  const [facility, setFacility] = useState<Facility | null>(null)
  const [regional, setRegional] = useState<RegionalBundle | null>(null)
  const [regionalErr, setRegionalErr] = useState(false)
  const [sources, setSources] = useState<Sources | null>(null)
  const [marginal, setMarginal] = useState<Marginal | null>(null)
  const [welcome, setWelcome] = useState(() => { try { return localStorage.getItem(STORED) !== '1' } catch { return true } })
  const [demo, setDemo] = useState(false)
  const [step, setStep] = useState(1)
  const [demoBusy, setDemoBusy] = useState(false)
  const [demoErr, setDemoErr] = useState<string | null>(null)
  const [demoZone, setDemoZone] = useState<string | null>(null)
  const fly = useRef<FlyApi | null>(null)

  // latest values for async handlers
  const epoch = useRef(0)
  const R = useRef({ cat, assign, backup, setup, hints, zoneSel, geo, zonesGeo, plan })
  R.current = { cat, assign, backup, setup, hints, zoneSel, geo, zonesGeo, plan }
  const busyRef = useRef(false)
  const toastId = useRef(0)

  useEffect(() => {
    fetch('/data/roads.geojson').then((r) => r.json()).then((fc: RoadCollection) => { setRoads(fc); setGeo(edgeGeometry(fc)) }).catch((e) => setLoadErr(String(e)))
    fetch('/data/facilities.json').then((r) => r.json()).then((f: Facility[]) => setFacility(f[0] ?? null)).catch(() => {})
    api.zoneGeo().then(setZonesGeo).catch(() => setZonesGeo(null))
    api.sources().then(setSources).catch(() => setSources(null))
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast((c) => (c?.id === toast.id ? null : c)), 9000)
    return () => clearTimeout(t)
  }, [toast])
  const say = useCallback((text: string, tone: Toast['tone'] = 'ok') => setToast({ id: ++toastId.current, text, tone }), [])

  const commit = (list: Assignment[], res: AllocationResult) => { R.current.assign = list; setAssign(list); setResult(res) }

  /* ---------------------------------------------------------- category */
  const loadCategory = useCallback(async (c: Cat): Promise<{ setup: Setup; hints: ActionHint[] } | null> => {
    const my = ++epoch.current
    R.current.cat = c; R.current.assign = []; R.current.backup = null; R.current.setup = null; R.current.hints = null; R.current.plan = null
    setCat(c); setLoading(true); setLoadErr(null)
    setAssign([]); setBackup(null); setPlan(null); setPlanErr(null); setCmp(null); setResult(null); setSetup(null); setHints(null)
    setRegional(null); setRegionalErr(false); setMarginal(null)
    api.regional(c).then((b) => { if (my === epoch.current) setRegional(b) }).catch(() => { if (my === epoch.current) setRegionalErr(true) })
    setLayers(new Set(DEFAULT_LAYERS))
    try {
      const [s, h, r] = await Promise.all([api.setup(c), api.actions(c), api.evaluate(c, [])])
      if (my !== epoch.current) return null
      R.current.setup = s; R.current.hints = h
      setSetup(s); setHints(h); setResult(r); setLoading(false)
      return { setup: s, hints: h }
    } catch (e) {
      if (my === epoch.current) { setLoadErr(`Could not load this storm: ${errText(e)}. Is the backend running on port 8000?`); setLoading(false) }
      return null
    }
  }, [])
  useEffect(() => { void loadCategory(3) }, [loadCategory])

  const assignKey = JSON.stringify(assign.map((a) => [a.resource, a.zone_id]))
  useEffect(() => {
    if (tab !== 'deploy' || !zoneSel || loading) return
    let dead = false
    api.marginal(cat, zoneSel, R.current.assign).then((m) => !dead && setMarginal(m)).catch(() => !dead && setMarginal(null))
    return () => { dead = true }
  }, [tab, zoneSel, cat, assignKey, loading])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      if (/^[1-5]$/.test(e.key) && !busyRef.current) void loadCategory(Number(e.key) as Cat)
      if (e.key === 'Escape') { setHowOpen(false); setZoneSel(null) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [loadCategory])

  /* ---------------------------------------------------------- map helpers */
  const enable = (keys: LayerKey[], exclusiveCoverage = false) =>
    setLayers((prev) => {
      const n = new Set(prev)
      if (exclusiveCoverage && keys.some((k) => COVER.includes(k))) COVER.forEach((k) => n.delete(k))
      keys.forEach((k) => n.add(k))
      return n
    })
  const toggleLayer = (k: LayerKey) => setLayers((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const selectZone = useCallback((id: string | null) => {
    setZoneSel(id)
    R.current.zoneSel = id
    if (!id) return
    const g = R.current.zonesGeo?.find((z) => z.id === id)
    if (g?.boundary) fly.current?.fit(g.boundary.coordinates[0] as [number, number][], 15.4)
    else if (g) fly.current?.to(g.center[0], g.center[1], 15.2)
  }, [])

  /** Frame what a just-placed unit changed, then pulse it. */
  function focusOn(res: AllocationResult, e: PlacedAssignment) {
    const z = e.zone_id
    let pts: [number, number][] = []
    if (e.resource === 'debris_crew') pts = R.current.geo ? edgesInfo(R.current.geo, ((e.details?.cleared_edge_ids as number[]) ?? [])).pts : []
    else {
      const L = res.layers
      const pick = { ems: L.ems, supply: L.supply, medical: L.medical } as Record<string, { zone_id: string; point: [number, number]; coverage: [number, number][] }[]>
      if (pick[e.resource === 'ems_team' ? 'ems' : e.resource === 'supply_team' ? 'supply' : 'medical'] && e.resource !== 'water_rescue' && e.resource !== 'helicopter') {
        const arr = pick[e.resource === 'ems_team' ? 'ems' : e.resource === 'supply_team' ? 'supply' : 'medical']
        arr.filter((u) => u.zone_id === z).forEach((u) => pts.push(u.point, ...u.coverage))
      } else if (e.resource === 'water_rescue') L.water.filter((u) => u.zone_id === z).forEach((u) => pts.push(u.point, ...u.targets))
      else L.helicopter.filter((u) => u.zone_id === z).forEach((u) => pts.push(u.point, ...u.cluster))
    }
    if (pts.length) { fly.current?.fit(pts, 15.4); setTimeout(() => fly.current?.pulse(), 1500) }
  }

  /* ---------------------------------------------------------- deploy */
  async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busyRef.current) return undefined
    busyRef.current = true; setBusy(true)
    try { return await fn() } catch (e) { say(`Could not reach the simulator (${errText(e)}). Nothing was changed.`, 'warn') } finally { busyRef.current = false; setBusy(false) }
    return undefined
  }

  /** Try a new allocation whose last entry is the change under test. Commits only if that entry is placed. */
  async function tryList(list: Assignment[], resource: ResourceId) {
    const my = epoch.current
    const res = await api.evaluate(R.current.cat, list)
    if (my !== epoch.current) return
    const e = res.assignments.find((a) => a.index === list.length - 1)
    if (e && e.status === 'placed') {
      commit(list, res); say(e.message, 'ok'); enable(layersFor(resource), true); focusOn(res, e)
    } else say(e?.message ?? 'That could not be placed.', 'warn')
  }

  const deploy = (resource: ResourceId) => {
    const zone = R.current.zoneSel
    if (!zone) return say('Select a neighborhood first.', 'warn')
    return guarded(() => tryList([...R.current.assign, { resource, zone_id: zone }], resource))
  }
  const remove = (i: number) => guarded(async () => {
    const my = epoch.current
    const a = R.current.assign[i]
    const list = removeAt(R.current.assign, i)
    const res = await api.evaluate(R.current.cat, list)
    if (my !== epoch.current) return
    commit(list, res); say(`${RES[a.resource].short} removed. The unit is back in your inventory.`, 'ok')
  })
  const move = (i: number, zone: string) => guarded(() => tryList(moveTo(R.current.assign, i, zone), R.current.assign[i].resource))
  const reset = (quiet = false) => guarded(async () => {
    const my = epoch.current
    const res = await api.evaluate(R.current.cat, [])
    if (my !== epoch.current) return
    R.current.backup = null; setBackup(null); commit([], res); setLayers(new Set(DEFAULT_LAYERS))
    if (!quiet) say('Allocation cleared. All 11 units are available again.', 'ok')
  })

  /* ---------------------------------------------------------- Gemma */
  const generate = useCallback(async (): Promise<GemmaPlan | null> => {
    if (busyRef.current) return null
    const my = epoch.current
    setPlanBusy(true); setPlanErr(null)
    try {
      const p = await api.gemmaPlan(R.current.cat, R.current.backup ?? R.current.assign)
      if (my !== epoch.current) return null
      R.current.plan = p; setPlan(p); return p
    } catch (e) {
      if (my === epoch.current) setPlanErr(errText(e))
      return null
    } finally { setPlanBusy(false) }
  }, [])

  const mine = backup ?? assign
  const mineKey = JSON.stringify(mine.map((a) => [a.resource, a.zone_id]))
  useEffect(() => {
    if (!plan) { setCmp(null); return }
    let dead = false
    api.compare(cat, [{ label: 'mine', assignments: mine }, { label: 'gemma', assignments: plan.verified.assignments }]).then((c) => !dead && setCmp(c)).catch(() => !dead && setCmp(null))
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, mineKey, cat])

  const applyGemma = () => {
    const p = R.current.plan
    if (!p) return
    const keep = R.current.backup ?? R.current.assign
    R.current.backup = keep; setBackup(keep)
    commit(p.verified.assignments, p.verified.result)
    setLayers(new Set<LayerKey>(['flood', 'debris', ...(p.verified.result.roads.cleared_edge_ids.length ? (['cleared'] as LayerKey[]) : []), ...p.verified.assignments.flatMap((a) => (a.resource === 'debris_crew' ? [] : layersFor(a.resource))).slice(0, 2)]))
    say('Gemma’s plan is now on the map. “Restore My Plan” brings yours back.', 'ok')
  }
  const restoreMine = () => guarded(async () => {
    const b = R.current.backup
    if (!b) return
    const my = epoch.current
    const res = await api.evaluate(R.current.cat, b)
    if (my !== epoch.current) return
    R.current.backup = null; setBackup(null); commit(b, res); say('Your own plan is restored.', 'ok')
  })
  const gemmaApplied = backup !== null && !!plan && sameAllocation(assign, plan.verified.assignments)

  /* ---------------------------------------------------------- guided demo */
  async function setAllocation(list: Assignment[]): Promise<AllocationResult | null> {
    const my = epoch.current
    let res = await api.evaluate(R.current.cat, list)
    if (my !== epoch.current) return null
    const keep = list.filter((_, i) => res.assignments.find((a) => a.index === i)?.status === 'placed')
    if (keep.length !== list.length) { list = keep; res = await api.evaluate(R.current.cat, list); if (my !== epoch.current) return null }
    commit(list, res)
    return res
  }

  async function runStep(n: number) {
    if (busyRef.current) return
    busyRef.current = true; setDemoBusy(true); setDemoErr(null); setDemo(true); setStep(n); setBusy(true)
    try {
      let ctx = R.current.setup && R.current.hints && R.current.cat === 3 ? { setup: R.current.setup, hints: R.current.hints } : null
      if (!ctx) { busyRef.current = false; ctx = await loadCategory(3); busyRef.current = true }
      if (!ctx) throw new Error('Could not load Category 3. Check that the backend is running.')
      if (n === 1) {
        if (R.current.assign.length || R.current.backup) { const res = await api.evaluate(3, []); R.current.backup = null; setBackup(null); commit([], res) }
        setPlan(null); R.current.plan = null; setPlanErr(null)
        setLayers(new Set(DEFAULT_LAYERS)); setTab('impact'); setZoneSel(null); fly.current?.home(); return
      }
      const zid = pickDemoZone(ctx.setup, ctx.hints) ?? ctx.setup.attention_order[0]
      setDemoZone(zid); setTab(n === 5 ? 'compare' : 'deploy')
      if (n === 2) { selectZone(zid); setLayers(new Set(DEFAULT_LAYERS)); await setAllocation([]); return }
      if (R.current.zoneSel !== zid) selectZone(zid)
      const hintOk = (r: ResourceId, z: string) => ctx!.hints.some((h) => h.resource === r && h.zone_id === z && h.valid)
      const crew: Assignment[] = hintOk('debris_crew', zid) ? [{ resource: 'debris_crew', zone_id: zid }] : []
      if (n === 3) {
        const res = await setAllocation(crew)
        const e = res?.assignments.find((a) => a.resource === 'debris_crew' && a.status === 'placed')
        setLayers(new Set<LayerKey>(['flood', 'debris', 'cleared']))
        if (e && res) { say(e.message); focusOn(res, e) } else setDemoErr('No debris crew could be placed in this neighborhood.')
        return
      }
      const list: Assignment[] = [...crew, { resource: 'ems_team', zone_id: zid }]
      if (hintOk('water_rescue', 'lincolnville') && zid !== 'lincolnville') list.push({ resource: 'water_rescue', zone_id: 'lincolnville' })
      if (n === 4 || !sameAllocation(R.current.assign, list)) {
        const res = await setAllocation(list)
        const e = res?.assignments.find((a) => a.resource === 'ems_team' && a.status === 'placed')
        setLayers(new Set<LayerKey>(['flood', 'cleared', 'ems', ...(res?.assignments.some((a) => a.resource === 'water_rescue') ? (['water'] as LayerKey[]) : [])]))
        if (e && res) { say(e.message); if (n === 4) focusOn(res, e) }
      }
      if (n === 5) {
        busyRef.current = false
        if (!R.current.plan) await generate()
        busyRef.current = true
        fly.current?.home()
      }
    } catch (e) {
      setDemoErr(`Something went wrong (${errText(e)}). Try Next again.`)
    } finally { busyRef.current = false; setBusy(false); setDemoBusy(false) }
  }
  const dismissWelcome = () => { setWelcome(false); try { localStorage.setItem(STORED, '1') } catch { /* ignore */ } }
  const startDemo = () => { dismissWelcome(); void runStep(1) }

  /* ---------------------------------------------------------- derived */
  const zonePct = useMemo(() => {
    const o: Record<string, number> = {}
    setup?.zones.forEach((z) => { o[z.zone_id] = z.cut_off_pct })
    result?.zones.forEach((z) => { o[z.zone_id] = pctCutOff(z.after) })
    return o
  }, [setup, result])
  const available = useMemo(() => {
    const L = result?.layers
    return {
      flood: true, debris: (result?.roads.debris_remaining ?? 0) > 0, cleared: (result?.roads.cleared_edge_ids.length ?? 0) > 0,
      ems: !!L?.ems.length, supply: !!L?.supply.length, water: !!L?.water.length, heli: !!L?.helicopter.length, medical: !!L?.medical.length,
    } as Record<LayerKey, boolean>
  }, [result])

  const mineRes = cmp?.plans[0]?.result ?? (backup ? null : result)
  const gemmaRes = cmp?.plans[1]?.result ?? plan?.verified.result ?? null

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView
        cat={cat} layers={layers} facility={facility} eds={regional?.access.facilities ?? null} geo={geo} zones={zonesGeo} zonePct={zonePct} zoneSel={zoneSel} onZone={selectZone}
        result={result} base={setup?.base ?? null} flyRef={fly} onBasemap={setBasemap} panelPad={panelOpen ? PANEL_W + 12 : 0}
      />
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 60%, rgba(6,10,19,.65) 100%)' }} />

      <header className="panel absolute top-3 right-3 left-3 z-10 flex items-center gap-3 px-3.5 py-1.5">
        <div className="leading-tight">
          <div className="text-[16px] font-bold tracking-[.22em]">STORM<span style={{ color: 'var(--cyan)' }}>FORGE</span></div>
          <div className="hidden text-[10px] xl:block" style={{ color: 'var(--mute)' }}>Where should limited rescue resources go?</div>
        </div>
        <NoaaChip sources={sources} onOpen={() => setHowOpen(true)} />
        <div className="mx-auto" />
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Hurricane category">
          <span className="label mr-1 hidden lg:inline">Hurricane</span>
          {CATS.slice(1).map((c) => (
            <button key={c.id} role="radio" aria-checked={cat === c.id} onClick={() => !busy && void loadCategory(c.id)} title={`Category ${c.id} storm-surge planning envelope (not a forecast). Key ${c.id}`}
              className="mono h-7 w-[34px] rounded border text-xs font-semibold"
              style={{ borderColor: cat === c.id ? 'var(--cyan)' : 'var(--line)', background: cat === c.id ? 'rgba(34,211,238,.14)' : 'transparent', color: cat === c.id ? 'var(--cyan)' : 'var(--mute)', boxShadow: cat === c.id ? '0 0 12px rgba(34,211,238,.25)' : 'none' }}>{c.id}</button>
          ))}
        </div>
        <button onClick={() => void runStep(1)} className="rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white" style={{ background: 'linear-gradient(90deg,#0e7490,#6d28d9)' }}>▶ Guided demo</button>
        <button onClick={() => setHowOpen(true)} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs whitespace-nowrap hover:bg-white/5" aria-label="Data and sources, how it works">ⓘ Data &amp; Sources</button>
      </header>

      <MapKey on={layers} onToggle={toggleLayer} available={available} bottomReserve={demo ? 250 : 0} />

      {toast && (
        <div key={toast.id} role="status" aria-live="polite" className="panel toast-in absolute top-[64px] z-30 flex max-w-[460px] items-start gap-2.5 px-4 py-2.5 text-[13px] leading-snug"
          style={{ left: `calc((100% - ${panelOpen ? PANEL_W + 12 : 0}px) / 2)`, transform: 'translateX(-50%)', borderColor: toast.tone === 'ok' ? '#4ade80' : 'var(--amber)', boxShadow: `0 0 24px ${toast.tone === 'ok' ? 'rgba(74,222,128,.25)' : 'rgba(251,191,36,.25)'}` }}>
          <span style={{ color: toast.tone === 'ok' ? '#4ade80' : 'var(--amber)' }}>{toast.tone === 'ok' ? '✓' : '!'}</span>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss" className="ml-1" style={{ color: 'var(--mute)' }}>✕</button>
        </div>
      )}

      <button onClick={() => setPanelOpen(!panelOpen)} aria-label={panelOpen ? 'Collapse panel' : 'Expand panel'} title={panelOpen ? 'Collapse panel' : 'Expand panel'}
        className="panel absolute top-[72px] z-20 h-8 w-5 text-xs hover:bg-white/10" style={{ right: panelOpen ? PANEL_W + 14 : 4 }}>{panelOpen ? '›' : '‹'}</button>

      {panelOpen && (
        <aside className="panel absolute top-[64px] right-3 bottom-10 z-10 flex flex-col overflow-hidden" style={{ width: PANEL_W }} aria-label={`${tab} panel`}>
          <nav className="flex border-b" style={{ borderColor: 'var(--line)' }} role="tablist" aria-label="Main">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="h-11 flex-1 text-[14px] font-semibold transition-colors hover:bg-white/5"
                style={{ background: tab === t.id ? 'rgba(34,211,238,.14)' : 'transparent', color: tab === t.id ? 'var(--cyan)' : 'var(--mute)', boxShadow: tab === t.id ? 'inset 0 -3px 0 var(--cyan)' : 'none' }}>{t.label}</button>
            ))}
          </nav>
          <div className="flex items-center justify-between border-b px-3.5 py-1.5" style={{ borderColor: 'var(--line)' }}>
            <div className="text-[13px] font-semibold">Category {cat} hurricane</div>
            <div className="mono text-[11px]" style={{ color: 'var(--mute)' }} aria-label="Units used">{result ? `${result.units_used}/${result.units_total} units sent` : ''}</div>
          </div>
          <div className="flex-1 overflow-y-auto px-3.5 py-3" role="tabpanel">
            {loadErr && !loading ? <div className="text-xs" style={{ color: 'var(--coral)' }}>{loadErr}</div> : null}
            {tab === 'impact' && <ImpactTab setup={setup} result={result} zoneSel={zoneSel} onSelect={selectZone} loading={loading} err={null} regional={regional} regionalErr={regionalErr} cat={cat} />}
            {tab === 'deploy' && <DeployTab setup={setup} result={result} hints={hints} assign={assign} zoneSel={zoneSel} onSelect={selectZone} onDeploy={(r) => void deploy(r)} onRemove={(i) => void remove(i)} onMove={(i, z) => void move(i, z)} busy={busy} onReset={() => void reset()} gemmaApplied={gemmaApplied} onRestore={() => void restoreMine()} marginal={marginal} regional={regional} />}
            {tab === 'compare' && (
              <CompareTab setup={setup} mineRes={mineRes} gemmaRes={gemmaRes} cmp={cmp} plan={plan} planBusy={planBusy} planErr={planErr}
                onGenerate={() => void generate()} onApply={applyGemma} onRestore={() => void restoreMine()} onReset={() => void reset()}
                hasBackup={backup !== null} gemmaApplied={gemmaApplied} noneAssigned={mine.length === 0} mineLoading={!!backup && !cmp} />
            )}
          </div>
          <ActionBar tab={tab} zone={setup?.zones.find((z) => z.zone_id === zoneSel) ?? null} unitsUsed={result?.units_used ?? 0} plan={plan} planBusy={planBusy} gemmaApplied={gemmaApplied} hasBackup={backup !== null} loading={loading}
            onDeploy={() => setTab('deploy')} onReview={() => setTab('compare')} onGenerate={() => void generate()} onApply={applyGemma} onRestore={() => void restoreMine()} />
        </aside>
      )}

      <footer className="absolute bottom-2 left-3 z-10 flex items-center gap-3 text-[10px]" style={{ color: 'var(--mute)' }}>
        <span className="rounded border px-2 py-0.5 tracking-wider uppercase" style={{ borderColor: 'var(--amber)', color: 'var(--amber)', background: 'rgba(6,10,19,.7)' }}>Educational simulator · not for real emergency decisions</span>
        <span className="hidden xl:inline">NOAA SLOSH MOM v4 (updated 6/18/2026) · © OpenStreetMap{basemap === false ? ' · basemap offline' : ' · © CARTO'} · resources, debris and base are hypothetical</span>
      </footer>

      {howOpen && <HowItWorks onClose={() => setHowOpen(false)} setup={setup} roads={roads} cat={cat} sources={sources} regional={regional} />}
      {demo && (
        <DemoCoach step={step} onBack={() => void runStep(Math.max(1, step - 1))} onNext={() => void runStep(Math.min(5, step + 1))} onExit={() => setDemo(false)}
          ctx={{ cat, setup, result, zone: setup?.zones.find((z) => z.zone_id === demoZone) ?? null, plan, planBusy, planErr, cmp, busy: demoBusy, err: demoErr, regional, sources }} />
      )}
      {welcome && <Welcome onStart={startDemo} onSkip={dismissWelcome} sources={sources} />}
    </div>
  )
}

/** Sticky next-step button at the bottom of the right panel (never scrolls away). */
function ActionBar({ tab, zone, unitsUsed, plan, planBusy, gemmaApplied, hasBackup, loading, onDeploy, onReview, onGenerate, onApply, onRestore }: {
  tab: Tab; zone: { name: string } | null; unitsUsed: number; plan: GemmaPlan | null; planBusy: boolean; gemmaApplied: boolean; hasBackup: boolean; loading: boolean
  onDeploy: () => void; onReview: () => void; onGenerate: () => void; onApply: () => void; onRestore: () => void
}) {
  let label = '', note = '', disabled = false, onClick = onDeploy
  if (tab === 'impact') {
    onClick = onDeploy; disabled = !zone || loading
    label = zone ? `Deploy Resources to ${zone.name} →` : 'Deploy Resources →'
    note = zone ? '' : 'Select a neighborhood on the map or from the list first.'
  } else if (tab === 'deploy') {
    onClick = onReview; disabled = loading
    label = 'Review My Response →'
    note = unitsUsed ? `${unitsUsed} unit${unitsUsed === 1 ? '' : 's'} sent. Compare your response with an AI recommendation.` : 'No units sent yet. You can still compare with an AI recommendation.'
  } else if (!plan) {
    onClick = onGenerate; disabled = planBusy || loading
    label = planBusy ? 'Asking Gemma…' : 'Get AI Recommendation'
    note = planBusy ? 'This usually takes 15–30 seconds. Please keep this tab open.' : 'Gemma suggests where to send the 11 units; the backend verifies every number.'
  } else if (!gemmaApplied) {
    onClick = onApply; disabled = planBusy
    label = 'Apply Gemma Plan to the Map'
    note = 'You can restore your own plan afterwards.'
  } else {
    onClick = onRestore; disabled = !hasBackup
    label = 'Restore My Plan'
    note = 'Gemma’s plan is on the map.'
  }
  return (
    <div className="border-t px-3.5 pt-2 pb-3" style={{ borderColor: 'var(--line)', background: 'linear-gradient(180deg, rgba(11,17,32,.6), #0b1120)' }} data-testid="action-bar">
      {note && <div className="mb-1.5 text-[11px] leading-snug" style={{ color: 'var(--mute)' }}>{note}</div>}
      <button onClick={onClick} disabled={disabled} className="w-full rounded-lg px-3 py-3 text-[14px] font-bold text-white transition-[filter] enabled:hover:brightness-110 disabled:opacity-40" style={{ background: 'linear-gradient(90deg,#0e7490,#6d28d9)', boxShadow: disabled ? 'none' : '0 0 20px rgba(109,40,217,.35)' }}>{label}</button>
    </div>
  )
}
