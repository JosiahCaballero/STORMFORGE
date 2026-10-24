import type { ActionHint, AllocationResult, Assignment, Setup } from '../lib/api'
import { actionState, assignedRows, cutOffLine, fmt, problemLines, regionBeforeAfter, RESOURCES, RES, ZONE_SHORT, invById } from '../lib/alloc'
import { Hint, Section, Spinner, Stat, primaryBg, primaryBtn } from './ui'

const TONE = { coral: 'var(--coral)', amber: 'var(--amber)', mute: 'var(--mute)' } as const

/* ------------------------------------------------------------------ IMPACT */
export function ImpactTab({ setup, result, zoneSel, onSelect, onDeploy, loading, err }: {
  setup: Setup | null; result: AllocationResult | null; zoneSel: string | null; onSelect: (id: string) => void; onDeploy: () => void; loading: boolean; err: string | null
}) {
  if (err) return <div className="text-xs" style={{ color: 'var(--coral)' }}>{err}</div>
  if (!setup || !result || loading) return <Spinner label="Calculating the storm’s impact on the road network…" />
  const b = result.metrics.before
  const order = setup.attention_order.map((id) => setup.zones.find((z) => z.zone_id === id)!).filter(Boolean)
  const sel = setup.zones.find((z) => z.zone_id === zoneSel)
  return (
    <div className="flex flex-col gap-3">
      <Hint n={1}>A hurricane has flooded roads and cut neighborhoods off from help. <b>Pick the neighborhood that needs it most.</b></Hint>
      <div className="flex gap-2">
        <Stat label="Roads blocked by modeled flooding" value={fmt(result.roads.flooded_segments)} tone="coral" />
        <Stat label="Roads blocked by simulated debris" value={fmt(result.roads.debris_total)} tone="amber" />
      </div>
      <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(255,255,255,.04)' }}>
        <b>Can reach a hospital:</b> <span className="mono">{fmt(b.hospital_locations)}</span> of {fmt(b.locations_total)} road-network locations
      </div>
      <div>
        <div className="label mb-1.5">Neighborhoods needing attention</div>
        <ol className="flex flex-col gap-1" aria-label="Neighborhoods, most cut off first">
          {order.map((z, i) => {
            const on = z.zone_id === zoneSel
            const col = z.cut_off_pct >= 60 ? 'var(--coral)' : z.cut_off_pct >= 20 ? 'var(--amber)' : '#4ade80'
            return (
              <li key={z.zone_id}>
                <button onClick={() => onSelect(z.zone_id)} aria-pressed={on} className="w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:bg-white/5" style={{ borderColor: on ? 'var(--cyan)' : 'var(--line)', background: on ? 'rgba(34,211,238,.09)' : undefined }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold"><span className="mono mr-1.5 text-[10px]" style={{ color: 'var(--mute)' }}>{i + 1}</span>{z.name}</span>
                    {z.debris_blocked > 0 && <span className="rounded px-1.5 py-px text-[10px]" style={{ color: 'var(--amber)', background: 'rgba(251,191,36,.12)' }}>{z.debris_blocked} debris</span>}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: '#141d33' }}><div className="h-full rounded-full" style={{ width: `${Math.max(2, z.cut_off_pct)}%`, background: col }} /></div>
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--mute)' }}>{cutOffLine(z)}</div>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
      <button onClick={onDeploy} disabled={!sel} className={primaryBtn} style={primaryBg}>
        {sel ? `Send resources to ${sel.name} →` : 'Select a neighborhood to send resources'}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ DEPLOY */
export function DeployTab({ setup, result, hints, assign, zoneSel, onSelect, onDeploy, onRemove, onMove, busy, onReset, gemmaApplied, onRestore }: {
  setup: Setup | null; result: AllocationResult | null; hints: ActionHint[] | null; assign: Assignment[]; zoneSel: string | null
  onSelect: (id: string) => void; onDeploy: (r: Assignment['resource']) => void; onRemove: (i: number) => void; onMove: (i: number, zone: string) => void
  busy: boolean; onReset: () => void; gemmaApplied: boolean; onRestore: () => void
}) {
  if (!setup || !result) return <Spinner label="Loading resources…" />
  const sz = setup.zones.find((z) => z.zone_id === zoneSel)
  const rz = result.zones.find((z) => z.zone_id === zoneSel)
  const rows = assignedRows(assign, result)
  const here = rows.filter((r) => r.zone_id === zoneSel)
  const ba = rz && here.length ? regionBeforeAfter(rz) : null
  return (
    <div className="flex flex-col gap-3">
      <Hint n={2}>Choose a neighborhood, then <b>send a resource</b>. You have {result.units_total - result.units_used} of {result.units_total} units left.</Hint>

      <label className="block">
        <span className="label">Neighborhood</span>
        <select value={zoneSel ?? ''} onChange={(e) => e.target.value && onSelect(e.target.value)} aria-label="Neighborhood" className="mt-1 w-full rounded-lg border bg-[#0b1120] px-2.5 py-2 text-[14px] font-semibold" style={{ borderColor: zoneSel ? 'var(--cyan)' : 'var(--amber)' }}>
          <option value="">Select a neighborhood (or click the map)…</option>
          {setup.attention_order.map((id) => <option key={id} value={id}>{ZONE_SHORT[id] ?? id}</option>)}
        </select>
      </label>

      {sz && (
        <ul className="flex flex-col gap-0.5 text-[12px]" aria-label="Problems in this neighborhood">
          {problemLines(sz).map((p) => <li key={p.key} className="flex items-start gap-2"><i className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE[p.tone] }} />{p.text}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Send resources">
        {RESOURCES.map((r) => {
          const inv = invById(result.inventory, r.id)
          const st = actionState(r.id, zoneSel, result.inventory, hints)
          const soft = st.soft
          return (
            <button
              key={r.id} onClick={() => onDeploy(r.id)} disabled={st.disabled || busy}
              title={st.reason ?? `${r.action}: send a ${r.noun} to ${sz?.name ?? 'the selected neighborhood'}`}
              aria-label={`${r.action}${st.reason ? ` — ${st.reason}` : ''}`}
              className="flex min-h-[54px] flex-col justify-center rounded-lg border px-2.5 py-1.5 text-left transition-all enabled:hover:brightness-125 disabled:cursor-not-allowed"
              style={{ borderColor: st.disabled ? 'var(--line)' : soft ? 'rgba(251,191,36,.45)' : 'rgba(34,211,238,.55)', background: st.disabled ? 'rgba(255,255,255,.02)' : 'rgba(34,211,238,.08)', opacity: st.disabled ? 0.5 : 1 }}
            >
              <span className="flex items-center justify-between gap-1">
                <span className="text-[13px] font-semibold">{r.icon} {r.action}</span>
                <span className="mono shrink-0 rounded px-1 text-[11px]" style={{ background: 'rgba(255,255,255,.08)' }} aria-label={`${inv?.remaining} of ${inv?.total} left`}>{inv?.remaining}/{inv?.total}</span>
              </span>
              {st.reason && zoneSel && <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight" style={{ color: soft ? 'var(--amber)' : 'var(--mute)' }}>{st.reason}</span>}
            </button>
          )
        })}
      </div>

      {sz && (
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }} aria-label="Before and after">
          {ba ? (
            <table className="w-full text-[12px]">
              <thead><tr className="label"><th className="pb-1 text-left font-normal">{sz.name}</th><th className="pb-1 text-right font-normal">Before</th><th /><th className="pb-1 text-right font-normal">After</th></tr></thead>
              <tbody>
                {ba.map((r) => {
                  const good = r.better === 'down' ? r.after < r.before : r.after > r.before
                  return (
                    <tr key={r.key}>
                      <td className="py-0.5 pr-2">{r.label}</td>
                      <td className="mono text-right" style={{ color: 'var(--mute)' }}>{fmt(r.before)}</td>
                      <td className="px-1 text-center" style={{ color: 'var(--mute)' }}>→</td>
                      <td className="mono text-right font-semibold" style={{ color: good ? '#4ade80' : 'var(--ink)' }}>{fmt(r.after)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--mute)' }}>Send a unit here to see what changes. Numbers are computed by the road-network model.</div>
          )}
        </div>
      )}

      <Section title={`Assigned units (${assign.length})`} defaultOpen={assign.length > 0} badge={gemmaApplied ? <span className="rounded px-1.5 py-px text-[10px]" style={{ background: 'rgba(34,211,238,.15)', color: 'var(--cyan)' }}>Gemma plan</span> : undefined}>
        {assign.length === 0 ? <div style={{ color: 'var(--mute)' }}>Nothing assigned yet.</div> : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => {
              const rejected = r.entry && r.entry.status !== 'placed'
              return (
                <li key={r.index} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate" title={r.entry?.message}>
                    {RES[r.resource].icon} {RES[r.resource].short} <span style={{ color: 'var(--mute)' }}>in</span> {ZONE_SHORT[r.zone_id] ?? r.zone_id}
                    {rejected && <span className="ml-1" style={{ color: 'var(--amber)' }} title={r.entry?.message}>(no effect now)</span>}
                  </span>
                  <select aria-label={`Move ${RES[r.resource].short} to another neighborhood`} value="" onChange={(e) => e.target.value && onMove(r.index, e.target.value)} disabled={busy} className="w-[62px] rounded border bg-[#0b1120] px-1 py-0.5 text-[11px]" style={{ borderColor: 'var(--line)' }}>
                    <option value="">Move…</option>
                    {setup.attention_order.filter((id) => id !== r.zone_id).map((id) => <option key={id} value={id}>{ZONE_SHORT[id]}</option>)}
                  </select>
                  <button onClick={() => onRemove(r.index)} disabled={busy} aria-label={`Remove ${RES[r.resource].short} from ${ZONE_SHORT[r.zone_id]}`} title="Remove (returns the unit to your inventory)" className="rounded px-1.5 py-0.5 hover:bg-white/10">✕</button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="mt-2 flex gap-2">
          {gemmaApplied && <button onClick={onRestore} className="rounded border px-2 py-1 text-[11px] hover:bg-white/5" style={{ borderColor: 'var(--line)' }}>Restore my plan</button>}
          {assign.length > 0 && <button onClick={onReset} className="rounded border px-2 py-1 text-[11px] hover:bg-white/5" style={{ borderColor: 'var(--line)' }}>Reset allocation</button>}
        </div>
      </Section>
    </div>
  )
}
