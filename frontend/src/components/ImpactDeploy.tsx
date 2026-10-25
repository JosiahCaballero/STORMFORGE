import type { ActionHint, AllocationResult, Assignment, Marginal, RegionalBundle, Setup } from '../lib/api'
import { actionState, assignedRows, clearedRoads, cutOffLine, fmt, improvedLines, indexesIn, invById, problemLines, regionBeforeAfter, RESOURCES, RES, stillNeedsLines, ZONE_SHORT } from '../lib/alloc'
import { EmergencyAccess } from './EmergencyAccess'
import { Hint, Section, SourceBadge, Spinner, Stat } from './ui'

const TONE = { coral: 'var(--coral)', amber: 'var(--amber)', mute: 'var(--mute)' } as const

/* ------------------------------------------------------------------ IMPACT */
export function ImpactTab({ setup, result, zoneSel, onSelect, loading, err, regional, regionalErr, cat }: {
  setup: Setup | null; result: AllocationResult | null; zoneSel: string | null; onSelect: (id: string) => void; loading: boolean; err: string | null
  regional: RegionalBundle | null; regionalErr: boolean; cat: number
}) {
  if (err) return <div className="text-xs" style={{ color: 'var(--coral)' }}>{err}</div>
  if (!setup || !result || loading) return <Spinner label="Calculating the storm’s impact on the road network…" />
  const order = setup.attention_order.map((id) => setup.zones.find((z) => z.zone_id === id)!).filter(Boolean)
  const sel = setup.zones.find((z) => z.zone_id === zoneSel)
  const hit = setup.zones.filter((z) => z.cut_off_locations > 0).length
  return (
    <div className="flex flex-col gap-3">
      <Hint n={1}>A Category {cat} hurricane has flooded roads. <b>Select a neighborhood on the map or from the list.</b></Hint>
      <div className="flex gap-2">
        <Stat label="Roads blocked by modeled flooding" value={fmt(result.roads.flooded_segments)} tone="coral" sub="CALCULATED from NOAA surge data" />
        <Stat label="Roads blocked by simulated debris" value={fmt(result.roads.debris_total)} tone="amber" sub="SIMULATED scenario" />
      </div>
      <div className="text-[11px] leading-snug" style={{ color: 'var(--mute)' }} aria-label="Scenario summary">
        Scenario: {hit} of {setup.zones.length} response zones have locations cut off from the response base · {setup.total_units} hypothetical units to deploy.
      </div>

      <EmergencyAccess bundle={regional} err={regionalErr} result={result} zoneSel={zoneSel} zoneName={sel?.name ?? null} />

      <div>
        <div className="label mb-1.5">Response zones needing attention</div>
        <ol className="flex flex-col gap-1" aria-label="Response zones, most cut off first">
          {order.map((z, i) => {
            const on = z.zone_id === zoneSel
            const col = z.cut_off_pct >= 60 ? 'var(--coral)' : z.cut_off_pct >= 20 ? 'var(--amber)' : '#4ade80'
            return (
              <li key={z.zone_id}>
                <button onClick={() => onSelect(z.zone_id)} aria-pressed={on} className="w-full rounded-lg border px-2.5 py-1 text-left transition-colors hover:bg-white/5" style={{ borderColor: on ? 'var(--cyan)' : 'var(--line)', background: on ? 'rgba(34,211,238,.12)' : undefined, boxShadow: on ? '0 0 0 1px var(--cyan), 0 0 14px rgba(34,211,238,.25)' : undefined }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold"><span className="mono mr-1.5 text-[10px]" style={{ color: 'var(--mute)' }}>{i + 1}</span>{z.name}
                      {z.kind === 'infrastructure' && <span className="ml-1.5 rounded px-1 py-px text-[9px] font-normal tracking-wide uppercase" style={{ background: 'rgba(255,255,255,.08)', color: 'var(--mute)' }}>transport zone</span>}
                    </span>
                    {z.debris_blocked > 0 && <span className="rounded px-1.5 py-px text-[10px]" style={{ color: 'var(--amber)', background: 'rgba(251,191,36,.12)' }}>{z.debris_blocked} debris</span>}
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full" style={{ background: '#141d33' }}><div className="h-full rounded-full" style={{ width: `${Math.max(2, z.cut_off_pct)}%`, background: col }} /></div>
                  <div className="mt-0.5 text-[11px]" style={{ color: 'var(--mute)' }}>{z.kind === 'infrastructure' ? 'Bridges and approaches, not residential. ' : ''}{cutOffLine(z)}</div>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ DEPLOY */
export function DeployTab({ setup, result, hints, assign, zoneSel, onSelect, onDeploy, onRemove, onMove, busy, onReset, gemmaApplied, onRestore, marginal, regional }: {
  setup: Setup | null; result: AllocationResult | null; hints: ActionHint[] | null; assign: Assignment[]; zoneSel: string | null
  onSelect: (id: string) => void; onDeploy: (r: Assignment['resource']) => void; onRemove: (i: number) => void; onMove: (i: number, zone: string) => void
  busy: boolean; onReset: () => void; gemmaApplied: boolean; onRestore: () => void; marginal: Marginal | null; regional: RegionalBundle | null
}) {
  if (!setup || !result) return <Spinner label="Loading resources…" />
  const sz = setup.zones.find((z) => z.zone_id === zoneSel)
  const rz = result.zones.find((z) => z.zone_id === zoneSel)
  const rows = assignedRows(assign, result)
  const here = rows.filter((r) => r.zone_id === zoneSel)
  const ba = rz && here.length ? regionBeforeAfter(rz) : null
  const edZone = regional?.zones.find((z) => z.zone === zoneSel)
  const left = result.units_total - result.units_used
  const marg = marginal && marginal.zone_id === zoneSel ? marginal : null
  const crewRoads = here.filter((r) => r.resource === 'debris_crew' && r.entry?.status === 'placed')
    .flatMap((r) => clearedRoads(result, (r.entry?.details?.cleared_obstruction_ids as string[]) ?? []))
  return (
    <div className="flex flex-col gap-3">
      <Hint n={2}>Choose a neighborhood, then <b>add units</b> with +. You have {left} of {result.units_total} units left; several units can go to one zone.</Hint>

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

      <div className="flex flex-col gap-1.5" role="group" aria-label="Units in this neighborhood">
        <div className="flex items-center justify-between"><span className="label">Units {sz ? `in ${sz.name}` : ''}</span><SourceBadge kind="simulated" /></div>
        {RESOURCES.map((r) => {
          const inv = invById(result.inventory, r.id)
          const st = actionState(r.id, zoneSel, result.inventory, hints)
          const idx = indexesIn(assign, r.id, zoneSel)
          const m = marg?.resources.find((x) => x.resource === r.id)
          const disabledPlus = busy || st.disabled
          const note = !zoneSel ? null : (inv?.remaining ?? 0) <= 0 ? st.reason : m ? (!m.valid ? m.message : !m.useful ? `Adds little here (+${m.new_locations} new locations).` : `Next unit adds +${fmt(m.new_locations)} locations.`) : st.reason
          const tone = !zoneSel || (inv?.remaining ?? 0) <= 0 ? 'var(--mute)' : m && (!m.valid || !m.useful) ? 'var(--amber)' : 'var(--mute)'
          return (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: idx.length ? 'rgba(34,211,238,.55)' : 'var(--line)', background: idx.length ? 'rgba(34,211,238,.07)' : 'rgba(255,255,255,.02)' }}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold"><span>{r.icon}</span><span className="truncate">{r.action}</span>
                  <span className="mono shrink-0 rounded px-1 text-[10.5px] font-normal" style={{ background: 'rgba(255,255,255,.08)' }} aria-label={`${inv?.remaining} of ${inv?.total} left`}>{inv?.remaining}/{inv?.total} left</span></div>
                {note && <div className="mt-0.5 line-clamp-2 text-[10px] leading-tight" style={{ color: tone }}>{note}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`${r.short} units in this neighborhood`}>
                <button onClick={() => idx.length && onRemove(idx[0])} disabled={busy || idx.length === 0} aria-label={`Remove one ${r.short}${sz ? ` from ${sz.name}` : ''}`} title="Remove one (returns it to your inventory)" className="grid h-7 w-7 place-items-center rounded border text-[16px] leading-none hover:bg-white/10 disabled:opacity-30" style={{ borderColor: 'var(--line)' }}>−</button>
                <span className="mono w-5 text-center text-[14px] font-semibold" aria-label={`${idx.length} assigned here`}>{idx.length}</span>
                <button onClick={() => onDeploy(r.id)} disabled={disabledPlus} aria-label={`Add one ${r.short}${sz ? ` to ${sz.name}` : ''}`} title={st.reason ?? `${r.action}: add a ${r.noun}`} className="grid h-7 w-7 place-items-center rounded border text-[16px] leading-none enabled:hover:brightness-125 disabled:opacity-30" style={{ borderColor: 'rgba(34,211,238,.6)', background: 'rgba(34,211,238,.14)' }}>+</button>
              </div>
            </div>
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
            <div className="text-[12px]" style={{ color: 'var(--mute)' }}>Add a unit here to see what changes. Numbers are computed by the road-network model.</div>
          )}
        </div>
      )}

      {rz && here.length > 0 && (
        <div className="grid gap-2 text-[12px]" aria-label="Outcome for this neighborhood">
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'rgba(74,222,128,.4)', background: 'rgba(74,222,128,.05)' }}>
            <div className="label mb-1" style={{ color: '#4ade80' }}>What improved?</div>
            {improvedLines(rz).length ? <ul className="list-disc space-y-0.5 pl-4">{improvedLines(rz).map((l) => <li key={l}>{l}</li>)}</ul> : <div style={{ color: 'var(--mute)' }}>Nothing yet in this neighborhood. Try a different unit.</div>}
            {crewRoads.length > 0 && (
              <div className="mt-1.5" style={{ color: 'var(--mute)' }}>Crews cleared: {crewRoads.map((c) => `${c.name} (${c.reopened} location${c.reopened === 1 ? '' : 's'} were cut off by it${c.flooded ? '; flooding still closes part of it' : ''})`).join('; ')}. Clearing debris never reopens flood-closed roads.</div>
            )}
          </div>
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'rgba(251,191,36,.4)', background: 'rgba(251,191,36,.05)' }}>
            <div className="label mb-1" style={{ color: 'var(--amber)' }}>What still needs help?</div>
            {stillNeedsLines(rz, edZone).length ? <ul className="list-disc space-y-0.5 pl-4">{stillNeedsLines(rz, edZone).map((l) => <li key={l}>{l}</li>)}</ul> : <div style={{ color: 'var(--mute)' }}>Nothing flagged by the model for this neighborhood.</div>}
          </div>
        </div>
      )}

      <Section key={assign.length > 0 ? 'open' : 'shut'} title={`All assigned units (${assign.length})`} defaultOpen={assign.length > 0} badge={gemmaApplied ? <span className="rounded px-1.5 py-px text-[10px]" style={{ background: 'rgba(34,211,238,.15)', color: 'var(--cyan)' }}>Gemma plan</span> : undefined}>
        {assign.length === 0 ? <div style={{ color: 'var(--mute)' }}>Nothing assigned yet.</div> : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => {
              const rejected = r.entry && r.entry.status !== 'placed'
              return (
                <li key={r.index} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate" title={r.entry?.message}>
                    {RES[r.resource].icon} {RES[r.resource].short} <span style={{ color: 'var(--mute)' }}>in</span> {ZONE_SHORT[r.zone_id] ?? r.zone_id}
                    {!rejected && r.entry && <span className="mono ml-1 text-[10.5px]" style={{ color: 'var(--mute)' }}>+{r.entry.new_locations}</span>}
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
