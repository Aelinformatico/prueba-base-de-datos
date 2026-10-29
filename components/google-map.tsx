"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { MapPin } from "lucide-react"
import { CITIES, type WeatherRow } from "@/lib/etl"

type LatLng = { lat: number; lng: number }
type GoogleMapInstance = { setCenter: (center: LatLng) => void }
type GoogleAdvancedMarker = {
  map: GoogleMapInstance | null
  addEventListener: (name: "gmp-click", listener: () => void) => void
}
type GoogleMapOptions = {
  center: LatLng
  zoom: number
  mapId: string
  mapTypeControl: boolean
  streetViewControl: boolean
  fullscreenControl: boolean
  gestureHandling: "cooperative"
}
type GoogleMapConstructor = new (
  element: HTMLElement,
  options: GoogleMapOptions
) => GoogleMapInstance
type AdvancedMarkerConstructor = new (options: {
  map: GoogleMapInstance
  position: LatLng
  title: string
  content: HTMLElement
  gmpClickable: boolean
}) => GoogleAdvancedMarker
type GoogleInfoWindow = {
  setContent: (content: HTMLElement) => void
  open: (options: {
    map: GoogleMapInstance
    anchor: GoogleAdvancedMarker
  }) => void
}
type MapsLibrary = {
  Map: GoogleMapConstructor
  InfoWindow: new () => GoogleInfoWindow
}
type MarkerLibrary = { AdvancedMarkerElement: AdvancedMarkerConstructor }
type GoogleMapsApi = {
  maps: { importLibrary: (name: "maps" | "marker") => Promise<unknown> }
}

declare global {
  interface Window {
    google?: GoogleMapsApi
    __meteoGoogleMapsReady?: () => void
  }
}

let mapsApiPromise: Promise<GoogleMapsApi> | null = null

function loadGoogleMaps(apiKey: string) {
  if (window.google?.maps) return Promise.resolve(window.google)
  if (mapsApiPromise) return mapsApiPromise

  mapsApiPromise = new Promise<GoogleMapsApi>((resolve, reject) => {
    window.__meteoGoogleMapsReady = () => {
      if (window.google?.maps) resolve(window.google)
      else reject(new Error("Google Maps no inicializó su API."))
    }
    const url = new URL("https://maps.googleapis.com/maps/api/js")
    url.searchParams.set("key", apiKey)
    url.searchParams.set("loading", "async")
    url.searchParams.set("callback", "__meteoGoogleMapsReady")
    url.searchParams.set("v", "weekly")
    url.searchParams.set("language", "es")
    url.searchParams.set("region", "ES")

    const script = document.createElement("script")
    script.src = url.toString()
    script.async = true
    script.dataset.meteoGoogleMaps = "true"
    script.onerror = () => reject(new Error("No se pudo cargar Google Maps."))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    mapsApiPromise = null
    throw error
  })
  return mapsApiPromise
}

export function GoogleMap({ rows }: { rows: WeatherRow[] }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID"
  const [status, setStatus] = useState<
    "loading" | "ready" | "missing" | "error"
  >(apiKey ? "loading" : "missing")
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GoogleMapInstance | null>(null)
  const markerConstructorRef = useRef<AdvancedMarkerConstructor | null>(null)
  const infoWindowRef = useRef<GoogleInfoWindow | null>(null)
  const markersRef = useRef<GoogleAdvancedMarker[]>([])

  const markers = useMemo(() => {
    const totals = new Map<string, { sum: number; count: number }>()
    for (const row of rows) {
      const current = totals.get(row.ciudad) ?? { sum: 0, count: 0 }
      current.sum += row.temperatura_c
      current.count += 1
      totals.set(row.ciudad, current)
    }
    const colors = ["#047857", "#2563eb", "#c2410c", "#7e22ce", "#be123c"]
    return CITIES.map((city, index) => {
      const total = totals.get(city.name)
      return {
        city,
        color: colors[index % colors.length],
        average: total ? total.sum / total.count : null,
        count: total?.count ?? 0,
      }
    })
  }, [rows])

  useEffect(() => {
    if (!apiKey) return
    let cancelled = false
    void loadGoogleMaps(apiKey)
      .then(async (google) => {
        const [maps, marker] = await Promise.all([
          google.maps.importLibrary("maps") as Promise<MapsLibrary>,
          google.maps.importLibrary("marker") as Promise<MarkerLibrary>,
        ])
        if (cancelled || !containerRef.current) return
        const map = new maps.Map(containerRef.current, {
          center: { lat: 40.2, lng: -3.7 },
          zoom: 6,
          mapId,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: "cooperative",
        })
        mapRef.current = map
        markerConstructorRef.current = marker.AdvancedMarkerElement
        infoWindowRef.current = new maps.InfoWindow()
        setStatus("ready")
      })
      .catch(() => {
        if (!cancelled) setStatus("error")
      })
    return () => {
      cancelled = true
      markersRef.current.forEach((marker) => (marker.map = null))
      markersRef.current = []
      mapRef.current = null
      markerConstructorRef.current = null
      infoWindowRef.current = null
    }
  }, [apiKey, mapId])

  useEffect(() => {
    const map = mapRef.current
    const Marker = markerConstructorRef.current
    const infoWindow = infoWindowRef.current
    if (status !== "ready" || !map || !Marker || !infoWindow) return

    markersRef.current.forEach((marker) => (marker.map = null))
    markersRef.current = markers.map(({ city, color, average, count }) => {
      const content = document.createElement("div")
      content.style.cssText = [
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "min-width:48px",
        "height:38px",
        "padding:0 7px",
        "border:2px solid white",
        "border-radius:20px",
        `background:${color}`,
        "box-shadow:0 2px 7px #0005",
        "color:white",
        "font:700 12px system-ui,sans-serif",
      ].join(";")
      content.textContent = average === null ? "—" : `${average.toFixed(1)}°`
      const marker = new Marker({
        map,
        position: { lat: city.latitude, lng: city.longitude },
        title: `${city.name}: ${average === null ? "sin datos" : `${average.toFixed(1)} °C`}`,
        content,
        gmpClickable: true,
      })
      marker.addEventListener("gmp-click", () => {
        const card = document.createElement("div")
        card.style.cssText = "font:14px system-ui,sans-serif;min-width:140px"
        const cityName = document.createElement("strong")
        cityName.textContent = city.name
        const temperature = document.createElement("div")
        temperature.textContent =
          average === null
            ? "Sin datos para los filtros actuales"
            : `Temperatura media: ${average.toFixed(1)} °C`
        const observations = document.createElement("small")
        observations.textContent = `${count} observaciones`
        card.append(cityName, temperature, observations)
        infoWindow.setContent(card)
        infoWindow.open({ map, anchor: marker })
      })
      return marker
    })
    return () => {
      markersRef.current.forEach((marker) => (marker.map = null))
      markersRef.current = []
    }
  }, [markers, status])

  return (
    <section className="mt-4 rounded-xl border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MapPin size={18} className="text-emerald-800" />
            <h3 className="temperature-chart-title font-semibold">Temperatura en Google Maps</h3>
          </div>
          <p className="segunda_frase text-slate-500">
            Media de los registros que cumplen los filtros actuales.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600">
          {rows.length} observaciones · °C
        </span>
      </div>

      {status === "missing" ? (
        <div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          Configura <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> en{" "}
          <code>.env.local</code> y reinicia Next.js para mostrar el mapa.
        </div>
      ) : status === "error" ? (
        <div
          role="alert"
          className="mt-4 rounded-lg bg-rose-50 p-4 text-sm text-rose-900"
        >
          No se pudo cargar Google Maps. Comprueba la clave, la API Maps
          JavaScript y las restricciones del sitio.
        </div>
      ) : (
        <div className="relative mt-4 aspect-[5/4] overflow-hidden rounded-lg bg-slate-100">
          {status === "loading" && (
            <p className="absolute inset-0 z-10 grid place-items-center bg-slate-100 text-sm text-slate-600">
              Cargando Google Maps…
            </p>
          )}
          <div
            ref={containerRef}
            className="h-full w-full"
            aria-label="Mapa de temperaturas por ciudad"
          />
        </div>
      )}

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {markers.map(({ city, color, average, count }) => (
          <li
            key={city.id}
            className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2"
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="min-w-0 flex-1 text-sm">{city.name}</span>
            <span className="text-right">
              <b className="block text-sm tabular-nums">
                {average === null ? "—" : `${average.toFixed(1)} °C`}
              </b>
              <small className="text-[10px] text-slate-500">
                {count} registros
              </small>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-right text-[10px] text-slate-500">
        Map data © Google
      </p>
    </section>
  )
}
