import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

maplibregl.setWorkerUrl(workerUrl)
import { ARTERIAL, type Cat, type Facility, type RoadProps } from '../lib/data'
import type { Candidate, Zone } from '../lib/api'

export type Selection =
  | { kind: 'road'; props: RoadProps; lngLat: [number, number] }
  | { kind: 'facility'; facility: Facility }
  | null

export interface FlyApi {
  home: () => void
  to: (lng: number, lat: number, z?: number) => void
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

interface Props {
  cat: Cat
  showLocal: boolean
  showBridges: boolean
  facility: Facility | null
  selected: Selection
  onSelect: (s: Selection) => void
  flyRef: React.MutableRefObject<FlyApi | null>
  onBasemap: (ok: boolean) => void
  zones: Zone[] | null
  zoneSel: string | null
  onZone: (id: string | null) => void
  candidates: Candidate[] | null
  applied: string[]
  recommended: string[]
  onCandidate: (id: string) => void
}

function applyCat(map: maplibregl.Map, k: Cat, local: boolean, bridges: boolean) {
  const off = k === 0
  const exposed = (extra: Expr): Filt => (off ? NONE : (['all', ['>', ['get', `f${k}`], 0], extra] as Filt))
  const closed = (extra: Expr): Filt => (off ? NONE : (['all', ['==', ['get', `c${k}`], 1], extra] as Filt))
  map.setFilter('exp-art', exposed(isArt))
  map.setFilter('exp-local', exposed(notArt))
  map.setFilter('closed-art-casing', closed(isArt))
  map.setFilter('closed-local', closed(notArt))
  const ramp = k === 0 ? '#3b4a6b' : DEPTH_RAMP(k)
  map.setPaintProperty('exp-art', 'line-color', ramp)
  map.setPaintProperty('exp-local', 'line-color', ramp)
  const vis = (on: boolean) => (on ? 'visible' : 'none')
  for (const id of ['exp-local', 'closed-local', 'roads-local']) map.setLayoutProperty(id, 'visibility', vis(local))
  map.setLayoutProperty('bridges', 'visibility', vis(bridges))
}

export default function MapView({ cat, showLocal, showBridges, facility, selected, onSelect, flyRef, onBasemap, zones, zoneSel, onZone, candidates, applied, recommended, onCandidate }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const latest = useRef({ cat, showLocal, showBridges, facility, onSelect })
  const zoneMarkers = useRef<maplibregl.Marker[]>([])
  const candMarkers = useRef<maplibregl.Marker[]>([])
  const latestAll = useRef({ zones, zoneSel, onZone, candidates, applied, recommended, onCandidate })
  latestAll.current = { zones, zoneSel, onZone, candidates, applied, recommended, onCandidate }
  latest.current = { cat, showLocal, showBridges, facility, onSelect }

  function syncFacility(map: maplibregl.Map, fac: Facility | null) {
    markerRef.current?.remove()
    markerRef.current = null
    if (!fac) return
    const node = document.createElement('button')
    node.setAttribute('aria-label', `${fac.name} (provisional)`)
    node.style.cssText =
      'width:26px;height:26px;border-radius:50%;background:#0b1120;border:2px solid #fbbf24;color:#fbbf24;font:700 15px/1 sans-serif;cursor:pointer;box-shadow:0 0 0 4px rgba(251,191,36,.18)'
    node.textContent = '+'
    node.onclick = (ev) => {
      ev.stopPropagation()
      latest.current.onSelect({ kind: 'facility', facility: fac })
    }
    markerRef.current = new maplibregl.Marker({ element: node }).setLngLat([fac.lon, fac.lat]).addTo(map)
    ;(map.getSource('snap') as maplibregl.GeoJSONSource).setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[fac.lon, fac.lat], [fac.snap_lon, fac.snap_lat]] },
    })
  }

  function syncZones(map: maplibregl.Map) {
    const { zones, zoneSel, onZone } = latestAll.current
    zoneMarkers.current.forEach((m) => m.remove())
    zoneMarkers.current = []
    const src = map.getSource('zones') as maplibregl.GeoJSONSource | undefined
    if (!src || !zones) return
    src.setData({
      type: 'FeatureCollection',
      features: zones.filter((z) => z.boundary).map((z) => ({ type: 'Feature', properties: { id: z.id, name: z.name, sel: z.id === zoneSel ? 1 : 0 }, geometry: z.boundary! })),
    })
    zoneMarkers.current = zones.map((z) => {
      const el = document.createElement('button')
      el.textContent = z.name + (z.kind === 'infrastructure' ? ' ⌁' : '')
      el.style.cssText = `font:600 10px/1 IBM Plex Sans,sans-serif;letter-spacing:.12em;text-transform:uppercase;padding:3px 6px;border-radius:4px;border:1px solid ${z.id === zoneSel ? '#22d3ee' : 'rgba(94,234,212,.35)'};background:rgba(6,10,19,.72);color:${z.id === zoneSel ? '#22d3ee' : '#9fe9dc'};cursor:pointer;pointer-events:auto`
      el.onclick = (ev) => { ev.stopPropagation(); onZone(z.id === latestAll.current.zoneSel ? null : z.id) }
      return new maplibregl.Marker({ element: el }).setLngLat(z.center).addTo(map)
    })
  }

  function syncCandidates(map: maplibregl.Map) {
    const { candidates, applied, recommended, onCandidate } = latestAll.current
    candMarkers.current.forEach((m) => m.remove())
    candMarkers.current = []
    candidates?.forEach((c) => {
      const on = applied.includes(c.id)
      const rec = recommended.includes(c.id)
      const el = document.createElement('button')
      el.setAttribute('aria-label', `${c.name} (hypothetical staging) ${on ? 'applied' : 'not applied'}`)
      el.title = `${c.name} — hypothetical staging site`
      el.style.cssText = `width:22px;height:22px;transform:rotate(45deg);border-radius:4px;cursor:pointer;border:2px ${on ? 'solid' : 'dashed'} ${on ? '#c4b5fd' : '#a78bfa'};background:${on ? 'rgba(167,139,250,.55)' : 'rgba(11,17,32,.85)'};box-shadow:${rec ? '0 0 0 4px rgba(34,211,238,.35)' : on ? '0 0 14px rgba(167,139,250,.7)' : 'none'}`
      el.onclick = (ev) => { ev.stopPropagation(); onCandidate(c.id) }
      candMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(map))
    })
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
      flyRef.current = {
        home: () => map.flyTo({ ...HOME, duration: 1600, essential: true }),
        to: (lng, lat, z = 15.5) => map.flyTo({ center: [lng, lat], zoom: z, pitch: 35, duration: 1600, essential: true }),
      }
      map.on('load', () => {
        map.addSource('roads', { type: 'geojson', data: '/data/roads.geojson', promoteId: 'id' })
        map.addSource('snap', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        const line = (
          id: string,
          paint: maplibregl.LineLayerSpecification['paint'],
          filter?: Filt,
          extra: Partial<maplibregl.LineLayerSpecification> = {},
        ) =>
          map.addLayer({
            id, type: 'line', source: 'roads',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint, ...(filter ? { filter } : {}), ...extra,
          } as maplibregl.LineLayerSpecification)

        line('roads-local', { 'line-color': '#26365a', 'line-width': W(0.4, 2), 'line-opacity': 0.8 }, notArt as Filt, { minzoom: 13.6 })
        line('roads-art', { 'line-color': '#41577f', 'line-width': W(1, 4.5) }, isArt as Filt)
        line('exp-local', { 'line-color': '#38bdf8', 'line-width': W(0.5, 2), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.6, 0.18, 16, 0.6] }, NONE, { minzoom: 13.6 })
        line('closed-local', { 'line-color': '#fb5d73', 'line-width': W(0.5, 2.2), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.6, 0.12, 16, 0.55], 'line-dasharray': [1.5, 1.2] }, NONE, { minzoom: 13.6 })
        line('closed-art-casing', { 'line-color': '#fb5d73', 'line-width': W(6, 14), 'line-opacity': 0.85, 'line-blur': 1.2 }, NONE)
        line('exp-art', { 'line-color': '#38bdf8', 'line-width': W(1, 3.2) }, NONE)
        line('bridges', { 'line-color': '#fbbf24', 'line-width': W(2, 6), 'line-dasharray': [0.6, 1.4], 'line-opacity': 0.95 }, ['==', ['get', 'bridge'], true] as Filt)
        line('roads-hover', { 'line-color': '#ffffff', 'line-width': W(3, 8), 'line-opacity': 0.9 }, NONE)
        line('roads-selected', { 'line-color': '#22d3ee', 'line-width': W(4, 10), 'line-opacity': 1 }, NONE)
        line('roads-hit', { 'line-color': '#000000', 'line-width': 14, 'line-opacity': 0 })
        map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': '#22d3ee', 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.12, 0] } }, 'roads-local')
        map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ['case', ['==', ['get', 'sel'], 1], '#22d3ee', '#5eead4'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 2.2, 1.1], 'line-dasharray': [3, 2], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 0.9, 0.18] } }, 'roads-local')
        map.addLayer({
          id: 'snap-line', type: 'line', source: 'snap',
          paint: { 'line-color': '#fbbf24', 'line-width': 2, 'line-dasharray': [1, 1.5] },
        })

        map.on('mousemove', 'roads-hit', (e) => {
          map.getCanvas().style.cursor = 'pointer'
          const id = e.features?.[0]?.properties?.id
          map.setFilter('roads-hover', id === undefined ? NONE : (['==', ['get', 'id'], id] as Filt))
        })
        map.on('mouseleave', 'roads-hit', () => {
          map.getCanvas().style.cursor = ''
          map.setFilter('roads-hover', NONE)
        })
        map.on('click', (e) => {
          const hit = map.queryRenderedFeatures(e.point, { layers: ['roads-hit'] })[0]
          if (hit) latest.current.onSelect({ kind: 'road', props: hit.properties as RoadProps, lngLat: [e.lngLat.lng, e.lngLat.lat] })
          else {
            latest.current.onSelect(null)
            const z = map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0]
            latestAll.current.onZone((z?.properties?.id as string | undefined) ?? null)
          }
        })
        ready.current = true
        const l = latest.current
        applyCat(map, l.cat, l.showLocal, l.showBridges)
        syncFacility(map, l.facility)
        syncZones(map)
        syncCandidates(map)
      })
    })
    return () => {
      dead = true
      ready.current = false
      markerRef.current?.remove()
      zoneMarkers.current.forEach((m) => m.remove())
      candMarkers.current.forEach((m) => m.remove())
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (map && ready.current) applyCat(map, cat, showLocal, showBridges)
  }, [cat, showLocal, showBridges])

  useEffect(() => {
    const map = mapRef.current
    if (map && ready.current) syncFacility(map, facility)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facility])

  useEffect(() => {
    const map = mapRef.current
    if (map && ready.current) syncZones(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, zoneSel])

  useEffect(() => {
    const map = mapRef.current
    if (map && ready.current) syncCandidates(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, applied, recommended])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready.current) return
    map.setFilter('roads-selected', selected?.kind === 'road' ? (['==', ['get', 'id'], selected.props.id] as Filt) : NONE)
  }, [selected])

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />
}
