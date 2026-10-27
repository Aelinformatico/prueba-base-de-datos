import type { RawCity, RejectedRow, WeatherRow } from "./etl.ts"

export function transform(raw: RawCity[]) {
  const transformed: WeatherRow[] = [],
    rejected: RejectedRow[] = [],
    seen = new Set<string>()
  for (const city of raw) {
    if (city.error || !city.datos || typeof city.datos !== "object") continue
    const hourly = (city.datos as { hourly?: Record<string, unknown> }).hourly
    const times = hourly?.time,
      temps = hourly?.temperature_2m,
      humidity = hourly?.relative_humidity_2m,
      rain = hourly?.precipitation
    if (
      ![times, temps, humidity, rain].every(Array.isArray) ||
      (times as unknown[]).length !== (temps as unknown[]).length ||
      (times as unknown[]).length !== (humidity as unknown[]).length ||
      (times as unknown[]).length !== (rain as unknown[]).length
    ) {
      rejected.push({
        ciudad: city.ciudad,
        fecha_hora: "—",
        motivo: "Arrays horarios ausentes o con longitudes incoherentes.",
        datos: hourly,
      })
      continue
    }
    for (let i = 0; i < (times as unknown[]).length; i++) {
      const time = (times as unknown[])[i],
        t = (temps as unknown[])[i],
        h = (humidity as unknown[])[i],
        p = (rain as unknown[])[i]
      const iso =
        typeof time === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(time)
          ? `${time}:00Z`
          : ""
      let reason = ""
      if (!city.ciudad) reason = "Ciudad ausente."
      else if (!iso || !Number.isFinite(Date.parse(iso)))
        reason = "Fecha/hora UTC no válida."
      else if (
        ![t, h, p].every((v) => typeof v === "number" && Number.isFinite(v))
      )
        reason =
          "Falta una medición numérica finita (null no se convierte en cero)."
      else if ((h as number) < 0 || (h as number) > 100)
        reason = "Humedad fuera del intervalo 0–100 %."
      else if ((p as number) < 0) reason = "Precipitación negativa."
      if (reason) {
        rejected.push({
          ciudad: city.ciudad,
          fecha_hora: iso || String(time ?? "—"),
          motivo: reason,
          datos: { time, t, h, p },
        })
        continue
      }
      const row: WeatherRow = {
        ciudad: city.ciudad,
        fecha_hora: iso,
        temperatura_c: t as number,
        humedad_pct: h as number,
        precipitacion_mm: p as number,
      }
      const key = `${row.ciudad}|${row.fecha_hora}`
      if (seen.has(key)) {
        rejected.push({
          ciudad: row.ciudad,
          fecha_hora: row.fecha_hora,
          motivo: "Duplicado eliminado; se conserva la primera aparición.",
          datos: { time, t, h, p },
        })
        continue
      }
      seen.add(key)
      transformed.push(row)
    }
  }
  return { transformed, rejected }
}
