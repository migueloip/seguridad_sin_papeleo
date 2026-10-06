// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Tests de autorización de app/actions/plans.ts con la BD simulada: cada
 * consulta del template tag `sql` queda registrada (texto + parámetros) para
 * verificar que toda lectura/escritura va filtrada por el dueño del plano.
 */

type Query = { text: string; values: unknown[]; inTx: boolean }

const state = vi.hoisted(() => ({
  userId: 1 as number | null,
  inTx: false,
  queries: [] as { text: string; values: unknown[]; inTx: boolean }[],
  responder: (() => []) as (q: { text: string; values: unknown[]; inTx: boolean }) => unknown[],
  getAiSettings: vi.fn(),
  generateText: vi.fn(),
}))

vi.mock("@/lib/db", () => {
  const isTemplate = (v: unknown): v is TemplateStringsArray => Array.isArray(v) && "raw" in (v as object)
  const tag = (first: unknown, ...rest: unknown[]) => {
    if (isTemplate(first)) {
      const q = { text: first.join("?"), values: rest, inTx: state.inTx }
      state.queries.push(q)
      return Promise.resolve(state.responder(q))
    }
    // Helper de inserción múltiple: sql(filas, ...columnas)
    return { __helper: true, rows: first, columns: rest }
  }
  tag.json = (value: unknown) => ({ __json: value })
  tag.begin = async (fn: (tx: unknown) => Promise<unknown>) => {
    state.inTx = true
    try {
      return await fn(tag)
    } finally {
      state.inTx = false
    }
  }
  return { sql: tag }
})

vi.mock("@/lib/auth", () => ({
  getCurrentUserId: async () => state.userId,
  getSession: async () => (state.userId == null ? null : { user_id: state.userId }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/settings", () => ({ getAiSettings: state.getAiSettings }))
vi.mock("@/lib/ai", () => ({ getModel: vi.fn(() => ({})) }))
vi.mock("ai", () => ({ generateText: state.generateText }))

import {
  createPlan,
  deletePlan,
  deletePlanType,
  extractZonesFromPlan,
  getPlanDetail,
  getPlanTypes,
  savePlanFloorsAndZones,
  updatePlanType,
} from "./plans"

const OWNER = 1
const OTHER_PLAN = 99
const OWN_PLAN = 7

function find(fragment: string): Query[] {
  return state.queries.filter((q) => q.text.includes(fragment))
}

beforeEach(() => {
  state.userId = OWNER
  state.inTx = false
  state.queries = []
  state.responder = () => []
  state.getAiSettings.mockReset()
  state.generateText.mockReset()
})

describe("deletePlan", () => {
  it("borra con user_id en el WHERE: un plano ajeno no se toca", async () => {
    await deletePlan(OTHER_PLAN)
    const deletes = find("DELETE FROM plans")
    expect(deletes).toHaveLength(1)
    expect(deletes[0].text).toMatch(/WHERE id = \? AND user_id = \?/)
    expect(deletes[0].values).toEqual([OTHER_PLAN, OWNER])
  })

  it("sin sesión no ejecuta ninguna consulta", async () => {
    state.userId = null
    await expect(deletePlan(OWN_PLAN)).rejects.toThrow("No autenticado")
    expect(state.queries).toHaveLength(0)
  })

  it("rechaza ids no numéricos", async () => {
    await expect(deletePlan("1 OR 1=1" as unknown as number)).rejects.toThrow("Plano no válido.")
    expect(state.queries).toHaveLength(0)
  })
})

describe("savePlanFloorsAndZones", () => {
  it("con un plano ajeno no borra ni escribe pisos/zonas", async () => {
    // La verificación de propiedad no devuelve filas: el plano no es del usuario.
    state.responder = () => []
    await expect(
      savePlanFloorsAndZones(OTHER_PLAN, [{ name: "Piso 1", zones: [{ name: "Andamio", code: "Alto" }] }]),
    ).rejects.toThrow("Plano no encontrado.")

    expect(state.queries).toHaveLength(1)
    const check = state.queries[0]
    expect(check.text).toContain("FROM plans WHERE id = ? AND user_id = ?")
    expect(check.text).toContain("FOR UPDATE")
    expect(check.values).toEqual([OTHER_PLAN, OWNER])
    expect(check.inTx).toBe(true)
    expect(find("DELETE")).toHaveLength(0)
    expect(find("INSERT")).toHaveLength(0)
    expect(find("UPDATE plans")).toHaveLength(0)
  })

  it("reemplaza pisos y zonas del plano propio dentro de una transacción", async () => {
    let floorSeq = 100
    state.responder = (q) => {
      if (q.text.includes("FROM plans WHERE id")) return [{ id: OWN_PLAN }]
      if (q.text.includes("INSERT INTO plan_floors")) return [{ id: ++floorSeq }]
      return []
    }
    const longName = "x".repeat(300)
    await savePlanFloorsAndZones(OWN_PLAN, [
      {
        name: "",
        zones: [
          { name: longName, code: "Alto", type: "risk", x: 1.7, y: -2, width: 0.25, height: 0.5 } as never,
          { name: "Bodega", code: "Bajo" },
        ],
      },
      { name: "Piso 2", level: 2 },
    ])

    // Todo ocurre dentro de la transacción y la verificación va primero.
    expect(state.queries.every((q) => q.inTx)).toBe(true)
    expect(state.queries[0].text).toContain("FOR UPDATE")
    const zoneDelete = state.queries.findIndex((q) => q.text.includes("DELETE FROM plan_zones"))
    expect(zoneDelete).toBeGreaterThan(0)

    const floorInserts = find("INSERT INTO plan_floors")
    expect(floorInserts).toHaveLength(2)
    expect(floorInserts[0].values).toEqual([OWNER, OWN_PLAN, "Piso 1", 0])
    expect(floorInserts[1].values).toEqual([OWNER, OWN_PLAN, "Piso 2", 2])

    const zoneInserts = find("INSERT INTO plan_zones")
    expect(zoneInserts).toHaveLength(1)
    const helper = zoneInserts[0].values[0] as { rows: Array<Record<string, unknown>>; columns: string[] }
    expect(helper.columns).toEqual(["user_id", "plan_id", "floor_id", "name", "code", "zone_type"])
    expect(helper.rows).toHaveLength(2)
    expect(helper.rows[0]).toMatchObject({ user_id: OWNER, plan_id: OWN_PLAN, floor_id: 101, code: "Alto", zone_type: "risk" })
    expect(String(helper.rows[0].name)).toHaveLength(100)
    expect(helper.rows[1]).toMatchObject({ name: "Bodega", zone_type: "general" })

    const update = find("UPDATE plans")
    expect(update).toHaveLength(1)
    expect(update[0].text).toContain("WHERE id = ? AND user_id = ?")
    const json = update[0].values[0] as { __json: { floors: Array<{ zones: Array<Record<string, unknown>> }> } }
    // Las coordenadas se conservan (normalizadas a 0..1) para el mapa de riesgos.
    expect(json.__json.floors[0].zones[0]).toMatchObject({ x: 1, y: 0, width: 0.25, height: 0.5 })
  })

  it("rechaza estructuras desmedidas sin tocar la BD", async () => {
    const floors = Array.from({ length: 51 }, (_, i) => ({ name: `P${i}` }))
    await expect(savePlanFloorsAndZones(OWN_PLAN, floors)).rejects.toThrow(/como máximo/)
    await expect(savePlanFloorsAndZones(OWN_PLAN, "nada" as never)).rejects.toThrow(/no es válido/)
    expect(state.queries).toHaveLength(0)
  })
})

describe("lecturas filtradas por usuario", () => {
  it("getPlanDetail de un plano ajeno devuelve vacío y no lee pisos ni zonas", async () => {
    const r = await getPlanDetail(OTHER_PLAN)
    expect(r).toEqual({ plan: null, floors: [] })
    expect(state.queries).toHaveLength(1)
    expect(state.queries[0].text).toContain("WHERE id = ? AND user_id = ?")
    expect(state.queries[0].values).toEqual([OTHER_PLAN, OWNER])
  })

  it("getPlanTypes solo lista los tipos del usuario", async () => {
    await getPlanTypes()
    expect(state.queries).toHaveLength(1)
    expect(state.queries[0].text).toContain("WHERE user_id = ?")
    expect(state.queries[0].values).toEqual([OWNER])
  })
})

describe("tipos de plano", () => {
  it("updatePlanType y deletePlanType filtran por user_id", async () => {
    await updatePlanType(5, { name: "  Eléctrico  ", description: "Tableros" })
    await deletePlanType(5)
    const [upd] = find("UPDATE plan_types")
    expect(upd.text).toContain("WHERE id = ? AND user_id = ?")
    expect(upd.values).toEqual(["Eléctrico", "Tableros", 5, OWNER])
    const [del] = find("DELETE FROM plan_types")
    expect(del.text).toContain("WHERE id = ? AND user_id = ?")
    expect(del.values).toEqual([5, OWNER])
  })

  it("exige nombre", async () => {
    await expect(updatePlanType(5, { name: "   " })).rejects.toThrow(/obligatorio/)
    expect(state.queries).toHaveLength(0)
  })
})

describe("createPlan", () => {
  it("no permite asociar el plano a un proyecto ajeno", async () => {
    state.responder = () => []
    await expect(createPlan({ name: "Plano", project_id: 33 })).rejects.toThrow("Proyecto no encontrado.")
    expect(find("FROM projects WHERE id = ? AND user_id = ?")[0].values).toEqual([33, OWNER])
    expect(find("INSERT INTO plans")).toHaveLength(0)
  })
})

describe("extractZonesFromPlan", () => {
  it("exige sesión antes de usar la IA", async () => {
    state.userId = null
    await expect(extractZonesFromPlan("aGVsbG8=", "image/png")).rejects.toThrow("No autenticado")
    expect(state.getAiSettings).not.toHaveBeenCalled()
    expect(state.generateText).not.toHaveBeenCalled()
  })

  it("rechaza imágenes demasiado grandes o con tipo no permitido", async () => {
    await expect(extractZonesFromPlan("A".repeat(8 * 1024 * 1024 + 4), "image/png")).rejects.toThrow(/tamaño máximo/)
    await expect(extractZonesFromPlan("aGVsbG8=", "text/html")).rejects.toThrow(/imagen/)
    await expect(extractZonesFromPlan("aGVs;bG8=", "image/png")).rejects.toThrow(/formato válido/)
    expect(state.getAiSettings).not.toHaveBeenCalled()
  })

  it("con sesión e imagen válida llama a la IA", async () => {
    state.getAiSettings.mockResolvedValue({ ready: true, provider: "google", model: "m", apiKey: "k", baseUrl: null })
    state.generateText.mockResolvedValue({ text: '```json\n{"floors":[{"name":"General","zones":[]}]}\n```' })
    const r = await extractZonesFromPlan("aGVsbG8=", "image/png")
    expect(r).toEqual({ floors: [{ name: "General", zones: [] }] })
    const call = state.generateText.mock.calls[0][0] as { messages: Array<{ content: Array<{ type: string; image?: string }> }> }
    expect(call.messages[0].content[1].image).toBe("data:image/png;base64,aGVsbG8=")
  })
})
