import { describe, expect, it } from "vitest"
import { CORRELATION_RULES, DEFAULT_SEARCH_RADIUS_M } from "./rules"
import {
  ELEMENT_TYPES,
  FINDING_CATEGORIES,
  LEVEL_RELATIONS,
  OBRA_ROLES,
  PRIORITIES,
  type ElementType,
  type FindingCategory,
} from "./types"

const PLACEHOLDERS = new Set(["{elemento}", "{distancia}", "{capa}", "{relacion}", "{verbo}"])
const MAX_DUE: Record<string, number> = { critica: 1, alta: 3, media: 7, baja: 14 }

function rulesFor(category: FindingCategory, type: ElementType) {
  return CORRELATION_RULES.filter((r) => r.categories.includes(category) && r.element_types.includes(type))
}

describe("catálogo de reglas de correlación", () => {
  it("tiene al menos 22 reglas con id único", () => {
    expect(CORRELATION_RULES.length).toBeGreaterThanOrEqual(22)
    const ids = CORRELATION_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/)
  })

  it("usa solo valores de los catálogos de types.ts", () => {
    for (const r of CORRELATION_RULES) {
      expect(r.categories.length).toBeGreaterThan(0)
      for (const c of r.categories) expect(c === "*" || FINDING_CATEGORIES.includes(c)).toBe(true)
      expect(r.element_types.length).toBeGreaterThan(0)
      for (const t of r.element_types) expect(ELEMENT_TYPES).toContain(t)
      expect(r.relations.length).toBeGreaterThan(0)
      for (const rel of r.relations) expect(LEVEL_RELATIONS).toContain(rel)
      expect(PRIORITIES).toContain(r.base_priority)
      expect(OBRA_ROLES).toContain(r.suggested_role)
    }
  })

  it("distancias dentro del radio de búsqueda y plazos coherentes con la prioridad", () => {
    for (const r of CORRELATION_RULES) {
      expect(r.max_distance_m).toBeGreaterThan(0)
      expect(r.max_distance_m).toBeLessThanOrEqual(DEFAULT_SEARCH_RADIUS_M)
      expect(Number.isInteger(r.due_in_days)).toBe(true)
      expect(r.due_in_days).toBeGreaterThanOrEqual(0)
      expect(r.due_in_days).toBeLessThanOrEqual(14)
      expect(r.due_in_days).toBeLessThanOrEqual(MAX_DUE[r.base_priority])
    }
  })

  it("hipótesis y acciones en español, con placeholders conocidos y largo acotado", () => {
    for (const r of CORRELATION_RULES) {
      const found = r.hypothesis.match(/\{[a-z_]+\}/g) ?? []
      for (const p of found) expect(PLACEHOLDERS.has(p), `${r.id}: ${p}`).toBe(true)
      expect(r.hypothesis).toContain("{elemento}")
      expect(r.hypothesis).toContain("{distancia}")
      expect(r.hypothesis.length).toBeLessThan(600)
      expect(r.recommended_actions.length).toBeGreaterThan(0)
      expect(r.recommended_actions.length).toBeLessThanOrEqual(20)
      for (const a of r.recommended_actions) {
        expect(a.length).toBeLessThanOrEqual(300)
        expect(a).toMatch(/^[A-ZÁÉÍÓÚÑ]/)
        expect(a.endsWith(".")).toBe(true)
      }
    }
  })

  it("grieta + alcantarillado: alta, ≤ 3 m, mismo nivel y nivel inferior, plazo 3 días", () => {
    for (const t of ["tuberia_alcantarillado", "camara_inspeccion"] as const) {
      const r = rulesFor("grieta", t)[0]
      expect(r.id).toBe("grieta_alcantarillado")
      expect(r.base_priority).toBe("alta")
      expect(r.max_distance_m).toBe(3)
      expect(r.relations).toEqual(expect.arrayContaining(["mismo_nivel", "nivel_inferior"]))
      expect(["prevencionista", "jefe_obra"]).toContain(r.suggested_role)
      expect(r.due_in_days).toBe(3)
      const text = (r.hypothesis + " " + r.recommended_actions.join(" ")).toLowerCase()
      for (const word of ["cctv", "estanqueidad", "fisurómetro", "cámara", "asentamiento diferencial"]) {
        expect(text).toContain(word)
      }
    }
  })

  it("cubre los cruces mínimos exigidos", () => {
    const required: Array<[FindingCategory, ElementType[]]> = [
      ["grieta", ["muro_carga", "columna", "viga", "losa", "fundacion", "tuberia_agua", "tuberia_aguas_lluvia"]],
      [
        "humedad_filtracion",
        ["tuberia_agua", "tuberia_alcantarillado", "tuberia_aguas_lluvia", "red_incendio", "ducto_electrico"],
      ],
      ["humedad_filtracion", ["tablero_electrico"]],
      ["olor_gas", ["linea_gas", "medidor_gas", "tuberia_alcantarillado", "camara_inspeccion"]],
      ["falla_electrica", ["ducto_electrico", "tablero_electrico", "tuberia_agua"]],
      ["hundimiento", ["tuberia_alcantarillado", "tuberia_agua", "tuberia_aguas_lluvia", "fundacion", "columna"]],
      ["excavacion", ["tuberia_alcantarillado", "tuberia_agua", "linea_gas", "ducto_electrico"]],
      ["desprendimiento", ["ducto_electrico", "red_incendio", "losa"]],
      ["corrosion", ["tuberia_agua", "red_incendio", "linea_gas"]],
      ["obstruccion", ["tuberia_alcantarillado", "camara_inspeccion", "tuberia_aguas_lluvia"]],
    ]
    for (const [cat, types] of required) {
      for (const t of types) expect(rulesFor(cat, t).length, `${cat} + ${t}`).toBeGreaterThan(0)
    }
  })

  it("los riesgos de gas y de agua con electricidad son críticos", () => {
    expect(rulesFor("olor_gas", "linea_gas")[0].base_priority).toBe("critica")
    expect(rulesFor("olor_gas", "linea_gas")[0].due_in_days).toBe(0)
    expect(rulesFor("humedad_filtracion", "tablero_electrico")[0].base_priority).toBe("critica")
    expect(rulesFor("humedad_filtracion", "ducto_electrico")[0].max_distance_m).toBeLessThanOrEqual(2)
    expect(rulesFor("excavacion", "linea_gas")[0].base_priority).toBe("critica")
    expect(rulesFor("excavacion", "ducto_electrico")[0].base_priority).toBe("critica")
  })

  it("los gases de alcantarillado se tratan como espacio confinado con medición previa", () => {
    const r = rulesFor("olor_gas", "camara_inspeccion")[0]
    const text = r.recommended_actions.join(" ").toLowerCase()
    expect(text).toContain("espacio confinado")
    expect(text).toContain("h2s")
    expect(text).toMatch(/sello hidráulico|sifon|sifón/)
  })

  it("hay una regla genérica de baja prioridad para redes cercanas", () => {
    const generic = CORRELATION_RULES.filter((r) => r.categories.includes("*"))
    expect(generic.length).toBeGreaterThan(0)
    for (const r of generic) expect(r.base_priority).toBe("baja")
    const types = new Set(generic.flatMap((r) => r.element_types))
    for (const t of [
      "tuberia_alcantarillado",
      "tuberia_agua",
      "linea_gas",
      "ducto_electrico",
      "red_incendio",
    ] as const) {
      expect(types.has(t)).toBe(true)
    }
  })
})
