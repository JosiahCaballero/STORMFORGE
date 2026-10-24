import { useEffect, useState } from 'react'
import { api, type AgentReport, type Candidate, type EvalResult, type Metrics, type PlanResponse, type PlanStatus, type Zone, type ZoneImpact } from '../lib/api'
import { depthLabel } from '../lib/data'

const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
const pct = (a: number, b: number) => (b ? (100 * a) / b : 0)

export function Badge({ children, tone = 'mute' }: { children: React.ReactNode; tone?: 'mute' | 'amber' | 'cyan' | 'green' | 'coral' }) {
  const c = { mute: 'var(--mute)', amber: 'var(--amber)', cyan: 'var(--cyan)', green: '#4ade80', coral: 'var(--coral)' }[tone]
  return (
    <span className="rounded border px-1.5 py-0.5 text-[9px] tracking-wider uppercase" style={{ borderColor: c, color: c }}>
      {children}
    </span>
  )
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="label">{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

function Err({ e }: { e: string }) {
  return <div className="rounded border border-[var(--coral)] p-2 text-[11px]" style={{ color: 'var(--coral)' }}>{e}</div>
}

function Bar({ label, base, now, total, color }: { label: string; base: number; now: number; total: number; color: string }) {
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex justify-between text-[11px]">
        <span>{label}</span>
        <span className="mono">
          {fmt(base)} → <b style={{ color }}>{fmt(now)}</b> <span style={{ color: 'var(--mute)' }}>/ {fmt(total)}</span>
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-sm" style={{ background: '#141d33' }}>
        <div className="absolute inset-y-0 left-0 transition-all duration-500" style={{ width: `${pct(now, total)}%`, background: color, opacity: 0.9 }} />
        <div className="absolute inset-y-0 left-0 border-r-2 border-white/70" style={{ width: `${pct(base, total)}%` }} title="baseline" />
      </div>
    </div>
  )
}

export function MetricsBars({ base, now }: { base: Metrics; now: Metrics }) {
  return (
    <>
      <Bar label="Full hospital route (provisional)" base={base.nodes_with_hospital_route} now={now.nodes_with_hospital_route} total={now.nodes_total} color="#22d3ee" />
      <Bar label="Temporary staging route (basic care)" base={base.nodes_with_staging_route} now={now.nodes_with_staging_route} total={now.nodes_total} color="#a78bfa" />
      <Bar label="Any modeled care route" base={base.nodes_with_any_care_route} now={now.nodes_with_any_care_route} total={now.nodes_total} color="#4ade80" />
      <div className="text-[10px] leading-snug" style={{ color: 'var(--mute)' }}>
        Graph nodes (of {fmt(now.nodes_total)}); white tick = baseline. Fixed sample: {now.origins_with_any_care_route}/{now.origins_total} origins reach any modeled care (baseline {base.origins_with_any_care_route}). Staging ≠ hospital.
      </div>
    </>
  )
}

/* ---------------- Response (candidates + apply/remove + Gemma plan) ---------------- */

export function ResponsePanel(props: {
  cat: number
  candidates: Candidate[] | null
  applied: string[]
  recommended: string[]
  onToggle: (id: string) => void
  onSet: (ids: string[]) => void
  onFocus: (c: Candidate) => void
  evalRes: EvalResult | null
  evalErr: string | null
  plan: PlanResponse | null
  planBusy: boolean
  planErr: string | null
  planStatus: PlanStatus | null
  onGenerate: () => void
  onCite: (agent: string) => void
}) {
  const { cat, candidates, applied, evalRes, plan } = props
  return (
    <>
      <Section title="Incident Commander · Gemma" right={props.planStatus && <Badge tone={props.planStatus.configured ? 'green' : 'amber'}>{props.planStatus.configured ? `Gemma · ${props.planStatus.model ?? ''}` : 'No Gemma key · fallback'}</Badge>}>
        <p className="mb-2 text-[11px] leading-snug" style={{ color: 'var(--mute)' }}>
          Gemma ranks candidate staging sites using the four analysis modules’ evidence. The backend validates its output and scores every plan itself — Gemma never supplies numbers.
        </p>
        <button
          disabled={props.planBusy || cat === 0}
          onClick={props.onGenerate}
          className="w-full rounded py-2 text-xs font-semibold tracking-wide transition disabled:opacity-40"
          style={{ background: 'linear-gradient(90deg,#0e7490,#6d28d9)', color: 'white' }}
        >
          {props.planBusy ? 'Incident Commander analysing…' : cat === 0 ? 'Select a hurricane category' : 'Generate response plan'}
        </button>
        {props.planErr && <div className="mt-2"><Err e={props.planErr} /></div>}
        {plan && (
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={plan.source === 'gemma' ? 'green' : 'amber'}>{plan.source_label}</Badge>
              <span className="mono text-[10px]" style={{ color: 'var(--mute)' }}>{fmt(plan.latency_ms)} ms</span>
              {plan.fallback_reason && <Badge>{plan.fallback_reason}</Badge>}
            </div>
            <p className="leading-relaxed">{plan.plan.summary}</p>
            <ol className="space-y-1.5">
              {plan.plan.ranked.map((r) => {
                const c = candidates?.find((x) => x.id === r.candidate_id)
                const rec = plan.plan.recommended_ids.includes(r.candidate_id)
                return (
                  <li key={r.candidate_id} className="rounded border p-2" style={{ borderColor: rec ? 'var(--cyan)' : 'var(--line)' }}>
                    <div className="flex items-center justify-between">
                      <b>#{r.rank} {c?.name ?? r.candidate_id}</b>
                      {rec && <Badge tone="cyan">recommended</Badge>}
                    </div>
                    <div className="mt-0.5 leading-snug" style={{ color: 'var(--mute)' }}>{r.rationale}</div>
                    {(() => {
                      const m = plan.verified.sequential_marginals.find((x) => x.candidate_id === r.candidate_id)
                      return m ? <div className="mono mt-1 text-[10px]" style={{ color: 'var(--cyan)' }}>backend: +{fmt(m.marginal_nodes)} new nodes after sites above it</div> : null
                    })()}
                  </li>
                )
              })}
            </ol>
            {plan.plan.tradeoffs.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-[11px]" style={{ color: 'var(--mute)' }}>
                {plan.plan.tradeoffs.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}
            {plan.plan.agent_citations.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {[...new Set(plan.plan.agent_citations.map((c) => c.agent))].map((a) => (
                  <button key={a} onClick={() => props.onCite(a)} className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] hover:bg-white/5">used {a} module ↗</button>
                ))}
              </div>
            )}
            {plan.validation.rejected.length > 0 && (
              <div className="text-[10px]" style={{ color: 'var(--amber)' }}>Backend rejected {plan.validation.rejected.length} item(s) from the model output: {plan.validation.rejected.map((r) => r.reason).join(', ')}</div>
            )}
            <div className="rounded p-2" style={{ background: 'rgba(34,211,238,.06)' }}>
              <div className="label mb-1">Independently verified by NetworkX (not by Gemma)</div>
              <MetricsBars base={plan.verified.evaluate.baseline} now={plan.verified.evaluate.intervention} />
              <div className="label mt-2 mb-1">Zone impact of this plan · any-care nodes</div>
              <ul className="mono space-y-0.5 text-[10px]">
                {plan.verified.zone_impact.map((z) => (
                  <li key={z.zone_id} className="flex justify-between" style={{ color: z.improved ? 'var(--ink)' : 'var(--mute)' }}>
                    <span>{z.zone_name}</span>
                    <span>{fmt(z.baseline_any_care_nodes)} → <b style={{ color: z.improved ? '#4ade80' : undefined }}>{fmt(z.after_any_care_nodes)}</b> / {fmt(z.zone_nodes)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-1 text-[9px]" style={{ color: 'var(--mute)' }}>Sites must add ≥ {plan.verified.min_marginal_nodes_per_site} new reachable nodes beyond those above them.</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => props.onSet(plan.plan.recommended_ids)} className="flex-1 rounded border border-[var(--cyan)] py-1.5 text-[var(--cyan)] hover:bg-[rgba(34,211,238,.12)]">Apply plan</button>
              <button onClick={() => props.onSet([])} className="flex-1 rounded border border-[var(--line)] py-1.5 hover:bg-white/5">Clear</button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Hypothetical staging candidates" right={<Badge tone="amber">hypothetical</Badge>}>
        {!candidates && <div className="text-[11px]" style={{ color: 'var(--mute)' }}>Loading…</div>}
        <ul className="space-y-1.5">
          {candidates?.map((c) => {
            const on = applied.includes(c.id)
            const rec = props.recommended.includes(c.id)
            const alone = evalRes?.per_candidate.find((p) => p.id === c.id)
            return (
              <li key={c.id} className="rounded border p-2 text-xs" style={{ borderColor: on ? '#a78bfa' : 'var(--line)', background: on ? 'rgba(167,139,250,.08)' : 'transparent' }}>
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => props.onFocus(c)} className="text-left font-semibold hover:underline">{c.name}</button>
                  <button onClick={() => props.onToggle(c.id)} aria-pressed={on} className="rounded border px-2 py-0.5 text-[10px] uppercase" style={{ borderColor: on ? '#a78bfa' : 'var(--line)', color: on ? '#c4b5fd' : 'var(--ink)' }}>{on ? 'Remove' : 'Apply'}</button>
                </div>
                <div className="mono mt-0.5 text-[10px]" style={{ color: 'var(--mute)' }}>
                  {c.zone_id.replace(/_/g, ' ')} · snap {fmt(c.snap_distance_m)} m {rec && <span style={{ color: 'var(--cyan)' }}>· plan pick</span>}
                </div>
                {alone && <div className="mono mt-0.5 text-[10px]" style={{ color: 'var(--mute)' }}>alone: +{fmt(alone.marginal.nodes_with_any_care_route ?? 0)} nodes with a care route (simulated)</div>}
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-[10px] leading-snug" style={{ color: 'var(--mute)' }}>
          Sites are hypothetical, graph-snapped basic-medical staging points — not real facilities, not hospitals. Benefits are computed by directed-graph reachability; staging does not make roads safe.
        </p>
      </Section>

      <Section title="Before / after · simulated" right={<Badge>{applied.length} applied</Badge>}>
        {props.evalErr && <Err e={props.evalErr} />}
        {evalRes ? <MetricsBars base={evalRes.baseline} now={evalRes.intervention} /> : <div className="text-[11px]" style={{ color: 'var(--mute)' }}>Computing…</div>}
        {evalRes?.warnings.map((w, i) => <div key={i} className="mt-1 text-[10px]" style={{ color: 'var(--amber)' }}>{w}</div>)}
      </Section>
    </>
  )
}

/* ---------------- Zones ---------------- */

export function ZonePanel({ zones, sel, onSel, cat, applied }: { zones: Zone[] | null; sel: string | null; onSel: (id: string | null) => void; cat: number; applied: string[] }) {
  const [imp, setImp] = useState<ZoneImpact | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setImp(null); setErr(null)
    if (!sel) return
    let dead = false
    api.zoneImpact(sel, cat, applied).then((r) => !dead && setImp(r)).catch((e) => !dead && setErr(String(e)))
    return () => { dead = true }
  }, [sel, cat, applied])
  const z = zones?.find((x) => x.id === sel)
  return (
    <>
      <Section title="Analysis zones" right={<Badge tone="amber">provisional</Badge>}>
        {!zones && <div className="text-[11px]" style={{ color: 'var(--mute)' }}>Loading…</div>}
        <div className="flex flex-wrap gap-1.5">
          {zones?.map((x) => (
            <button key={x.id} onClick={() => onSel(sel === x.id ? null : x.id)} className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: sel === x.id ? 'var(--cyan)' : 'var(--line)', color: sel === x.id ? 'var(--cyan)' : 'var(--ink)', background: sel === x.id ? 'rgba(34,211,238,.1)' : 'transparent' }}>
              {x.name}{x.kind === 'infrastructure' ? ' ⌁' : ''}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-snug" style={{ color: 'var(--mute)' }}>
          Custom demonstration zones, not official districts. No population data is used or implied. ⌁ = infrastructure zone.
        </p>
      </Section>
      {z && (
        <Section title={z.name} right={<Badge tone="amber">{z.boundary_status}</Badge>}>
          {err && <Err e={err} />}
          {imp ? (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Closed (illustrative)" v={`${fmt(imp.closed_length_pct)}%`} sub={`${fmt(imp.edges_closed)}/${fmt(imp.edges_total)} directed edges`} tone="var(--coral)" />
                <Stat label="Nodes with any care route" v={`${fmt(pct(imp.nodes_with_any_care_route, imp.nodes))}%`} sub={`${fmt(imp.nodes_with_any_care_route)}/${fmt(imp.nodes)} nodes`} tone="#4ade80" />
              </div>
              <div className="text-[11px]" style={{ color: 'var(--mute)' }}>Hospital route (provisional): {fmt(imp.nodes_with_hospital_route)}/{fmt(imp.nodes)} nodes</div>
              {imp.most_exposed_roads.length > 0 && (
                <div>
                  <div className="label mb-1">Deepest NOAA bins on zone roads</div>
                  <ul className="mono text-[11px]">
                    {imp.most_exposed_roads.slice(0, 5).map((r) => <li key={r.edge_id}>{r.name ?? 'unnamed'} · {depthLabel(r.max_bin)}</li>)}
                  </ul>
                </div>
              )}
              <div className="text-[10px] leading-snug" style={{ color: 'var(--mute)' }}>{z.method}</div>
              {imp.limitations.map((l, i) => <div key={i} className="text-[10px]" style={{ color: 'var(--mute)' }}>• {l}</div>)}
            </div>
          ) : !err ? <div className="text-[11px]" style={{ color: 'var(--mute)' }}>Computing…</div> : null}
        </Section>
      )}
    </>
  )
}

function Stat({ label, v, sub, tone }: { label: string; v: string; sub: string; tone: string }) {
  return (
    <div className="rounded border border-[var(--line)] p-2">
      <div className="label">{label}</div>
      <div className="mono text-xl font-semibold" style={{ color: tone }}>{v}</div>
      <div className="text-[10px]" style={{ color: 'var(--mute)' }}>{sub}</div>
    </div>
  )
}

/* ---------------- Agents ---------------- */

const AGENTS: { key: 'transportation' | 'medical' | 'logistics' | 'community'; icon: string }[] = [
  { key: 'transportation', icon: '🛣' }, { key: 'medical', icon: '✚' }, { key: 'logistics', icon: '▦' }, { key: 'community', icon: '◍' },
]

export function AgentsPanel({ cat, applied, plan, open, setOpen }: { cat: number; applied: string[]; plan: PlanResponse | null; open: string | null; setOpen: (a: string | null) => void }) {
  const [rep, setRep] = useState<AgentReport | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setErr(null)
    let dead = false
    api.report(cat, applied).then((r) => !dead && setRep(r)).catch((e) => !dead && setErr(String(e)))
    return () => { dead = true }
  }, [cat, applied])
  const cited = new Set(plan?.plan.agent_citations.map((c) => `${c.agent}:${c.finding_id}`) ?? [])
  return (
    <>
      <Section title="Analysis modules → Incident Commander">
        <p className="text-[11px] leading-snug" style={{ color: 'var(--mute)' }}>
          Four deterministic software modules compute findings from the NOAA-derived graph. Gemma only reads their evidence and ranks options; it does not run them. Findings the plan cited are highlighted.
        </p>
      </Section>
      {err && <Err e={err} />}
      {!rep && !err && <div className="text-xs" style={{ color: 'var(--mute)' }}>Computing module findings…</div>}
      {rep && AGENTS.map(({ key, icon }) => {
        const a = rep[key]
        const isOpen = open === key
        return (
          <div key={key} className="panel p-3">
            <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
              <span className="text-sm font-semibold">{icon} {a.title}</span>
              <span style={{ color: 'var(--mute)' }}>{isOpen ? '−' : '+'}</span>
            </button>
            <div className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink)' }}>{a.headline}</div>
            {isOpen && (
              <div className="mt-2 space-y-1.5 text-[11px]">
                {a.findings.map((f) => (
                  <div key={f.id} className="rounded border p-1.5" style={{ borderColor: cited.has(`${key}:${f.id}`) ? 'var(--cyan)' : 'var(--line)', background: cited.has(`${key}:${f.id}`) ? 'rgba(34,211,238,.08)' : 'transparent' }}>
                    <div className="mono text-[9px]" style={{ color: 'var(--mute)' }}>{f.id} · {f.provenance}{cited.has(`${key}:${f.id}`) ? ' · cited by plan' : ''}</div>
                    {f.text}
                  </div>
                ))}
                {a.limitations.map((l, i) => <div key={i} className="text-[10px]" style={{ color: 'var(--amber)' }}>⚠ {l}</div>)}
              </div>
            )}
          </div>
        )
      })}
      {rep && (
        <div className="panel p-3 text-[11px]" style={{ color: 'var(--mute)' }}>
          <div className="mb-1 flex items-center justify-between"><b className="text-[var(--ink)]">Public transit & evacuation</b><Badge>planned</Badge></div>
          {rep.transit.note}
        </div>
      )}
    </>
  )
}
