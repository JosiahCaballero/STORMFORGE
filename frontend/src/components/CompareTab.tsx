import type { AllocationResult, Compared, GemmaPlan, Setup } from '../lib/api'
import { COVERAGE_ROWS, diffRows, fmt, RES, stillCutOff, ZONE_SHORT } from '../lib/alloc'
import { Hint, Section, primaryBg, primaryBtn } from './ui'

function Cell({ v, best, na }: { v: number | string | null; best: boolean; na?: boolean }) {
  return <td className="mono py-1 text-right text-[13px]" style={{ color: na ? 'var(--mute)' : best ? '#4ade80' : 'var(--ink)', fontWeight: best ? 700 : 400 }}>{na || v === null ? '—' : typeof v === 'number' ? fmt(v) : v}</td>
}

export function CompareTab({ setup, mineRes, gemmaRes, cmp, plan, planBusy, planErr, onGenerate, onApply, onRestore, onReset, hasBackup, gemmaApplied, noneAssigned, mineLoading }: {
  setup: Setup | null; mineRes: AllocationResult | null; gemmaRes: AllocationResult | null; cmp: Compared | null; plan: GemmaPlan | null
  planBusy: boolean; planErr: string | null; onGenerate: () => void; onApply: () => void; onRestore: () => void; onReset: () => void
  hasBackup: boolean; gemmaApplied: boolean; noneAssigned: boolean; mineLoading: boolean
}) {
  const name = (id: string) => ZONE_SHORT[id] ?? setup?.zones.find((z) => z.zone_id === id)?.name ?? id
  const real = plan?.source === 'gemma'
  const m = mineRes, g = gemmaRes
  const rows: { label: string; mine: number | null; gem: number | null; hi: boolean; unit?: string }[] = [
    { label: 'Resources used', mine: m?.units_used ?? null, gem: g?.units_used ?? null, hi: false, unit: '/ 11' },
    { label: 'Roads cleared of debris', mine: m?.roads.debris_cleared ?? null, gem: g?.roads.debris_cleared ?? null, hi: true },
    ...COVERAGE_ROWS.map((c) => ({ label: c.label, mine: m?.metrics.after[c.key] ?? null, gem: g?.metrics.after[c.key] ?? null, hi: true })),
  ]
  const gap = (r: AllocationResult | null) => (r ? stillCutOff(r.zones) : null)
  const diff = cmp ? diffRows(cmp.assignment_diff, name) : []

  return (
    <div className="flex flex-col gap-3">
      <Hint n={3}>Ask Gemma for a different allocation of the same 11 units, then <b>compare</b> it with yours.</Hint>

      <div className="flex gap-2">
        <button onClick={onGenerate} disabled={planBusy} className={`${primaryBtn} flex-1`} style={primaryBg}>
          {planBusy ? 'Asking Gemma…' : plan ? 'Regenerate Gemma Plan' : 'Generate Gemma Plan'}
        </button>
        <button onClick={onApply} disabled={!plan || planBusy || gemmaApplied} className="rounded-lg border px-3 py-2 text-[13px] font-semibold hover:bg-white/5 disabled:opacity-35" style={{ borderColor: 'var(--cyan)', color: 'var(--cyan)' }}>Apply Gemma Plan</button>
      </div>
      <div className="flex gap-2 text-[11px]">
        <button onClick={onRestore} disabled={!hasBackup} className="rounded border px-2.5 py-1 hover:bg-white/5 disabled:opacity-35" style={{ borderColor: 'var(--line)' }}>Restore My Plan</button>
        <button onClick={onReset} className="rounded border px-2.5 py-1 hover:bg-white/5" style={{ borderColor: 'var(--line)' }}>Reset Allocation</button>
        {gemmaApplied && <span className="ml-auto self-center" style={{ color: 'var(--cyan)' }}>Gemma’s plan is applied on the map</span>}
      </div>

      {planBusy && (
        <div role="status" className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(34,211,238,.08)' }}>
          <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 align-[-2px]" style={{ borderColor: 'var(--cyan)', borderTopColor: 'transparent' }} />
          Gemma is choosing where to send the 11 units. The road-network model then checks every number. This takes about 10–30 seconds.
        </div>
      )}
      {planErr && !planBusy && <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(251,191,36,.1)', color: 'var(--amber)' }}>Planner unavailable: {planErr}. You can still adjust your own plan in Deploy.</div>}
      {plan && !planBusy && (
        <div className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: real ? 'rgba(74,222,128,.5)' : 'rgba(251,191,36,.6)', background: real ? 'rgba(74,222,128,.07)' : 'rgba(251,191,36,.08)' }}>
          <div className="font-semibold" style={{ color: real ? '#4ade80' : 'var(--amber)' }}>{plan.source_label}</div>
          {!real && plan.fallback_reason && <div className="mt-0.5" style={{ color: 'var(--mute)' }}>Reason: {plan.fallback_reason}</div>}
          <div className="mt-0.5" style={{ color: 'var(--mute)' }}>{(plan.latency_ms / 1000).toFixed(1)} s · results verified by the road-network model, not by Gemma</div>
        </div>
      )}

      <table className="w-full" aria-label="My Response compared with Gemma's Recommendation">
        <thead>
          <tr className="label">
            <th className="pb-1 text-left font-normal" />
            <th className="w-[84px] pb-1 text-right font-normal" style={{ color: 'var(--cyan)' }}>My Response</th>
            <th className="w-[94px] pb-1 text-right font-normal" style={{ color: '#c4b5fd' }}>Gemma’s Recommendation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const have = r.mine !== null && r.gem !== null
            return (
              <tr key={r.label} className="border-t" style={{ borderColor: 'rgba(255,255,255,.06)' }}>
                <td className="py-1 pr-2 text-[12px]">{r.label}</td>
                <Cell v={r.mine === null ? (mineLoading ? '…' : null) : r.unit ? `${r.mine} ${r.unit}` : r.mine} best={have && r.hi && r.mine! > r.gem!} />
                <Cell v={r.gem} best={have && r.hi && r.gem! > r.mine!} na={!plan} />
              </tr>
            )
          })}
        </tbody>
      </table>
      {noneAssigned && !hasBackup && !plan && <div className="text-[11px]" style={{ color: 'var(--mute)' }}>You have not sent any resources yet. Go to Deploy first, or ask Gemma and compare with an empty plan.</div>}
      <div className="text-[10px] leading-snug" style={{ color: 'var(--mute)' }}>Each line counts a different kind of coverage in road-network locations, so they are never added together. Green = better.</div>

      {plan && (
        <>
          <Section title="Why Gemma chose these assignments" defaultOpen>
            <p className="mb-2">{plan.plan.summary}</p>
            <ul className="flex flex-col gap-1.5">
              {plan.plan.assignments.map((a) => (
                <li key={a.action_id}><b>{RES[a.resource].icon} {RES[a.resource].short} → {name(a.zone_id)}</b><div style={{ color: 'var(--mute)' }}>{a.rationale}</div></li>
              ))}
            </ul>
            {plan.plan.tradeoffs.length > 0 && <div className="mt-2" style={{ color: 'var(--mute)' }}>Trade-offs: {plan.plan.tradeoffs.join(' · ')}</div>}
            {plan.validation.repairs.length > 0 && <div className="mt-2" style={{ color: 'var(--amber)' }}>The backend adjusted the plan: {plan.validation.repairs.join('; ')}</div>}
          </Section>
          <Section title={`What is different (${diff.length})`} defaultOpen={false}>
            {diff.length === 0 ? <div style={{ color: 'var(--mute)' }}>The two allocations are identical.</div> : (
              <table className="w-full"><thead><tr className="label"><th className="text-left font-normal" /><th className="text-right font-normal">You</th><th className="text-right font-normal">Gemma</th></tr></thead>
                <tbody>{diff.map((d) => <tr key={d.resource + d.zone}><td className="py-0.5">{RES[d.resource].short} in {d.zone}</td><td className="mono text-right">{d.mine}</td><td className="mono text-right">{d.gemma}</td></tr>)}</tbody></table>
            )}
          </Section>
        </>
      )}
      <Section title="Which neighborhoods still lack coverage">
        <div className="grid grid-cols-2 gap-3">
          {([['My Response', gap(m)], ['Gemma', plan ? gap(g) : null]] as const).map(([t, list]) => (
            <div key={t}>
              <div className="label mb-1">{t}</div>
              {list === null ? <div style={{ color: 'var(--mute)' }}>—</div> : list.length === 0 ? <div>None</div> : (
                <ul>{list.map((z) => <li key={z.zone_id}>{z.zone}: <span className="mono">{fmt(z.count)}</span> cut off</li>)}</ul>
              )}
            </div>
          ))}
        </div>
        <details className="mt-2"><summary className="cursor-pointer" style={{ color: 'var(--mute)' }}>All remaining gaps (my response)</summary>
          <ul className="mt-1">{m?.zones.map((z) => <li key={z.zone_id} className="mt-1"><b>{z.name}</b><ul style={{ color: 'var(--mute)' }}>{z.remaining.map((r) => <li key={r.kind}>{r.text}</li>)}</ul></li>)}</ul>
        </details>
      </Section>
    </div>
  )
}
