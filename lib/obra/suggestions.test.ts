import { describe, expect, it } from "vitest"
import {
  canTransition,
  parseSuggestionPayload,
  SUGGESTION_LIMITS,
  SUGGESTION_TRANSITIONS,
  SuggestionPayloadError,
} from "./suggestions"
import { SUGGESTION_STATUSES, type CreateTaskPayload, type SuggestionKind } from "./types"

const validTask: CreateTaskPayload = {
  title: "Revisar grieta junto a colector de alcantarillado",
  description: "Posible filtración del colector.\n\nEvidencia: elemento #10.",
  priority: "alta",
  assigned_role: "jefe_obra",
  due_in_days: 3,
  finding_id: 501,
  layer_id: 1,
  level: 1,
  x: 0.25,
  y: 0.5,
  checklist: ["Inspeccionar con CCTV.", "Prueba de estanqueidad."],
}

function errorOf(kind: SuggestionKind, data: unknown): string {
  try {
    parseSuggestionPayload(kind, data)
  } catch (e) {
    expect(e).toBeInstanceOf(SuggestionPayloadError)
    expect(e).toBeInstanceOf(Error)
    return (e as Error).message
  }
  throw new Error("se esperaba un error de validación")
}

describe("parseSuggestionPayload — create_task", () => {
  it("acepta un payload válido sin cambiarlo", () => {
    expect(parseSuggestionPayload("create_task", validTask)).toEqual({ kind: "create_task", data: validTask })
  })

  it("acepta el sobre { kind, data } si el tipo coincide", () => {
    expect(parseSuggestionPayload("create_task", { kind: "create_task", data: validTask }).data).toEqual(validTask)
    expect(errorOf("create_task", { kind: "plan_elements", data: validTask })).toMatch(/no coincide/)
  })

  it("completa valores por defecto y descarta claves desconocidas", () => {
    const r = parseSuggestionPayload("create_task", { title: "  Revisar   tablero  ", extra: "x" })
    expect(r.data).toEqual({
      title: "Revisar tablero",
      description: "",
      priority: "media",
      assigned_role: null,
      due_in_days: 7,
      finding_id: null,
      layer_id: null,
      level: null,
      x: null,
      y: null,
      checklist: [],
    })
  })

  it("recorta textos: título 200, descripción 4000, checklist 20 ítems de 300", () => {
    const r = parseSuggestionPayload("create_task", {
      ...validTask,
      title: "T".repeat(500),
      description: "D".repeat(5000),
      checklist: [...Array.from({ length: 30 }, (_, i) => `Paso ${i + 1} ${"x".repeat(400)}`), "  ", ""],
    })
    if (r.kind !== "create_task") throw new Error("tipo inesperado")
    expect(r.data.title.length).toBe(SUGGESTION_LIMITS.title)
    expect(r.data.description.length).toBe(SUGGESTION_LIMITS.description)
    expect(r.data.checklist.length).toBe(20)
    for (const item of r.data.checklist) expect(item.length).toBeLessThanOrEqual(300)
    expect(r.data.checklist[0].startsWith("Paso 1 ")).toBe(true)
  })

  it("limpia caracteres de control y conserva saltos de línea en la descripción", () => {
    const r = parseSuggestionPayload("create_task", {
      ...validTask,
      title: "Revisar\u0000 grieta\n",
      description: "Línea 1\r\nLínea 2\u0007\n\n\n\nLínea 3",
      checklist: ["Paso\tuno"],
    })
    if (r.kind !== "create_task") throw new Error("tipo inesperado")
    expect(r.data.title).toBe("Revisar grieta")
    expect(r.data.description).toBe("Línea 1\nLínea 2\n\nLínea 3")
    expect(r.data.checklist).toEqual(["Paso uno"])
  })

  it("redondea el plazo y valida rangos", () => {
    const r = parseSuggestionPayload("create_task", { ...validTask, due_in_days: 2.6 })
    if (r.kind !== "create_task") throw new Error("tipo inesperado")
    expect(r.data.due_in_days).toBe(3)
    expect(errorOf("create_task", { ...validTask, due_in_days: -1 })).toMatch(/plazo en días/)
    expect(errorOf("create_task", { ...validTask, due_in_days: 1000 })).toMatch(/plazo en días/)
    expect(errorOf("create_task", { ...validTask, x: 1.5 })).toMatch(/coordenada x/)
    expect(errorOf("create_task", { ...validTask, finding_id: 0 })).toMatch(/hallazgo/)
    expect(errorOf("create_task", { ...validTask, level: 1.5 })).toMatch(/nivel.*entero/)
  })

  it("rechaza catálogos inválidos con mensaje en español", () => {
    const msg = errorOf("create_task", { ...validTask, priority: "urgente" })
    expect(msg).toBe("Tarea sugerida inválida: el campo «prioridad» tiene un valor no permitido («urgente»).")
    expect(errorOf("create_task", { ...validTask, assigned_role: "admin" })).toMatch(/rol asignado/)
  })

  it("exige título y coordenadas completas", () => {
    expect(errorOf("create_task", { ...validTask, title: undefined })).toBe(
      "Tarea sugerida inválida: el campo «título» es obligatorio.",
    )
    expect(errorOf("create_task", { ...validTask, title: "   " })).toMatch(/El título de la tarea es obligatorio/)
    expect(errorOf("create_task", { ...validTask, y: null })).toMatch(/x e y deben venir juntas/)
  })

  it("rechaza payloads que no son objetos", () => {
    expect(errorOf("create_task", null)).toMatch(/se esperaba un objeto/)
    expect(errorOf("create_task", "tarea")).toMatch(/se esperaba un objeto/)
    expect(errorOf("create_task", [validTask])).toMatch(/se esperaba un objeto/)
  })
})

describe("parseSuggestionPayload — plan_elements", () => {
  const geometry = {
    type: "polyline",
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.31234567, y: 0.2 },
    ],
  }

  it("valida y normaliza elementos", () => {
    const r = parseSuggestionPayload("plan_elements", {
      layer_id: 7,
      elements: [
        {
          element_type: "tuberia_alcantarillado",
          label: "  C-3 ",
          geometry,
          attributes: { diameter_mm: "160", material: "PVC", depth_m: -2, nested: { a: 1 }, __proto__x: 1 },
          confidence: 0.82,
        },
        { element_type: "camara_inspeccion", geometry: { type: "point", points: [{ x: 0.5, y: 0.5 }] } },
      ],
    })
    if (r.kind !== "plan_elements") throw new Error("tipo inesperado")
    expect(r.data.layer_id).toBe(7)
    expect(r.data.elements[0]).toEqual({
      element_type: "tuberia_alcantarillado",
      label: "C-3",
      geometry: {
        type: "polyline",
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.312346, y: 0.2 },
        ],
      },
      attributes: { diameter_mm: 160, material: "PVC", __proto__x: 1 },
      confidence: 0.82,
    })
    expect(r.data.elements[1]).toEqual({
      element_type: "camara_inspeccion",
      label: null,
      geometry: { type: "point", points: [{ x: 0.5, y: 0.5 }] },
      attributes: {},
      confidence: null,
    })
  })

  it("no permite contaminar prototipos con claves especiales en atributos", () => {
    const attributes = JSON.parse('{"__proto__": {"polluted": true}, "constructor": "x", "material": "PVC"}')
    const r = parseSuggestionPayload("plan_elements", {
      layer_id: 7,
      elements: [{ element_type: "muro", geometry, attributes }],
    })
    if (r.kind !== "plan_elements") throw new Error("tipo inesperado")
    expect(r.data.elements[0].attributes).toEqual({ material: "PVC" })
    expect(Object.getPrototypeOf(r.data.elements[0].attributes)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it("rechaza geometrías inválidas indicando el elemento", () => {
    const msg = errorOf("plan_elements", {
      layer_id: 7,
      elements: [
        { element_type: "muro", geometry },
        { element_type: "muro", geometry: { type: "polygon", points: [{ x: 0, y: 0 }] } },
      ],
    })
    expect(msg).toMatch(/^Elementos de plano sugeridos inválidos \(elementos › n\.º 2 › geometría\): La geometría/)
  })

  it("rechaza tipos desconocidos, listas vacías y más de 2000 elementos", () => {
    expect(errorOf("plan_elements", { layer_id: 7, elements: [{ element_type: "piscina", geometry }] })).toMatch(
      /tipo de elemento/,
    )
    expect(errorOf("plan_elements", { layer_id: 7, elements: [] })).toMatch(/al menos un elemento/)
    const many = Array.from({ length: 2001 }, () => ({ element_type: "muro", geometry }))
    expect(errorOf("plan_elements", { layer_id: 7, elements: many })).toMatch(/como máximo 2000/)
    expect(errorOf("plan_elements", { elements: [{ element_type: "muro", geometry }] })).toMatch(/capa/)
  })

  it("acepta exactamente 2000 elementos", () => {
    const max = Array.from({ length: 2000 }, () => ({ element_type: "muro", geometry }))
    const r = parseSuggestionPayload("plan_elements", { layer_id: 1, elements: max })
    if (r.kind !== "plan_elements") throw new Error("tipo inesperado")
    expect(r.data.elements.length).toBe(2000)
  })
})

describe("parseSuggestionPayload — update_finding_severity", () => {
  it("acepta un cambio con motivo", () => {
    const data = { finding_id: 9, from: "medium", to: "critical", reason: "  Grieta junto a colector con olor  " }
    expect(parseSuggestionPayload("update_finding_severity", data)).toEqual({
      kind: "update_finding_severity",
      data: { finding_id: 9, from: "medium", to: "critical", reason: "Grieta junto a colector con olor" },
    })
  })

  it("rechaza severidades iguales, inválidas o sin motivo", () => {
    expect(errorOf("update_finding_severity", { finding_id: 9, from: "high", to: "high", reason: "x" })).toMatch(
      /distinta de la actual/,
    )
    expect(errorOf("update_finding_severity", { finding_id: 9, from: "high", to: "extrema", reason: "x" })).toMatch(
      /severidad nueva/,
    )
    expect(errorOf("update_finding_severity", { finding_id: 9, from: "low", to: "high", reason: " " })).toMatch(
      /motivo/,
    )
    expect(errorOf("update_finding_severity", { from: "low", to: "high", reason: "x" })).toMatch(/hallazgo/)
  })
})

describe("parseSuggestionPayload — tipo", () => {
  it("rechaza tipos de sugerencia desconocidos", () => {
    expect(errorOf("borrar_todo" as SuggestionKind, {})).toBe("Tipo de sugerencia desconocido.")
  })
})

describe("transiciones de estado", () => {
  it("solo una sugerencia pendiente puede cambiar de estado", () => {
    expect([...SUGGESTION_TRANSITIONS.pending].sort()).toEqual(["approved", "rejected", "superseded"])
    expect(canTransition("pending", "approved")).toBe(true)
    expect(canTransition("pending", "rejected")).toBe(true)
    expect(canTransition("pending", "superseded")).toBe(true)
    expect(canTransition("pending", "pending")).toBe(false)
  })

  it("aprobada, rechazada y reemplazada son terminales", () => {
    for (const from of ["approved", "rejected", "superseded"] as const) {
      expect(SUGGESTION_TRANSITIONS[from]).toEqual([])
      for (const to of SUGGESTION_STATUSES) expect(canTransition(from, to)).toBe(false)
    }
  })

  it("estados desconocidos no transicionan", () => {
    expect(canTransition("toString" as never, "approved")).toBe(false)
    expect(canTransition("pending", "borrada" as never)).toBe(false)
  })
})
