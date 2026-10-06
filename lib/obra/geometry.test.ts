import { describe, expect, it } from "vitest"
import {
  clamp01,
  DEFAULT_FRAME,
  distancePointToGeometryMeters,
  distancePointToSegment,
  fromLevelMeters,
  geometryToMeters,
  isValidGeometry,
  MAX_GEOMETRY_POINTS,
  normalizeGeometry,
  pointInPolygon,
  sanitizeFrame,
  toLevelMeters,
} from "./geometry"
import type { ElementGeometry, LayerFrame } from "./types"

describe("clamp01", () => {
  it("limita a [0, 1] y trata NaN como 0", () => {
    expect(clamp01(-0.2)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(3)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
    expect(clamp01(Infinity)).toBe(1)
  })
})

describe("marcos de capa", () => {
  it("el marco por defecto es 50 m × 0,7 sin desplazamiento ni rotación", () => {
    expect(DEFAULT_FRAME).toEqual({ width_m: 50, aspect: 0.7, offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 })
  })

  it("sin rotación: local = (x·ancho, y·ancho·aspecto) + desplazamiento", () => {
    const f: LayerFrame = { width_m: 40, aspect: 0.5, offset_x_m: 3, offset_y_m: -2, rotation_deg: 0 }
    expect(toLevelMeters({ x: 0.5, y: 0.5 }, f)).toEqual({ x: 23, y: 8 })
  })

  it("rota en sentido horario en pantalla (eje y hacia abajo)", () => {
    const f: LayerFrame = { width_m: 10, aspect: 1, offset_x_m: 0, offset_y_m: 0, rotation_deg: 90 }
    // (10, 0) rotado 90° → (0, 10): el eje x de la lámina apunta hacia abajo en pantalla.
    expect(toLevelMeters({ x: 1, y: 0 }, f)).toEqual({ x: 0, y: 10 })
    expect(toLevelMeters({ x: 0, y: 1 }, f)).toEqual({ x: -10, y: 0 })
  })

  it("aplica la fórmula del plan con ángulos arbitrarios", () => {
    const f: LayerFrame = { width_m: 20, aspect: 0.6, offset_x_m: 5, offset_y_m: 7, rotation_deg: 30 }
    const lx = 0.3 * 20
    const ly = 0.8 * 20 * 0.6
    const t = (30 * Math.PI) / 180
    const r = toLevelMeters({ x: 0.3, y: 0.8 }, f)
    expect(r.x).toBeCloseTo(lx * Math.cos(t) - ly * Math.sin(t) + 5, 10)
    expect(r.y).toBeCloseTo(lx * Math.sin(t) + ly * Math.cos(t) + 7, 10)
  })

  it("ida y vuelta con rotación y desplazamiento", () => {
    const frames: LayerFrame[] = [
      { width_m: 50, aspect: 0.7, offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 },
      { width_m: 37.5, aspect: 0.62, offset_x_m: -4.2, offset_y_m: 11.9, rotation_deg: 17.3 },
      { width_m: 80, aspect: 1.4, offset_x_m: 100, offset_y_m: -50, rotation_deg: -135 },
      { width_m: 12, aspect: 0.3, offset_x_m: 0.5, offset_y_m: 0.5, rotation_deg: 450 },
    ]
    for (const f of frames) {
      for (const p of [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 0.123, y: 0.987 },
        { x: 0.5, y: 0.25 },
      ]) {
        const back = fromLevelMeters(toLevelMeters(p, f), f)
        expect(back.x).toBeCloseTo(p.x, 9)
        expect(back.y).toBeCloseTo(p.y, 9)
      }
    }
  })

  it("fromLevelMeters no recorta: un punto fuera de la lámina queda fuera de [0, 1]", () => {
    const f: LayerFrame = { width_m: 10, aspect: 1, offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }
    expect(fromLevelMeters({ x: 15, y: -5 }, f)).toEqual({ x: 1.5, y: -0.5 })
  })

  it("sanitizeFrame repara valores inválidos", () => {
    expect(sanitizeFrame({ width_m: 0, aspect: -1, offset_x_m: Number.NaN, rotation_deg: Infinity })).toEqual(
      DEFAULT_FRAME,
    )
    expect(sanitizeFrame(null)).toEqual(DEFAULT_FRAME)
    expect(sanitizeFrame({ width_m: "30" as unknown as number, aspect: 0.5 }).width_m).toBe(30)
  })
})

describe("distancias", () => {
  it("punto a segmento: proyección interior, extremos y segmento degenerado", () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    expect(distancePointToSegment({ x: 5, y: 3 }, a, b)).toBe(3)
    expect(distancePointToSegment({ x: -3, y: 4 }, a, b)).toBe(5)
    expect(distancePointToSegment({ x: 13, y: 4 }, a, b)).toBe(5)
    expect(distancePointToSegment({ x: 3, y: 4 }, a, a)).toBe(5)
  })

  it("geometría tipo punto: distancia euclídea", () => {
    expect(distancePointToGeometryMeters({ x: 0, y: 0 }, { type: "point", points: [{ x: 3, y: 4 }] })).toBe(5)
  })

  it("polilínea: mínima a sus segmentos", () => {
    const g = {
      type: "polyline" as const,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    }
    expect(distancePointToGeometryMeters({ x: 12, y: 5 }, g)).toBe(2)
    expect(distancePointToGeometryMeters({ x: 5, y: -1 }, g)).toBe(1)
    // Una polilínea no se cierra: el tramo (10,10)→(0,0) quedaría a 2,8 m, pero no cuenta.
    expect(distancePointToGeometryMeters({ x: 1, y: 5 }, g)).toBe(5)
  })

  it("polígono: 0 dentro; fuera, mínima a los bordes incluido el cierre", () => {
    const g = {
      type: "polygon" as const,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    }
    expect(distancePointToGeometryMeters({ x: 7, y: 2 }, g)).toBe(0)
    // (2, 6) está fuera del triángulo; su borde más cercano es el de cierre (10,10)→(0,0).
    expect(distancePointToGeometryMeters({ x: 2, y: 6 }, g)).toBeCloseTo(Math.SQRT2 * 2, 10)
  })

  it("geometría vacía → Infinity", () => {
    expect(distancePointToGeometryMeters({ x: 0, y: 0 }, { type: "polyline", points: [] })).toBe(Infinity)
  })
})

describe("polígono cóncavo", () => {
  // Forma de "U" (abierta hacia arriba en pantalla).
  const u = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 3 },
    { x: 2, y: 3 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { x: 0, y: 3 },
  ]

  it("detecta puntos dentro de los brazos y fuera en la muesca", () => {
    expect(pointInPolygon({ x: 0.5, y: 2 }, u)).toBe(true)
    expect(pointInPolygon({ x: 2.5, y: 2 }, u)).toBe(true)
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, u)).toBe(true)
    expect(pointInPolygon({ x: 1.5, y: 2 }, u)).toBe(false)
    expect(pointInPolygon({ x: 4, y: 1 }, u)).toBe(false)
  })

  it("la distancia desde la muesca es al borde interior más cercano", () => {
    expect(distancePointToGeometryMeters({ x: 1.5, y: 2 }, { type: "polygon", points: u })).toBeCloseTo(0.5, 10)
    expect(distancePointToGeometryMeters({ x: 1.5, y: 1.2 }, { type: "polygon", points: u })).toBeCloseTo(0.2, 10)
  })

  it("con menos de 3 vértices nunca está dentro", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false)
  })
})

describe("geometryToMeters", () => {
  it("convierte cada punto con el marco de la capa y conserva el tipo", () => {
    const f: LayerFrame = { width_m: 20, aspect: 0.5, offset_x_m: 1, offset_y_m: 2, rotation_deg: 0 }
    const g: ElementGeometry = {
      type: "polyline",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    }
    expect(geometryToMeters(g, f)).toEqual({
      type: "polyline",
      points: [
        { x: 1, y: 2 },
        { x: 21, y: 12 },
      ],
    })
  })
})

describe("validación y normalización de geometrías", () => {
  it("acepta geometrías bien formadas", () => {
    expect(isValidGeometry({ type: "point", points: [{ x: 0.2, y: 0.3 }] })).toBe(true)
    expect(
      isValidGeometry({
        type: "polyline",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
    ).toBe(true)
    expect(
      isValidGeometry({
        type: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
    ).toBe(true)
  })

  it("rechaza tipos, cantidades y coordenadas inválidas", () => {
    const p = { x: 0.5, y: 0.5 }
    expect(isValidGeometry(null)).toBe(false)
    expect(isValidGeometry([])).toBe(false)
    expect(isValidGeometry({ type: "circle", points: [p] })).toBe(false)
    expect(isValidGeometry({ type: "point", points: [p, p] })).toBe(false)
    expect(isValidGeometry({ type: "point", points: [] })).toBe(false)
    expect(isValidGeometry({ type: "polyline", points: [p] })).toBe(false)
    expect(isValidGeometry({ type: "polygon", points: [p, p] })).toBe(false)
    expect(isValidGeometry({ type: "point", points: [{ x: 1.01, y: 0 }] })).toBe(false)
    expect(isValidGeometry({ type: "point", points: [{ x: -0.01, y: 0 }] })).toBe(false)
    expect(isValidGeometry({ type: "point", points: [{ x: Number.NaN, y: 0 }] })).toBe(false)
    expect(isValidGeometry({ type: "point", points: [{ x: "0.5", y: 0 }] })).toBe(false)
    expect(isValidGeometry({ type: "point", points: [null] })).toBe(false)
    expect(isValidGeometry({ type: "polyline", points: "0,0 1,1" })).toBe(false)
  })

  it("limita la cantidad de puntos", () => {
    const pts = Array.from({ length: MAX_GEOMETRY_POINTS }, (_, i) => ({ x: i / MAX_GEOMETRY_POINTS, y: 0.5 }))
    expect(isValidGeometry({ type: "polyline", points: pts })).toBe(true)
    expect(isValidGeometry({ type: "polyline", points: [...pts, { x: 1, y: 1 }] })).toBe(false)
  })

  it("normaliza: recorta a [0, 1], redondea a 6 decimales y quita propiedades extra", () => {
    const g = {
      type: "polyline",
      points: [
        { x: -0.5, y: 0.12345678, z: 9 },
        { x: 1.5, y: 0.9999999 },
      ],
    } as unknown as ElementGeometry
    expect(normalizeGeometry(g)).toEqual({
      type: "polyline",
      points: [
        { x: 0, y: 0.123457 },
        { x: 1, y: 1 },
      ],
    })
  })

  it("un punto conserva exactamente un vértice", () => {
    const g = normalizeGeometry({ type: "point", points: [{ x: 0.1234567, y: 0.5 }] })
    expect(g).toEqual({ type: "point", points: [{ x: 0.123457, y: 0.5 }] })
  })
})

describe("polygonArea", () => {
  it("calcula el área sin importar el sentido de los vértices", async () => {
    const { polygonArea } = await import("./geometry")
    const sq = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ]
    expect(polygonArea(sq)).toBe(12)
    expect(polygonArea([...sq].reverse())).toBe(12)
    expect(polygonArea(sq.slice(0, 2))).toBe(0)
  })
})
