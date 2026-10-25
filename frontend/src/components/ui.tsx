import { useState } from 'react'

export function Section({ title, children, defaultOpen = false, badge }: { title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--line)' }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold hover:bg-white/5">
        <span>{title}</span>
        <span className="flex items-center gap-2">{badge}<span style={{ color: 'var(--mute)' }}>{open ? '▴' : '▾'}</span></span>
      </button>
      {open && <div className="border-t px-3 py-2.5 text-xs leading-relaxed" style={{ borderColor: 'var(--line)' }}>{children}</div>}
    </div>
  )
}

export function Stat({ label, value, tone, sub }: { label: string; value: React.ReactNode; tone?: 'coral' | 'amber' | 'cyan' | 'green'; sub?: string }) {
  const c = tone === 'coral' ? 'var(--coral)' : tone === 'amber' ? 'var(--amber)' : tone === 'cyan' ? 'var(--cyan)' : tone === 'green' ? '#4ade80' : 'var(--ink)'
  return (
    <div className="min-w-0 flex-1 rounded-lg px-2.5 py-2" style={{ background: 'rgba(255,255,255,.04)' }}>
      <div className="mono text-[22px] leading-none font-semibold" style={{ color: c }}>{value}</div>
      <div className="mt-1 text-[11px] leading-tight" style={{ color: 'var(--mute)' }}>{label}</div>
      {sub && <div className="mt-0.5 text-[10px] leading-tight" style={{ color: 'var(--mute)' }}>{sub}</div>}
    </div>
  )
}

export function Hint({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[12px] leading-snug" style={{ color: 'var(--ink)' }}>
      <span className="mono mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold" style={{ background: 'var(--cyan)', color: '#04202a' }}>{n}</span>
      <span>{children}</span>
    </div>
  )
}

export const Spinner = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2 py-6 text-xs" style={{ color: 'var(--mute)' }} role="status">
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: 'var(--cyan)', borderTopColor: 'transparent' }} />
    {label}
  </div>
)

export const primaryBtn = 'rounded-lg px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40'
export const primaryBg = { background: 'linear-gradient(90deg,#0e7490,#6d28d9)' }

export type Kind = 'real' | 'calculated' | 'simulated'
export const KIND: Record<Kind, { label: string; color: string; tip: string }> = {
  real: { label: 'REAL DATA', color: '#4ade80', tip: 'Published or mapped by others (NOAA, OpenStreetMap, operator-listed facilities).' },
  calculated: { label: 'CALCULATED', color: '#22d3ee', tip: 'Computed by STORMFORGE from real data using the stated, illustrative rules.' },
  simulated: { label: 'SIMULATED', color: '#fbbf24', tip: 'Hypothetical input made up for this demo; not measured by NOAA or anyone else.' },
}

/** Small REAL / CALCULATED / SIMULATED tag for a metric or section. */
export function SourceBadge({ kind, className = '' }: { kind: Kind; className?: string }) {
  const k = KIND[kind]
  return (
    <span title={k.tip} className={`mono inline-block rounded border px-1 py-px text-[8.5px] leading-none font-semibold tracking-wider whitespace-nowrap ${className}`}
      style={{ color: k.color, borderColor: `${k.color}66`, background: `${k.color}14` }}>{k.label}</span>
  )
}
