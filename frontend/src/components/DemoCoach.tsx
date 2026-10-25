import type { AllocationResult, Compared, GemmaPlan, RegionalBundle, Setup, SetupZone, Sources } from '../lib/api'
import { clearedRoads, fmt } from '../lib/alloc'
import { primaryBg, SourceBadge } from './ui'

export interface DemoCtx {
  cat: number
  setup: Setup | null
  result: AllocationResult | null
  /** region used for steps 2-4 (West Augustine when it has debris, else another verified region) */
  zone: SetupZone | null
  plan: GemmaPlan | null
  planBusy: boolean
  planErr: string | null
  cmp: Compared | null
  busy: boolean
  err: string | null
  regional: RegionalBundle | null
  sources: Sources | null
}

export const STEP_META = [
  { n: 1, short: 'See the damage' },
  { n: 2, short: 'Pick a neighborhood' },
  { n: 3, short: 'Clear the roads' },
  { n: 4, short: 'Add coverage' },
  { n: 5, short: 'Ask Gemma' },
] as const

const entry = (c: DemoCtx, resource: string, zone?: string) => c.result?.assignments.find((a) => a.resource === resource && (!zone || a.zone_id === zone) && a.status === 'placed')

function content(step: number, c: DemoCtx): { title: string; body: React.ReactNode; look: string } {
  const z = c.zone
  const rz = c.result?.zones.find((x) => x.zone_id === z?.zone_id)
  const waiting = { title: 'Working…', body: <>Calculating on the road network. The first request for a storm category can take a few seconds.</>, look: '' }
  if (!c.setup || !c.result) return waiting
  switch (step) {
    case 1: {
      const top = c.setup.zones.find((q) => q.zone_id === c.setup!.attention_order[0])
      const ed = c.regional?.access.any_24h_ed.local_4km_nodes
      return {
        title: 'Revised NOAA surge data, limited rescue resources',
        body: (
          <>
            <SourceBadge kind="real" /> <b>{c.sources?.noaa.headline ?? 'NOAA SLOSH MOM v4 (2026 revision)'}</b> shows where a Category {c.cat} surge could flood roads.{' '}
            <SourceBadge kind="calculated" /> STORMFORGE finds <b className="text-[var(--coral)]">{fmt(c.result.roads.flooded_segments)}</b> blocked road segments{ed && <> and {fmt(ed.nodes_with_route)} of {fmt(ed.nodes)} locations that can still reach a verified 24-hour emergency department</>}
            {top && <>; {top.name} is the most cut off ({Math.round(top.cut_off_pct)}%)</>}.{' '}
            <SourceBadge kind="simulated" /> <b className="text-[var(--amber)]">{c.result.roads.debris_total}</b> simulated debris blockages and 11 hypothetical units complete the puzzle.
          </>
        ),
        look: 'Red dashed roads are flooded; amber dashes are debris. Press 1–5 to try other storm strengths.',
      }
    }
    case 2:
      return z ? {
        title: `Look at ${z.name}`,
        body: <>{z.name} has <b className="text-[var(--coral)]">{fmt(z.flooded_road_segments)}</b> flooded road segments, <b className="text-[var(--amber)]">{z.debris_blocked}</b> roads blocked by debris, and <b>{Math.round(z.cut_off_pct)}%</b> of its locations ({fmt(z.cut_off_locations)} of {fmt(z.locations)}) are cut off from help. The outline on the map is the selected neighborhood.</>,
        look: 'The panel on the right lists these problems and your 11 units.',
      } : { title: 'Pick a neighborhood', body: <>Choose any neighborhood on the map.</>, look: '' }
    case 3: {
      const e = entry(c, 'debris_crew', z?.zone_id)
      return {
        title: 'Send a debris-clearing crew',
        body: e ? <>{e.message} {rz && <>Locations cut off in {rz.name}: <b>{fmt(rz.before.cut_off_locations)} → <span className="text-[#4ade80]">{fmt(rz.after.cut_off_locations)}</span></b>.</>}
          {c.result && (() => { const r = clearedRoads(c.result, (e.details?.cleared_obstruction_ids as string[]) ?? []); return r.length ? <> Cleared: {r.map((x) => x.name).join(', ')}. <SourceBadge kind="simulated" /></> : null })()}</> : <>The crew could not be placed{c.err ? `: ${c.err}` : '.'}</>,
        look: 'The green roads on the map are the segments that were just cleared.',
      }
    }
    case 4: {
      const e = entry(c, 'ems_team', z?.zone_id)
      const w = c.result.assignments.find((a) => a.resource === 'water_rescue' && a.status === 'placed')
      return {
        title: 'Add EMS coverage',
        body: <>{e ? e.message : 'The EMS team could not be placed.'} {w && <> {w.message}</>} EMS coverage is a different thing from emergency-department access, which deployments do not change.</>,
        look: 'Blue dots show locations an ambulance could reach within 1.5 km. The teal ring marks potential water rescue.',
      }
    }
    default: {
      if (c.planBusy) return { title: 'Asking Gemma…', body: <>Gemma is choosing where to send the same 11 units. The road-network model then verifies every number. This takes a few seconds.</>, look: '' }
      if (c.planErr) return { title: 'Gemma planner unavailable', body: <>{c.planErr}. Your own allocation is unchanged. You can retry from the Compare tab.</>, look: '' }
      if (!c.plan) return waiting
      const real = c.plan.source === 'gemma'
      const a = c.cmp?.plans[0]?.result, b = c.cmp?.plans[1]?.result
      return {
        title: real ? 'Gemma’s recommendation' : 'Fallback plan (not Gemma)',
        body: (
          <>
            <b style={{ color: real ? '#4ade80' : 'var(--amber)' }}>{c.plan.source_label}.</b> {a && b && <>Roads cleared of debris: you <b>{a.roads.debris_cleared}</b>, Gemma <b>{b.roads.debris_cleared}</b>. EMS coverage: you <b>{fmt(a.metrics.after.ems_locations)}</b>, Gemma <b>{fmt(b.metrics.after.ems_locations)}</b> locations.</>}
          </>
        ),
        look: 'Compare tab: apply Gemma’s plan to see it on the map, or restore yours.',
      }
    }
  }
}

export function DemoCoach({ step, ctx, onBack, onNext, onExit }: { step: number; ctx: DemoCtx; onBack: () => void; onNext: () => void; onExit: () => void }) {
  const c = content(step, ctx)
  return (
    <div className="panel absolute bottom-10 left-3 z-30 w-[410px] max-w-[calc(100vw-440px)] p-3.5" style={{ borderColor: 'var(--cyan)', boxShadow: '0 0 30px rgba(34,211,238,.18)' }} role="region" aria-label="Guided demo">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {STEP_META.map((s) => <span key={s.n} className="h-1.5 w-6 rounded-full transition-colors" style={{ background: s.n <= step ? 'var(--cyan)' : '#243252' }} title={s.short} />)}
          <span className="mono ml-1.5 text-[10px]" style={{ color: 'var(--mute)' }}>STEP {step}/5 · {STEP_META[step - 1].short.toUpperCase()}</span>
        </div>
        <button onClick={onExit} className="text-[11px] hover:underline" style={{ color: 'var(--mute)' }}>Exit ✕</button>
      </div>
      <h2 className="text-[14px] leading-snug font-semibold">{c.title}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed" aria-live="polite">{c.body}</p>
      {ctx.err && step !== 3 && <p className="mt-1 text-[11.5px]" style={{ color: 'var(--amber)' }}>{ctx.err}</p>}
      {c.look && <p className="mt-1 text-[11.5px] leading-snug" style={{ color: 'var(--mute)' }}>{c.look}</p>}
      <div className="mt-2.5 flex items-center justify-between">
        <button onClick={onBack} disabled={step === 1 || ctx.busy} className="rounded border border-[var(--line)] px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-30">← Back</button>
        {ctx.busy && <span className="text-[11px]" style={{ color: 'var(--mute)' }}>Working…</span>}
        <button onClick={step === 5 ? onExit : onNext} disabled={ctx.busy} className="rounded px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40" style={primaryBg}>
          {step === 5 ? 'Finish & explore' : 'Next →'}
        </button>
      </div>
    </div>
  )
}

export function Welcome({ onStart, onSkip, sources }: { onStart: () => void; onSkip: () => void; sources: Sources | null }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 p-6" role="dialog" aria-label="Welcome">
      <div className="panel w-full max-w-lg p-6" style={{ background: '#0b1120' }}>
        <div className="text-[22px] font-bold tracking-[.22em]">STORM<span style={{ color: 'var(--cyan)' }}>FORGE</span></div>
        <div className="mt-3 flex items-center gap-2.5 rounded-lg border px-3 py-2" style={{ borderColor: 'rgba(74,222,128,.45)', background: 'rgba(74,222,128,.07)' }}>
          <SourceBadge kind="real" />
          <div className="leading-tight"><div className="text-[13px] font-semibold">Powered by NOAA Storm-Surge Data</div><div className="text-[11px]" style={{ color: 'var(--mute)' }}>{sources?.noaa.headline ?? 'SLOSH MOM v4 · 2026 revision'} · OpenStreetMap roads · NetworkX analysis</div></div>
        </div>
        <p className="mt-4 text-[17px] leading-snug font-semibold">A hurricane has hit. Roads are blocked. You have limited rescue resources. Decide where to send them.</p>
        <ol className="mt-3 space-y-1 text-[13px]" style={{ color: 'var(--mute)' }}>
          <li>1 · See which neighborhoods are cut off</li>
          <li>2 · Send crews, ambulances and rescue teams</li>
          <li>3 · Watch the map change, then compare with AI’s suggestion</li>
        </ol>
        <div className="mt-5 flex gap-3">
          <button onClick={onStart} className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white" style={primaryBg}>▶ Start guided demo</button>
          <button onClick={onSkip} className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm hover:bg-white/5">Explore on my own</button>
        </div>
        <p className="mt-4 text-[11px]" style={{ color: 'var(--mute)' }}>Educational simulator with hypothetical resources and simulated debris. Not for real emergency decisions.</p>
      </div>
    </div>
  )
}
