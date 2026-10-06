// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * El middleware solo comprueba que exista la cookie `session_token`, no que sea
 * válida. Estas rutas deben validar la sesión real con getSession() y responder
 * 401 antes de gastar cuota de IA, pedir tokens de Autodesk o llamar al
 * conversor CAD.
 */

const state = vi.hoisted(() => ({
  session: null as null | { user_id: number; email: string; name: string | null; role: string | null },
  getAiSettings: vi.fn(),
  getReportData: vi.fn(),
  getModel: vi.fn(),
  sql: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  getSession: async () => state.session,
  getCurrentUserId: async () => state.session?.user_id ?? null,
}))
vi.mock("@/lib/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => state.sql(strings, ...values),
}))
vi.mock("@/app/actions/settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/settings", () => ({ getAiSettings: state.getAiSettings, readSetting: vi.fn() }))
vi.mock("@/app/actions/reports", () => ({ getReportData: state.getReportData }))
vi.mock("@/lib/ai", () => ({ getModel: state.getModel }))

import { POST as chatPOST } from "./chat/route"
import { POST as assistantPOST } from "./assistant/route"
import { GET as autodeskGET } from "./autodesk/token/route"
import { POST as cadPOST } from "./planos/cad-to-image/route"
import { classifyUpload, extractDocumentData, parseDocumentDescription } from "@/app/actions/document-processing"
import { extractPdfText, getOcrMethod } from "@/app/actions/ocr"

const fetchMock = vi.fn()
const ENV_KEYS = ["AUTODESK_CLIENT_ID", "AUTODESK_CLIENT_SECRET", "CAD_CONVERTER_URL"] as const
const savedEnv: Record<string, string | undefined> = {}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "session_token=cualquier-cosa" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.session = null
  state.getAiSettings.mockReset()
  state.getAiSettings.mockResolvedValue({ ready: false, provider: "google", model: "m", apiKey: "", baseUrl: null })
  state.getReportData.mockReset()
  state.getModel.mockReset()
  state.sql.mockReset()
  state.sql.mockResolvedValue([])
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.AUTODESK_CLIENT_ID = "id"
  process.env.AUTODESK_CLIENT_SECRET = "secreto"
  process.env.CAD_CONVERTER_URL = "https://conversor.example.com/convert"
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe("sin sesión válida (cookie presente pero inválida) -> 401", () => {
  it("/api/chat no consulta la configuración de IA", async () => {
    const res = await chatPOST(jsonRequest("/api/chat", { messages: [], projectId: 1 }))
    expect(res.status).toBe(401)
    expect(state.getAiSettings).not.toHaveBeenCalled()
    expect(state.getReportData).not.toHaveBeenCalled()
  })

  it("/api/assistant no consulta IA ni BD", async () => {
    const res = await assistantPOST(jsonRequest("/api/assistant", { messages: [] }))
    expect(res.status).toBe(401)
    expect(state.getAiSettings).not.toHaveBeenCalled()
    expect(state.sql).not.toHaveBeenCalled()
  })

  it("/api/autodesk/token no pide token a Autodesk", async () => {
    const res = await autodeskGET()
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("/api/planos/cad-to-image no llama al conversor", async () => {
    const res = await cadPOST(jsonRequest("/api/planos/cad-to-image", { base64: "QUJD", ext: "dxf" }))
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("con sesión válida", () => {
  beforeEach(() => {
    state.session = { user_id: 7, email: "a@test.cl", name: "A", role: "user" }
  })

  it("/api/chat pasa la autenticación (sin IA configurada responde 400)", async () => {
    const res = await chatPOST(jsonRequest("/api/chat", { messages: [] }))
    expect(res.status).toBe(400)
    expect(state.getAiSettings).toHaveBeenCalledTimes(1)
  })

  it("/api/chat rechaza cuerpos inválidos", async () => {
    const res = await chatPOST(jsonRequest("/api/chat", { messages: "hola" }))
    expect(res.status).toBe(400)
    expect(state.getAiSettings).not.toHaveBeenCalled()
  })

  it("/api/assistant pasa la autenticación (sin IA configurada responde 400)", async () => {
    const res = await assistantPOST(jsonRequest("/api/assistant", { messages: [] }))
    expect(res.status).toBe(400)
  })

  it("/api/autodesk/token entrega el token sin caché", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "tok", expires_in: 3599 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const res = await autodeskGET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ access_token: "tok", expires_in: 3599 })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("/api/planos/cad-to-image pasa la autenticación y valida la extensión", async () => {
    const res = await cadPOST(jsonRequest("/api/planos/cad-to-image", { base64: "QUJD", ext: "exe" }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("/api/planos/cad-to-image llama al conversor con un archivo válido", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ dataUrl: "data:image/png;base64,QUJD", mimeType: "image/png" }), { status: 200 }),
    )
    const res = await cadPOST(jsonRequest("/api/planos/cad-to-image", { base64: "QUJD", ext: "dxf" }))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("acciones de IA/OCR (document-processing.ts y ocr.ts)", () => {
  it("sin sesión lanzan 'No autenticado' antes de tocar la IA", async () => {
    await expect(parseDocumentDescription("curso de altura")).rejects.toThrow("No autenticado")
    await expect(extractDocumentData("QUJD", "image/png")).rejects.toThrow("No autenticado")
    await expect(classifyUpload("QUJD", "image/png")).rejects.toThrow("No autenticado")
    await expect(getOcrMethod()).rejects.toThrow("No autenticado")
    await expect(extractPdfText("data:application/pdf;base64,QUJD")).rejects.toThrow("No autenticado")
    expect(state.getAiSettings).not.toHaveBeenCalled()
  })

  it("con sesión limitan el tamaño y el tipo de las entradas", async () => {
    state.session = { user_id: 7, email: "a@test.cl", name: "A", role: "user" }
    const big = "A".repeat(8 * 1024 * 1024 + 4)
    await expect(extractDocumentData(big, "image/png")).rejects.toThrow(/tamaño máximo/)
    await expect(classifyUpload("QUJD", "text/html")).rejects.toThrow(/no soportado/)
    await expect(parseDocumentDescription("x".repeat(4001))).rejects.toThrow(/demasiado larga/)
    await expect(extractPdfText(`data:application/pdf;base64,${big}`)).rejects.toThrow(/tamaño máximo/)
    expect(state.getAiSettings).not.toHaveBeenCalled()
  })

  it("con sesión y sin IA configurada devuelven el resultado vacío de siempre", async () => {
    state.session = { user_id: 7, email: "a@test.cl", name: "A", role: "user" }
    await expect(classifyUpload("QUJD", "image/png")).resolves.toEqual({ target: "document" })
    await expect(parseDocumentDescription("curso de altura")).resolves.toEqual({
      tipoDocumento: null,
      nombre: null,
      vigenciaMeses: null,
      notas: null,
    })
  })
})
