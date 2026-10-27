"use client"

import { useMemo, useRef, useState } from "react"
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Database,
  LoaderCircle,
  Play,
  RefreshCw,
  Upload,
  Waves,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CITIES,
  type CityId,
  type RawCity,
  type RejectedRow,
  type WeatherRow,
} from "@/lib/etl"

const PAGE = 20
type Extraction = {
  cities: RawCity[]
  transformed: WeatherRow[]
  rejected: RejectedRow[]
  rawCount: number
  extractionMs: number
  transformMs: number
}
type Filters = {
  city: string[]
  from: string
  to: string
  minT: string
  maxT: string
  minH: string
  maxH: string
  minP: string
  maxP: string
  rain: boolean
}
const emptyFilters: Filters = {
  city: [],
  from: "",
  to: "",
  minT: "",
  maxT: "",
  minH: "",
  maxH: "",
  minP: "",
  maxP: "",
  rain: false,
}
const key = (r: WeatherRow) => `${r.ciudad}|${r.fecha_hora}`
const fmt = (v: number, d = 1) =>
  new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(v)
async function request(payload: unknown) {
  const res = await fetch("/api/etl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Error de servidor")
  return data
}
function save(name: string, content: string, type = "application/json") {
  const a = document.createElement("a"),
    u = URL.createObjectURL(new Blob([content], { type }))
  a.href = u
  a.download = name
  a.click()
  URL.revokeObjectURL(u)
}

export default function Home() {
  const [start, setStart] = useState("2026-09-01"),
    [end, setEnd] = useState("2026-09-30"),
    [cities, setCities] = useState<CityId[]>(CITIES.map((c) => c.id))
  const [data, setData] = useState<Extraction | null>(null),
    [working, setWorking] = useState(false),
    [msg, setMsg] = useState("")
  const [cityProgress, setCityProgress] = useState<
    Partial<Record<CityId, string>>
  >({})
  const [tab, setTab] = useState("válidos"),
    [page, setPage] = useState(0),
    [filters, setFilters] = useState<Filters>(emptyFilters),
    [sort, setSort] = useState<keyof WeatherRow>("fecha_hora"),
    [desc, setDesc] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set())
  const [loads, setLoads] = useState<
      { status: string; processed: number; error?: string }[]
    >([]),
    [batches, setBatches] = useState<WeatherRow[][]>([]),
    [persisted, setPersisted] = useState<WeatherRow[]>([]),
    [dbCount, setDbCount] = useState(0),
    [dbPage, setDbPage] = useState(0),
    [dbCity, setDbCity] = useState(""),
    [dbStart, setDbStart] = useState(""),
    [dbEnd, setDbEnd] = useState(""),
    [dbSort, setDbSort] = useState("fecha_hora"),
    [dbBusy, setDbBusy] = useState(false),
    [loadMs, setLoadMs] = useState<number | null>(null),
    [selectionMs, setSelectionMs] = useState(0)
  const days =
      start && end
        ? (Date.parse(end + "T00:00Z") - Date.parse(start + "T00:00Z")) /
            86400000 +
          1
        : 0,
    validPeriod = days >= 1 && days <= 31 && cities.length > 0
  const filterMs = useRef(0)
  const filtered = useMemo(() => {
    const started = performance.now()
    if (!data) {
      filterMs.current = performance.now() - started
      return []
    }
    const rows = data.transformed
      .filter(
        (r) =>
          (!filters.city.length || filters.city.includes(r.ciudad)) &&
          (!filters.from || r.fecha_hora.slice(0, 16) >= filters.from) &&
          (!filters.to || r.fecha_hora.slice(0, 16) <= filters.to) &&
          (filters.minT === "" || r.temperatura_c >= +filters.minT) &&
          (filters.maxT === "" || r.temperatura_c <= +filters.maxT) &&
          (filters.minH === "" || r.humedad_pct >= +filters.minH) &&
          (filters.maxH === "" || r.humedad_pct <= +filters.maxH) &&
          (filters.minP === "" || r.precipitacion_mm >= +filters.minP) &&
          (filters.maxP === "" || r.precipitacion_mm <= +filters.maxP) &&
          (!filters.rain || r.precipitacion_mm > 0)
      )
      .sort((a, b) => {
        const x = a[sort],
          y = b[sort]
        return (
          (typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x).localeCompare(String(y))) * (desc ? -1 : 1)
        )
      })
    filterMs.current = performance.now() - started
    return rows
  }, [data, filters, sort, desc])
  const selectedIn = filtered.filter((r) => selected.has(key(r))).length,
    selectedOut = selected.size - selectedIn,
    visible = filtered.slice(page * PAGE, (page + 1) * PAGE)
  async function extract(only?: CityId[]) {
    const targets = only ?? cities
    let failed = false
    setWorking(true)
    setMsg("")
    if (!only) {
      setData(null)
      setSelected(new Set())
      setCityProgress(
        Object.fromEntries(targets.map((id) => [id, "Pendiente"]))
      )
    }
    for (const id of targets)
      setCityProgress((p) => ({ ...p, [id]: "En curso" }))
    try {
      await Promise.all(
        targets.map(async (id) => {
          try {
            const result: Extraction = await request({
              action: "extract",
              startDate: start,
              endDate: end,
              cities: [id],
            })
            const currentCity = result.cities[0]
            setCityProgress((p) => ({
              ...p,
              [id]: currentCity?.error ? "Con errores" : "Completada",
            }))
            if (currentCity?.error) failed = true
            setData((old) => {
              const name = CITIES.find((c) => c.id === id)!.name
              const keep = old?.cities.filter((c) => c.ciudad !== name) ?? []
              return {
                cities: [...keep, ...result.cities],
                transformed: [
                  ...(old?.transformed.filter((r) => r.ciudad !== name) ?? []),
                  ...result.transformed,
                ],
                rejected: [
                  ...(old?.rejected.filter((r) => r.ciudad !== name) ?? []),
                  ...result.rejected,
                ],
                rawCount: (old?.rawCount ?? 0) + result.rawCount,
                extractionMs: (old?.extractionMs ?? 0) + result.extractionMs,
                transformMs: (old?.transformMs ?? 0) + result.transformMs,
              }
            })
          } catch (e) {
            failed = true
            setCityProgress((p) => ({ ...p, [id]: "Error" }))
            setMsg(e instanceof Error ? e.message : "Error de descarga")
          }
        })
      )
      setPage(0)
      setTab("válidos")
      if (!failed) setMsg("Extracción completada.")
    } finally {
      setWorking(false)
    }
  }
  async function refreshDatabase(p = dbPage) {
    setDbBusy(true)
    try {
      const r = await request({
        action: "read",
        page: p,
        pageSize: PAGE,
        city: dbCity || undefined,
        startDate: dbStart || undefined,
        endDate: dbEnd || undefined,
        sort: dbSort,
      })
      setPersisted(r.rows)
      setDbCount(r.count)
      setDbPage(p)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo consultar Supabase.")
    } finally {
      setDbBusy(false)
    }
  }
  async function load() {
    const started = performance.now(),
      snapshot = filtered.filter((r) => selected.has(key(r)))
    if (!snapshot.length) return
    const groups = Array.from(
      { length: Math.ceil(snapshot.length / 500) },
      (_, i) => snapshot.slice(i * 500, (i + 1) * 500)
    )
    setBatches(groups)
    setWorking(true)
    setLoads(groups.map(() => ({ status: "Pendiente", processed: 0 })))
    setMsg("")
    let verified = 0,
      failed = 0
    for (let i = 0; i < groups.length; i++) {
      setLoads((v) =>
        v.map((x, j) => (j === i ? { ...x, status: "En curso" } : x))
      )
      try {
        const res = await request({ action: "load", rows: groups[i] })
        if (res.verified !== groups[i].length)
          throw new Error(
            "La verificación no encontró todas las claves en destino."
          )
        verified += res.verified
        setLoads((v) =>
          v.map((x, j) =>
            j === i
              ? { ...x, status: "Completado", processed: res.verified }
              : x
          )
        )
      } catch (e) {
        failed++
        setLoads((v) =>
          v.map((x, j) =>
            j === i
              ? {
                  ...x,
                  status: "Fallido",
                  error: e instanceof Error ? e.message : "Error",
                }
              : x
          )
        )
      }
    }
    setLoadMs(performance.now() - started)
    setWorking(false)
    setMsg(
      `Carga finalizada: ${verified} registros verificados; ${failed} lotes fallidos.`
    )
    void refreshDatabase(0)
  }
  async function retryFailures() {
    const failed = loads.flatMap((l, i) => (l.status === "Fallido" ? [i] : []))
    setWorking(true)
    for (const i of failed) {
      const part = batches[i]
      if (!part?.length) continue
      setLoads((v) =>
        v.map((x, j) => (j === i ? { ...x, status: "En curso" } : x))
      )
      try {
        const res = await request({ action: "load", rows: part })
        if (res.verified !== part.length)
          throw new Error(
            "La verificación no encontró todas las claves en destino."
          )
        setLoads((v) =>
          v.map((x, j) =>
            j === i
              ? { ...x, status: "Completado", processed: res.verified }
              : x
          )
        )
      } catch (e) {
        setLoads((v) =>
          v.map((x, j) =>
            j === i
              ? {
                  ...x,
                  status: "Fallido",
                  error: e instanceof Error ? e.message : "Error",
                }
              : x
          )
        )
      }
    }
    setWorking(false)
    void refreshDatabase(0)
  }
  function changeFilter<K extends keyof Filters>(k: K, v: Filters[K]) {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(0)
  }
  function toggle(r: WeatherRow) {
    const started = performance.now(),
      k = key(r)
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
    setSelectionMs(performance.now() - started)
  }
  const fields: { key: keyof WeatherRow; label: string }[] = [
    { key: "ciudad", label: "Ciudad" },
    { key: "fecha_hora", label: "Fecha y hora (UTC)" },
    { key: "temperatura_c", label: "Temperatura °C" },
    { key: "humedad_pct", label: "Humedad %" },
    { key: "precipitacion_mm", label: "Precipitación mm" },
  ]
  return (
    <main className="min-h-screen bg-[#f5f7f6] text-slate-900">
      <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-7">
        <header className="flex items-center justify-between">
          <a className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-emerald-800 text-white">
              <Waves />
            </span>
            <span>
              <b className="block">MeteoLab</b>
              <small className="text-slate-500">Práctica ETL · Big Data</small>
            </span>
          </a>
          <span className="rounded-full border bg-white px-3 py-2 text-xs">
            Open-Meteo{" "}
            <span aria-label="y" className="mx-1">
              →
            </span>{" "}
            Supabase
          </span>
        </header>
        <section className="mt-9 max-w-3xl">
          <p className="text-xs font-bold tracking-[.18em] text-emerald-800 uppercase">
            Laboratorio de datos climáticos
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            El tiempo, dato a dato.
          </h1>
          <p className="mt-3 leading-7 text-slate-600">
            Sigue cada fase, inspecciona los rechazos y decide exactamente qué
            registros pasan a la base de datos.
          </p>
        </section>
        <section
          className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
          aria-label="Fases del pipeline"
        >
          {[
            "Extracción",
            "Transformación",
            "Limpieza",
            "Filtrado y selección",
            "Carga",
          ].map((name, i) => (
            <article key={name} className="rounded-xl border bg-white p-4">
              <div className="flex justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase">
                  0{i + 1} · {name}
                </span>
                <span
                  className="text-xs font-semibold"
                  aria-label={
                    i === 0
                      ? data
                        ? "Completada"
                        : "Pendiente"
                      : i < 4
                        ? data
                          ? "Completada"
                          : "Pendiente"
                        : loads.some((x) => x.status === "Fallido")
                          ? "Con errores"
                          : loads.length
                            ? "Completada"
                            : "Pendiente"
                  }
                >
                  {i === 0
                    ? data
                      ? "✓ Completada"
                      : "○ Pendiente"
                    : i < 4
                      ? data
                        ? "✓ Completada"
                        : "○ Pendiente"
                      : loads.some((x) => x.status === "Fallido")
                        ? "! Con errores"
                        : loads.length
                          ? "✓ Completada"
                          : "○ Pendiente"}
                </span>
              </div>
              <p className="mt-3 text-sm font-medium">
                {i === 0
                  ? `${data?.cities.length ?? 0} ciudades → ${data?.rawCount ?? 0} filas horarias`
                  : i === 1
                    ? `${data?.rawCount ?? 0} filas → ${(data?.transformed.length ?? 0) + (data?.rejected.length ?? 0)} filas transformadas`
                    : i === 2
                      ? `${(data?.transformed.length ?? 0) + (data?.rejected.length ?? 0)} filas → ${data?.transformed.length ?? 0} válidas · ${data?.rejected.length ?? 0} rechazadas`
                      : i === 3
                        ? `${data?.transformed.length ?? 0} válidas → ${filtered.length} filtradas · ${selectedIn} seleccionadas`
                        : loads.length
                          ? `${selectedIn} seleccionadas → ${loads.reduce((n, x) => n + x.processed, 0)} verificadas · ${loads.filter((x) => x.status === "Completado").length}/${loads.length} lotes`
                          : "En espera"}
              </p>
              <small className="mt-1 block text-xs text-slate-500">
                {i === 0 && data
                  ? `Duración real: ${(data.extractionMs / 1000).toFixed(2)} s`
                  : i === 1 && data
                    ? `Duración real: ${(data.transformMs / 1000).toFixed(3)} s`
                    : i === 2 && data
                      ? `Limpieza incluida: ${(data.transformMs / 1000).toFixed(3)} s`
                      : i === 3 && data
                        ? `Filtro y orden: ${filterMs.current.toFixed(3)} ms · último cambio de selección: ${selectionMs.toFixed(3)} ms`
                        : i === 4 && loadMs !== null
                          ? `Carga y verificación: ${(loadMs / 1000).toFixed(2)} s`
                          : "Duración disponible al finalizar"}
              </small>
            </article>
          ))}
        </section>
        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-2xl border bg-white p-5">
            <h2 className="font-semibold">Configuración de extracción</h2>
            <p className="mt-1 text-xs text-slate-500">
              1 hora por ciudad = 1 registro.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs">
                Desde
                <input
                  className="field"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label className="text-xs">
                Hasta
                <input
                  className="field"
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Volumen previsto: {validPeriod ? cities.length * days * 24 : 0}{" "}
              filas ({cities.length} ciudades × {days > 0 ? days : 0} días × 24
              h)
            </p>
            {!validPeriod && (
              <p role="alert" className="mt-2 text-xs text-rose-700">
                Elige una ciudad y un periodo válido de hasta 31 días.
              </p>
            )}
            <div className="mt-5 space-y-2">
              <b className="text-xs tracking-wide text-slate-500 uppercase">
                Ciudades
              </b>
              {CITIES.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cities.includes(c.id)}
                    onChange={() =>
                      setCities((x) =>
                        x.includes(c.id)
                          ? x.filter((v) => v !== c.id)
                          : [...x, c.id]
                      )
                    }
                  />
                  {c.name}
                  <span className="ml-auto text-xs text-slate-400">
                    {c.latitude.toFixed(2)}, {c.longitude.toFixed(2)}
                  </span>
                </label>
              ))}
            </div>
            <Button
              disabled={!validPeriod || working}
              onClick={() => extract()}
              className="mt-5 w-full bg-emerald-800 text-white hover:bg-emerald-900"
            >
              {working ? <LoaderCircle className="animate-spin" /> : <Play />}
              Extraer datos
            </Button>
            {Object.entries(cityProgress).map(([id, status]) => (
              <p key={id} className="mt-2 text-xs" aria-live="polite">
                {CITIES.find((c) => c.id === id)?.name}: <b>{status}</b>
                {status === "Error" && (
                  <button
                    className="ml-2 underline"
                    onClick={() => extract([id as CityId])}
                  >
                    Reintentar ciudad
                  </button>
                )}
              </p>
            ))}
            {data?.cities
              .filter((c) => c.error)
              .map((c) => (
                <div
                  className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800"
                  key={c.ciudad}
                >
                  <b>{c.ciudad}:</b> {c.error}
                  <button
                    className="ml-2 underline"
                    onClick={() =>
                      extract([CITIES.find((x) => x.name === c.ciudad)!.id])
                    }
                  >
                    Reintentar ciudad
                  </button>
                </div>
              ))}
          </aside>
          <section className="min-w-0 space-y-4">
            <div className="rounded-2xl border bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Inspección del pipeline</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    La paginación cambia la vista, nunca el conjunto filtrado o
                    seleccionado.
                  </p>
                </div>
                {data && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      save(
                        "open-meteo-original.json",
                        JSON.stringify(data.cities, null, 2)
                      )
                    }
                  >
                    <ArrowDownToLine size={16} />
                    Descargar JSON original
                  </Button>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  "original",
                  "transformados",
                  "válidos",
                  "rechazados",
                  "vista previa",
                  "datos en Supabase",
                ].map((x) => (
                  <button
                    key={x}
                    onClick={() => {
                      setTab(x)
                      if (x === "datos en Supabase") void refreshDatabase(0)
                    }}
                    className={`rounded-lg px-3 py-2 text-sm ${tab === x ? "bg-emerald-800 text-white" : "bg-slate-100 text-slate-700"}`}
                  >
                    {x[0].toUpperCase() + x.slice(1)}
                  </button>
                ))}
              </div>
              {tab === "original" ? (
                <div className="mt-4 space-y-2">
                  {data?.cities.map((c) => (
                    <details key={c.ciudad} className="rounded-lg border p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        {c.ciudad}{" "}
                        {c.error
                          ? `· Error: ${c.error}`
                          : "· Respuesta original"}
                      </summary>
                      <pre className="mt-3 max-h-80 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
                        {JSON.stringify(c.datos, null, 2)}
                      </pre>
                    </details>
                  )) ?? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      Ejecuta una extracción para conservar los JSON en esta
                      sesión.
                    </p>
                  )}
                </div>
              ) : tab === "datos en Supabase" ? (
                <div>
                  <div className="mt-4 flex flex-wrap items-end gap-2">
                    <label className="text-xs">
                      Ciudad
                      <select
                        className="field"
                        value={dbCity}
                        onChange={(e) => setDbCity(e.target.value)}
                      >
                        <option value="">Todas</option>
                        {CITIES.map((c) => (
                          <option key={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs">
                      Desde
                      <input
                        type="date"
                        className="field"
                        value={dbStart}
                        onChange={(e) => setDbStart(e.target.value)}
                      />
                    </label>
                    <label className="text-xs">
                      Hasta
                      <input
                        type="date"
                        className="field"
                        value={dbEnd}
                        onChange={(e) => setDbEnd(e.target.value)}
                      />
                    </label>
                    <label className="text-xs">
                      Ordenar
                      <select
                        className="field"
                        value={dbSort}
                        onChange={(e) => setDbSort(e.target.value)}
                      >
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      variant="outline"
                      onClick={() => refreshDatabase(0)}
                      disabled={dbBusy}
                    >
                      <RefreshCw
                        size={15}
                        className={dbBusy ? "animate-spin" : ""}
                      />
                      Actualizar
                    </Button>
                  </div>
                  <p className="mt-3 text-sm">
                    Registros persistidos: <b>{dbCount}</b>. Los datos de esta
                    pestaña ya están guardados en Supabase.
                  </p>
                  <Table
                    rows={persisted}
                    fields={fields}
                    empty="No hay registros persistidos o no se pudo consultar Supabase."
                  />
                  <Pager
                    page={dbPage}
                    count={dbCount}
                    size={PAGE}
                    set={refreshDatabase}
                  />
                </div>
              ) : !data ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  Ejecuta una extracción para inspeccionar los resultados.
                </p>
              ) : (
                <div>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      ["Extraídos", data.rawCount],
                      ["Válidos", data.transformed.length],
                      ["Rechazados", data.rejected.length],
                      ["Coinciden", filtered.length],
                      ["Seleccionados", selectedIn],
                    ].map(([l, n]) => (
                      <div
                        className="rounded-lg bg-slate-50 p-3"
                        key={String(l)}
                      >
                        <small className="block text-slate-500">{l}</small>
                        <b>{n}</b>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-end gap-2">
                    <label className="text-xs">
                      Ciudad
                      <select
                        multiple
                        className="field h-[76px] min-w-32"
                        value={filters.city}
                        onChange={(e) =>
                          changeFilter(
                            "city",
                            Array.from(e.target.selectedOptions, (o) => o.value)
                          )
                        }
                      >
                        {CITIES.map((c) => (
                          <option key={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs">
                      Desde UTC
                      <input
                        className="field"
                        type="datetime-local"
                        value={filters.from}
                        onChange={(e) => changeFilter("from", e.target.value)}
                      />
                    </label>
                    <label className="text-xs">
                      Hasta UTC
                      <input
                        className="field"
                        type="datetime-local"
                        value={filters.to}
                        onChange={(e) => changeFilter("to", e.target.value)}
                      />
                    </label>
                    {(
                      [
                        ["minT", "T. mín °C"],
                        ["maxT", "T. máx °C"],
                        ["minH", "H. mín %"],
                        ["maxH", "H. máx %"],
                        ["minP", "P. mín mm"],
                        ["maxP", "P. máx mm"],
                      ] as const
                    ).map(([k, l]) => (
                      <label key={k} className="text-xs">
                        {l}
                        <input
                          className="field w-24"
                          type="number"
                          value={filters[k]}
                          onChange={(e) => changeFilter(k, e.target.value)}
                        />
                      </label>
                    ))}
                    <label className="flex items-center gap-1 pb-2 text-xs">
                      <input
                        type="checkbox"
                        checked={filters.rain}
                        onChange={(e) => changeFilter("rain", e.target.checked)}
                      />
                      Solo con lluvia (&gt; 0 mm)
                    </label>
                    <label className="text-xs">
                      Ordenar
                      <select
                        className="field"
                        value={sort}
                        onChange={(e) =>
                          setSort(e.target.value as keyof WeatherRow)
                        }
                      >
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      variant="outline"
                      onClick={() => setDesc((x) => !x)}
                    >
                      {desc ? "Descendente" : "Ascendente"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setFilters(emptyFilters)
                        setPage(0)
                      }}
                    >
                      Restablecer filtros
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setSelected(new Set())}
                    >
                      Vaciar selección
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        setSelected(
                          (s) => new Set([...s, ...filtered.map(key)])
                        )
                      }
                    >
                      Seleccionar las {filtered.length} coincidentes
                    </Button>
                  </div>
                  {tab === "transformados" ? (
                    <div>
                      <Table
                        rows={data.transformed.slice(
                          page * PAGE,
                          (page + 1) * PAGE
                        )}
                        fields={fields}
                        empty="Sin filas transformadas."
                      />
                      <Pager
                        page={page}
                        count={data.transformed.length}
                        size={PAGE}
                        set={setPage}
                      />
                    </div>
                  ) : tab === "rechazados" ? (
                    <div>
                      <RejectedTable
                        rows={data.rejected.slice(
                          page * PAGE,
                          (page + 1) * PAGE
                        )}
                      />
                      <Pager
                        page={page}
                        count={data.rejected.length}
                        size={PAGE}
                        set={setPage}
                      />
                    </div>
                  ) : (
                    <div>
                      <p className="mt-3 text-xs text-slate-500">
                        Los seleccionados que dejan de cumplir los filtros no se
                        enviarán: {selectedOut}. La vista previa conserva el
                        orden elegido. La base de datos no conserva el orden de
                        inserción; las consultas necesitan ORDER BY.
                      </p>
                      <Table
                        rows={(tab === "vista previa"
                          ? filtered.filter((r) => selected.has(key(r)))
                          : visible
                        ).slice(page * PAGE, (page + 1) * PAGE)}
                        fields={fields}
                        selectable={tab !== "vista previa"}
                        selected={selected}
                        toggle={toggle}
                        empty={
                          tab === "vista previa"
                            ? "Selecciona filas válidas para crear la vista previa."
                            : "No hay filas que coincidan con los filtros."
                        }
                      />
                      <Pager
                        page={page}
                        count={
                          tab === "vista previa" ? selectedIn : filtered.length
                        }
                        size={PAGE}
                        set={setPage}
                      />
                      {tab === "válidos" && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-emerald-50 p-3">
                          <span className="text-sm">
                            {selectedIn} seleccionados para cargar
                          </span>
                          <Button
                            disabled={working || !selectedIn}
                            onClick={load}
                            className="bg-emerald-800 text-white"
                          >
                            <Upload size={16} />
                            Subir {selectedIn} registros a Supabase
                          </Button>
                        </div>
                      )}
                      {loads.length > 0 && (
                        <div className="mt-4 rounded-lg border p-3">
                          <b className="text-sm">Resultado de lotes</b>
                          {loadMs !== null && (
                            <p className="mt-2 text-xs">
                              Duración total real, incluida la verificación:{" "}
                              {(loadMs / 1000).toFixed(2)} s.
                            </p>
                          )}
                          {loads.map((l, i) => (
                            <p className="mt-2 text-xs" key={i}>
                              Lote {i + 1}: <b>{l.status}</b> · verificados{" "}
                              {l.processed}
                              {l.error ? ` · ${l.error}` : ""}
                            </p>
                          ))}
                          {loads.some((x) => x.status === "Fallido") && (
                            <Button
                              className="mt-3"
                              variant="outline"
                              disabled={working}
                              onClick={retryFailures}
                            >
                              Reintentar lotes fallidos
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {msg && (
              <p
                role="status"
                className="rounded-lg border bg-white p-3 text-sm"
              >
                {msg}
              </p>
            )}
          </section>
        </div>
        <footer className="mt-6 flex items-center gap-2 text-xs text-slate-500">
          <Database size={14} />
          Escritura en servidor. No se configura autenticación: habilitado solo
          para desarrollo local; protege los endpoints antes de publicar.
        </footer>
      </div>
    </main>
  )
}
function Table({
  rows,
  fields,
  empty,
  selectable = false,
  selected,
  toggle,
}: {
  rows: WeatherRow[]
  fields: { key: keyof WeatherRow; label: string }[]
  empty: string
  selectable?: boolean
  selected?: Set<string>
  toggle?: (r: WeatherRow) => void
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            {selectable && <th className="p-3">Elegir</th>}
            {fields.map((f) => (
              <th className="p-3" key={f.key}>
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr className="border-t" key={key(r) + i}>
                {selectable && (
                  <td className="p-3">
                    <input
                      aria-label={`Seleccionar ${r.ciudad} ${r.fecha_hora}`}
                      type="checkbox"
                      checked={selected?.has(key(r)) ?? false}
                      onChange={() => toggle?.(r)}
                    />
                  </td>
                )}
                {fields.map((f) => (
                  <td
                    className="p-3 whitespace-nowrap tabular-nums"
                    key={f.key}
                  >
                    {typeof r[f.key] === "number"
                      ? fmt(r[f.key] as number)
                      : r[f.key]}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                className="p-8 text-center text-sm text-slate-500"
                colSpan={fields.length + (selectable ? 1 : 0)}
              >
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
function RejectedTable({ rows }: { rows: RejectedRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[700px] text-left text-sm">
        <thead className="bg-slate-50 text-xs">
          <tr>
            {["Ciudad", "Fecha y hora", "Motivo", "Valores originales"].map(
              (x) => (
                <th className="p-3" key={x}>
                  {x}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="p-3">{r.ciudad}</td>
              <td className="p-3">{r.fecha_hora}</td>
              <td className="p-3 text-rose-800">{r.motivo}</td>
              <td className="p-3 font-mono text-xs">
                {JSON.stringify(r.datos)}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td className="p-8 text-center" colSpan={4}>
                No hay registros rechazados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
function Pager({
  page,
  count,
  size,
  set,
}: {
  page: number
  count: number
  size: number
  set: (page: number) => void | Promise<void>
}) {
  return (
    <div className="mt-3 flex items-center justify-end gap-3 text-xs text-slate-600">
      <span>
        {count
          ? `${page * size + 1}–${Math.min(count, (page + 1) * size)} de ${count}`
          : "0 registros"}
      </span>
      <Button
        variant="outline"
        size="icon"
        disabled={page === 0}
        onClick={() => set(page - 1)}
        aria-label="Página anterior"
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="outline"
        size="icon"
        disabled={(page + 1) * size >= count}
        onClick={() => set(page + 1)}
        aria-label="Página siguiente"
      >
        <ChevronRight />
      </Button>
    </div>
  )
}
