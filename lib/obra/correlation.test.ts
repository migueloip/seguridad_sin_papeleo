import { describe, expect, it } from "vitest"
import {
  combinePriority,
  correlateFinding,
  correlationToTaskPayload,
  describeCorrelation,
  describeElement,
  formatDistanceCl,
  priorityFromSeverity,
  severityFromPriority,
  type CorrelationElementInput,
  type CorrelationFindingInput,
  type CorrelationLayerInput,
} from "./correlation"
import { fromLevelMeters } from "./geometry"
import { parseSuggestionPayload } from "./suggestions"
import {
  PRIORITIES,
  SEVERITIES,
  type Correlation,
  type CorrelationRule,
  type ElementGeometry,
  type ElementType,
  type LayerFrame,
  type Vec2,
} from "./types"

// ---------------------------------------------------------------------------
// Escenario: nivel 1 con planos de distintas especialidades y marcos distintos
// ---------------------------------------------------------------------------

const ARQ_FRAME: LayerFrame = { width_m: 40, aspect: 0.75, offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }
const ALC_FRAME: LayerFrame = { width_m: 60, aspect: 0.5, offset_x_m: -5, offset_y_m: -6, rotation_deg: 12 }
const AGUA_FRAME: LayerFrame = { width_m: 50, aspect: 0.7, offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }

const layer = (
  id: number,
  name: string,
  discipline: CorrelationLayerInput["discipline"],
  level: number,
  frame: LayerFrame,
): CorrelationLayerInput => ({ id, name, discipline, level, frame })

/** Polilínea definida en metros del nivel, guardada en coordenadas normalizadas de la capa. */
function polylineIn(frame: LayerFrame, pts: Vec2[]): ElementGeometry {
  return { type: "polyline", points: pts.map((p) => fromLevelMeters(p, frame)) }
}

function pointIn(frame: LayerFrame, p: Vec2): ElementGeometry {
  return { type: "point", points: [fromLevelMeters(p, frame)] }
}

/** Línea vertical (en metros del nivel) a `dx` metros a la derecha del hallazgo, que está en (10, 15). */
function verticalLineAt(frame: LayerFrame, dx: number): ElementGeometry {
  return polylineIn(frame, [
    { x: 10 + dx, y: 5 },
    { x: 10 + dx, y: 25 },
  ])
}

const el = (
  id: number,
  layer_id: number,
  element_type: ElementType,
  geometry: ElementGeometry,
  label: string | null = null,
  attributes?: CorrelationElementInput["attributes"],
): CorrelationElementInput => ({ id, layer_id, element_type, label, geometry, attributes })

/** Grieta reportada en la capa de arquitectura del nivel 1, en (10 m, 15 m). */
const grieta = (severity: CorrelationFindingInput["severity"] = "medium"): CorrelationFindingInput => ({
  level: 1,
  frame: ARQ_FRAME,
  x: 10 / 40,
  y: 15 / (40 * 0.75),
  category: "grieta",
  severity,
})

const LAYERS = [
  layer(1, "Arquitectura N1", "arquitectura", 1, ARQ_FRAME),
  layer(2, "Alcantarillado N1", "alcantarillado", 1, ALC_FRAME),
  layer(3, "Agua potable N1", "agua_potable", 1, AGUA_FRAME),
]

describe("correlateFinding — caso del plan (grieta junto al colector)", () => {
  const elements = [
    el(10, 2, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 1.2), "C-3", { diameter_mm: 160 }),
    el(11, 3, "tuberia_agua", verticalLineAt(AGUA_FRAME, -1.8), "AP-1"),
    // Tabique a 3 m: fuera del alcance de la regla de tabiques (0,5 m) y no es una red.
    el(12, 1, "muro", verticalLineAt(ARQ_FRAME, 3)),
  ]

  it("la primera correlación es la regla de alcantarillado, prioridad alta, a 1,2 m", () => {
    const res = correlateFinding(grieta(), LAYERS, elements)
    expect(res.length).toBe(2)
    const c = res[0]
    expect(c.rule_id).toBe("grieta_alcantarillado")
    expect(c.element_id).toBe(10)
    expect(c.layer_id).toBe(2)
    expect(c.layer_name).toBe("Alcantarillado N1")
    expect(c.discipline).toBe("alcantarillado")
    expect(c.relation).toBe("mismo_nivel")
    expect(c.distance_m).toBe(1.2)
    expect(c.priority).toBe("alta")
    expect(c.suggested_role).toBe("jefe_obra")
    expect(c.due_in_days).toBe(3)
    expect(c.hypothesis).toContain(
      "A 1,2 m, en el mismo nivel, pasa el colector de alcantarillado «C-3» Ø160 (capa Alcantarillado N1).",
    )
    expect(c.hypothesis).toContain("asentamiento diferencial")
    expect(c.hypothesis).not.toMatch(/\{[a-z]+\}/)
    expect(c.recommended_actions.join(" ")).toContain("CCTV")
    // score = 0,75 × (1 − 1,2/3)^0,7
    expect(c.score).toBeCloseTo(0.75 * Math.pow(0.6, 0.7), 3)
    expect(c.score).toBeGreaterThan(0)
    expect(c.score).toBeLessThanOrEqual(1)
  })

  it("la tubería de agua a 1,8 m aparece después, con la regla de agua (media)", () => {
    const res = correlateFinding(grieta(), LAYERS, elements)
    expect(res[1].rule_id).toBe("grieta_agua")
    expect(res[1].distance_m).toBe(1.8)
    expect(res[1].priority).toBe("media")
    expect(res[1].score).toBeLessThan(res[0].score)
  })

  it("la severidad del hallazgo sube la prioridad un nivel, nunca la baja", () => {
    expect(correlateFinding(grieta("high"), LAYERS, elements)[0].priority).toBe("alta")
    expect(correlateFinding(grieta("critical"), LAYERS, elements)[0].priority).toBe("critica")
    expect(correlateFinding(grieta("low"), LAYERS, elements)[0].priority).toBe("alta")
    // Al subir a crítica, el plazo se acorta a 1 día como máximo.
    expect(correlateFinding(grieta("critical"), LAYERS, elements)[0].due_in_days).toBe(1)
  })

  it("describeCorrelation entrega la evidencia verificable", () => {
    const c = correlateFinding(grieta(), LAYERS, elements)[0]
    expect(describeCorrelation(c)).toBe(
      "A 1,2 m, en el mismo nivel, pasa el colector de alcantarillado «C-3» Ø160 (capa Alcantarillado N1).",
    )
    // Una correlación sin descripción guardada (p.ej. evidencia antigua) usa tipo y etiqueta.
    const plain: Correlation = { ...c }
    delete (plain as Partial<{ element_description: string }>).element_description
    expect(describeCorrelation(plain)).toBe(
      "A 1,2 m, en el mismo nivel, pasa el colector de alcantarillado «C-3» (capa Alcantarillado N1).",
    )
  })

  it("ignora elementos de capas no entregadas o con geometría inválida", () => {
    const extra = [
      el(20, 99, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 0.5)),
      el(21, 2, "tuberia_alcantarillado", { type: "polyline", points: [{ x: 2, y: 0 }] } as unknown as ElementGeometry),
    ]
    const res = correlateFinding(grieta(), LAYERS, [...elements, ...extra])
    expect(res.map((c) => c.element_id)).toEqual([10, 11])
  })
})

describe("correlateFinding — niveles", () => {
  it("un colector del nivel inferior aplica como 'bajo el hallazgo' con puntaje × 0,75", () => {
    const same = correlateFinding(
      grieta(),
      [
        layer(1, "Arquitectura N1", "arquitectura", 1, ARQ_FRAME),
        layer(2, "Alcantarillado N1", "alcantarillado", 1, ALC_FRAME),
      ],
      [el(10, 2, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 1.2))],
    )[0]
    const below = correlateFinding(
      grieta(),
      [
        layer(1, "Arquitectura N1", "arquitectura", 1, ARQ_FRAME),
        layer(5, "Alcantarillado N0", "alcantarillado", 0, ALC_FRAME),
      ],
      [el(10, 5, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 1.2))],
    )[0]
    expect(below.rule_id).toBe("grieta_alcantarillado")
    expect(below.relation).toBe("nivel_inferior")
    expect(below.hypothesis).toContain("en el nivel inferior (bajo el hallazgo)")
    expect(below.score).toBeCloseTo(same.score * 0.75, 3)
  })

  it("en el nivel superior la regla de grietas no aplica: queda solo el contexto genérico", () => {
    const res = correlateFinding(
      grieta(),
      [layer(6, "Alcantarillado N2", "alcantarillado", 2, ALC_FRAME)],
      [el(10, 6, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 1.2))],
    )
    expect(res.length).toBe(1)
    expect(res[0].rule_id).toBe("contexto_red_cercana")
    expect(res[0].relation).toBe("nivel_superior")
    expect(res[0].priority).toBe("baja")
    expect(res[0].hypothesis).toContain("en el nivel superior (sobre el hallazgo)")
  })

  it("ignora capas a más de un nivel de distancia", () => {
    const res = correlateFinding(
      grieta(),
      [
        layer(7, "Alcantarillado N3", "alcantarillado", 3, ALC_FRAME),
        layer(8, "Alcantarillado N-1", "alcantarillado", -1, ALC_FRAME),
      ],
      [
        el(10, 7, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 0.5)),
        el(11, 8, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 0.5)),
      ],
    )
    expect(res).toEqual([])
  })
})

describe("correlateFinding — radio, gas, deduplicación y límite", () => {
  it("fuera del radio no hay correlaciones", () => {
    const far = [el(10, 2, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 8))]
    expect(correlateFinding(grieta(), LAYERS, far)).toEqual([])
    const near = [el(10, 2, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 1.2))]
    expect(correlateFinding(grieta(), LAYERS, near, { radiusM: 1 })).toEqual([])
  })

  it("olor a gas junto a la red de gas es crítico y para hoy", () => {
    const gasLayer = layer(4, "Gas N1", "gas", 1, AGUA_FRAME)
    const finding: CorrelationFindingInput = { ...grieta("low"), category: "olor_gas" }
    const res = correlateFinding(finding, [gasLayer], [el(30, 4, "linea_gas", verticalLineAt(AGUA_FRAME, 3), "G-1")])
    expect(res[0].rule_id).toBe("olor_gas_red_gas")
    expect(res[0].priority).toBe("critica")
    expect(res[0].due_in_days).toBe(0)
    expect(res[0].suggested_role).toBe("prevencionista")
    expect(res[0].hypothesis).toContain("A 3,0 m, en el mismo nivel, pasa la red de gas «G-1» (capa Gas N1).")
  })

  it("olor junto a una cámara: gases de alcantarillado y espacio confinado", () => {
    const finding: CorrelationFindingInput = { ...grieta(), category: "olor_gas" }
    const res = correlateFinding(finding, LAYERS, [
      el(31, 2, "camara_inspeccion", pointIn(ALC_FRAME, { x: 11, y: 15 }), "CI-4"),
    ])
    expect(res[0].rule_id).toBe("olor_alcantarillado")
    expect(res[0].hypothesis).toContain("se ubica la cámara de inspección «CI-4»")
    expect(res[0].recommended_actions.join(" ")).toContain("espacio confinado")
  })

  it("una sola correlación por elemento: la regla específica gana a la genérica", () => {
    // A 2,95 m la regla específica (máx. 3 m) tiene menos puntaje que la genérica (máx. 6 m),
    // pero la genérica solo se usa cuando ninguna específica aplica.
    const res = correlateFinding(grieta(), LAYERS, [
      el(10, 2, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 2.95)),
    ])
    expect(res.length).toBe(1)
    expect(res[0].rule_id).toBe("grieta_alcantarillado")
  })

  it("entre reglas aplicables a un mismo elemento se queda la de mayor puntaje", () => {
    const rule = (
      id: string,
      max_distance_m: number,
      base_priority: CorrelationRule["base_priority"],
    ): CorrelationRule => ({
      id,
      categories: ["grieta"],
      element_types: ["tuberia_agua"],
      max_distance_m,
      relations: ["mismo_nivel"],
      base_priority,
      hypothesis: "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}).",
      recommended_actions: ["Revisar."],
      suggested_role: "supervisor",
      due_in_days: 5,
    })
    const rules = [rule("lejana_media", 5, "media"), rule("cercana_alta", 1, "alta")]
    const res = correlateFinding(grieta(), LAYERS, [el(11, 3, "tuberia_agua", verticalLineAt(AGUA_FRAME, 0.9))], {
      rules,
    })
    expect(res.length).toBe(1)
    // media: 0,5 × (1 − 0,9/5)^0,7 ≈ 0,435 > alta: 0,75 × (1 − 0,9)^0,7 ≈ 0,150
    expect(res[0].rule_id).toBe("lejana_media")
    const close = correlateFinding(grieta(), LAYERS, [el(11, 3, "tuberia_agua", verticalLineAt(AGUA_FRAME, 0.1))], {
      rules,
    })
    expect(close[0].rule_id).toBe("cercana_alta")
  })

  it("ordena por puntaje y luego por distancia, y corta en maxResults (5 por defecto)", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      el(100 + i, 3, "tuberia_agua", verticalLineAt(AGUA_FRAME, -(0.2 + i * 0.2)), `AP-${i}`),
    )
    const res = correlateFinding(grieta(), LAYERS, many)
    expect(res.length).toBe(5)
    expect(res.map((c) => c.element_id)).toEqual([100, 101, 102, 103, 104])
    for (let i = 1; i < res.length; i++) expect(res[i].score).toBeLessThanOrEqual(res[i - 1].score)
    expect(correlateFinding(grieta(), LAYERS, many, { maxResults: 2 }).length).toBe(2)
    expect(correlateFinding(grieta(), LAYERS, many, { maxResults: 0 })).toEqual([])
  })

  it("distancias redondeadas a 2 decimales y punto dentro de un polígono a distancia 0", () => {
    const losa: ElementGeometry = {
      type: "polygon",
      points: [
        { x: 0.2, y: 0.4 },
        { x: 0.3, y: 0.4 },
        { x: 0.3, y: 0.6 },
        { x: 0.2, y: 0.6 },
      ],
    }
    const res = correlateFinding(grieta(), LAYERS, [el(40, 1, "losa", losa, "L-101")])
    expect(res[0].rule_id).toBe("grieta_estructural")
    expect(res[0].distance_m).toBe(0)
    expect(res[0].hypothesis).toContain("A menos de 0,1 m")
  })

  it("un muro o una red como polígono (polilínea cerrada de DXF) se mide a su contorno, no como superficie", () => {
    const anillo: ElementGeometry = {
      type: "polygon",
      points: [
        { x: 0.05, y: 0.05 },
        { x: 0.95, y: 0.05 },
        { x: 0.95, y: 0.95 },
        { x: 0.05, y: 0.95 },
      ],
    }
    // El hallazgo queda dentro del anillo, lejos de sus bordes: no hay muro ni colector "a 0 m".
    expect(correlateFinding(grieta(), LAYERS, [el(41, 1, "muro", anillo, "Perímetro")])).toEqual([])
    expect(correlateFinding(grieta(), LAYERS, [el(42, 2, "tuberia_alcantarillado", anillo, "Anillo")])).toEqual([])
  })
})

describe("prioridades", () => {
  it("combinePriority sube un nivel con severidad alta o crítica si la regla es menor", () => {
    expect(combinePriority("baja", "low")).toBe("baja")
    expect(combinePriority("baja", "medium")).toBe("baja")
    expect(combinePriority("baja", "high")).toBe("media")
    expect(combinePriority("baja", "critical")).toBe("media")
    expect(combinePriority("media", "high")).toBe("alta")
    expect(combinePriority("alta", "high")).toBe("alta")
    expect(combinePriority("alta", "critical")).toBe("critica")
    expect(combinePriority("critica", "low")).toBe("critica")
  })

  it("nunca baja la prioridad de la regla", () => {
    for (const p of PRIORITIES) {
      for (const s of SEVERITIES) {
        expect(PRIORITIES.indexOf(combinePriority(p, s))).toBeGreaterThanOrEqual(PRIORITIES.indexOf(p))
      }
    }
  })

  it("severidad ↔ prioridad", () => {
    expect(priorityFromSeverity("critical")).toBe("critica")
    expect(priorityFromSeverity("low")).toBe("baja")
    expect(severityFromPriority("alta")).toBe("high")
    for (const s of SEVERITIES) expect(severityFromPriority(priorityFromSeverity(s))).toBe(s)
  })
})

describe("textos", () => {
  it("formatDistanceCl usa coma decimal", () => {
    expect(formatDistanceCl(1.2)).toBe("1,2 m")
    expect(formatDistanceCl(12.345)).toBe("12,3 m")
    expect(formatDistanceCl(0)).toBe("menos de 0,1 m")
    expect(formatDistanceCl(Number.NaN)).toBe("distancia desconocida")
  })

  it("describeElement: tipo con artículo, etiqueta y diámetro", () => {
    expect(
      describeElement({ element_type: "tuberia_alcantarillado", label: "C-3", attributes: { diameter_mm: 160 } }),
    ).toBe("el colector de alcantarillado «C-3» Ø160")
    expect(describeElement({ element_type: "tuberia_alcantarillado", label: "C-3" }, { article: false })).toBe(
      "colector de alcantarillado «C-3»",
    )
    expect(describeElement({ element_type: "camara_inspeccion", label: null })).toBe("la cámara de inspección")
    expect(
      describeElement({
        element_type: "tuberia_agua",
        label: "  ",
        attributes: { diameter_mm: "110" as unknown as number },
      }),
    ).toBe("la tubería de agua potable Ø110")
    expect(describeElement({ element_type: "tuberia_agua", label: "«X»\n1", attributes: { diameter_mm: 0 } })).toBe(
      "la tubería de agua potable «X 1»",
    )
  })
})

describe("correlationToTaskPayload", () => {
  const finding = { id: 501, title: "Grieta en muro del eje B", layer_id: 1, level: 1, x: 0.25, y: 0.5 }
  const colector = el(10, 2, "tuberia_alcantarillado", verticalLineAt(ALC_FRAME, 1.2), "C-3", { diameter_mm: 160 })

  it("genera un payload de tarea válido y accionable", () => {
    const c = correlateFinding(grieta(), LAYERS, [colector])[0]
    const p = correlationToTaskPayload(c, finding)
    expect(p.title).toBe("Revisar grieta junto a colector de alcantarillado «C-3»")
    expect(p.title.length).toBeLessThanOrEqual(120)
    expect(p.description.startsWith(c.hypothesis)).toBe(true)
    expect(p.description).toContain("Evidencia: elemento #10 de la capa «Alcantarillado N1»")
    expect(p.description).toContain("hallazgo #501")
    expect(p.priority).toBe("alta")
    expect(p.assigned_role).toBe("jefe_obra")
    expect(p.due_in_days).toBe(3)
    expect(p.checklist).toEqual(c.recommended_actions)
    expect(p).toMatchObject({ finding_id: 501, layer_id: 1, level: 1, x: 0.25, y: 0.5 })
    // Pasa la validación de payloads sin cambios.
    expect(parseSuggestionPayload("create_task", p)).toEqual({ kind: "create_task", data: p })
  })

  it("redacta el título según el nivel y la categoría", () => {
    const below = correlateFinding(
      grieta(),
      [
        layer(1, "Arquitectura N1", "arquitectura", 1, ARQ_FRAME),
        layer(5, "Alcantarillado N0", "alcantarillado", 0, ALC_FRAME),
      ],
      [{ ...colector, layer_id: 5 }],
    )[0]
    expect(correlationToTaskPayload(below, finding).title).toBe(
      "Revisar grieta sobre colector de alcantarillado «C-3» del nivel inferior",
    )

    const above = correlateFinding(
      grieta(),
      [layer(6, "Alcantarillado N2", "alcantarillado", 2, ALC_FRAME)],
      [{ ...colector, layer_id: 6 }],
    )[0]
    // Regla genérica: sin categoría, el título usa el del hallazgo.
    expect(correlationToTaskPayload(above, finding).title).toBe(
      "Revisar hallazgo «Grieta en muro del eje B» bajo colector de alcantarillado «C-3» del nivel superior",
    )
    expect(correlationToTaskPayload(above, { ...finding, category: "grieta" }).title).toBe(
      "Revisar grieta bajo colector de alcantarillado «C-3» del nivel superior",
    )

    const gas = correlateFinding(
      { ...grieta(), category: "olor_gas" },
      [layer(4, "Gas N1", "gas", 1, AGUA_FRAME)],
      [el(30, 4, "linea_gas", verticalLineAt(AGUA_FRAME, 1))],
    )[0]
    expect(correlationToTaskPayload(gas, finding).title).toBe("Atender olor a gas junto a red de gas")
  })

  it("acota el título a 120 caracteres", () => {
    const longLabel = "Colector principal de descarga del edificio hacia la red pública, tramo entre cámaras".repeat(2)
    const c = correlateFinding(grieta(), LAYERS, [{ ...colector, label: longLabel }])[0]
    const p = correlationToTaskPayload(c, { ...finding, title: "x".repeat(300) })
    expect(Array.from(p.title).length).toBeLessThanOrEqual(120)
    expect(p.title.startsWith("Revisar grieta junto a colector de alcantarillado")).toBe(true)
  })
})
