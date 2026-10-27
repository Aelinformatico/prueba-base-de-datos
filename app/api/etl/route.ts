import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import {
  CITIES,
  isCityId,
  isWeatherRow,
  type CityId,
  type RawCity,
  type WeatherRow,
} from "@/lib/etl"
import { transform } from "@/lib/weather-transform"

export const runtime = "nodejs"
const SOURCE = "https://archive-api.open-meteo.com/v1/archive"
const DAY = 86_400_000
let loading = false
type Body = Record<string, unknown>
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status })
function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\d$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === v
}
function period(a: unknown, b: unknown) {
  if (!validDate(a) || !validDate(b)) return "Indica fechas válidas."
  const days =
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY + 1
  return days < 1 || days > 31
    ? "El periodo debe tener entre 1 y 31 días."
    : null
}
function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key)
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local."
    )
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function getCity(
  id: CityId,
  start: string,
  end: string
): Promise<RawCity> {
  const city = CITIES.find((c) => c.id === id)!
  const url = new URL(SOURCE)
  url.search = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    start_date: start,
    end_date: end,
    hourly: "temperature_2m,relative_humidity_2m,precipitation",
    timezone: "GMT",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  }).toString()
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    })
    const data: unknown = await res.json()
    if (!res.ok) throw new Error(`Open-Meteo respondió HTTP ${res.status}.`)
    if (
      !data ||
      typeof data !== "object" ||
      !("hourly" in data) ||
      !(data as { hourly?: unknown }).hourly
    )
      throw new Error("Respuesta horaria ausente.")
    return { ciudad: city.name, datos: data }
  } catch (e) {
    return {
      ciudad: city.name,
      datos: null,
      error: e instanceof Error ? e.message : "Error de red.",
    }
  }
}

async function post(request: Request, b: Body) {
  if (b.action === "extract") {
    const extractionStarted = performance.now()
    const dateError = period(b.startDate, b.endDate)
    if (dateError) return fail(dateError)
    if (
      !Array.isArray(b.cities) ||
      !b.cities.length ||
      b.cities.length > CITIES.length ||
      !b.cities.every(isCityId)
    )
      return fail("Selecciona al menos una ciudad válida.")
    const ids = [...new Set(b.cities as CityId[])]
    const cities = await Promise.all(
      ids.map((id) => getCity(id, b.startDate as string, b.endDate as string))
    )
    const extractionMs = performance.now() - extractionStarted
    const transformStarted = performance.now()
    const processed = transform(cities)
    const transformMs = performance.now() - transformStarted
    return NextResponse.json({
      cities,
      ...processed,
      extractionMs,
      transformMs,
      rawCount: cities.reduce(
        (n, c) =>
          n +
          (c.datos &&
          typeof c.datos === "object" &&
          "hourly" in c.datos &&
          Array.isArray(
            (c.datos as { hourly: { time?: unknown[] } }).hourly?.time
          )
            ? (c.datos as { hourly: { time: unknown[] } }).hourly.time.length
            : 0),
        0
      ),
    })
  }
  if (b.action === "load") {
    if (loading)
      return fail("Ya hay una carga en curso. Espera a que termine.", 409)
    if (
      !Array.isArray(b.rows) ||
      !b.rows.length ||
      b.rows.length > 500 ||
      !b.rows.every(isWeatherRow)
    )
      return fail("Cada lote debe contener entre 1 y 500 registros válidos.")
    if (
      new Set(
        (b.rows as WeatherRow[]).map((r) => `${r.ciudad}|${r.fecha_hora}`)
      ).size !== b.rows.length
    )
      return fail("El lote contiene claves ciudad/fecha duplicadas.")
    loading = true
    try {
      const rows = b.rows as WeatherRow[],
        db = client()
      const safeRows = rows.map(
        ({
          ciudad,
          fecha_hora,
          temperatura_c,
          humedad_pct,
          precipitacion_mm,
        }) => ({
          ciudad,
          fecha_hora,
          temperatura_c,
          humedad_pct,
          precipitacion_mm,
        })
      )
      const { data, error } = await db
        .from("mediciones_meteorologicas")
        .upsert(safeRows, { onConflict: "ciudad,fecha_hora" })
        .select("ciudad,fecha_hora")
      if (error) return fail(`Supabase rechazó el lote: ${error.message}`, 502)
      const keys = new Set(
        (data ?? []).map((r) => `${r.ciudad}|${r.fecha_hora}`)
      )
      const { data: verified, error: verifyError } = await db
        .from("mediciones_meteorologicas")
        .select("ciudad,fecha_hora")
        .in("ciudad", [...new Set(rows.map((r) => r.ciudad))])
        .in(
          "fecha_hora",
          rows.map((r) => r.fecha_hora)
        )
      if (verifyError)
        return NextResponse.json(
          {
            error: `Lote procesado pero falló la verificación: ${verifyError.message}`,
            processed: data?.length ?? 0,
          },
          { status: 502 }
        )
      const found = new Set(
        (verified ?? []).map((r) => `${r.ciudad}|${r.fecha_hora}`)
      )
      const missing = rows
        .filter((r) => !found.has(`${r.ciudad}|${r.fecha_hora}`))
        .map((r) => `${r.ciudad} ${r.fecha_hora}`)
      return NextResponse.json({
        processed: data?.length ?? 0,
        verified: rows.length - missing.length,
        missing,
        returnedKeys: keys.size,
      })
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Error de carga.", 503)
    } finally {
      loading = false
    }
  }
  if (b.action === "read") {
    try {
      const db = client(),
        page = Number(b.page ?? 0),
        size = Math.min(100, Math.max(1, Number(b.pageSize ?? 25)))
      if (!Number.isInteger(page) || page < 0) return fail("Página no válida.")
      let q = db
        .from("mediciones_meteorologicas")
        .select(
          "id,ciudad,fecha_hora,temperatura_c,humedad_pct,precipitacion_mm,importado_en",
          { count: "exact" }
        )
      if (typeof b.city === "string" && CITIES.some((c) => c.name === b.city))
        q = q.eq("ciudad", b.city)
      if (validDate(b.startDate))
        q = q.gte("fecha_hora", `${b.startDate}T00:00:00Z`)
      if (validDate(b.endDate))
        q = q.lte("fecha_hora", `${b.endDate}T23:59:59Z`)
      const sort = [
        "ciudad",
        "fecha_hora",
        "temperatura_c",
        "humedad_pct",
        "precipitacion_mm",
        "importado_en",
      ].includes(String(b.sort))
        ? String(b.sort)
        : "fecha_hora"
      const { data, error, count } = await q
        .order(sort, { ascending: b.direction !== "desc" })
        .range(page * size, page * size + size - 1)
      if (error)
        return fail(`No se pudieron consultar los datos: ${error.message}`, 502)
      return NextResponse.json({
        rows: data ?? [],
        count: count ?? 0,
        page,
        pageSize: size,
      })
    } catch (e) {
      return fail(
        e instanceof Error ? e.message : "Configura Supabase para consultar.",
        503
      )
    }
  }
  return fail("Acción no reconocida.")
}
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (length > 8_000_000)
    return fail("La solicitud supera el tamaño máximo de 8 MB.", 413)
  let body: Body
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > 8_000_000)
      return fail("La solicitud supera el tamaño máximo de 8 MB.", 413)
    body = JSON.parse(text) as Body
  } catch {
    return fail("El cuerpo debe ser JSON válido.")
  }
  return post(request, body)
}
