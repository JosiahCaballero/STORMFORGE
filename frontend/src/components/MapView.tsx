import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

maplibregl.setWorkerUrl(workerUrl)
import { ARTERIAL, edgesInfo, roadStatus, type Cat, type EdgeGeo, type Facility, type RoadProps } from '../lib/data'
import type { AllocationResult, BaseSite, ZoneGeo } from '../lib/api'
import { circlePolygon, LAYERS, type LayerKey } from '../lib/alloc'

export interface FlyApi {
  home: () => void
  to: (lng: number, lat: number, z?: number) => void
  fit: (pts: [number, number][], maxZoom?: number) => void
  /** Briefly pulse the cleared-road / coverage overlays so a fresh change is obvious. */
  pulse: () => void
}

const HOME = { center: [-81.3095, 29.8895] as [number, number], zoom: 14.1, pitch: 28, bearing: -12 }
const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const BLANK: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0a1020' } }],
}

type Expr = maplibregl.ExpressionSpecification
type Filt = maplibregl.FilterSpecification

const DEPTH_RAMP = (k: number): Expr => [
  'interpolate', ['linear'], ['get', `b${k}`],
  0, '#3b4a6b', 1, '#7dd3fc', 4, '#38bdf8', 8, '#6366f1', 14, '#a855f7', 20, '#e879f9', 21, '#fdf4ff',
]
const isArt: Expr = ['in', ['get', 'hw'], ['literal', ARTERIAL]]
const notArt: Expr = ['!', isArt]
const NONE = ['==', ['get', 'id'], -1] as Filt
const W = (a: number, b: number): Expr => ['interpolate', ['linear'], ['zoom'], 12, a, 17, b]
const inIds = (ids: number[]): Filt => (ids.length ? (['in', ['get', 'id'], ['literal', ids]] as Filt) : NONE)
const color = (k: LayerKey) => LAYERS.find((l) => l.key === k)!.color

const GROUPS: Record<LayerKey, string[]> = {
  flood: ['exp-art', 'exp-local', 'closed-art-casing', 'closed-local'],
  debris: ['debris-casing', 'debris-line', 'debris-pts'],
  cleared: ['cleared-casing', 'cleared-line', 'cleared-pulse'],
  ems: ['cov-ems'],
  supply: ['cov-supply'],
  medical: ['cov-medical'],
  water: ['water-fill', 'water-ring', 'water-targets'],
  heli: ['heli-halo', 'heli-pts'],
}

async function pickStyle(): Promise<string | maplibregl.StyleSpecification> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 4000)
    const r = await fetch(STYLE_URL, { signal: ctl.signal })
    clearTimeout(t)
    return r.ok ? STYLE_URL : BLANK
  } catch {
    return BLANK
  }
}

const fcPts = (pts: number[][], props: Record<string, unknown> = {}) => ({
  type: 'FeatureCollection' as const,
  features: pts.map((c) => ({ type: 'Feature' as const, properties: props, geometry: { type: 'Point' as const, coordinates: c } })),
})
const EMPTY = { type: 'FeatureCollection' as const, features: [] }

interface Props {
  cat: Cat
  layers: Set<LayerKey>
  facility: Facility | null
  geo: EdgeGeo | null
  zones: ZoneGeo[] | null
  /** current share of each region's locations that are cut off from help (0-100) */
  zonePct: Record<string, number>
  zoneSel: string | null
  onZone: (id: string | null) => void
  result: AllocationResult | null
  base: BaseSite | null
  flyRef: React.MutableRefObject<FlyApi | null>
  onBasemap: (ok: boolean) => void
  panelPad: number
}

function pill(text: string, col: string, title: string) {
  const el = document.createElement('div')
  el.textContent = text
  el.title = title
  el.style.cssText = `font:700 9px/1 IBM Plex Sans,sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:3px 6px;border-radius:999px;border:1.5px solid ${col};background:rgba(6,10,19,.88);color:${col};box-shadow:0 0 10px ${col}66;pointer-events:auto;white-space:nowrap`
  return el
}

export default function MapView(props: Props) {
  const { cat, layers, facility, geo, zones, zonePct, zoneSel, onZone, result, base, flyRef, onBasemap, panelPad } = props
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const P = useRef(props)
  P.current = props
  const markers = useRef<{ zone: maplibregl.Marker[]; unit: maplibregl.Marker[]; fixed: maplibregl.Marker[] }>({ zone: [], unit: [], fixed: [] })
  const pulseT = useRef<number | null>(null)

  function sync() {
    const map = mapRef.current
    if (!map || !ready.current) return
    const { cat, layers, facility, geo, zones, zonePct, zoneSel, onZone, result, base } = P.current
    const on = (k: LayerKey) => layers.has(k)

    // --- road exposure by category
    const off = cat === 0
    const exposed = (extra: Expr): Filt => (off ? NONE : (['all', ['>', ['get', `f${cat}`], 0], extra] as Filt))
    const closed = (extra: Expr): Filt => (off ? NONE : (['all', ['==', ['get', `c${cat}`], 1], extra] as Filt))
    map.setFilter('exp-art', exposed(isArt))
    map.setFilter('exp-local', exposed(notArt))
    map.setFilter('closed-art-casing', closed(isArt))
    map.setFilter('closed-local', closed(notArt))
    const ramp = off ? '#3b4a6b' : DEPTH_RAMP(cat)
    map.setPaintProperty('exp-art', 'line-color', ramp)
    map.setPaintProperty('exp-local', 'line-color', ramp)

    // --- overlay visibility
    for (const k of Object.keys(GROUPS) as LayerKey[]) for (const id of GROUPS[k]) map.setLayoutProperty(id, 'visibility', on(k) ? 'visible' : 'none')

    // --- debris / cleared (filter the roads source by API edge ids)
    const left = (result?.roads.debris ?? []).filter((d) => !d.cleared)
    const leftIds = left.flatMap((d) => d.edge_ids)
    const clearedIds = result?.roads.cleared_edge_ids ?? []
    for (const id of ['debris-casing', 'debris-line']) map.setFilter(id, inIds(leftIds))
    for (const id of ['cleared-casing', 'cleared-line', 'cleared-pulse']) map.setFilter(id, inIds(clearedIds))
    const dpts = geo ? left.map((d) => edgesInfo(geo, d.edge_ids).mid).filter((m): m is [number, number] => !!m) : []
    ;(map.getSource('debris-pts') as maplibregl.GeoJSONSource).setData(fcPts(dpts))

    // --- coverage layers
    const L = result?.layers
    const cov = (arr: { coverage: number[][] }[] | undefined) => fcPts((arr ?? []).flatMap((u) => u.coverage))
    ;(map.getSource('cov-ems') as maplibregl.GeoJSONSource).setData(cov(L?.ems))
    ;(map.getSource('cov-supply') as maplibregl.GeoJSONSource).setData(cov(L?.supply))
    ;(map.getSource('cov-medical') as maplibregl.GeoJSONSource).setData(cov(L?.medical))
    ;(map.getSource('water-targets') as maplibregl.GeoJSONSource).setData(fcPts((L?.water ?? []).flatMap((u) => u.targets)))
    ;(map.getSource('water-ring') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (L?.water ?? []).map((u) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(u.point[0], u.point[1], u.radius_m)] } })),
    })
    ;(map.getSource('heli-pts') as maplibregl.GeoJSONSource).setData(fcPts((L?.helicopter ?? []).flatMap((u) => u.cluster)))

    // --- regions: tint by share cut off, outline + dim around the selection
    const z = zones ?? []
    ;(map.getSource('zones') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: z.filter((q) => q.boundary).map((q) => ({
        type: 'Feature' as const,
        properties: { id: q.id, name: q.name, sel: q.id === zoneSel ? 1 : 0, dim: zoneSel && q.id !== zoneSel ? 1 : 0, pct: zonePct[q.id] ?? 0 },
        geometry: q.boundary!,
      })),
    })

    // --- DOM markers
    markers.current.zone.forEach((m) => m.remove())
    markers.current.zone = z.map((q) => {
      const e = document.createElement('button')
      const sel = q.id === zoneSel
      const pct = zonePct[q.id] ?? 0
      const dot = pct >= 60 ? '#fb5d73' : pct >= 20 ? '#fbbf24' : '#4ade80'
      e.innerHTML = `<i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dot};margin-right:6px;box-shadow:0 0 6px ${dot}"></i>`
      e.append(document.createTextNode(q.name))
      e.setAttribute('aria-label', `Select ${q.name}`)
      e.style.cssText = `font:600 ${sel ? 11 : 10}px/1 IBM Plex Sans,sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:4px 8px;border-radius:5px;border:1px solid ${sel ? '#22d3ee' : 'rgba(148,163,184,.35)'};background:${sel ? 'rgba(8,47,60,.92)' : 'rgba(6,10,19,.78)'};color:${sel ? '#67e8f9' : '#cbd5e1'};cursor:pointer;pointer-events:auto;white-space:nowrap;box-shadow:${sel ? '0 0 16px rgba(34,211,238,.45)' : 'none'}`
      e.onclick = (ev) => { ev.stopPropagation(); onZone(q.id === P.current.zoneSel ? null : q.id) }
      return new maplibregl.Marker({ element: e, anchor: q.id === 'bridge_corridor' ? 'left' : q.id === 'historic_downtown' ? 'right' : 'center' }).setLngLat(q.center).addTo(map)
    })

    markers.current.unit.forEach((m) => m.remove())
    const um: maplibregl.Marker[] = []
    const add = (ll: [number, number], text: string, col: string, title: string, anchor: 'bottom' | 'center' = 'bottom') =>
      um.push(new maplibregl.Marker({ element: pill(text, col, title), anchor }).setLngLat(ll).addTo(map))
    if (on('ems')) L?.ems.forEach((u) => add(u.point, 'EMS', color('ems'), `EMS team on ${u.street}`))
    if (on('supply')) L?.supply.forEach((u) => add(u.point, 'Supplies', color('supply'), `Supply team on ${u.street}`))
    if (on('medical')) L?.medical.forEach((u) => add(u.point, 'Medical site', color('medical'), `Temporary medical support: ${u.name}`))
    if (on('water')) L?.water.forEach((u) => add(u.point, 'Potential water rescue', color('water'), `Rescue entry point on ${u.street} (500 m screening ring)`))
    if (on('heli')) L?.helicopter.forEach((u) => add(u.point, 'Helicopter target · hypothetical', color('heli'), `Hypothetical helicopter priority cluster near ${u.street}`))
    markers.current.unit = um

    markers.current.fixed.forEach((m) => m.remove())
    const fm: maplibregl.Marker[] = []
    if (base) {
      const b = pill('Response base · provisional', '#e2e8f0', base.disclosure)
      b.style.boxShadow = 'none'
      b.style.opacity = '0.85'
      fm.push(new maplibregl.Marker({ element: b, anchor: 'top' }).setLngLat([base.lon, base.lat]).addTo(map))
    }
    if (facility) {
      const h = document.createElement('div')
      h.title = `${facility.name} — OSM hospital (provisional, entrance unverified)`
      h.textContent = '+'
      h.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#0b1120;border:2px solid #fbbf24;color:#fbbf24;font:700 14px/18px sans-serif;text-align:center;box-shadow:0 0 0 4px rgba(251,191,36,.18);pointer-events:auto'
      fm.push(new maplibregl.Marker({ element: h }).setLngLat([facility.lon, facility.lat]).addTo(map))
    }
    markers.current.fixed = fm
  }

  useEffect(() => {
    let dead = false
    pickStyle().then((style) => {
      if (dead || !el.current) return
      onBasemap(style !== BLANK)
      const map = new maplibregl.Map({ container: el.current, style, ...HOME, maxPitch: 60, canvasContextAttributes: { preserveDrawingBuffer: location.search.includes('shot') }, attributionControl: { compact: true } })
      mapRef.current = map
      if (location.search.includes('shot')) (window as unknown as { __map: unknown }).__map = map
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
      map.setPadding({ top: 60, bottom: 0, left: 0, right: P.current.panelPad })
      flyRef.current = {
        home: () => map.flyTo({ ...HOME, duration: 1600, essential: true }),
        to: (lng, lat, z = 15.5) => map.flyTo({ center: [lng, lat], zoom: z, pitch: 30, duration: 1400, essential: true }),
        fit: (pts, maxZoom = 15.6) => {
          if (!pts.length) return
          const b = new maplibregl.LngLatBounds(pts[0], pts[0])
          pts.forEach((q) => b.extend(q))
          map.fitBounds(b, { padding: { left: 60, right: 60, top: 50, bottom: 90 }, maxZoom, pitch: 25, duration: 1500, essential: true })
        },
        pulse: () => {
          if (pulseT.current) cancelAnimationFrame(pulseT.current)
          const t0 = performance.now()
          const tick = (t: number) => {
            const k = (t - t0) / 2400
            if (k >= 1 || !mapRef.current) {
              for (const id of ['cleared-pulse']) mapRef.current?.setPaintProperty(id, 'line-opacity', 0)
              for (const id of ['cov-ems', 'cov-supply', 'cov-medical']) mapRef.current?.setPaintProperty(id, 'circle-stroke-width', 0.6)
              return
            }
            const a = Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k)
            map.setPaintProperty('cleared-pulse', 'line-opacity', a * 0.9)
            for (const id of ['cov-ems', 'cov-supply', 'cov-medical']) map.setPaintProperty(id, 'circle-stroke-width', 0.6 + 2.4 * a)
            pulseT.current = requestAnimationFrame(tick)
          }
          pulseT.current = requestAnimationFrame(tick)
        },
      }
      map.on('load', () => {
        map.addSource('roads', { type: 'geojson', data: '/data/roads.geojson', promoteId: 'id' })
        const line = (id: string, paint: maplibregl.LineLayerSpecification['paint'], filter?: Filt, extra: Partial<maplibregl.LineLayerSpecification> = {}, layout: maplibregl.LineLayerSpecification['layout'] = {}) =>
          map.addLayer({
            id, type: 'line', source: 'roads',
            layout: { 'line-cap': 'round', 'line-join': 'round', ...layout },
            paint, ...(filter ? { filter } : {}), ...extra,
          } as maplibregl.LineLayerSpecification)

        map.addSource('zones', { type: 'geojson', data: EMPTY })
        map.addLayer({
          id: 'zones-fill', type: 'fill', source: 'zones',
          paint: {
            'fill-color': ['interpolate', ['linear'], ['get', 'pct'], 0, '#4ade80', 35, '#fbbf24', 80, '#fb5d73'],
            'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.2, 0.11],
          },
        })

        line('roads-local', { 'line-color': '#26365a', 'line-width': W(0.4, 2), 'line-opacity': 0.8 }, notArt as Filt, { minzoom: 13.6 })
        line('roads-art', { 'line-color': '#41577f', 'line-width': W(1, 4.5) }, isArt as Filt)
        line('exp-local', { 'line-color': '#38bdf8', 'line-width': W(0.5, 2), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.6, 0.18, 16, 0.6] }, NONE, { minzoom: 13.6 })
        line('closed-local', { 'line-color': '#fb5d73', 'line-width': W(0.5, 2.2), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.6, 0.12, 16, 0.55], 'line-dasharray': [1.5, 1.2] }, NONE, { minzoom: 13.6 })
        line('closed-art-casing', { 'line-color': '#fb5d73', 'line-width': W(6, 14), 'line-opacity': 0.85, 'line-blur': 1.2 }, NONE)
        line('exp-art', { 'line-color': '#38bdf8', 'line-width': W(1, 3.2) }, NONE)

        // dim everything outside the selected region (above roads, below overlays)
        map.addLayer({ id: 'zones-dim', type: 'fill', source: 'zones', filter: ['==', ['get', 'dim'], 1], paint: { 'fill-color': '#060a13', 'fill-opacity': 0.55 } })
        map.addLayer({
          id: 'zones-line', type: 'line', source: 'zones',
          paint: { 'line-color': ['case', ['==', ['get', 'sel'], 1], '#22d3ee', '#94a3b8'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 3, 1], 'line-dasharray': [3, 2], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.35] },
        })

        // overlays
        line('debris-casing', { 'line-color': color('debris'), 'line-width': W(6, 14), 'line-opacity': 0.28, 'line-blur': 1.5 }, NONE)
        line('debris-line', { 'line-color': color('debris'), 'line-width': W(2.5, 6), 'line-dasharray': [0.7, 0.55] }, NONE, {}, { 'line-cap': 'butt' })
        line('cleared-casing', { 'line-color': color('cleared'), 'line-width': W(7, 16), 'line-opacity': 0.35, 'line-blur': 2 }, NONE)
        line('cleared-line', { 'line-color': color('cleared'), 'line-width': W(2.5, 6) }, NONE)
        line('cleared-pulse', { 'line-color': '#ffffff', 'line-width': W(8, 18), 'line-opacity': 0, 'line-blur': 2 }, NONE)
        for (const s of ['debris-pts', 'cov-ems', 'cov-supply', 'cov-medical', 'water-targets', 'heli-pts']) map.addSource(s, { type: 'geojson', data: EMPTY })
        map.addSource('water-ring', { type: 'geojson', data: EMPTY })
        const cir = (id: string, src: string, col: string, r: [number, number], opacity: number, stroke = 0.6) =>
          map.addLayer({ id, type: 'circle', source: src, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, r[0], 17, r[1]], 'circle-color': col, 'circle-opacity': opacity, 'circle-stroke-width': stroke, 'circle-stroke-color': '#06101c' } })
        cir('cov-supply', 'cov-supply', color('supply'), [1.6, 5], 0.8)
        cir('cov-medical', 'cov-medical', color('medical'), [1.6, 5], 0.8)
        cir('cov-ems', 'cov-ems', color('ems'), [1.6, 5], 0.85)
        map.addLayer({ id: 'water-fill', type: 'fill', source: 'water-ring', paint: { 'fill-color': color('water'), 'fill-opacity': 0.1 } })
        map.addLayer({ id: 'water-ring', type: 'line', source: 'water-ring', paint: { 'line-color': color('water'), 'line-width': 2, 'line-dasharray': [2, 1.5] } })
        cir('water-targets', 'water-targets', color('water'), [2.5, 6.5], 0.95, 1)
        map.addLayer({ id: 'heli-halo', type: 'circle', source: 'heli-pts', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 7, 17, 18], 'circle-color': color('heli'), 'circle-opacity': 0.25, 'circle-blur': 0.7 } })
        cir('heli-pts', 'heli-pts', '#ffffff', [2.5, 6], 1, 1.5)
        cir('debris-pts', 'debris-pts', color('debris'), [4, 8], 1, 2)

        line('roads-hit', { 'line-color': '#000000', 'line-width': 14, 'line-opacity': 0 })

        map.on('mousemove', 'roads-hit', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'roads-hit', () => { map.getCanvas().style.cursor = '' })
        map.on('click', (e) => {
          const z = map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0]
          const hit = map.queryRenderedFeatures(e.point, { layers: ['roads-hit'] })[0]
          if (hit && map.getZoom() >= 15.4) {
            const p = hit.properties as RoadProps
            const { cat, result } = P.current
            const body = document.createElement('div')
            body.style.cssText = 'font:12px/1.4 IBM Plex Sans,sans-serif;color:#0b1120'
            const nm = document.createElement('b')
            nm.textContent = p.name || 'Unnamed road'
            const status = document.createElement('div')
            const inDebris = result?.roads.debris.find((d) => d.edge_ids.includes(p.id))
            status.textContent = inDebris ? (inDebris.cleared ? 'Debris cleared by your crew' : 'Blocked by simulated debris') : cat > 0 ? roadStatus(p, cat as 1 | 2 | 3 | 4 | 5).state === 'closed' ? 'Flooded (modeled)' : 'Not flooded under the model' : ''
            body.append(nm, status)
            new maplibregl.Popup({ closeButton: false, offset: 8 }).setLngLat(e.lngLat).setDOMContent(body).addTo(map)
            if (!z) return
          }
          P.current.onZone((z?.properties?.id as string | undefined) ?? null)
        })
        ready.current = true
        sync()
      })
    })
    return () => {
      dead = true
      ready.current = false
      if (pulseT.current) cancelAnimationFrame(pulseT.current)
      Object.values(markers.current).forEach((a) => a.forEach((m) => m.remove()))
      markers.current = { zone: [], unit: [], fixed: [] }
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { sync() }, [cat, layers, facility, geo, zones, zonePct, zoneSel, onZone, result, base]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { mapRef.current?.setPadding({ top: 60, bottom: 0, left: 0, right: panelPad }) }, [panelPad])

  return <div ref={el} style={{ position: 'absolute', inset: 0 }} />
}
