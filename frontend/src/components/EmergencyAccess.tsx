import type { AllocationResult, RegionalBundle } from '../lib/api'
import { fmt } from '../lib/alloc'
import { SourceBadge } from './ui'

const TYPE_LABEL = { full_service_hospital: 'Full-service hospital', freestanding_er: 'Freestanding 24-hour ED' } as const
const QUALITY: Record<string, string> = {
  osm_building_centroid: 'position from OpenStreetMap building',
  address_geocode_nominatim: 'position from a street-address geocode',
  approx_street_intersection_SR207_Wildwood: 'position approximated at a road intersection',
}

const Row = ({ label, count, of, sub, badge }: { label: string; count: number; of: number; sub?: string; badge: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-2 py-1">
    <div className="min-w-0 text-[12px] leading-snug">
      <div>{label} {badge}</div>
      {sub && <div className="text-[10.5px]" style={{ color: 'var(--mute)' }}>{sub}</div>}
    </div>
    <div className="mono shrink-0 text-right text-[13px] font-semibold">{fmt(count)}<span className="font-normal" style={{ color: 'var(--mute)' }}> / {fmt(of)}</span></div>
  </div>
)

/** Impact headline: regional emergency-department accessibility, kept visibly separate from full-service hospital access and from EMS coverage. */
export function EmergencyAccess({ bundle, err, result, zoneSel, zoneName }: { bundle: RegionalBundle | null; err: boolean; result: AllocationResult | null; zoneSel: string | null; zoneName: string | null }) {
  if (err) {
    return (
      <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(251,191,36,.08)', color: 'var(--amber)' }}>
        Emergency-department access is unavailable right now (the regional routing service did not respond). Resource allocation below is unaffected.
      </div>
    )
  }
  if (!bundle) return <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(255,255,255,.04)', color: 'var(--mute)' }}>Calculating emergency-department access…</div>
  const a = bundle.access
  const ed = a.any_24h_ed.local_4km_nodes, fh = a.full_service_hospital.local_4km_nodes
  const zone = bundle.zones.find((z) => z.zone === zoneSel)
  const ems = result?.metrics.after.ems_locations ?? 0
  const allocHosp = result?.metrics.before.hospital_locations ?? null
  const differs = allocHosp !== null && allocHosp !== fh.nodes_with_route
  const hospital = a.facilities.find((f) => f.facility_type === 'full_service_hospital')
  return (
    <section className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.035)' }} aria-label="Emergency care access">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Emergency care access</span>
        <SourceBadge kind="calculated" />
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="mono text-[24px] leading-none font-semibold" style={{ color: ed.nodes_with_route === 0 ? 'var(--coral)' : 'var(--ink)' }}>{fmt(ed.nodes_with_route)}</span>
        <span className="mono text-[12px]" style={{ color: 'var(--mute)' }}>of {fmt(ed.nodes)} road-network locations</span>
      </div>
      <div className="text-[12px] leading-snug">can reach a <b>verified 24-hour emergency department</b> by open roads.</div>

      <div className="mt-2 border-t pt-1" style={{ borderColor: 'rgba(255,255,255,.07)' }}>
        <Row label="Full-service hospital" count={fh.nodes_with_route} of={fh.nodes} sub={hospital ? `${hospital.name} only` : undefined} badge={<SourceBadge kind="calculated" className="ml-1" />} />
        <Row label="EMS teams you send" count={ems} of={result?.metrics.after.locations_total ?? 0} sub={ems ? 'locations an ambulance could reach within 1.5 km' : 'none sent yet; this is deployment coverage, not hospital access'} badge={<SourceBadge kind="simulated" className="ml-1" />} />
      </div>

      {zone && zoneName && (
        <div className="mt-1 rounded px-2 py-1 text-[11.5px]" style={{ background: 'rgba(34,211,238,.07)' }}>
          In <b>{zoneName}</b>: <span className="mono">{fmt(zone.nodes_with_24h_ed_route)}</span> of <span className="mono">{fmt(zone.nodes)}</span> locations can reach a 24-hour ED
          {zone.nodes_with_full_service_hospital_route === 0 && zone.nodes ? ' (none reach a full-service hospital)' : ''}.
        </div>
      )}

      <p className="mt-2 text-[10.5px] leading-snug" style={{ color: 'var(--mute)' }}>
        Counts local study-area road-network locations (not people), routed over a larger regional road network. Separate from the resource-allocation model below; deploying units does not change this number.
      </p>
      {differs && (
        <p className="mt-1.5 rounded px-2 py-1 text-[10.5px] leading-snug" style={{ background: 'rgba(251,191,36,.08)', color: 'var(--amber)' }}>
          The allocation model sees only one hospital on a smaller 4 km map and counts <b className="mono">{fmt(allocHosp)}</b> location{allocHosp === 1 ? ' (only the hospital’s own road node)' : 's'}. The two calculations use different networks, so they can disagree; both are shown on purpose.
        </p>
      )}

      <details className="mt-2 text-[11px]">
        <summary className="cursor-pointer" style={{ color: 'var(--cyan)' }}>Facilities, scope and uncertainty</summary>
        <ul className="mt-1.5 flex flex-col gap-1">
          {a.facilities.map((f) => (
            <li key={f.name} className="leading-snug">
              <b>{f.name}</b> <span style={{ color: 'var(--mute)' }}>· {TYPE_LABEL[f.facility_type]} · {f.accessible ? 'reachable by open roads' : 'cannot be reached by any open road in this scenario'}</span>
              <div style={{ color: 'var(--mute)' }}>{QUALITY[f.position_quality] ?? f.position_quality}; {Math.round(f.snap_distance_m)} m to nearest road node; entrance unverified.</div>
            </li>
          ))}
        </ul>
        <ul className="mt-2 list-disc space-y-0.5 pl-4" style={{ color: 'var(--mute)' }}>
          {a.scope.map((s) => <li key={s}>{s}</li>)}
          <li>Sampled-origin check ({fmt(ed.origins_with_route)} of {fmt(ed.origins)} deterministic origins) is a spot check only; the headline counts all locations.</li>
        </ul>
      </details>
    </section>
  )
}
