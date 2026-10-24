import type { Candidate, EvalResult, PlanResponse } from '../lib/api'

export interface DemoCtx {
  cat: number
  closedPct: number | null
  hospitalNodesPct: number | null
  hospitalOrigins: string | null
  plan: PlanResponse | null
  planBusy: boolean
  planErr: string | null
  evalRes: EvalResult | null
  candidates: Candidate[] | null
  gainedNodes: number | null
}

const fmt = (n: number) => n.toLocaleString()

export const STEP_META = [
  { n: 1, short: 'Select storm' },
  { n: 2, short: 'Inspect communities' },
  { n: 3, short: 'Module findings' },
  { n: 4, short: 'Gemma plan' },
  { n: 5, short: 'Apply & verify' },
] as const

function content(step: number, c: DemoCtx): { title: string; body: React.ReactNode; look: string; nextDisabled?: boolean; nextLabel?: string } {
  const name = (id: string) => c.candidates?.find((x) => x.id === id)?.name ?? id
  switch (step) {
    case 1:
      return {
        title: 'A storm closes the roads that connect the city',
        body: (
          <>
            NOAA’s June 2026 SLOSH MOM <b>high-tide surge envelope</b> for a Category {c.cat || 3} hurricane is sampled along every road segment of a 4 km OpenStreetMap network.
            {c.closedPct !== null && <> Under an <b>illustrative</b> rule (any ~20 m sample ≥ 2 ft), <b className="text-[var(--coral)]">{c.closedPct.toFixed(0)}%</b> of directed road length is closed — including most of downtown.</>}
            {c.hospitalNodesPct !== null && <> Only <b>{c.hospitalNodesPct.toFixed(1)}%</b> of road-graph nodes can still reach the (provisional) hospital node.</>}
          </>
        ),
        look: 'Try keys 0–5 to compare categories, or click any road to inspect its NOAA depth. This is a planning envelope, not a forecast.',
      }
    case 2:
      return {
        title: 'Which communities lose access?',
        body: <>Six <b>provisional demo zones</b> (not official districts; no population data) summarize closures and modeled care access. Historic Downtown is selected: its zone panel shows how many of its road nodes can reach care under this storm.</>,
        look: 'Click other zone labels on the map or in the panel. Dashed outlines are approximate construction, not boundaries.',
      }
    case 3:
      return {
        title: 'Four analysis modules read the road graph',
        body: <>Transportation, Medical Access, Logistics and Community Impact are <b>deterministic software modules</b> — not AI chat. Each finding has an ID the Incident Commander can cite. Medical access is <b>provisional</b>: one OSM-tagged hospital, entrance unverified, so zero modeled access ≠ zero real-world care.</>,
        look: 'Expand each module to see findings and limitations. Public transit & evacuation is marked planned — no verified data is modeled.',
      }
    case 4: {
      if (c.planBusy || (!c.plan && !c.planErr)) {
        return { title: 'Gemma, the Incident Commander, is reading the evidence', body: <>Gemma receives the module findings plus sequential, backend-computed marginal gains for seven <b>hypothetical</b> staging sites, and returns a ranked plan. The backend rejects invented IDs or numbers, redundant sites (&lt; 5 new nodes) and zone claims that contradict its own results.</>, look: 'This usually takes 5–15 seconds.', nextDisabled: true }
      }
      if (c.planErr) return { title: 'Planner unavailable', body: <>The plan request failed: {c.planErr}. You can retry from the Response tab.</>, look: '', nextDisabled: true }
      const p = c.plan!
      const real = p.source === 'gemma'
      return {
        title: real ? `Gemma proposed ${p.plan.recommended_ids.length} site${p.plan.recommended_ids.length === 1 ? '' : 's'}` : 'Demo fallback plan (not Gemma)',
        body: (
          <>
            {real ? <>A <b>real Gemma response</b> ({p.model}, {(p.latency_ms / 1000).toFixed(1)} s) passed backend validation. </> : <><b className="text-[var(--amber)]">This is the deterministic fallback, not a Gemma response</b> ({p.fallback_reason ?? 'unavailable'}). </>}
            Recommended: {p.plan.recommended_ids.length ? p.plan.recommended_ids.map(name).join(' → ') : 'no site adds enough new reachable nodes'}.
          </>
        ),
        look: 'Read the rationale cards on the right. Gemma proposes; it never supplies the numbers.',
      }
    }
    case 5: {
      const e = c.evalRes
      return {
        title: 'Apply it — the backend verifies the impact',
        body: e ? (
          <>
            With the plan applied, nodes with a modeled route to care go <b>{fmt(e.baseline.nodes_with_any_care_route)} → <span className="text-[#4ade80]">{fmt(e.intervention.nodes_with_any_care_route)}</span></b> of {fmt(e.baseline.nodes_total)}, and fixed sample origins <b>{e.baseline.origins_with_any_care_route} → {e.intervention.origins_with_any_care_route}</b> of {e.baseline.origins_total}.
            Hospital access is unchanged (<b>{fmt(e.intervention.nodes_with_hospital_route)}</b> node) — staging is basic care, not a hospital. These numbers come from NetworkX, not from Gemma.
          </>
        ) : <>Applying the plan…</>,
        look: c.gainedNodes ? `Green dots on the map are the ${fmt(c.gainedNodes)} graph nodes that gain a route. Use Remove/Apply to see the before/after yourself.` : 'Use Apply/Remove on the candidates to compare.',
        nextLabel: 'Finish',
      }
    }
  }
  return { title: '', body: null, look: '' }
}

export function DemoCoach({ step, ctx, onBack, onNext, onExit }: { step: number; ctx: DemoCtx; onBack: () => void; onNext: () => void; onExit: () => void }) {
  const c = content(step, ctx)
  return (
    <div className="panel absolute bottom-9 left-1/2 z-30 w-[min(600px,calc(100vw-640px))] min-w-[420px] -translate-x-1/2 p-4" style={{ borderColor: 'var(--cyan)', boxShadow: '0 0 30px rgba(34,211,238,.18)' }} role="region" aria-label="Guided demo">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {STEP_META.map((s) => (
            <span key={s.n} className="h-1.5 w-8 rounded-full transition-colors" style={{ background: s.n <= step ? 'var(--cyan)' : '#243252' }} title={s.short} />
          ))}
          <span className="mono ml-2 text-[10px]" style={{ color: 'var(--mute)' }}>STEP {step}/5 · {STEP_META[step - 1].short.toUpperCase()}</span>
        </div>
        <button onClick={onExit} className="text-[11px] hover:underline" style={{ color: 'var(--mute)' }}>Exit demo ✕</button>
      </div>
      <h2 className="text-[15px] leading-snug font-semibold">{c.title}</h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed">{c.body}</p>
      {c.look && <p className="mt-1.5 text-[11.5px] leading-snug" style={{ color: 'var(--mute)' }}>👉 {c.look}</p>}
      <div className="mt-3 flex items-center justify-between">
        <button onClick={onBack} disabled={step === 1} className="rounded border border-[var(--line)] px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-30">← Back</button>
        <button onClick={step === 5 ? onExit : onNext} disabled={c.nextDisabled} className="rounded px-4 py-1.5 text-xs font-semibold disabled:opacity-40" style={{ background: 'linear-gradient(90deg,#0e7490,#6d28d9)', color: 'white' }}>
          {c.nextLabel ?? 'Next →'}
        </button>
      </div>
    </div>
  )
}

export function Welcome({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6" role="dialog" aria-label="Welcome">
      <div className="panel w-full max-w-xl p-6" style={{ background: '#0b1120' }}>
        <div className="text-[22px] font-bold tracking-[.22em]">STORM<span style={{ color: 'var(--cyan)' }}>FORGE</span></div>
        <div className="mt-0.5 text-xs italic" style={{ color: 'var(--mute)' }}>Break the city. See the consequences. Rebuild access.</div>
        <p className="mt-4 text-[13.5px] leading-relaxed">
          A hurricane doesn’t only damage buildings — flooded roads can cut neighborhoods off from care. STORMFORGE shows how NOAA’s 2026 storm-surge planning
          maps close St. Augustine’s roads, then lets Gemma propose a response that an independent graph simulation verifies.
        </p>
        <ul className="mt-3 space-y-1 text-[12.5px]" style={{ color: 'var(--mute)' }}>
          <li>• Real data: NOAA SLOSH MOM surge envelopes + OpenStreetMap roads</li>
          <li>• Gemma proposes · deterministic NetworkX engine validates and scores</li>
          <li>• Educational simulator — hypothetical sites, provisional hospital, not for real emergencies</li>
        </ul>
        <div className="mt-5 flex gap-3">
          <button onClick={onStart} className="flex-1 rounded py-2.5 text-sm font-semibold" style={{ background: 'linear-gradient(90deg,#0e7490,#6d28d9)', color: 'white' }}>▶ Start 5-step guided demo</button>
          <button onClick={onSkip} className="rounded border border-[var(--line)] px-4 py-2.5 text-sm hover:bg-white/5">Explore on my own</button>
        </div>
      </div>
    </div>
  )
}
