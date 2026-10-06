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

  it("/api/autodesk/token entrega solo access_token y expires_in, sin caché", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "tok", expires_in: 3599, token_type: "Bearer", scope: "data:write", extra: "x" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const res = await autodeskGET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ access_token: "tok", expires_in: 3599 })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("/api/autodesk/token pide solo el scope del visor y no pone el secreto en el cuerpo", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: "tok", expires_in: 3599 }), { status: 200 }))
    await autodeskGET()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://developer.api.autodesk.com/authentication/v2/token")
    const body = new URLSearchParams(String(init.body))
    expect(body.get("grant_type")).toBe("client_credentials")
    expect(body.get("scope")).toBe("viewables:read")
    expect(String(init.body)).not.toContain("secreto")
    const headers = new Headers(init.headers)
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("id:secreto").toString("base64")}`)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("/api/autodesk/token no expone los mensajes del proveedor", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ developerMessage: "The client_id specified does not have access to the api product" }), {
        status: 401,
      }),
    )
    const res = await autodeskGET()
    expect(res.status).toBe(502)
    const text = JSON.stringify(await res.json())
    expect(text).not.toMatch(/client_id|api product|developerMessage/)
    expect(text).toMatch(/No se pudo obtener el token de Autodesk/)

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ expires_in: 10 }), { status: 200 }))
    expect((await autodeskGET()).status).toBe(502)

    fetchMock.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND developer.api.autodesk.com"))
    const net = await autodeskGET()
    expect(net.status).toBe(502)
    expect(JSON.stringify(await net.json())).not.toContain("ENOTFOUND")

    delete process.env.AUTODESK_CLIENT_SECRET
    const cfg = await autodeskGET()
    expect(cfg.status).toBe(503)
    expect(JSON.stringify(await cfg.json())).not.toMatch(/AUTODESK_CLIENT/)
    spy.mockRestore()
  })

  it("/api/planos/cad-to-image pasa la autenticación y valida la extensión", async () => {
    const res = await cadPOST(jsonRequest("/api/planos/cad-to-image", { base64: "QUJD", ext: "exe" }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("/api/planos/cad-to-image llama al conversor con un archivo válido (con tiempo máximo)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ dataUrl: "data:image/png;base64,QUJD", mimeType: "text/html" }), { status: 200 }),
    )
    const res = await cadPOST(jsonRequest("/api/planos/cad-to-image", { base64: "QUJD", ext: "dxf" }))
    expect(res.status).toBe(200)
    // El tipo sale del propio data URL, no de lo que declare el conversor.
    expect(await res.json()).toEqual({ dataUrl: "data:image/png;base64,QUJD", mimeType: "image/png" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://conversor.example.com/convert")
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(init.body))).toEqual({ base64: "QUJD", ext: "dxf" })
  })

  it("/api/planos/cad-to-image no devuelve el error del conversor al cliente", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "ODA File Converter 25.4 falló en /srv/convert/tmp/abc.dwg" }), { status: 500 }),
    )
    const res = await cadPOST(jsonRequest("/api/planos/cad-to-image", { base64: "QUJD", ext: "dwg" }))
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/El conversor CAD no pudo procesar el archivo/)
    expect(body.error).not.toMatch(/ODA|srv|abc\.dwg/)
    // Sí queda registrado en el servidor.
    expect(JSON.stringify(spy.mock.calls)).toContain("ODA File Converter")

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }), { status: 200 }))
    expect((await cadPOST(jsonRequest("/api/planos/cad-to-image", { base64: "QUJD", ext: "dxf" }))).status).toBe(502)

    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.7:8080"))
    const down = await cadPOST(jsonRequest("/api/planos/cad-to-image", { base64: "QUJD", ext: "dxf" }))
    expect(down.status).toBe(502)
    expect(JSON.stringify(await down.json())).not.toContain("ECONNREFUSED")
    spy.mockRestore()
  })

  it("/api/planos/cad-to-image responde 504 si el conversor no responde a tiempo", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
    const res = await cadPOST(jsonRequest("/api/planos/cad-to-image", { base64: "QUJD", ext: "dxf" }))
    expect(res.status).toBe(504)
    expect(((await res.json()) as { error: string }).error).toMatch(/no respondió a tiempo/)
    spy.mockRestore()
  })

  it("/api/planos/cad-to-image limita el tamaño de la entrada sin llamar al conversor", async () => {
    const big = "A".repeat(25 * 1024 * 1024 + 1)
    const res = await cadPOST(jsonRequest("/api/planos/cad-to-image", { base64: big, ext: "dxf" }))
    expect(res.status).toBe(413)
    const declared = new Request("http://localhost/api/planos/cad-to-image", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(30 * 1024 * 1024) },
      body: JSON.stringify({ base64: "QUJD", ext: "dxf" }),
    })
    expect((await cadPOST(declared)).status).toBe(413)
    expect((await cadPOST(jsonRequest("/api/planos/cad-to-image", "no-json"))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
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
