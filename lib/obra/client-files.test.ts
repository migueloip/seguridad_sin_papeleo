// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { startFakeStorage, type FakeStorage } from "@/tests/obra/fake-supabase-storage"
import {
  PLAN_IMAGE_MAX_BYTES,
  PLAN_IMAGE_MAX_SIDE,
  PLAN_INLINE_FILE_MAX_BYTES,
  PLAN_UPLOAD_MAX_BYTES,
  PLAN_UPLOAD_MAX_SIDE,
  PlanUploadError,
  UPLOAD_NETWORK_ERROR,
  blobToDataUrl,
  dataUrlLengthFor,
  describeStorageUploadError,
  detectPlanFileKind,
  estimateDataUrlBytes,
  fitsInline,
  formatMegabytes,
  readImageFileAsDataUrl,
  readImageFileForUpload,
  readTextFile,
  uploadToSignedUrl,
  type PlanFileKind,
} from "./client-files"

describe("detectPlanFileKind", () => {
  const cases: Array<[string, string, PlanFileKind]> = [
    ["plano.png", "image/png", "image"],
    ["FOTO.JPG", "image/jpeg", "image"],
    ["lamina.webp", "", "image"],
    ["escaneo", "image/jpeg", "image"],
    ["planta-arq.pdf", "application/pdf", "pdf"],
    ["planta-arq.PDF", "", "pdf"],
    ["sin-extension", "application/pdf", "pdf"],
    ["alcantarillado.dxf", "", "dxf"],
    ["alcantarillado.DXF", "application/octet-stream", "dxf"],
    ["plano", "image/vnd.dxf", "dxf"],
    ["estructura.dwg", "", "dwg"],
    ["estructura", "application/acad", "dwg"],
    ["foto.heic", "image/heic", "unknown"],
    ["notas.txt", "text/plain", "unknown"],
    ["planilla.xlsx", "", "unknown"],
  ]

  it.each(cases)("%s (%s) → %s", (name, type, expected) => {
    expect(detectPlanFileKind(new File(["x"], name, { type }))).toBe(expected)
  })
})

describe("estimateDataUrlBytes", () => {
  it("calcula los bytes decodificados de un data URL base64", () => {
    expect(estimateDataUrlBytes("data:text/plain;base64,SGVsbG8=")).toBe(5) // "Hello"
    expect(estimateDataUrlBytes("data:text/plain;base64,SGk=")).toBe(2) // "Hi"
    expect(estimateDataUrlBytes("data:text/plain;base64,SGV5")).toBe(3) // "Hey"
    expect(estimateDataUrlBytes("data:image/png;base64,")).toBe(0)
    const big = "data:image/png;base64," + "A".repeat(4_000_000)
    expect(estimateDataUrlBytes(big)).toBe(3_000_000)
  })

  it("cuenta los escapes %XX en data URL sin base64", () => {
    expect(estimateDataUrlBytes("data:text/plain,hola%20mundo")).toBe(10)
  })

  it("devuelve 0 si no es un data URL", () => {
    expect(estimateDataUrlBytes("")).toBe(0)
    expect(estimateDataUrlBytes("https://ejemplo.cl/plano.png")).toBe(0)
    expect(estimateDataUrlBytes("data:sin-coma")).toBe(0)
  })
})

describe("readTextFile", () => {
  it("lee UTF-8 y, si no es válido, Windows-1252", async () => {
    const utf8 = new File([new TextEncoder().encode("Cañería Ø160")], "a.dxf")
    expect(await readTextFile(utf8)).toBe("Cañería Ø160")
    // "Cañería" en Windows-1252 (ñ = 0xF1, í = 0xED): no es UTF-8 válido.
    const latin = new File([new Uint8Array([0x43, 0x61, 0xf1, 0x65, 0x72, 0xed, 0x61])], "b.dxf")
    expect(await readTextFile(latin)).toBe("Cañería")
  })
})

describe("readImageFileAsDataUrl", () => {
  it("expone límites por defecto razonables", () => {
    expect(PLAN_IMAGE_MAX_SIDE).toBe(3000)
    // Bajo el límite de 6 MB por request de las funciones de Netlify, con margen para el resto del cuerpo.
    expect(PLAN_IMAGE_MAX_BYTES).toBe(4_500_000)
    expect(PLAN_IMAGE_MAX_BYTES).toBeLessThan(6 * 1024 * 1024 * 0.8)
  })

  it("rechaza archivos que no son imágenes", async () => {
    await expect(readImageFileAsDataUrl(new File(["0\nSECTION"], "plano.dxf"))).rejects.toThrow(/no es una imagen/)
  })
})

describe("límites inline y de subida directa", () => {
  it("separa el límite inline (server action) del de subida directa a Storage", () => {
    // Inline: data URL de ≤ 4.500.000 caracteres ≈ archivo de ≤ 3,2 MB.
    expect(PLAN_INLINE_FILE_MAX_BYTES).toBe(3_374_982)
    expect(formatMegabytes(PLAN_INLINE_FILE_MAX_BYTES)).toBe("3,2 MB")
    // Directo: 25 MB y resolución completa hasta 6000 px.
    expect(PLAN_UPLOAD_MAX_BYTES).toBe(25 * 1024 * 1024)
    expect(formatMegabytes(PLAN_UPLOAD_MAX_BYTES)).toBe("25 MB")
    expect(PLAN_UPLOAD_MAX_SIDE).toBe(6000)
    expect(PLAN_UPLOAD_MAX_SIDE).toBeGreaterThan(PLAN_IMAGE_MAX_SIDE)
    expect(PLAN_UPLOAD_MAX_BYTES).toBeGreaterThan(PLAN_IMAGE_MAX_BYTES)
  })

  it("dataUrlLengthFor y fitsInline calculan exacto el borde del límite inline", () => {
    expect(dataUrlLengthFor(3, "image/png")).toBe("data:image/png;base64,".length + 4)
    expect(dataUrlLengthFor(4, "image/png")).toBe("data:image/png;base64,".length + 8)
    const at = { blob: new Blob([new Uint8Array(PLAN_INLINE_FILE_MAX_BYTES)]), mime: "image/jpeg" }
    const over = { blob: new Blob([new Uint8Array(PLAN_INLINE_FILE_MAX_BYTES + 1)]), mime: "image/jpeg" }
    expect(dataUrlLengthFor(at.blob.size, at.mime)).toBeLessThanOrEqual(PLAN_IMAGE_MAX_BYTES)
    expect(fitsInline(at)).toBe(true)
    expect(fitsInline(over)).toBe(false)
  })

  it("blobToDataUrl etiqueta el data URL con el tipo pedido", async () => {
    const url = await blobToDataUrl(new Blob([new Uint8Array([1, 2, 3])]), "image/png")
    expect(url).toBe("data:image/png;base64,AQID")
    expect(estimateDataUrlBytes(url)).toBe(3)
  })
})

describe("readImageFileForUpload", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubBitmap(width: number, height: number) {
    const close = vi.fn()
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close })))
    return close
  }

  it("envía PNG/JPEG/WebP de hasta 6000 px y 25 MB tal cual, sin recomprimir (aunque superen el canvas de iOS)", async () => {
    const close = stubBitmap(6000, 4000) // 24 MP: más que CANVAS_MAX_PIXELS, pero no pasa por canvas
    const file = new File([new Uint8Array(9 * 1024 * 1024)], "planta.png", { type: "image/png" })
    const img = await readImageFileForUpload(file)
    expect(img).toMatchObject({ width: 6000, height: 4000, mime: "image/png", reencoded: false })
    expect(img.blob).toBe(file)
    expect(fitsInline(img)).toBe(false)
    expect(close).toHaveBeenCalled()
  })

  it("re-etiqueta archivos sin tipo informado según su extensión", async () => {
    stubBitmap(100, 50)
    const img = await readImageFileForUpload(new File([new Uint8Array(10)], "FOTO.JPG", { type: "" }))
    expect(img.mime).toBe("image/jpeg")
    expect(img.blob.type).toBe("image/jpeg")
    expect(img.blob.size).toBe(10)
  })

  it("si supera 6000 px necesita canvas (y lo informa si el navegador no lo tiene)", async () => {
    stubBitmap(9000, 3000)
    // jsdom avisa por consola que no implementa canvas: se silencia.
    vi.spyOn(console, "error").mockImplementation(() => {})
    const file = new File([new Uint8Array(10)], "larga.png", { type: "image/png" })
    await expect(readImageFileForUpload(file)).rejects.toThrow(/canvas no disponible/)
  })

  it("rechaza lo que no es imagen", async () => {
    await expect(readImageFileForUpload(new File(["%PDF"], "plano.pdf"))).rejects.toThrow(/no es una imagen/)
  })
})

describe("describeStorageUploadError (cuerpos reales de Storage: HTTP 400 con el código en el cuerpo)", () => {
  const body = (statusCode: string, error: string, message: string, code = "") =>
    JSON.stringify({ statusCode, code, error, message })

  it.each([
    [body("413", "Payload too large", "The object exceeded the maximum allowed size", "EntityTooLarge"), "too_large", /tamaño máximo.*25 MB/],
    [body("415", "invalid_mime_type", "mime type image/svg+xml is not supported", "InvalidMimeType"), "type", /PNG, JPG o WebP/],
    [body("409", "Duplicate", "The resource already exists", "KeyAlreadyExists"), "conflict", /Ya existe/],
    [body("400", "InvalidJWT", '"exp" claim timestamp check failed', "InvalidJWT"), "expired", /venció/],
    [body("400", "InvalidSignature", "Invalid signature", "InvalidSignature"), "expired", /venció/],
    [body("500", "Internal", "Internal Server Error", "InternalError"), "http", /código 500/],
    ["<html>Bad gateway</html>", "http", /código 400/],
  ] as const)("%s → %s", (text, kind, message) => {
    const e = describeStorageUploadError(400, text)
    expect(e).toBeInstanceOf(PlanUploadError)
    expect(e.kind).toBe(kind)
    expect(e.message).toMatch(message)
    expect(e.status).toBe(400)
  })
})

describe("uploadToSignedUrl contra el servidor falso de Storage (XMLHttpRequest real de jsdom, con CORS)", () => {
  const KEY = "clave-servicio-cliente"
  let fake: FakeStorage
  const api = (p: string) => `${fake.url}/storage/v1${p}`
  const auth = { Authorization: `Bearer ${KEY}` }

  beforeAll(async () => {
    fake = await startFakeStorage({ serviceKey: KEY })
    const res = await fetch(api("/bucket"), {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "obra-planos", public: false, file_size_limit: 2 * 1024 * 1024, allowed_mime_types: ["image/png"] }),
    })
    expect(res.status).toBe(200)
  })
  afterAll(async () => {
    await fake?.stop()
  })

  async function signedUrl(path: string): Promise<string> {
    const res = await fetch(api(`/object/upload/sign/obra-planos/${path}`), { method: "POST", headers: auth })
    const { url } = (await res.json()) as { url: string }
    return api(url)
  }

  it("hace PUT sin credenciales con Content-Type y x-upsert (preflight CORS) e informa el progreso", async () => {
    const url = await signedUrl("obra/1/uploads/a.png")
    const bytes = new Uint8Array(300_000).map((_, i) => i & 0xff)
    const progress: number[] = []
    await uploadToSignedUrl(url, new Blob([bytes], { type: "image/png" }), "image/png", { onProgress: (f) => progress.push(f) })
    const obj = fake.objects.get("obra-planos/obra/1/uploads/a.png")
    expect(obj?.contentType).toBe("image/png")
    expect(obj?.bytes.equals(Buffer.from(bytes))).toBe(true)
    expect(progress.at(-1)).toBe(1)
    const put = fake.requests.find((r) => r.method === "PUT" && r.path.endsWith("/obra/1/uploads/a.png"))
    expect(put).toMatchObject({ authorized: false, status: 200, headers: { "content-type": "image/png", "x-upsert": "false" } })
    expect(fake.requests.some((r) => r.method === "OPTIONS" && r.path.endsWith("/obra/1/uploads/a.png"))).toBe(true)
  })

  it("traduce los rechazos reales: tamaño, tipo, ruta repetida y token vencido", async () => {
    const big = await signedUrl("obra/1/uploads/grande.png")
    await expect(uploadToSignedUrl(big, new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]), "image/png")).rejects.toMatchObject({
      kind: "too_large",
    })
    const svg = await signedUrl("obra/1/uploads/svg.png")
    await expect(uploadToSignedUrl(svg, new Blob(["<svg/>"]), "image/svg+xml")).rejects.toMatchObject({ kind: "type" })
    const dup = await signedUrl("obra/1/uploads/dup.png")
    await uploadToSignedUrl(dup, new Blob([new Uint8Array(10)]), "image/png")
    await expect(uploadToSignedUrl(dup, new Blob([new Uint8Array(10)]), "image/png")).rejects.toMatchObject({ kind: "conflict" })
    const late = await signedUrl("obra/1/uploads/tarde.png")
    fake.advanceTime(7201)
    await expect(uploadToSignedUrl(late, new Blob([new Uint8Array(10)]), "image/png")).rejects.toMatchObject({ kind: "expired" })
    fake.advanceTime(-7201)
  })

  it("una falla de red (conexión cortada) llega como error de red con mensaje claro", async () => {
    const url = await signedUrl("obra/1/uploads/red.png")
    fake.setFailure({ method: "PUT", status: "network" })
    try {
      const err = await uploadToSignedUrl(url, new Blob([new Uint8Array(10)]), "image/png").catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PlanUploadError)
      expect((err as PlanUploadError).kind).toBe("network")
      expect((err as PlanUploadError).message).toBe(UPLOAD_NETWORK_ERROR)
    } finally {
      fake.setFailure(null)
    }
  })

  it("se puede cancelar", async () => {
    const url = await signedUrl("obra/1/uploads/cancelada.png")
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(uploadToSignedUrl(url, new Blob([new Uint8Array(10)]), "image/png", { signal: ctrl.signal })).rejects.toMatchObject({
      kind: "aborted",
    })
  })
})
