import { describe, expect, it } from "vitest"
import { DEFAULT_FRAME } from "./geometry"
import {
  computeHeatGrid,
  countHeatFindings,
  DEFAULT_HEAT_FILTER,
  findingHeatWeight,
  HEAT_FULL_SCALE,
  HEAT_MIN_INTENSITY,
  heatColor,
  heatGridToRgba,
  heatPointsFor,
  heatScaleMax,
  hottestCell,
  type HeatFilter,
} from "./heatmap"
import type { FindingPin, LayerFrame } from "./types"

const TODAY = "2026-10-08"

function pin(over: Partial<FindingPin> = {}): FindingPin {
  return {
    finding_id: 1,
    project_id: 1,
    layer_id: 10,
    level: 0,
    x: 0.5,
    y: 0.5,
    category: "grieta",
    reported_by: 1,
    created_at: "2026-10-01T15:00:00.000Z",
    reported_at: "2026-10-01T15:00:00.000Z",
    title: "Grieta",
    description: null,
    severity: "high",
    status: "open",
    ...over,
  }
}

const ALL: HeatFilter = { status: "todos", period_days: null, categories: null }

describe("findingHeatWeight", () => {
  it("pesa por gravedad", () => {
    expect(findingHeatWeight(pin({ severity: "low" }), ALL, TODAY)).toBe(1)
    expect(findingHeatWeight(pin({ severity: "medium" }), ALL, TODAY)).toBe(2)
    expect(findingHeatWeight(pin({ severity: "high" }), ALL, TODAY)).toBe(4)
    expect(findingHeatWeight(pin({ severity: "critical" }), ALL, TODAY)).toBe(8)
  })

  it("solo abiertos excluye resueltos y cerrados; «todos» los incluye con menos peso", () => {
    expect(findingHeatWeight(pin({ status: "in_progress" }), DEFAULT_HEAT_FILTER, TODAY)).toBe(4)
    expect(findingHeatWeight(pin({ status: "resolved" }), DEFAULT_HEAT_FILTER, TODAY)).toBe(0)
    expect(findingHeatWeight(pin({ status: "closed" }), DEFAULT_HEAT_FILTER, TODAY)).toBe(0)
    expect(findingHeatWeight(pin({ status: "resolved" }), ALL, TODAY)).toBe(1)
  })

  it("filtra por categoría", () => {
    const f: HeatFilter = { ...ALL, categories: ["humedad_filtracion"] }
    expect(findingHeatWeight(pin({ category: "grieta" }), f, TODAY)).toBe(0)
    expect(findingHeatWeight(pin({ category: "humedad_filtracion" }), f, TODAY)).toBe(4)
    expect(findingHeatWeight(pin(), { ...ALL, categories: [] }, TODAY)).toBe(4)
  })

  it("el período cuenta en días de Chile e incluye hoy", () => {
    const f: HeatFilter = { ...ALL, period_days: 30 }
    // 2026-09-09 es el primer día de los últimos 30 (con hoy incluido).
    expect(findingHeatWeight(pin({ reported_at: "2026-09-09T12:00:00.000Z" }), f, TODAY)).toBe(4)
    expect(findingHeatWeight(pin({ reported_at: "2026-09-08T12:00:00.000Z" }), f, TODAY)).toBe(0)
    // 02:00 UTC del 9 de septiembre todavía es el 8 en Chile.
    expect(findingHeatWeight(pin({ reported_at: "2026-09-09T02:00:00.000Z" }), f, TODAY)).toBe(0)
    expect(findingHeatWeight(pin({ created_at: "fecha rota", reported_at: "fecha rota" }), f, TODAY)).toBe(0)
    expect(findingHeatWeight(pin({ created_at: "fecha rota", reported_at: "fecha rota" }), ALL, TODAY)).toBe(4)
  })

  it("el período usa la fecha del reporte, no la de su ubicación en el plano", () => {
    const f: HeatFilter = { ...ALL, period_days: 30 }
    const viejoUbicadoHoy = pin({ reported_at: "2026-05-01T12:00:00.000Z", created_at: "2026-10-08T12:00:00.000Z" })
    expect(findingHeatWeight(viejoUbicadoHoy, f, TODAY)).toBe(0)
    expect(findingHeatWeight(viejoUbicadoHoy, ALL, TODAY)).toBe(4)
  })
})

describe("heatPointsFor", () => {
  const frame: LayerFrame = { width_m: 20, aspect: 0.5, offset_x_m: 5, offset_y_m: -2, rotation_deg: 0 }

  it("convierte a metros del nivel con el marco de la capa y omite capas desconocidas o niveles distintos", () => {
    const pins = [
      pin({ finding_id: 1, x: 0.5, y: 0.5 }),
      pin({ finding_id: 2, layer_id: 99 }),
      pin({ finding_id: 3, level: 1 }),
      pin({ finding_id: 4, status: "closed" }),
    ]
    const pts = heatPointsFor(pins, (id) => (id === 10 ? frame : null), DEFAULT_HEAT_FILTER, TODAY, 0)
    expect(pts).toHaveLength(1)
    expect(pts[0].x).toBeCloseTo(15)
    expect(pts[0].y).toBeCloseTo(3)
    expect(pts[0].weight).toBe(4)
  })

  it("cuenta los hallazgos que entran", () => {
    const pins = [pin(), pin({ status: "resolved" }), pin({ level: 2 })]
    expect(countHeatFindings(pins, DEFAULT_HEAT_FILTER, TODAY)).toBe(2)
    expect(countHeatFindings(pins, DEFAULT_HEAT_FILTER, TODAY, 0)).toBe(1)
    expect(countHeatFindings(pins, ALL, TODAY)).toBe(3)
  })
})

describe("computeHeatGrid", () => {
  const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 10 }

  it("sin puntos la grilla queda en cero", () => {
    const g = computeHeatGrid([], bounds)
    expect(g.max).toBe(0)
    expect(g.cols).toBe(80)
    expect(g.rows).toBe(40)
    expect(hottestCell(g)).toBeNull()
    expect(computeHeatGrid([]).max).toBe(0)
  })

  it("sin límites, la grilla cubre solo los puntos y su halo", () => {
    const g = computeHeatGrid([
      { x: 100, y: 50, weight: 1 },
      { x: 104, y: 52, weight: 1 },
    ])
    expect(g.minX).toBeCloseTo(100 - 3.75)
    expect(g.minY).toBeCloseTo(50 - 3.75)
    expect(g.cell).toBeCloseTo(0.25)
    expect(g.cols * g.cell).toBeGreaterThanOrEqual(4 + 7.5 - 1e-9)
  })

  it("en un nivel enorme la celda crece y el radio con ella: el hallazgo no se pierde", () => {
    const g = computeHeatGrid([{ x: 2501.3, y: 1777.7, weight: 8 }], { minX: 0, minY: 0, maxX: 5000, maxY: 5000 })
    expect(g.cell).toBeGreaterThan(10)
    expect(g.max / 8).toBeGreaterThan(0.5)
  })

  it("el máximo queda en el hallazgo y vale ~su peso; cae con la distancia", () => {
    const g = computeHeatGrid([{ x: 10.125, y: 5.125, weight: 8 }], bounds)
    const hot = hottestCell(g)!
    expect(hot.x).toBeCloseTo(10.125, 5)
    expect(hot.y).toBeCloseTo(5.125, 5)
    expect(g.max).toBeCloseTo(8, 3)
    const at = (x: number, y: number) =>
      g.values[Math.floor((y - g.minY) / g.cell) * g.cols + Math.floor((x - g.minX) / g.cell)]
    // A un radio (2,5 m) aporta exp(-2) ≈ 13,5 %.
    expect(at(12.625, 5.125) / 8).toBeCloseTo(Math.exp(-2), 2)
    // Más allá de 1,5 radios no aporta nada.
    expect(at(14.5, 5.125)).toBe(0)
  })

  it("suma hallazgos cercanos", () => {
    const one = computeHeatGrid([{ x: 5, y: 5, weight: 4 }], bounds)
    const two = computeHeatGrid(
      [
        { x: 5, y: 5, weight: 4 },
        { x: 5.5, y: 5, weight: 4 },
      ],
      bounds,
    )
    expect(two.max).toBeGreaterThan(one.max * 1.8)
  })

  it("amplía los límites para el halo de un punto cerca o fuera del borde", () => {
    const g = computeHeatGrid([{ x: -1, y: 11, weight: 1 }], bounds)
    expect(g.minX).toBeLessThanOrEqual(-1 - 2.5 * 1.5)
    expect(g.minY + g.rows * g.cell).toBeGreaterThanOrEqual(11 + 2.5 * 1.5)
  })

  it("agranda la celda para no pasar de max_side por lado", () => {
    const g = computeHeatGrid([{ x: 500, y: 100, weight: 1 }], { minX: 0, minY: 0, maxX: 1000, maxY: 200 }, { max_side: 200 })
    expect(g.cols).toBeLessThanOrEqual(200)
    expect(g.rows).toBeLessThanOrEqual(200)
    expect(g.cell).toBeGreaterThan(0.25)
  })
})

describe("escala y colores", () => {
  it("la escala es absoluta hasta que una zona supera a un hallazgo crítico", () => {
    const g1 = computeHeatGrid([{ x: 5, y: 5, weight: 1 }], { minX: 0, minY: 0, maxX: 10, maxY: 10 })
    expect(heatScaleMax(g1)).toBe(HEAT_FULL_SCALE)
    const g2 = computeHeatGrid(
      [
        { x: 5, y: 5, weight: 8 },
        { x: 5, y: 5, weight: 8 },
      ],
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    )
    expect(heatScaleMax(g1, g2, null)).toBeCloseTo(g2.max)
  })

  it("rampa transparente → amarillo → rojo, con opacidad creciente", () => {
    expect(heatColor(0)).toEqual([250, 204, 21, 0])
    expect(heatColor(HEAT_MIN_INTENSITY / 2)[3]).toBe(0)
    const low = heatColor(0.12)
    const high = heatColor(1)
    expect(low[0]).toBe(250)
    expect(low[1]).toBe(204)
    expect(high).toEqual([127, 29, 29, Math.round(0.78 * 255)])
    expect(heatColor(5)).toEqual(high)
    expect(heatColor(0.5)[3]).toBeGreaterThan(low[3])
  })

  it("heatGridToRgba pinta solo donde hay calor", () => {
    const g = computeHeatGrid([{ x: 5, y: 5, weight: 8 }], { minX: 0, minY: 0, maxX: 10, maxY: 10 })
    const px = heatGridToRgba(g)
    expect(px.length).toBe(g.cols * g.rows * 4)
    expect(px[3]).toBe(0) // esquina sin calor
    const hot = hottestCell(g)!
    const i = (Math.floor((hot.y - g.minY) / g.cell) * g.cols + Math.floor((hot.x - g.minX) / g.cell)) * 4
    expect(px[i + 3]).toBeGreaterThan(150)
    expect(heatGridToRgba(g, undefined, 0.5)[i + 3]).toBeLessThan(px[i + 3])
  })

  it("acepta el marco por defecto", () => {
    expect(heatPointsFor([pin()], () => DEFAULT_FRAME, DEFAULT_HEAT_FILTER, TODAY)).toHaveLength(1)
  })
})
