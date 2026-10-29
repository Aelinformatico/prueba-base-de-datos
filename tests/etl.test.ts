import assert from "node:assert/strict"
import test from "node:test"
import { transform } from "../lib/weather-transform.ts"

test("convierte arrays horarios paralelos a registros normalizados con UTC explícito", () => {
  const result = transform([
    {
      ciudad: "Barcelona",
      datos: {
        hourly: {
          time: ["2026-09-01T00:00", "2026-09-01T01:00"],
          temperature_2m: [18.2, 17.8],
          relative_humidity_2m: [70, 72],
          precipitation: [0, 0.2],
        },
      },
    },
  ])
  assert.equal(result.transformed.length, 2)
  assert.equal(result.transformed[0].fecha_hora, "2026-09-01T00:00:00Z")
  assert.equal(result.transformed[1].precipitacion_mm, 0.2)
  assert.equal(result.rejected.length, 0)
})

test("un fixture de una ciudad y un día produce 24 filas horarias", () => {
  const times = Array.from(
    { length: 24 },
    (_, hour) => `2026-09-01T${String(hour).padStart(2, "0")}:00`
  )
  const result = transform([
    {
      ciudad: "Barcelona",
      datos: {
        hourly: {
          time: times,
          temperature_2m: times.map(() => 20),
          relative_humidity_2m: times.map(() => 60),
          precipitation: times.map(() => 0),
        },
      },
    },
  ])
  assert.equal(result.transformed.length, 24)
  assert.equal(result.transformed[23].fecha_hora, "2026-09-01T23:00:00Z")
})

test("rechaza null sin convertirlo en cero y registra el motivo", () => {
  const result = transform([
    {
      ciudad: "Madrid",
      datos: {
        hourly: {
          time: ["2026-09-01T00:00"],
          temperature_2m: [null],
          relative_humidity_2m: [55],
          precipitation: [0],
        },
      },
    },
  ])
  assert.equal(result.transformed.length, 0)
  assert.match(result.rejected[0].motivo, /null no se convierte en cero/)
})

test("elimina duplicados por ciudad y hora y conserva el primer registro", () => {
  const hourly = {
    time: ["2026-09-01T00:00", "2026-09-01T00:00"],
    temperature_2m: [18, 99],
    relative_humidity_2m: [50, 50],
    precipitation: [0, 0],
  }
  const result = transform([{ ciudad: "Sevilla", datos: { hourly } }])
  assert.equal(result.transformed.length, 1)
  assert.equal(result.transformed[0].temperatura_c, 18)
  assert.match(result.rejected[0].motivo, /se conserva la primera/)
})

test("rechaza arrays con longitudes incoherentes", () => {
  const result = transform([
    {
      ciudad: "Bilbao",
      datos: {
        hourly: {
          time: ["2026-09-01T00:00"],
          temperature_2m: [],
          relative_humidity_2m: [55],
          precipitation: [0],
        },
      },
    },
  ])
  assert.equal(result.transformed.length, 0)
  assert.match(result.rejected[0].motivo, /longitudes incoherentes/)
})

test("rechaza fechas de calendario imposibles aunque JavaScript pueda normalizarlas", () => {
  const result = transform([
    {
      ciudad: "Valencia",
      datos: {
        hourly: {
          time: ["2026-02-30T12:00"],
          temperature_2m: [20],
          relative_humidity_2m: [50],
          precipitation: [0],
        },
      },
    },
  ])
  assert.equal(result.transformed.length, 0)
  assert.match(result.rejected[0].motivo, /Fecha\/hora UTC no válida/)
})

test("rechaza cadenas vacías y valores ausentes en las mediciones", () => {
  const result = transform([
    {
      ciudad: "Barcelona",
      datos: {
        hourly: {
          time: ["2026-09-01T00:00", "2026-09-01T01:00"],
          temperature_2m: ["", undefined],
          relative_humidity_2m: [50, 50],
          precipitation: [0, 0],
        },
      },
    },
  ])
  assert.equal(result.transformed.length, 0)
  assert.equal(result.rejected.length, 2)
  assert.ok(
    result.rejected.every((row) => /medición numérica finita/.test(row.motivo))
  )
})
