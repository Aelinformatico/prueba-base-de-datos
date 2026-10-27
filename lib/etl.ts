export const CITIES = [
  { id: "barcelona", name: "Barcelona", latitude: 41.3874, longitude: 2.1686 },
  { id: "madrid", name: "Madrid", latitude: 40.4168, longitude: -3.7038 },
  { id: "sevilla", name: "Sevilla", latitude: 37.3891, longitude: -5.9845 },
  { id: "bilbao", name: "Bilbao", latitude: 43.263, longitude: -2.935 },
  { id: "valencia", name: "Valencia", latitude: 39.4699, longitude: -0.3763 },
] as const

export type CityId = (typeof CITIES)[number]["id"]
export type WeatherRow = {
  ciudad: string
  fecha_hora: string
  temperatura_c: number
  humedad_pct: number
  precipitacion_mm: number
}
export type RejectedRow = {
  ciudad: string
  fecha_hora: string
  motivo: string
  datos: unknown
}
export type RawCity = { ciudad: string; datos: unknown; error?: string }
export const isCityId = (value: unknown): value is CityId =>
  typeof value === "string" && CITIES.some((city) => city.id === value)
export const getCityName = (id: CityId) =>
  CITIES.find((city) => city.id === id)!.name

export function isWeatherRow(value: unknown): value is WeatherRow {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return (
    typeof row.ciudad === "string" &&
    CITIES.some((c) => c.name === row.ciudad) &&
    typeof row.fecha_hora === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(row.fecha_hora) &&
    Number.isFinite(Date.parse(row.fecha_hora)) &&
    typeof row.temperatura_c === "number" &&
    Number.isFinite(row.temperatura_c) &&
    typeof row.humedad_pct === "number" &&
    Number.isFinite(row.humedad_pct) &&
    row.humedad_pct >= 0 &&
    row.humedad_pct <= 100 &&
    typeof row.precipitacion_mm === "number" &&
    Number.isFinite(row.precipitacion_mm) &&
    row.precipitacion_mm >= 0
  )
}
