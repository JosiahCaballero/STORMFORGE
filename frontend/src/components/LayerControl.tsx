import { useState } from 'react'
import { LAYERS, type LayerKey } from '../lib/alloc'

/** Small overlay picker. Collapsed it shows only the colors of the layers that are on. */
export function LayerControl({ on, onToggle, available }: { on: Set<LayerKey>; onToggle: (k: LayerKey) => void; available: Record<LayerKey, boolean> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="panel absolute top-[64px] left-3 z-10 text-[12px]">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5" style={{ borderRadius: 10 }}>
        <span className="label" style={{ letterSpacing: '.12em' }}>Map layers</span>
        {!open && LAYERS.filter((l) => on.has(l.key)).map((l) => <i key={l.key} title={l.label} className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />)}
        <span style={{ color: 'var(--mute)' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className="border-t px-3 py-2" style={{ borderColor: 'var(--line)' }} aria-label="Map layers">
          {LAYERS.map((l) => (
            <li key={l.key}>
              <label className="flex cursor-pointer items-center gap-2 py-1" title={l.hint}>
                <input type="checkbox" checked={on.has(l.key)} onChange={() => onToggle(l.key)} className="accent-cyan-400" />
                <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                <span style={{ opacity: available[l.key] ? 1 : 0.55 }}>{l.label}</span>
                {!available[l.key] && <span className="text-[10px]" style={{ color: 'var(--mute)' }}>none yet</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
