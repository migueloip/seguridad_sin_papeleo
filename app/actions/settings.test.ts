// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  userId: null as number | null,
  rows: [] as Array<{ id: number; key: string; value: string | null; description: string | null; user_id: number | null }>,
}))

vi.mock("@/lib/auth", () => ({ getCurrentUserId: async () => state.userId }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/db", () => ({
  // Simula las consultas de settings: distingue por el texto del WHERE y los parámetros.
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?")
    if (text.includes("user_id IS NULL AND key")) {
      return state.rows.filter((r) => r.user_id === null && r.key === values[0])
    }
    if (text.includes("user_id = ? AND key")) {
      return state.rows.filter((r) => r.user_id === values[0] && r.key === values[1])
    }
    if (text.includes("WHERE user_id IS NULL")) return state.rows.filter((r) => r.user_id === null)
    if (text.includes("WHERE user_id = ?")) return state.rows.filter((r) => r.user_id === values[0])
    return []
  },
}))

import { getSetting, getSettings } from "./settings"
import { encryptSettingIfNeeded, getAiSettings } from "@/lib/settings"

beforeEach(() => {
  process.env.CONFIG_ENCRYPTION_SECRET = "test"
  state.userId = null
  state.rows = [
    { id: 1, key: "ai_api_key", value: encryptSettingIfNeeded("ai_api_key", "clave-global-secreta"), description: null, user_id: null },
    { id: 2, key: "smtp_pass", value: encryptSettingIfNeeded("smtp_pass", "smtp-secreta"), description: null, user_id: null },
    { id: 3, key: "company_name", value: "Constructora Demo", description: null, user_id: null },
    { id: 4, key: "ai_provider", value: "google", description: null, user_id: null },
  ]
})

describe("acciones de configuración (endpoints públicos)", () => {
  it("getSetting nunca devuelve claves sensibles, con o sin sesión", async () => {
    expect(await getSetting("ai_api_key")).toBeNull()
    expect(await getSetting("smtp_pass")).toBeNull()
    state.userId = 7
    expect(await getSetting("ai_api_key")).toBeNull()
    expect(await getSetting("company_name")).toBe("Constructora Demo")
  })

  it("getSettings enmascara todas las claves sensibles", async () => {
    const all = await getSettings()
    const byKey = Object.fromEntries(all.map((s) => [s.key, s.value]))
    expect(byKey.ai_api_key).toBe("__MASKED__")
    expect(byKey.smtp_pass).toBe("__MASKED__")
    expect(byKey.company_name).toBe("Constructora Demo")
    expect(JSON.stringify(all)).not.toContain("secreta")
  })

  it("en el servidor, getAiSettings (lib/settings) sí lee la key descifrada", async () => {
    state.userId = 7
    const ai = await getAiSettings()
    expect(ai.apiKey).toBe("clave-global-secreta")
    expect(ai.ready).toBe(true)
  })

  it("una URL base propia nunca se combina con la key global (no se filtra a un host del usuario)", async () => {
    state.userId = 7
    state.rows.push({ id: 10, key: "ai_base_url", value: "https://atacante.example.com/v1beta", description: null, user_id: 7 })
    const ai = await getAiSettings()
    expect(ai.apiKey).toBe("")
    expect(ai.ready).toBe(false)
    expect(JSON.stringify(ai)).not.toContain("secreta")
  })
})
