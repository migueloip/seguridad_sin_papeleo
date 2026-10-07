// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  userId: 1 as number | null,
  photos: [] as unknown,
  projectId: 7 as number | null,
  /** Proyectos del usuario (para la consulta de propiedad de una ruta "obra-storage:"). */
  ownedProjects: [7] as number[],
  sql: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  getCurrentUserId: async () => state.userId,
  getSession: async () => (state.userId == null ? null : { user_id: state.userId }),
}))
vi.mock("@/lib/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => state.sql(strings, ...values),
}))

import { GET } from "./route"

const SUPABASE = "https://abcd.supabase.co"
const HEX24 = "0123456789abcdef01234567"
const fetchMock = vi.fn()
const originalSupabaseUrl = process.env.SUPABASE_URL

function req(query = "id=5&index=0") {
  return new Request(`http://localhost/api/findings/photo?${query}`)
}

beforeEach(() => {
  state.userId = 1
  state.projectId = 7
  state.ownedProjects = [7]
  state.sql.mockReset()
  state.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join("?").includes("FROM projects")) {
      const [pid, uid] = values as [number, number]
      return uid === state.userId && state.ownedProjects.includes(pid) ? [{ n: 1 }] : []
    }
    return [{ photos: state.photos, project_id: state.projectId }]
  })
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  process.env.SUPABASE_URL = SUPABASE
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL
  else process.env.SUPABASE_URL = originalSupabaseUrl
})

describe("GET /api/findings/photo", () => {
  it("sin sesión responde 401 y no consulta la BD", async () => {
    state.userId = null
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(state.sql).not.toHaveBeenCalled()
  })

  it("consulta el hallazgo filtrando por el usuario", async () => {
    state.photos = []
    await GET(req())
    const [strings, ...values] = state.sql.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    expect(strings.join("?")).toContain("WHERE id = ? AND user_id = ?")
    expect(values).toEqual([5, 1])
  })

  it("sirve data URLs con caché privada y sin sniffing", async () => {
    state.photos = ["data:image/png;base64,aGVsbG8="]
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("hello")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    "https://evil.example.com/foto.png",
    "https://abcd.supabase.co.evil.com/foto.png",
    "https://abcd.supabase.co@evil.com/foto.png",
    "https://user:pass@abcd.supabase.co/foto.png",
    "http://abcd.supabase.co/foto.png",
    "https://abcd.supabase.co:8443/foto.png",
    "https://otro.supabase.co/storage/v1/object/public/b/foto.png",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:5432/",
  ])("rechaza con 415 el origen no permitido %s sin hacer fetch", async (url) => {
    state.photos = [url]
    const res = await GET(req())
    expect(res.status).toBe(415)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sin SUPABASE_URL configurada no descarga ninguna URL remota", async () => {
    delete process.env.SUPABASE_URL
    state.photos = [`${SUPABASE}/storage/v1/object/public/findings/1.png`]
    const res = await GET(req())
    expect(res.status).toBe(415)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("descarga del origen de Supabase sin seguir redirecciones y con timeout", async () => {
    const photoUrl = `${SUPABASE}/storage/v1/object/public/findings/1.png`
    state.photos = ["data:image/png;base64,aGVsbG8=", photoUrl]
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    )
    const res = await GET(req("id=5&index=1"))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(photoUrl)
    expect(init.redirect).toBe("error")
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(res.headers.get("content-type")).toBe("image/jpeg")
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400")
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3])
  })

  it("sirve fotos de Obra integral (obra-storage:) leyendo el bucket privado con la service key", async () => {
    const png = Buffer.alloc(8 + 25 + 12)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0)
    png.writeUInt32BE(13, 8)
    png.write("IHDR", 12, "ascii")
    png.writeUInt32BE(4, 16)
    png.writeUInt32BE(3, 20)
    const prevKey = process.env.SUPABASE_SERVICE_KEY
    process.env.SUPABASE_SERVICE_KEY = "service-key"
    try {
      state.photos = [`obra-storage:obra/7/hallazgos/${HEX24}.png`]
      fetchMock.mockResolvedValue(new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } }))
      const res = await GET(req())
      expect(res.status).toBe(200)
      const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(calledUrl).toBe(`${SUPABASE}/storage/v1/object/authenticated/obra-planos/obra/7/hallazgos/${HEX24}.png`)
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer service-key")
      expect(init.redirect).toBe("error")
      expect(res.headers.get("content-type")).toBe("image/png")
      expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    } finally {
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_KEY
      else process.env.SUPABASE_SERVICE_KEY = prevKey
    }
  })

  it.each([
    ["una lámina de capa (no es foto de hallazgo)", `obra-storage:obra/7/12-${HEX24}.png`],
    ["una lámina subida directo", "obra-storage:obra/7/uploads/0f8fad5b-d9cb-469f-a165-70867728950e.png"],
    ["una foto de OTRO proyecto", `obra-storage:obra/8/hallazgos/${HEX24}.png`],
    ["una ruta con ..", `obra-storage:obra/7/hallazgos/../../8/hallazgos/${HEX24}.png`],
    ["una ruta con otro formato", "obra-storage:obra/7/hallazgos/abc123.png"],
  ])("no sirve %s aunque esté en photos del hallazgo propio (404, sin leer Storage)", async (_label, ref) => {
    const prevKey = process.env.SUPABASE_SERVICE_KEY
    process.env.SUPABASE_SERVICE_KEY = "service-key"
    try {
      state.photos = [ref]
      const res = await GET(req())
      expect(res.status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_KEY
      else process.env.SUPABASE_SERVICE_KEY = prevKey
    }
  })

  it("no sirve una foto de Obra si el proyecto del hallazgo no es del usuario (hallazgo heredado con project_id ajeno)", async () => {
    const prevKey = process.env.SUPABASE_SERVICE_KEY
    process.env.SUPABASE_SERVICE_KEY = "service-key"
    try {
      state.projectId = 8
      state.ownedProjects = [7]
      state.photos = [`obra-storage:obra/8/hallazgos/${HEX24}.png`]
      const res = await GET(req())
      expect(res.status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_KEY
      else process.env.SUPABASE_SERVICE_KEY = prevKey
    }
  })

  it("si Storage redirige (fetch falla) responde 500 sin filtrar detalles", async () => {
    state.photos = [`${SUPABASE}/storage/v1/object/public/findings/1.png`]
    fetchMock.mockRejectedValue(new TypeError("fetch failed: redirect mode is set to error"))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.text()).toBe("error")
  })
})
