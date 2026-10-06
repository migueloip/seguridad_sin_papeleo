// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  userId: null as number | null,
  rows: [] as Array<{ id: number; key: string; value: string | null; description: string | null; user_id: number | null }>,
  /** Escrituras simuladas (INSERT ... ON CONFLICT): [user_id, key, valor guardado]. */
  writes: [] as Array<{ user_id: unknown; key: unknown; value: unknown }>,
}))

vi.mock("@/lib/auth", () => ({ getCurrentUserId: async () => state.userId }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/db", () => ({
  // Simula las consultas de settings: distingue por el texto del WHERE y los parámetros.
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?")
    if (text.includes("INSERT INTO settings")) {
      state.writes.push({ user_id: values[0], key: values[1], value: values[2] })
      return []
    }
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

import { getSetting, getSettings, updateSetting, updateSettings } from "./settings"
import { decryptSettingIfNeeded, encryptSettingIfNeeded, getAiSettings } from "@/lib/settings"

beforeEach(() => {
  process.env.CONFIG_ENCRYPTION_SECRET = "test"
  state.userId = null
  state.writes = []
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

describe("updateSetting / updateSettings: lista blanca de claves", () => {
  it("updateSettings guarda las claves de /configuracion e ignora las desconocidas o mal formadas", async () => {
    state.userId = 7
    await updateSettings([
      { key: "company_name", value: "Constructora Los Aromos" },
      { key: "ai_provider", value: "openai" },
      { key: "nav_disabled", value: '["planos"]' },
      { key: "require_signature", value: "off" },
      { key: "is_admin", value: "true" },
      { key: "__proto__", value: "x" },
      { key: "role", value: "admin" },
      { key: "company_logo", value: 123 as unknown as string },
      null as unknown as { key: string; value: string },
    ])
    expect(state.writes.map((w) => w.key)).toEqual(["company_name", "ai_provider", "nav_disabled", "require_signature"])
    expect(state.writes.every((w) => w.user_id === 7)).toBe(true)
  })

  it("las claves que usa el resto del código se pueden guardar", async () => {
    state.userId = 7
    const keys = [
      "ai_provider",
      "ai_model",
      "ai_api_key",
      "ai_base_url",
      "ai_report_style_examples",
      "ocr_method",
      "company_name",
      "company_logo",
      "responsible_name",
      "responsible_signature",
      "require_signature",
      "pdf_template_default",
      "nav_disabled",
      "notifications_read_at",
    ]
    await updateSettings(keys.map((key) => ({ key, value: "v" })))
    expect(state.writes.map((w) => w.key)).toEqual(keys)
  })

  it("updateSetting rechaza claves desconocidas sin escribir", async () => {
    state.userId = 7
    await expect(updateSetting("is_admin", "true")).rejects.toThrow("Clave de configuración no permitida.")
    await expect(updateSetting("smtp_host", "smtp.atacante.example.com")).rejects.toThrow(/no permitida/)
    await expect(updateSetting("company_name", 5 as unknown as string)).rejects.toThrow(/no válido/)
    expect(state.writes).toEqual([])
    await updateSetting("notifications_read_at", "2026-10-06T12:00:00.000Z")
    expect(state.writes).toEqual([{ user_id: 7, key: "notifications_read_at", value: "2026-10-06T12:00:00.000Z" }])
  })

  it("mantiene el enmascarado: el valor __MASKED__ no pisa la clave guardada y las sensibles se cifran", async () => {
    state.userId = 7
    await updateSettings([
      { key: "ai_api_key", value: "__MASKED__" },
      { key: "company_name", value: "Demo" },
    ])
    expect(state.writes.map((w) => w.key)).toEqual(["company_name"])
    await updateSetting("ai_api_key", "__MASKED__")
    expect(state.writes).toHaveLength(1)

    await updateSetting("ai_api_key", "clave-nueva-secreta")
    const stored = state.writes[1]
    expect(stored.key).toBe("ai_api_key")
    expect(String(stored.value)).toMatch(/^enc:gcm:/)
    expect(String(stored.value)).not.toContain("clave-nueva-secreta")
    expect(decryptSettingIfNeeded("ai_api_key", String(stored.value))).toBe("clave-nueva-secreta")
  })

  it("sin sesión no escribe nada", async () => {
    state.userId = null
    await updateSetting("company_name", "X")
    await updateSettings([{ key: "company_name", value: "X" }])
    expect(state.writes).toEqual([])
  })
})
