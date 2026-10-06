// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  DXF_MAX_POINTS_PER_ELEMENT,
  DXF_UNSUPPORTED_FORMAT_MESSAGE,
  countEntitiesByLayer,
  disciplineFromElementTypes,
  dxfToElementDrafts,
  guessElementTypeFromLayer,
  parseDxf,
  suggestLayerMapping,
  type ParsedDxf,
} from "./dxf"
import type { ElementType, NormPoint } from "./types"

// ---------------------------------------------------------------------------
// Utilidades para escribir DXF ASCII a mano
// ---------------------------------------------------------------------------

type Pair = [number, string | number]

function dxf(pairs: Pair[], eol = "\n"): string {
  return pairs.map(([c, v]) => `${String(c).padStart(3, " ")}${eol}${v}`).join(eol) + eol
}

function section(name: string, body: Pair[]): Pair[] {
  return [[0, "SECTION"], [2, name], ...body, [0, "ENDSEC"]]
}

function layerTable(names: string[]): Pair[] {
  const records: Pair[] = []
  for (const n of names) {
    records.push(
      [0, "LAYER"],
      [5, "10"],
      [100, "AcDbSymbolTableRecord"],
      [100, "AcDbLayerTableRecord"],
      [2, n],
      [70, 0],
      [62, 7],
      [6, "CONTINUOUS"],
    )
  }
  return [[0, "TABLE"], [2, "LAYER"], [5, "2"], [100, "AcDbSymbolTable"], [70, names.length], ...records, [0, "ENDTAB"]]
}

function vertex(layer: string, x: number, y: number): Pair[] {
  return [
    [0, "VERTEX"],
    [8, layer],
    [10, x],
    [20, y],
    [30, 0],
  ]
}

function lwpolyline(layer: string, pts: Array<[number, number]>, closed: boolean, extra: Pair[] = []): Pair[] {
  const out: Pair[] = [
    [0, "LWPOLYLINE"],
    [100, "AcDbEntity"],
    [8, layer],
    [100, "AcDbPolyline"],
    [90, pts.length],
    [70, closed ? 1 : 0],
    [43, 0],
    ...extra,
  ]
  for (const [x, y] of pts) out.push([10, x], [20, y])
  return out
}

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps

/** R12: POLYLINE/VERTEX/SEQEND, TEXT con %%c, BLOCKS que no se deben expandir y $EXTMIN falso. */
const R12 = dxf([
  ...section("HEADER", [
    [9, "$ACADVER"],
    [1, "AC1009"],
    [9, "$EXTMIN"],
    [10, -99999],
    [20, -99999],
    [9, "$EXTMAX"],
    [10, 99999],
    [20, 99999],
  ]),
  ...section("TABLES", layerTable(["0", "ALC-COLECTOR", "ELEC-FZA", "MUROS", "COTAS"])),
  ...section("BLOCKS", [
    [0, "BLOCK"],
    [8, "0"],
    [2, "CAMARA"],
    [70, 0],
    [10, 0],
    [20, 0],
    [0, "LINE"],
    [8, "ALC-COLECTOR"],
    [10, 50000],
    [20, 50000],
    [11, 60000],
    [21, 60000],
    [0, "ENDBLK"],
    [8, "0"],
  ]),
  ...section("ENTITIES", [
    // Colector abierto: (0,0) → (40,0) → (40,30)
    [0, "POLYLINE"],
    [8, "ALC-COLECTOR"],
    [66, 1],
    [70, 0],
    ...vertex("ALC-COLECTOR", 0, 0),
    ...vertex("ALC-COLECTOR", 40, 0),
    ...vertex("ALC-COLECTOR", 40, 30),
    [0, "SEQEND"],
    [8, "ALC-COLECTOR"],
    // Muro cerrado (rectángulo)
    [0, "POLYLINE"],
    [8, "MUROS"],
    [66, 1],
    [70, 1],
    ...vertex("MUROS", 10, 10),
    ...vertex("MUROS", 30, 10),
    ...vertex("MUROS", 30, 20),
    ...vertex("MUROS", 10, 20),
    [0, "SEQEND"],
    [8, "MUROS"],
    [0, "TEXT"],
    [8, "ALC-COLECTOR"],
    [10, 20],
    [20, 0.5],
    [40, 0.25],
    [1, "COLECTOR PVC %%c160"],
    [0, "LINE"],
    [8, "COTAS"],
    [10, -500],
    [20, -500],
    [11, 500],
    [21, -500],
  ]),
  [0, "EOF"],
])

/** R2000 con CRLF, $INSUNITS = 4 (mm), LWPOLYLINE, LINE, CIRCLE, ARC, INSERT, TEXT y MTEXT. */
const R2000 = dxf(
  [
    ...section("HEADER", [
      [9, "$ACADVER"],
      [1, "AC1015"],
      [9, "$INSUNITS"],
      [70, 4],
    ]),
    ...section("TABLES", layerTable(["0", "MUROS", "ELEC-FZA", "ALC-COLECTOR", "COTAS"])),
    ...section("ENTITIES", [
      ...lwpolyline(
        "MUROS",
        [
          [0, 0],
          [10000, 0],
          [10000, 8000],
          [0, 8000],
        ],
        true,
      ),
      [0, "LINE"],
      [100, "AcDbEntity"],
      [8, "ELEC-FZA"],
      [100, "AcDbLine"],
      [10, 1000],
      [20, 1000],
      [30, 0],
      [11, 9000],
      [21, 1000],
      [31, 0],
      [0, "CIRCLE"],
      [8, "ALC-COLECTOR"],
      [10, 5000],
      [20, 4000],
      [40, 80],
      [0, "INSERT"],
      [8, "ELEC-FZA"],
      [2, "TDA"],
      [10, 9000],
      [20, 1000],
      [0, "TEXT"],
      [8, "ELEC-FZA"],
      [10, 9000],
      [20, 1150],
      [40, 100],
      [1, "TDA-1"],
      [0, "MTEXT"],
      [8, "ALC-COLECTOR"],
      [10, 5100],
      [20, 4100],
      [40, 100],
      [1, "{\\fArial|b0|i0;C.I. N\\U+00B01}\\PCota tapa 100.00"],
      [0, "ARC"],
      [8, "ALC-COLECTOR"],
      [10, 2000],
      [20, 2000],
      [40, 500],
      [50, 0],
      [51, 90],
      [0, "LINE"],
      [8, "COTAS"],
      [10, -90000],
      [20, 0],
      [11, -80000],
      [21, 0],
      [0, "DIMENSION"],
      [8, "COTAS"],
      [10, 0],
      [20, 0],
    ]),
    [0, "EOF"],
  ],
  "\r\n",
)

// ---------------------------------------------------------------------------
// parseDxf
// ---------------------------------------------------------------------------

describe("parseDxf", () => {
  it("lee un DXF R12 con POLYLINE/VERTEX/SEQEND y no expande BLOCKS", () => {
    const p = parseDxf(R12)
    expect(p.layers).toEqual(["0", "ALC-COLECTOR", "ELEC-FZA", "MUROS", "COTAS"])
    expect(p.insunits).toBeNull()
    expect(p.entities.map((e) => e.kind)).toEqual(["polyline", "polyline", "text", "line"])

    const [colector, muro, texto] = p.entities
    expect(colector.layer).toBe("ALC-COLECTOR")
    expect(colector.closed).toBe(false)
    expect(colector.points).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
    ])
    expect(muro.closed).toBe(true)
    expect(muro.points).toHaveLength(4)
    expect(texto.text).toBe("COLECTOR PVC Ø160")

    // Extensión calculada desde las entidades (no desde $EXTMIN ni desde BLOCKS).
    expect(p.extents).toEqual({ minX: -500, minY: -500, maxX: 500, maxY: 30 })
    expect(p.entities.some((e) => e.points.some((pt) => pt.x >= 50000))).toBe(false)
    expect(countEntitiesByLayer(p)).toEqual({ "ALC-COLECTOR": 2, MUROS: 1, COTAS: 1 })
  })

  it("lee un DXF R2000 con CRLF: LWPOLYLINE, LINE, CIRCLE, ARC, INSERT, TEXT y MTEXT", () => {
    const p = parseDxf(R2000)
    expect(p.insunits).toBe(4)
    expect(p.layers).toEqual(["0", "MUROS", "ELEC-FZA", "ALC-COLECTOR", "COTAS"])
    const kinds = p.entities.map((e) => e.kind)
    expect(kinds).toEqual(["polyline", "line", "circle", "insert", "text", "text", "polyline", "line"])

    const lw = p.entities[0]
    expect(lw.closed).toBe(true)
    expect(lw.points).toEqual([
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 8000 },
      { x: 0, y: 8000 },
    ])
    const circle = p.entities[2]
    expect(circle.radius).toBe(80)
    expect(circle.points).toEqual([{ x: 5000, y: 4000 }])
    const insert = p.entities[3]
    expect(insert.block).toBe("TDA")
    expect(p.entities[4].text).toBe("TDA-1")
    expect(p.entities[5].text).toBe("C.I. N°1 Cota tapa 100.00")

    const arc = p.entities[6]
    expect(arc.points).toHaveLength(13)
    expect(near(arc.points[0].x, 2500) && near(arc.points[0].y, 2000)).toBe(true)
    expect(near(arc.points[12].x, 2000) && near(arc.points[12].y, 2500)).toBe(true)
    for (const pt of arc.points) expect(near(Math.hypot(pt.x - 2000, pt.y - 2000), 500)).toBe(true)

    // La cota no soportada (DIMENSION) queda en advertencias, no rompe nada.
    expect(p.warnings.some((w) => w.includes("DIMENSION"))).toBe(true)
  })

  it("tolera basura, líneas mal formadas y entidades rotas sin lanzar", () => {
    const text = [
      "  0",
      "SECTION",
      "  2",
      "ENTITIES",
      "  0",
      "LINE",
      "  8",
      "MUROS",
      "esto no es un código",
      " 10",
      "0",
      " 20",
      "0",
      " 11",
      "5",
      " 21",
      "5",
      "  0",
      "LINE",
      "  8",
      "MUROS",
      " 10",
      "abc",
      " 20",
      "1",
      " 11",
      "2",
      " 21",
      "2",
      "  0",
      "CIRCLE",
      "  8",
      "ALC",
      " 10",
      "1",
      " 20",
      "1",
      " 40",
      "-3",
      "  0",
      "LWPOLYLINE",
      "  8",
      "ALC",
      " 90",
      "1",
      " 10",
      "1",
      " 20",
      "1",
      "  0",
      "POLYLINE",
      "  8",
      "MUROS",
      " 70",
      "0",
      "  0",
      "VERTEX",
      "  8",
      "MUROS",
      " 10",
      "0",
      " 20",
      "0",
      "  0",
      "VERTEX",
      "  8",
      "MUROS",
      " 10",
      "9",
      " 20",
      "9",
      // falta SEQEND: la siguiente entidad cierra la polilínea
      "  0",
      "POINT",
      "  8",
      "MUROS",
      " 10",
      "3",
      " 20",
      "4",
      "@@@@ basura final",
    ].join("\n")
    let p: ParsedDxf | null = null
    expect(() => {
      p = parseDxf(text)
    }).not.toThrow()
    const parsed = p as unknown as ParsedDxf
    expect(parsed.entities.map((e) => e.kind)).toEqual(["line", "polyline", "point"])
    expect(parsed.entities[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ])
    expect(parsed.entities[1].points).toEqual([
      { x: 0, y: 0 },
      { x: 9, y: 9 },
    ])
    const w = parsed.warnings.join("\n")
    expect(w).toMatch(/línea\(s\) mal formadas/)
    expect(w).toMatch(/LINE .*coordenadas inválidas/)
    expect(w).toMatch(/CIRCLE .*radio inválido/)
    expect(w).toMatch(/LWPOLYLINE .*menos de 2 vértices/)
    expect(w).toMatch(/falta SEQEND/)
  })

  it("texto que no es DXF: devuelve vacío con advertencia", () => {
    const p = parseDxf("hola, esto es un acta de reunión\nsin nada de CAD\n")
    expect(p.entities).toEqual([])
    expect(p.extents).toBeNull()
    expect(p.warnings.length).toBeGreaterThan(0)
    expect(parseDxf("").warnings[0]).toMatch(/vacío/)
  })

  it("rechaza DXF binario y DWG", () => {
    const binary = "AutoCAD Binary DXF\r\n\u001a\u0000" + "\u0000\u0001\u0002".repeat(200)
    expect(() => parseDxf(binary)).toThrow(DXF_UNSUPPORTED_FORMAT_MESSAGE)
    const dwg = "AC1032" + "\u0000".repeat(10) + "ÿþ\u0001\u0003".repeat(300)
    expect(() => parseDxf(dwg)).toThrow(DXF_UNSUPPORTED_FORMAT_MESSAGE)
    const noise = Array.from({ length: 3000 }, (_, i) => String.fromCharCode(i % 32)).join("")
    expect(() => parseDxf(noise)).toThrow(/DXF ASCII/)
  })

  it("aproxima bulges de LWPOLYLINE como arcos", () => {
    // Semicírculo antihorario de (0,0) a (10,0): pasa por debajo (y < 0).
    const text = dxf([
      ...section("ENTITIES", [
        [0, "LWPOLYLINE"],
        [8, "ALC"],
        [90, 2],
        [70, 0],
        [10, 0],
        [20, 0],
        [42, 1],
        [10, 10],
        [20, 0],
      ]),
    ])
    const [pl] = parseDxf(text).entities
    expect(pl.points.length).toBeGreaterThan(3)
    expect(pl.points[0]).toEqual({ x: 0, y: 0 })
    expect(pl.points[pl.points.length - 1]).toEqual({ x: 10, y: 0 })
    for (const pt of pl.points.slice(1, -1)) {
      expect(near(Math.hypot(pt.x - 5, pt.y), 5)).toBe(true)
      expect(pt.y).toBeLessThan(0)
    }
  })

  it("aplica la extrusión (0,0,-1) espejando X y omite el espacio papel", () => {
    const text = dxf([
      ...section("ENTITIES", [
        [0, "CIRCLE"],
        [8, "ALC"],
        [10, 100],
        [20, 50],
        [40, 2],
        [210, 0],
        [220, 0],
        [230, -1],
        [0, "LINE"],
        [8, "MARCO"],
        [67, 1],
        [10, 0],
        [20, 0],
        [11, 420],
        [21, 297],
      ]),
    ])
    const p = parseDxf(text)
    expect(p.entities).toHaveLength(1)
    expect(p.entities[0].points[0].x).toBeCloseTo(-100)
    expect(p.entities[0].points[0].y).toBeCloseTo(50)
    expect(p.warnings.some((w) => w.includes("espacio papel"))).toBe(true)
  })

  it("evalúa SPLINE y conserva sus extremos (B-spline anclada)", () => {
    const text = dxf([
      ...section("ENTITIES", [
        [0, "SPLINE"],
        [8, "ALC"],
        [70, 8],
        [71, 3],
        [72, 8],
        [73, 4],
        [74, 0],
        ...([0, 0, 0, 0, 1, 1, 1, 1].map((k) => [40, k]) as Pair[]),
        [10, 0],
        [20, 0],
        [10, 1],
        [20, 2],
        [10, 3],
        [20, 2],
        [10, 4],
        [20, 0],
      ]),
    ])
    const [sp] = parseDxf(text).entities
    expect(sp.kind).toBe("polyline")
    expect(sp.points.length).toBeGreaterThan(10)
    expect(near(sp.points[0].x, 0) && near(sp.points[0].y, 0)).toBe(true)
    const last = sp.points[sp.points.length - 1]
    expect(near(last.x, 4) && near(last.y, 0)).toBe(true)
  })

  it("procesa archivos grandes en una pasada", () => {
    const parts: string[] = ["0\nSECTION\n2\nENTITIES\n"]
    for (let i = 0; i < 60_000; i++) {
      parts.push(
        `0\nLINE\n8\nALC-${i % 7}\n10\n${i}\n20\n${i % 100}\n30\n0\n11\n${i + 1}\n21\n${(i + 1) % 100}\n31\n0\n`,
      )
    }
    parts.push("0\nENDSEC\n0\nEOF\n")
    const text = parts.join("")
    expect(text.length).toBeGreaterThan(3_000_000)
    const t0 = Date.now()
    const p = parseDxf(text)
    const elapsed = Date.now() - t0
    expect(p.entities).toHaveLength(60_000)
    expect(p.layers).toHaveLength(7)
    expect(elapsed).toBeLessThan(5000)
  })
})

// ---------------------------------------------------------------------------
// guessElementTypeFromLayer
// ---------------------------------------------------------------------------

describe("guessElementTypeFromLayer", () => {
  const cases: Array<[string, ElementType | null]> = [
    // Alcantarillado
    ["ALC-COLECTOR", "tuberia_alcantarillado"],
    ["ALCANTARILLADO", "tuberia_alcantarillado"],
    ["alc_ud", "tuberia_alcantarillado"],
    ["A.S.", "tuberia_alcantarillado"],
    ["AS", "tuberia_alcantarillado"],
    ["AS-UD", "tuberia_alcantarillado"],
    ["SANITARIO 1ER PISO", "tuberia_alcantarillado"],
    ["Desagüe", "tuberia_alcantarillado"],
    ["AGUAS SERVIDAS", "tuberia_alcantarillado"],
    ["COLECTOR", "tuberia_alcantarillado"],
    ["PLANTA|ALC-COLECTOR", "tuberia_alcantarillado"],
    ["CASA", null],
    ["AS-BUILT", null],
    // Cámaras
    ["C.I.", "camara_inspeccion"],
    ["CI-ALC", "camara_inspeccion"],
    ["ALC-CAMARAS", "camara_inspeccion"],
    ["CAM", "camara_inspeccion"],
    ["Cámara inspección", "camara_inspeccion"],
    ["CAMARINES", null],
    // Agua potable
    ["AP", "tuberia_agua"],
    ["A.P.", "tuberia_agua"],
    ["AGUA POTABLE", "tuberia_agua"],
    ["AF-PVC", "tuberia_agua"],
    ["AC", "tuberia_agua"],
    ["AP-MEDIDOR", "tuberia_agua"],
    // Aguas lluvia
    ["ALL", "tuberia_aguas_lluvia"],
    ["A.LL", "tuberia_aguas_lluvia"],
    ["AGUAS LLUVIAS", "tuberia_aguas_lluvia"],
    ["BAJADAS", "tuberia_aguas_lluvia"],
    ["A.A.L.L.", "tuberia_aguas_lluvia"],
    // Eléctrico
    ["ELEC-FZA", "ducto_electrico"],
    ["ELE", "ducto_electrico"],
    ["Eléctrico", "ducto_electrico"],
    ["FUERZA", "ducto_electrico"],
    ["ALUMBRADO", "ducto_electrico"],
    ["ENCHUFES", "ducto_electrico"],
    ["CANALIZACION", "ducto_electrico"],
    ["ELEC-ARTEFACTOS", "ducto_electrico"],
    ["ELEVACION", null],
    ["TDA", "tablero_electrico"],
    ["TDF-1", "tablero_electrico"],
    ["TG", "tablero_electrico"],
    ["TGAUX", "tablero_electrico"],
    ["ELEC-TABLEROS", "tablero_electrico"],
    // Gas
    ["GAS", "linea_gas"],
    ["GLP", "linea_gas"],
    ["GN-RED", "linea_gas"],
    ["GASFITERIA", null],
    ["MEDIDOR", "medidor_gas"],
    ["GAS-REGULADOR", "medidor_gas"],
    // Arquitectura y estructura
    ["MUROS", "muro"],
    ["TABIQUES", "muro"],
    ["ARQ-MUROS", "muro"],
    ["A-WALL", "muro"],
    ["ARQ", "muro"],
    ["MURO HA", "muro_carga"],
    ["M.HA", "muro_carga"],
    ["MUROS-HA", "muro_carga"],
    ["COL", "columna"],
    ["PILARES", "columna"],
    ["HA-COL", "columna"],
    ["COLUMNAS", "columna"],
    ["VIGAS", "viga"],
    ["CADENAS", "viga"],
    ["LOSA", "losa"],
    ["FUNDACIONES", "fundacion"],
    ["ZAP", "fundacion"],
    ["RADIER", "fundacion"],
    ["ARQ$0$MUROS", "muro"],
    // Clima e incendio
    ["CLIMA", "ducto_clima"],
    ["HVAC", "ducto_clima"],
    ["VENT", "ducto_clima"],
    ["EXTRACCION", "ducto_clima"],
    ["INC", "red_incendio"],
    ["RED HUMEDA", "red_incendio"],
    ["Red Seca", "red_incendio"],
    ["RH", "red_incendio"],
    ["SPRINKLERS", "red_incendio"],
    ["GABINETES", "red_incendio"],
    ["INCENDIO", "red_incendio"],
    // Excavación
    ["EXCAVACION", "excavacion"],
    ["ZANJAS", "excavacion"],
    // Anotación y desconocidas
    ["COTAS", null],
    ["COTA", null],
    ["DIM", null],
    ["TEXTO", null],
    ["TXT", null],
    ["EJES", null],
    ["EJE", null],
    ["HATCH", null],
    ["ACHURAS", null],
    ["DEFPOINTS", null],
    ["0", null],
    ["MARCO", null],
    ["VIEWPORT", null],
    ["ALC-COTAS", null],
    ["ELEC-TEXTO", null],
    ["Layer1", null],
    ["", null],
    ["VENTANAS", null],
    ["ARQ-PUERTAS", null],
    ["MOBILIARIO", null],
  ]

  it.each(cases)("%s → %s", (name, expected) => {
    expect(guessElementTypeFromLayer(name)).toBe(expected)
  })
})

describe("disciplineFromElementTypes", () => {
  it("elige la disciplina mayoritaria", () => {
    expect(disciplineFromElementTypes(["tuberia_alcantarillado", "camara_inspeccion", "muro"])).toBe("alcantarillado")
    expect(disciplineFromElementTypes(["ducto_electrico", "tablero_electrico", "tablero_electrico", "linea_gas"])).toBe(
      "electrico",
    )
    expect(disciplineFromElementTypes(["muro_carga", "columna", "muro"])).toBe("estructura")
  })

  it("'otro' solo gana si no hay otra disciplina", () => {
    expect(disciplineFromElementTypes([])).toBe("otro")
    expect(disciplineFromElementTypes(["excavacion", "excavacion", "muro"])).toBe("arquitectura")
    expect(disciplineFromElementTypes(["excavacion", "otro"])).toBe("otro")
  })
})

// ---------------------------------------------------------------------------
// dxfToElementDrafts
// ---------------------------------------------------------------------------

describe("dxfToElementDrafts", () => {
  it("normaliza con las capas mapeadas, invierte Y, arma polígonos y etiqueta desde textos (R12)", () => {
    const parsed = parseDxf(R12)
    const mapping = suggestLayerMapping(parsed)
    expect(mapping).toEqual({
      "0": null,
      "ALC-COLECTOR": "tuberia_alcantarillado",
      "ELEC-FZA": "ducto_electrico",
      MUROS: "muro",
      COTAS: null,
    })
    const r = dxfToElementDrafts(parsed, mapping)
    // Extensión solo de capas mapeadas: x 0..40, y 0..30 (la cota en -500 no cuenta).
    expect(r.width_units).toBe(40)
    expect(r.aspect).toBeCloseTo(0.75)
    expect(r.drafts).toHaveLength(2)
    expect(r.per_layer).toEqual({ "ALC-COLECTOR": 1, MUROS: 1 })
    expect(r.skipped).toBe(0)

    const pipe = r.drafts[0]
    expect(pipe.element_type).toBe("tuberia_alcantarillado")
    expect(pipe.geometry.type).toBe("polyline")
    // (0,0) es la esquina inferior izquierda en DXF → y = 1 en la lámina.
    expect(pipe.geometry.points).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ])
    expect(pipe.label).toBe("COLECTOR PVC Ø160")
    expect(pipe.attributes?.dxf_layer).toBe("ALC-COLECTOR")

    const wall = r.drafts[1]
    expect(wall.element_type).toBe("muro")
    expect(wall.geometry.type).toBe("polygon")
    const pts = wall.geometry.points as NormPoint[]
    expect(pts).toHaveLength(4)
    expect(pts[0].x).toBeCloseTo(0.25)
    expect(pts[0].y).toBeCloseTo(2 / 3, 5)
    expect(pts[2].x).toBeCloseTo(0.75)
    expect(pts[2].y).toBeCloseTo(1 / 3, 5)
    expect(wall.label ?? null).toBeNull()

    // Sin unidades declaradas y ancho pequeño: no se sugiere ancho, pero se avisa.
    expect(r.suggested_width_m).toBeNull()
    expect(r.warnings.some((w) => w.includes("no declara unidades"))).toBe(true)

    // Las coordenadas, ya escaladas a metros con el marco, conservan la escala.
    // local = (x·width_m, y·width_m·aspect): con width_m = 40 el colector mide 40 + 30.
    const toLocal = (p: NormPoint) => ({ x: p.x * 40, y: p.y * 40 * r.aspect })
    const a = toLocal(pipe.geometry.points[1])
    const b = toLocal(pipe.geometry.points[2])
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(30)
  })

  it("R2000 en mm: ancho sugerido, diámetro de círculos, bloques y etiquetas", () => {
    const parsed = parseDxf(R2000)
    const r = dxfToElementDrafts(parsed, suggestLayerMapping(parsed))
    expect(r.width_units).toBe(10000)
    expect(r.aspect).toBeCloseTo(0.8)
    expect(r.suggested_width_m).toBe(10)
    expect(r.per_layer).toEqual({ MUROS: 1, "ELEC-FZA": 2, "ALC-COLECTOR": 2 })

    const byKind = (t: string) => r.drafts.filter((d) => d.geometry.type === t)
    const [wall] = byKind("polygon")
    expect(wall.geometry.points).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ])

    const camara = r.drafts.find((d) => d.attributes?.diameter_mm != null)
    expect(camara?.geometry).toEqual({ type: "point", points: [{ x: 0.5, y: 0.5 }] })
    expect(camara?.attributes?.diameter_mm).toBe(160)
    expect(camara?.label).toBe("C.I. N°1 Cota tapa 100.00")

    const tablero = r.drafts.find((d) => d.attributes?.dxf_block === "TDA")
    expect(tablero?.element_type).toBe("ducto_electrico")
    expect(tablero?.geometry.points[0]).toEqual({ x: 0.9, y: 0.875 })
    expect(tablero?.label).toBe("TDA-1")

    const arc = r.drafts.find((d) => d.element_type === "tuberia_alcantarillado" && d.geometry.type === "polyline")
    expect(arc?.geometry.points.length).toBeGreaterThan(2)
    for (const d of r.drafts) {
      for (const p of d.geometry.points) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(1)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(1)
      }
    }
  })

  it("respeta labelFromText=false, maxElements y mapeo sin distinguir mayúsculas", () => {
    const pairs: Pair[] = []
    for (let i = 0; i < 10; i++) pairs.push([0, "POINT"], [8, "Alc-Camaras"], [10, i * 10], [20, i])
    pairs.push([0, "TEXT"], [8, "Alc-Camaras"], [10, 0.1], [20, 0.1], [1, "C.I. 1"])
    const parsed = parseDxf(dxf(section("ENTITIES", pairs)))
    const r = dxfToElementDrafts(
      parsed,
      { "ALC-CAMARAS": "camara_inspeccion" },
      { maxElements: 3, labelFromText: false },
    )
    expect(r.drafts).toHaveLength(3)
    expect(r.skipped).toBe(7)
    expect(r.drafts.every((d) => d.label === null)).toBe(true)
    expect(r.per_layer).toEqual({ "Alc-Camaras": 3 })
    expect(r.warnings.some((w) => w.includes("máximo de 3"))).toBe(true)

    const withLabels = dxfToElementDrafts(parsed, { "ALC-CAMARAS": "camara_inspeccion" })
    expect(withLabels.drafts[0].label).toBe("C.I. 1")
    expect(withLabels.drafts[5].label).toBeNull()
  })

  it("simplifica polilíneas largas y respeta el máximo de puntos", () => {
    const n = 20_000
    const zigzag: Array<[number, number]> = []
    for (let i = 0; i < n; i++) zigzag.push([i, (i % 2) * 40])
    const straight: Array<[number, number]> = []
    for (let i = 0; i <= 1000; i++) straight.push([i * 20, 10])
    const parsed = parseDxf(
      dxf(section("ENTITIES", [...lwpolyline("ALC", zigzag, false), ...lwpolyline("ALC", straight, false)])),
    )
    const r = dxfToElementDrafts(parsed, { ALC: "tuberia_alcantarillado" })
    expect(r.drafts).toHaveLength(2)
    expect(r.drafts[0].geometry.points.length).toBeLessThanOrEqual(DXF_MAX_POINTS_PER_ELEMENT)
    expect(r.drafts[0].geometry.points.length).toBeGreaterThan(100)
    // Los puntos colineales se eliminan.
    expect(r.drafts[1].geometry.points).toHaveLength(2)
  })

  it("sin unidades y ancho grande asume milímetros con advertencia", () => {
    const parsed = parseDxf(
      dxf(
        section("ENTITIES", [
          [0, "LINE"],
          [8, "MUROS"],
          [10, 0],
          [20, 0],
          [11, 60000],
          [21, 30000],
        ]),
      ),
    )
    const r = dxfToElementDrafts(parsed, { MUROS: "muro" })
    expect(r.suggested_width_m).toBe(60)
    expect(r.warnings.some((w) => w.includes("milímetros"))).toBe(true)
  })

  it("sin capas mapeadas no genera elementos y usa todas las entidades para la extensión", () => {
    const parsed = parseDxf(R12)
    const r = dxfToElementDrafts(parsed, {})
    expect(r.drafts).toEqual([])
    expect(r.width_units).toBe(1000)
    expect(r.warnings.some((w) => w.includes("Ninguna capa"))).toBe(true)
  })

  it("una línea horizontal no produce aspect 0 y omite entidades degeneradas", () => {
    const parsed = parseDxf(
      dxf(
        section("ENTITIES", [
          [0, "LINE"],
          [8, "GAS"],
          [10, 0],
          [20, 5],
          [11, 100],
          [21, 5],
          [0, "LINE"],
          [8, "GAS"],
          [10, 50],
          [20, 5],
          [11, 50],
          [21, 5],
        ]),
      ),
    )
    const r = dxfToElementDrafts(parsed, { GAS: "linea_gas" })
    expect(r.aspect).toBeGreaterThan(0)
    expect(r.drafts).toHaveLength(1)
    expect(r.drafts[0].geometry.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])
    expect(r.warnings.some((w) => w.includes("degeneradas"))).toBe(true)
  })

  it("archivo vacío: resultado vacío y válido", () => {
    const r = dxfToElementDrafts(parseDxf(""), {})
    expect(r.drafts).toEqual([])
    expect(r.aspect).toBe(1)
    expect(r.suggested_width_m).toBeNull()
  })

  it("los borradores son válidos para geometry.ts y vuelven a metros con la escala real", async () => {
    const { isValidGeometry, toLevelMeters } = await import("./geometry")
    const parsed = parseDxf(R2000)
    const r = dxfToElementDrafts(parsed, suggestLayerMapping(parsed))
    for (const d of r.drafts) expect(isValidGeometry(d.geometry)).toBe(true)
    // Marco sugerido: 10 m de ancho, aspect 0,8. El muro mide 10 m × 8 m (en mm: 10000 × 8000).
    const frame = { width_m: r.suggested_width_m as number, aspect: r.aspect, offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }
    const wall = r.drafts.find((d) => d.geometry.type === "polygon")
    const [a, b, c] = (wall?.geometry.points ?? []).map((p) => toLevelMeters(p, frame))
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(10)
    expect(Math.hypot(c.x - b.x, c.y - b.y)).toBeCloseTo(8)
    // El círculo (centro en 5000, 4000 mm) queda a 5 m del borde izquierdo y 4 m del borde superior.
    const camara = r.drafts.find((d) => d.attributes?.diameter_mm != null)
    const pc = toLevelMeters((camara?.geometry.points ?? [])[0], frame)
    expect(pc.x).toBeCloseTo(5)
    expect(pc.y).toBeCloseTo(4)
  })
})
