import { describe, expect, it } from "vitest"
import {
  buildScene3D,
  decimatePoints,
  elementDiameterMm,
  elementPrimitives,
  LEVEL_HEIGHT_M,
  sceneGroupOf,
  segmentBox,
  tubeElevationOf,
  tubeRadiusOf,
  WALL_HEIGHT_M,
  type SceneBox,
  type SceneCylinder,
  type ScenePrism,
  type SceneTube,
} from "./scene3d"
import type { ElementGeometry, ElementType, FindingPin, LayerFrame, PlanElement, PlanLayer } from "./types"

// Lámina de 20 m × 10 m sin giro ni desplazamiento: (x, y) normalizado → (20x, 10y) m.
const FRAME: LayerFrame = { width_m: 20, aspect: 0.5, offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }

function layer(over: Partial<PlanLayer> = {}): PlanLayer {
  return {
    id: 1,
    project_id: 1,
    name: "Arquitectura",
    discipline: "arquitectura",
    level: 0,
    level_label: null,
    has_image: false,
    mime_type: null,
    width_px: null,
    height_px: null,
    frame: FRAME,
    opacity: 1,
    element_count: 0,
    uploaded_by: 1,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...over,
  }
}

let nextId = 1
function el(element_type: ElementType, geometry: ElementGeometry, over: Partial<PlanElement> = {}): PlanElement {
  return {
    id: nextId++,
    layer_id: 1,
    project_id: 1,
    element_type,
    label: null,
    geometry,
    attributes: {},
    source: "manual",
    confidence: null,
    created_by: 1,
    created_at: "2026-10-01T00:00:00.000Z",
    ...over,
  }
}

/** Punto normalizado desde metros de la lámina de prueba. */
const m = (x: number, y: number) => ({ x: x / 20, y: y / 10 })

describe("segmentBox", () => {
  it("centra la caja en el tramo y la alarga medio espesor por lado", () => {
    const b = segmentBox({ x: 0, y: 0 }, { x: 4, y: 0 }, 0, 2.5, 0.2)!
    expect(b.cx).toBeCloseTo(2)
    expect(b.cz).toBeCloseTo(0)
    expect(b.cy).toBeCloseTo(1.25)
    expect(b.sx).toBeCloseTo(4.2)
    expect(b.sy).toBeCloseTo(2.5)
    expect(b.sz).toBeCloseTo(0.2)
    expect(b.rot_y).toBeCloseTo(0)
  })

  it("el giro alinea el largo con el tramo según la convención de three.js", () => {
    // Tramo hacia +y del plano (= +Z): (1,0,0) girado θ en torno a Y es (cos θ, 0, −sen θ) = (0, 0, 1).
    const b = segmentBox({ x: 1, y: 1 }, { x: 1, y: 4 }, 0, 1, 0.1)!
    expect(Math.cos(b.rot_y)).toBeCloseTo(0)
    expect(-Math.sin(b.rot_y)).toBeCloseTo(1)
    const diag = segmentBox({ x: 0, y: 0 }, { x: 3, y: 3 }, 0, 1, 0.1)!
    expect(Math.cos(diag.rot_y)).toBeCloseTo(Math.SQRT1_2)
    expect(-Math.sin(diag.rot_y)).toBeCloseTo(Math.SQRT1_2)
  })

  it("descarta tramos de largo cero", () => {
    expect(segmentBox({ x: 1, y: 1 }, { x: 1, y: 1 }, 0, 1, 0.1)).toBeNull()
  })
})

describe("elementPrimitives", () => {
  const L = layer()

  it("un muro es una caja por tramo, de piso a 2,5 m", () => {
    const p = elementPrimitives(el("muro", { type: "polyline", points: [m(0, 0), m(4, 0), m(4, 3)] }), L) as SceneBox[]
    expect(p).toHaveLength(2)
    expect(p.every((b) => b.kind === "box" && b.group === "muros")).toBe(true)
    expect(p[0].cy - p[0].sy / 2).toBeCloseTo(0)
    expect(p[0].cy + p[0].sy / 2).toBeCloseTo(WALL_HEIGHT_M)
    expect(p[0].sz).toBeCloseTo(0.15)
    expect(p[1].cx).toBeCloseTo(4)
    expect(p[1].cz).toBeCloseTo(1.5)
  })

  it("un muro poligonal se cierra y un muro de carga es más grueso", () => {
    const ring = elementPrimitives(el("muro_carga", { type: "polygon", points: [m(0, 0), m(4, 0), m(4, 3), m(0, 3)] }), L) as SceneBox[]
    expect(ring).toHaveLength(4)
    expect(ring[0].sz).toBeCloseTo(0.2)
    expect(ring[3].cx).toBeCloseTo(0)
    expect(ring[3].cz).toBeCloseTo(1.5)
  })

  it("columnas desde un punto (30 × 30 cm) y desde un polígono (su huella)", () => {
    const [c1] = elementPrimitives(el("columna", { type: "point", points: [m(5, 5)] }), L) as SceneBox[]
    expect([c1.cx, c1.cz, c1.sx, c1.sz]).toEqual([5, 5, 0.3, 0.3])
    expect(c1.sy).toBeCloseTo(WALL_HEIGHT_M)
    const [c2] = elementPrimitives(
      el("columna", { type: "polygon", points: [m(1, 1), m(1.4, 1), m(1.4, 1.2), m(1, 1.2)] }),
      L,
    ) as SceneBox[]
    expect(c2.cx).toBeCloseTo(1.2)
    expect(c2.cz).toBeCloseTo(1.1)
    expect(c2.sx).toBeCloseTo(0.4)
    expect(c2.sz).toBeCloseTo(0.2)
  })

  it("tubos: radio por Ø (atributo o etiqueta), altura por tipo y profundidad si viene", () => {
    const line = { type: "polyline" as const, points: [m(0, 5), m(10, 5)] }
    const [sewer] = elementPrimitives(el("tuberia_alcantarillado", line, { label: "Colector PVC Ø110" }), L) as SceneTube[]
    expect(sewer.kind).toBe("tube")
    expect(sewer.radius).toBeCloseTo(0.055)
    expect(sewer.points[0]).toEqual([0, -0.6, 5])
    const [deep] = elementPrimitives(
      el("tuberia_alcantarillado", line, { attributes: { diameter_mm: 200, depth_m: 1.4 } }),
      L,
    ) as SceneTube[]
    expect(deep.radius).toBeCloseTo(0.1)
    expect(deep.points[1]).toEqual([10, -1.4, 5])
    const [water] = elementPrimitives(el("tuberia_agua", line), L) as SceneTube[]
    expect(water.points[0][1]).toBeCloseTo(2.25)
    expect(water.radius).toBeCloseTo(0.03) // Ø25 → 0,0125 m, sube al mínimo visible
    expect(water.group).toBe("agua_potable")
    // Un tubo de un punto no se dibuja.
    expect(elementPrimitives(el("linea_gas", { type: "point", points: [m(1, 1)] }), L)).toHaveLength(0)
  })

  it("cámara de inspección: cilindro enterrado con su Ø", () => {
    const [c] = elementPrimitives(
      el("camara_inspeccion", { type: "point", points: [m(8, 2)] }, { attributes: { diameter_mm: 600 } }),
      L,
    ) as SceneCylinder[]
    expect(c.kind).toBe("cylinder")
    expect(c.radius).toBeCloseTo(0.3)
    expect([c.cx, c.cz]).toEqual([8, 2])
    expect(c.y_bottom).toBeCloseTo(-0.9)
    expect(c.y_top).toBeGreaterThan(0)
  })

  it("losas y excavaciones: polígonos extruidos bajo el piso", () => {
    const sq = { type: "polygon" as const, points: [m(0, 0), m(2, 0), m(2, 2), m(0, 2)] }
    const [slab] = elementPrimitives(el("losa", sq), L) as ScenePrism[]
    expect(slab.kind).toBe("prism")
    expect([slab.y_bottom, slab.y_top]).toEqual([-0.15, 0])
    expect(slab.translucent).toBe(false)
    const [pit] = elementPrimitives(el("excavacion", sq, { attributes: { depth_m: 2 } }), L) as ScenePrism[]
    expect(pit.y_bottom).toBeCloseTo(-2)
    expect(pit.translucent).toBe(true)
  })

  it("los niveles se apilan cada 2,8 m", () => {
    const up = layer({ id: 2, level: 2 })
    const [w] = elementPrimitives(el("muro", { type: "polyline", points: [m(0, 0), m(1, 0)] }, { layer_id: 2 }), up) as SceneBox[]
    expect(w.cy - w.sy / 2).toBeCloseTo(2 * LEVEL_HEIGHT_M)
    expect(w.level).toBe(2)
  })

  it("geometrías rotas no lanzan errores", () => {
    const bad = [
      el("muro", { type: "polyline", points: [] }),
      el("muro", { type: "polyline", points: [{ x: Number.NaN, y: 0 }] }),
      el("tuberia_agua", null as unknown as ElementGeometry),
      el("columna", { type: "polygon", points: [m(1, 1), m(1, 1), m(1, 1)] }),
    ]
    for (const e of bad) expect(() => elementPrimitives(e, L)).not.toThrow()
  })
})

describe("grupos y Ø", () => {
  it("agrupa por tipo y usa la red de la capa para «otro»", () => {
    expect(sceneGroupOf({ element_type: "muro" })).toBe("muros")
    expect(sceneGroupOf({ element_type: "viga" })).toBe("estructura")
    expect(sceneGroupOf({ element_type: "ducto_electrico" })).toBe("electrico")
    expect(sceneGroupOf({ element_type: "otro" }, { discipline: "gas" })).toBe("gas")
    expect(sceneGroupOf({ element_type: "otro" }, { discipline: "arquitectura" })).toBe("otro")
    expect(sceneGroupOf({ element_type: "excavacion" })).toBe("otro")
  })

  it("lee el Ø de la etiqueta cuando no hay atributo", () => {
    expect(elementDiameterMm({ attributes: {}, label: "UD PVC Ø160" })).toBe(160)
    expect(elementDiameterMm({ attributes: {}, label: "Colector %%c110" })).toBe(110)
    expect(elementDiameterMm({ attributes: { diameter_mm: 75 }, label: "Ø110" })).toBe(75)
    expect(elementDiameterMm({ attributes: {}, label: "Red gas Cu 1/2\"" })).toBeNull()
    expect(elementDiameterMm({ attributes: {}, label: null })).toBeNull()
    expect(tubeRadiusOf({ element_type: "ducto_clima", attributes: {}, label: null })).toBeCloseTo(0.125)
    expect(tubeElevationOf({ element_type: "linea_gas", attributes: { depth_m: "0,8" as unknown as number } })).toBeCloseTo(-0.8)
  })

  it("diezma puntos conservando extremos", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => i)
    const d = decimatePoints(pts, 10)
    expect(d).toHaveLength(10)
    expect(d[0]).toBe(0)
    expect(d[9]).toBe(999)
  })
})

describe("buildScene3D", () => {
  const arq = layer({ id: 1 })
  const alc = layer({ id: 2, discipline: "alcantarillado", name: "Alcantarillado" })
  const piso2 = layer({ id: 3, level: 1 })
  const elements = [
    el("muro", { type: "polyline", points: [m(0, 0), m(10, 0)] }, { layer_id: 1 }),
    el("columna", { type: "point", points: [m(0, 0)] }, { layer_id: 1 }),
    el("tuberia_alcantarillado", { type: "polyline", points: [m(0, 5), m(10, 5)] }, { layer_id: 2 }),
    el("muro", { type: "polyline", points: [m(0, 0), m(0, 5)] }, { layer_id: 3 }),
  ]
  const pin: FindingPin = {
    finding_id: 7,
    project_id: 1,
    layer_id: 1,
    level: 0,
    x: 1,
    y: 1,
    category: "grieta",
    reported_by: 1,
    created_at: "2026-10-01T00:00:00.000Z",
    reported_at: "2026-10-01T00:00:00.000Z",
    title: "Grieta",
    description: null,
    severity: "high",
    status: "open",
  }

  it("cuenta grupos, filtra por nivel y ubica pines en metros (X = x, Z = y)", () => {
    const s = buildScene3D({ layers: [arq, alc, piso2], elements, pins: [pin], levels: [0] })
    expect(s.groups.map((g) => [g.group, g.count])).toEqual([
      ["muros", 1],
      ["estructura", 1],
      ["alcantarillado", 1],
    ])
    expect(s.element_count).toBe(3)
    expect(s.floors).toEqual([{ level: 0, elevation: 0, minX: 0, minZ: 0, maxX: 20, maxZ: 10 }])
    expect(s.pins).toEqual([{ finding_id: 7, level: 0, x: 20, y: 0, z: 10, severity: "high", status: "open", title: "Grieta" }])
    expect(s.bounds!.minY).toBeLessThan(0) // el colector enterrado
    expect(s.truncated).toBe(false)
  })

  it("respeta el marco de la capa (desplazamiento)", () => {
    const shifted = layer({ id: 9, frame: { width_m: 10, aspect: 0.5, offset_x_m: 2, offset_y_m: 3, rotation_deg: 0 } })
    const s = buildScene3D({ layers: [shifted], elements: [], pins: [{ ...pin, layer_id: 9 }] })
    expect(s.pins[0].x).toBeCloseTo(12)
    expect(s.pins[0].z).toBeCloseTo(8)
  })

  it("oculta grupos («solo muros»), capas y disciplinas de capa", () => {
    const soloMuros = buildScene3D({
      layers: [arq, alc, piso2],
      elements,
      hiddenGroups: ["estructura", "alcantarillado"],
    })
    expect(new Set(soloMuros.primitives.map((p) => p.group))).toEqual(new Set(["muros"]))
    expect(soloMuros.groups).toHaveLength(3) // los grupos ocultos se siguen ofreciendo
    expect(soloMuros.floors.map((f) => f.level)).toEqual([0, 1])

    const sinCapa = buildScene3D({ layers: [arq, alc], elements, hiddenLayerIds: [2] })
    expect(sinCapa.primitives.some((p) => p.group === "alcantarillado")).toBe(false)
    expect(sinCapa.groups.map((g) => g.group)).toEqual(["muros", "estructura"])
    const sinDisciplina = buildScene3D({ layers: [arq, alc], elements, hiddenDisciplines: ["arquitectura"] })
    expect(sinDisciplina.primitives.every((p) => p.group === "alcantarillado")).toBe(true)
  })

  it("un tubo cuenta por sus tramos en el presupuesto de piezas", () => {
    const longPipe = el(
      "tuberia_agua",
      { type: "polyline", points: Array.from({ length: 11 }, (_, i) => m(i, 5)) },
      { layer_id: 1 },
    )
    expect(buildScene3D({ layers: [arq], elements: [longPipe], maxPrimitives: 20 }).primitives).toHaveLength(1)
    const s = buildScene3D({ layers: [arq], elements: [longPipe], maxPrimitives: 19 })
    expect(s.primitives).toHaveLength(0)
    expect(s.truncated).toBe(true)
  })

  it("recorta escenas enormes y lo informa", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      el("muro", { type: "polyline", points: [m(0, i * 0.1), m(5, i * 0.1)] }, { layer_id: 1 }),
    )
    const s = buildScene3D({ layers: [arq], elements: many, maxPrimitives: 10 })
    expect(s.primitives).toHaveLength(10)
    expect(s.truncated).toBe(true)
  })
})
