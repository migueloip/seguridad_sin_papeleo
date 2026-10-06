// @vitest-environment node
/**
 * Integración con Supabase Storage contra un servidor HTTP falso FIEL al
 * contrato real (tests/obra/fake-supabase-storage.ts) y Postgres real:
 *
 * - Contrato del servidor falso (rutas, auth, errores con HTTP 400 y el
 *   código semántico en el cuerpo, URL firmada de subida, Range, límites del
 *   bucket), para que los tests de la app no descansen en supuestos falsos.
 * - Subida directa de láminas grandes: ticket (createObraLayerUploadTicket) →
 *   PUT real del archivo a la URL firmada → createObraLayer con image_upload →
 *   /api/obra/layers/[id]/image redirige a una URL firmada. Rechazos: ruta de otro
 *   proyecto, "..", objeto inexistente, contenido falso (y se borra), tamaño
 *   excedido, reuso de la ruta, roles sin plans.manage, sin Supabase.
 * - Bucket privado creado una sola vez (con límites), bucket heredado público
 *   o sin límites, límite global menor que el del bucket.
 * - Ruta inline existente y fotos de hallazgos (pins.ts) contra el mismo servidor.
 *
 * SUPABASE_URL / SUPABASE_SERVICE_KEY apuntan al servidor falso ANTES de
 * importar cualquier módulo de la app.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActionResult, LayerUploadTicket, PlanLayer } from "@/lib/obra/types"
import { startFakeStorage, type FakeStorage } from "./fake-supabase-storage"
import { actAs, HAS_TEST_DB, setupObraTestDb, type TestDb } from "./helpers"

vi.mock("@/lib/auth", async () => (await import("./helpers")).authMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const SERVICE_KEY = "service-key-falsa-de-prueba"
const BUCKET = "obra-planos"
const MB = 1024 * 1024

function unwrap<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`Se esperaba ok y llegó error: ${(r as { error?: string }).error}`)
  return r.data
}

function expectError<T>(r: ActionResult<T>, pattern: RegExp) {
  expect(r.ok).toBe(false)
  expect((r as { error?: string }).error).toMatch(pattern)
}

/** PNG con cabecera IHDR real, rellenado hasta `total` bytes (el servidor solo mira la cabecera). */
function pngBytes(width: number, height: number, total = 64): Buffer {
  const b = Buffer.alloc(Math.max(total, 45))
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write("IHDR", 12, "ascii")
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  b[24] = 8
  b[25] = 2
  b.write("IEND", 37, "ascii")
  for (let i = 45; i < b.length; i += 4096) b[i] = i & 0xff
  return b
}

/** JPEG cuyo SOF queda más allá de los primeros 64 bytes (un APP1/EXIF largo antes). */
function jpegWithLongExif(width: number, height: number): Buffer {
  const exif = Buffer.alloc(4 + 3000)
  exif[0] = 0xff
  exif[1] = 0xe1
  exif.writeUInt16BE(3002, 2)
  const sof = Buffer.alloc(19)
  sof[0] = 0xff
  sof[1] = 0xc0
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 3
  return Buffer.concat([Buffer.from([0xff, 0xd8]), exif, sof, Buffer.alloc(5000), Buffer.from([0xff, 0xd9])])
}

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`

/** PUT del navegador a la URL firmada: sin Authorization, con el tipo y x-upsert: false. */
function putSigned(url: string, body: Buffer, contentType = "image/png") {
  return fetch(url, { method: "PUT", headers: { "Content-Type": contentType, "x-upsert": "false" }, body: new Uint8Array(body) })
}

const auth = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }

// ---------------------------------------------------------------------------
// El servidor falso respeta el contrato real (sin BD)
// ---------------------------------------------------------------------------

describe("servidor falso de Supabase Storage: contrato de la API real", () => {
  let fake: FakeStorage
  beforeAll(async () => {
    fake = await startFakeStorage({ serviceKey: SERVICE_KEY })
  })
  afterAll(async () => {
    await fake?.stop()
  })
  const api = (p: string) => `${fake.url}/storage/v1${p}`

  it("buckets: crear (privado, con límites), duplicado → 400 con statusCode 409, límites sobre el global → 413", async () => {
    const create = (body: unknown, headers: Record<string, string> = auth) =>
      fetch(api("/bucket"), { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const sinAuth = await create({ name: "x" }, {})
    expect(sinAuth.status).toBe(400)
    expect(await sinAuth.json()).toMatchObject({ statusCode: "403", error: "Unauthorized" })
    const ok = await create({ id: "b1", name: "b1", public: false, file_size_limit: 5 * MB, allowed_mime_types: ["image/png"] })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ name: "b1" })
    const dup = await create({ id: "b1", name: "b1" })
    expect(dup.status).toBe(400)
    expect(await dup.json()).toEqual({
      statusCode: "409",
      code: "BucketAlreadyExists",
      error: "Duplicate",
      message: "The resource already exists",
    })
    const big = await create({ id: "b2", name: "b2", file_size_limit: 60 * MB })
    expect(await big.json()).toMatchObject({ statusCode: "413", error: "Payload too large" })
    const info = await fetch(api("/bucket/b1"), { headers: auth })
    expect(await info.json()).toMatchObject({ id: "b1", public: false, file_size_limit: 5 * MB, allowed_mime_types: ["image/png"] })
    const missing = await fetch(api("/bucket/nada"), { headers: auth })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ statusCode: "404", error: "Bucket not found" })
  })

  it("URL firmada de subida: relativa a /storage/v1, PUT sin credenciales, ligada a la ruta y con vencimiento", async () => {
    const sign = await fetch(api("/object/upload/sign/b1/carpeta/a.png"), { method: "POST", headers: auth })
    expect(sign.status).toBe(200)
    const { url, token } = (await sign.json()) as { url: string; token: string }
    expect(url).toBe(`/object/upload/sign/b1/carpeta/a.png?token=${token}`)
    expect(token.split(".")).toHaveLength(3)

    const signedUrl = api(url)
    const otherPath = signedUrl.replace("/carpeta/a.png", "/carpeta/b.png")
    const wrong = await putSigned(otherPath, pngBytes(2, 2))
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toMatchObject({ statusCode: "400", code: "InvalidSignature" })

    const svg = await putSigned(signedUrl, Buffer.from("<svg/>"), "image/svg+xml")
    expect(await svg.json()).toMatchObject({ statusCode: "415", error: "invalid_mime_type" })
    const tooBig = await putSigned(signedUrl, Buffer.alloc(5 * MB + 1))
    expect(tooBig.status).toBe(400)
    expect(await tooBig.json()).toMatchObject({ statusCode: "413", error: "Payload too large" })

    const put = await putSigned(signedUrl, pngBytes(2, 2))
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({ Key: "b1/carpeta/a.png" })
    // El token no se "gasta", pero sin upsert la ruta ya existe: Duplicate.
    const again = await putSigned(signedUrl, pngBytes(2, 2))
    expect(await again.json()).toMatchObject({ statusCode: "409", error: "Duplicate" })
    // Firmar una ruta que ya existe (sin x-upsert) también es Duplicate.
    const resign = await fetch(api("/object/upload/sign/b1/carpeta/a.png"), { method: "POST", headers: auth })
    expect(await resign.json()).toMatchObject({ statusCode: "409", error: "Duplicate" })

    const sign2 = (await (await fetch(api("/object/upload/sign/b1/carpeta/c.png"), { method: "POST", headers: auth })).json()) as {
      url: string
    }
    fake.advanceTime(7201)
    const expired = await putSigned(api(sign2.url), pngBytes(2, 2))
    expect(await expired.json()).toMatchObject({ statusCode: "400", code: "InvalidJWT", message: '"exp" claim timestamp check failed' })
    const noAuthSign = await fetch(api("/object/upload/sign/b1/carpeta/d.png"), { method: "POST" })
    expect(await noAuthSign.json()).toMatchObject({ statusCode: "403" })
  })

  it("lectura autenticada: HEAD, Range 206/416, objeto inexistente → 400 con statusCode 404, bucket privado sin auth", async () => {
    const path = "/object/authenticated/b1/carpeta/a.png"
    const head = await fetch(api(path), { method: "HEAD", headers: auth })
    expect(head.status).toBe(200)
    expect(head.headers.get("content-length")).toBe("64")
    expect(head.headers.get("content-type")).toBe("image/png")
    expect(head.headers.get("accept-ranges")).toBe("bytes")
    const part = await fetch(api(path), { headers: { ...auth, Range: "bytes=0-7" } })
    expect(part.status).toBe(206)
    expect(part.headers.get("content-range")).toBe("bytes 0-7/64")
    expect(Buffer.from(await part.arrayBuffer())).toEqual(pngBytes(2, 2).subarray(0, 8))
    const past = await fetch(api(path), { headers: { ...auth, Range: "bytes=100-200" } })
    expect(past.status).toBe(416)
    const missingHead = await fetch(api("/object/authenticated/b1/carpeta/zz.png"), { method: "HEAD", headers: auth })
    expect(missingHead.status).toBe(400)
    const missing = await fetch(api("/object/authenticated/b1/carpeta/zz.png"), { headers: auth })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ statusCode: "404", code: "NoSuchKey", error: "not_found", message: "Object not found" })
    const noAuth = await fetch(api(path))
    expect(noAuth.status).toBe(400)
    const anon = await fetch(api("/object/b1/carpeta/a.png"))
    expect(await anon.json()).toMatchObject({ statusCode: "404", error: "Bucket not found" })
    const pub = await fetch(api("/object/public/b1/carpeta/a.png"))
    expect(await pub.json()).toMatchObject({ statusCode: "404", error: "Bucket not found" })
    const info = await fetch(api("/object/info/authenticated/b1/carpeta/a.png"), { headers: auth })
    expect(await info.json()).toMatchObject({ name: "carpeta/a.png", bucket_id: "b1", size: 64, content_type: "image/png" })
  })

  it("CORS como el gateway y fallas inyectadas", async () => {
    const pre = await fetch(api("/object/upload/sign/b1/x.png?token=t"), {
      method: "OPTIONS",
      headers: { Origin: "https://app.ejemplo.cl", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,x-upsert" },
    })
    expect(pre.status).toBe(200)
    expect(pre.headers.get("access-control-allow-origin")).toBe("*")
    expect(pre.headers.get("access-control-allow-headers")).toBe("content-type,x-upsert")
    fake.setFailure({ method: "GET", path: "/bucket/", status: 503, times: 1 })
    expect((await fetch(api("/bucket/b1"), { headers: auth })).status).toBe(503)
    expect((await fetch(api("/bucket/b1"), { headers: auth })).status).toBe(200)
    fake.setFailure({ path: /\/bucket\/b1$/, status: "network" })
    await expect(fetch(api("/bucket/b1"), { headers: auth })).rejects.toThrow()
    fake.setFailure(null)
  })
})

// ---------------------------------------------------------------------------
// App + BD real + servidor falso
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_TEST_DB)("subida directa de láminas y fotos contra Supabase Storage (servidor falso + BD real)", () => {
  let db: TestDb
  let fake: FakeStorage
  let layer: PlanLayer
  let ticket: LayerUploadTicket
  const big = pngBytes(6000, 4000, 8 * MB)

  async function imageRoute(id: number) {
    const { GET } = await import("@/app/api/obra/layers/[id]/image/route")
    return GET(new Request(`http://localhost/api/obra/layers/${id}/image`), { params: Promise.resolve({ id: String(id) }) })
  }

  async function newTicket(mime = "image/png", size = big.length, projectId = db.projectId) {
    const { createObraLayerUploadTicket } = await import("@/app/actions/obra/layers")
    return createObraLayerUploadTicket(projectId, { mime, size_bytes: size })
  }

  async function layerFromUpload(path: string, name = "Lámina subida", projectId = db.projectId) {
    const { createObraLayer } = await import("@/app/actions/obra/layers")
    return createObraLayer(projectId, { name, discipline: "arquitectura", level: 2, image_upload: { path, width_px: 100, height_px: 50 } })
  }

  const useFake = (f: FakeStorage) => {
    process.env.SUPABASE_URL = f.url
    process.env.SUPABASE_SERVICE_KEY = SERVICE_KEY
  }

  beforeAll(async () => {
    fake = await startFakeStorage({ serviceKey: SERVICE_KEY })
    useFake(fake)
    db = await setupObraTestDb("storage_int_test")
  })
  afterAll(async () => {
    await db?.close()
    await fake?.stop()
  })
  afterEach(() => {
    fake.setFailure(null)
    useFake(fake)
    vi.restoreAllMocks()
  })

  it("los límites del cliente y del servidor coinciden", async () => {
    const client = await import("@/lib/obra/client-files")
    const server = await import("@/lib/obra/server/storage")
    expect(client.PLAN_UPLOAD_MAX_BYTES).toBe(server.PLAN_UPLOAD_MAX_BYTES)
    expect(client.PLAN_UPLOAD_MAX_BYTES).toBe(25 * MB)
    expect(client.PLAN_IMAGE_MAX_BYTES).toBe(server.PLAN_INLINE_DATA_URL_MAX_CHARS)
    expect(client.PLAN_INLINE_FILE_MAX_BYTES).toBe(server.PLAN_INLINE_MAX_BYTES)
  })

  it("ticket → PUT real a la URL firmada → createObraLayer(image_upload) → la ruta de imagen redirige a la URL firmada", async () => {
    actAs(db.users.prevencionista)
    ticket = unwrap(await newTicket())
    expect(ticket.path).toMatch(new RegExp(`^obra/${db.projectId}/uploads/[0-9a-f-]{36}\\.png$`))
    expect(ticket.upload_url).toBe(`${fake.url}/storage/v1/object/upload/sign/${BUCKET}/${ticket.path}?token=${ticket.token}`)
    expect(ticket).toMatchObject({ expires_in: 7200, max_bytes: 25 * MB, mime: "image/png" })

    const put = await putSigned(ticket.upload_url, big)
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({ Key: `${BUCKET}/${ticket.path}` })
    const putLog = fake.requests.filter((r) => r.method === "PUT" && r.path.includes("/upload/sign/"))
    expect(putLog.at(-1)).toMatchObject({ authorized: false, status: 200 })

    layer = unwrap(await layerFromUpload(ticket.path, "Arquitectura N2 (grande)"))
    // Las dimensiones reales (cabecera del archivo) mandan sobre las declaradas (100 × 50).
    expect(layer).toMatchObject({ has_image: true, mime_type: "image/png", width_px: 6000, height_px: 4000, level: 2 })
    expect(layer.frame.aspect).toBeCloseTo(4000 / 6000, 6)
    const row = await db.sql<{ image_path: string | null; image_data: string | null }[]>`
      SELECT image_path, image_data FROM obra_plan_layers WHERE id = ${layer.id}`
    expect(row[0]).toEqual({ image_path: ticket.path, image_data: null })
    const audit = await db.sql<{ details: Record<string, unknown> }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'layer.created' AND entity_id = ${layer.id}`
    expect(audit[0].details).toMatchObject({ has_image: true, mime_type: "image/png", bytes: big.length, direct_upload: true })

    // Verificación del objeto: HEAD (existencia y tamaño) y solo los primeros 64 bytes (Range).
    expect(fake.requests.some((r) => r.method === "HEAD" && r.path === `/object/authenticated/${BUCKET}/${ticket.path}`)).toBe(true)
    expect(fake.requests.some((r) => r.method === "GET" && r.headers.range === "bytes=0-63" && r.path.endsWith(ticket.path))).toBe(true)

    // La ruta de la imagen redirige a una URL firmada: los 8 MB no pasan por la función.
    actAs(db.users.visita)
    const res = await imageRoute(layer.id)
    expect(res.status).toBe(302)
    const location = res.headers.get("location")!
    expect(location).toMatch(new RegExp(`^${fake.url}/storage/v1/object/sign/${BUCKET}/${ticket.path}\\?token=`))
    const followed = await fetch(location)
    expect(followed.status).toBe(200)
    expect(followed.headers.get("content-type")).toBe("image/png")
    expect(Buffer.from(await followed.arrayBuffer()).equals(big)).toBe(true)
    actAs(db.users.extrano)
    expect((await imageRoute(layer.id)).status).toBe(404)

    // URL firmada de descarga (para redirigir láminas grandes): funciona sin credenciales.
    const { getLayerImageSignedUrl } = await import("@/lib/obra/server/layers")
    const signed = await getLayerImageSignedUrl(db.users.visita, layer.id, 60)
    expect(signed).toMatch(new RegExp(`^${fake.url}/storage/v1/object/sign/${BUCKET}/${ticket.path}\\?token=`))
    const dl = await fetch(signed!)
    expect(dl.status).toBe(200)
    expect(Buffer.from(await dl.arrayBuffer()).equals(big)).toBe(true)
    await expect(getLayerImageSignedUrl(db.users.extrano, layer.id)).rejects.toMatchObject({ status: 404 })
  })

  it("el bucket privado se creó una sola vez, con límite de tamaño y tipos permitidos", async () => {
    actAs(db.users.gerente)
    unwrap(await newTicket("image/jpeg", 5 * MB))
    unwrap(await newTicket("image/webp", 5 * MB))
    expect(fake.requests.filter((r) => r.method === "POST" && r.path === "/bucket")).toHaveLength(1)
    expect(fake.buckets.get(BUCKET)).toMatchObject({
      public: false,
      file_size_limit: 25 * MB,
      allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
    })
    expect(fake.requests.filter((r) => r.path.startsWith("/bucket")).every((r) => r.authorized)).toBe(true)
    // Privado de verdad: sin credenciales no se lee nada.
    const pub = await fetch(`${fake.url}/storage/v1/object/public/${BUCKET}/${ticket.path}`)
    expect(await pub.json()).toMatchObject({ statusCode: "404", error: "Bucket not found" })
  })

  it("una misma ruta no se usa dos veces (ni en paralelo) y el objeto no se borra", async () => {
    actAs(db.users.jefe_obra)
    expectError(await layerFromUpload(ticket.path, "Reuso"), /ya se usó en otra capa/)
    expect(fake.objects.has(`${BUCKET}/${ticket.path}`)).toBe(true)

    const t = unwrap(await newTicket("image/png", 1000))
    expect((await putSigned(t.upload_url, pngBytes(800, 600, 1000))).status).toBe(200)
    // Latencia en la lectura del Range: ambas pasan la verificación previa antes de que una inserte.
    fake.setFailure({ method: "GET", path: t.path, delayMs: 300 })
    const [a, b] = await Promise.all([layerFromUpload(t.path, "Paralela A"), layerFromUpload(t.path, "Paralela B")])
    fake.setFailure(null)
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expectError(a.ok ? b : a, /ya se usó en otra capa/)
    const rows = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_plan_layers WHERE image_path = ${t.path}`
    expect(rows[0].n).toBe(1)
    expect(fake.objects.has(`${BUCKET}/${t.path}`)).toBe(true)

    // Una capa borrada sigue "usando" su ruta.
    const { deleteObraLayer } = await import("@/app/actions/obra/layers")
    const created = (a.ok ? a : b) as { ok: true; data: PlanLayer }
    unwrap(await deleteObraLayer(created.data.id))
    expectError(await layerFromUpload(t.path, "Tras borrar"), /ya se usó en otra capa/)
  })

  it("rechaza rutas de otro proyecto, con '..', inexistentes o con formato distinto, sin tocar el objeto", async () => {
    // El dueño de la obra ajena sube una lámina a SU proyecto.
    actAs(db.users.extrano)
    const foreign = unwrap(await newTicket("image/png", 1000, db.otherProjectId))
    expect(foreign.path.startsWith(`obra/${db.otherProjectId}/uploads/`)).toBe(true)
    expect((await putSigned(foreign.upload_url, pngBytes(10, 10, 1000))).status).toBe(200)

    actAs(db.users.gerente)
    const NOT_OURS = /no corresponde a esta obra/
    expectError(await layerFromUpload(foreign.path), NOT_OURS)
    expect(fake.objects.has(`${BUCKET}/${foreign.path}`)).toBe(true)
    // Tampoco puede pedir tickets ni crear capas en la obra ajena.
    expectError(await newTicket("image/png", 1000, db.otherProjectId), /no encontrado/)
    expectError(await layerFromUpload(foreign.path, "x", db.otherProjectId), /no encontrado/)

    const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e"
    for (const path of [
      `obra/${db.projectId}/uploads/../../${db.otherProjectId}/uploads/${foreign.path.split("/").pop()}`,
      `obra/${db.projectId}/uploads/..%2F${uuid}.png`,
      `obra/${db.projectId}/uploads/${uuid}.svg`,
      `obra/${db.projectId}/hallazgos/${uuid}.png`,
      `obra/${db.projectId}/uploads/sub/${uuid}.png`,
      `/obra/${db.projectId}/uploads/${uuid}.png`,
      `obra/${db.projectId}0/uploads/${uuid}.png`,
    ]) {
      expectError(await layerFromUpload(path), NOT_OURS)
    }
    expectError(await layerFromUpload(`obra/${db.projectId}/uploads/${uuid}.png`), /No se encontró la imagen subida/)

    const { createObraLayer } = await import("@/app/actions/obra/layers")
    expectError(
      await createObraLayer(db.projectId, {
        name: "Doble",
        discipline: "otro",
        level: 0,
        image: { data_url: dataUrl("image/png", pngBytes(2, 2)), width_px: 2, height_px: 2 },
        image_upload: { path: `obra/${db.projectId}/uploads/${uuid}.png`, width_px: 2, height_px: 2 },
      }),
      /de una sola forma/,
    )
    expectError(
      await createObraLayer(db.projectId, {
        name: "Sin dimensiones",
        discipline: "otro",
        level: 0,
        image_upload: { path: ticket.path, width_px: 0, height_px: 2 },
      }),
      /dimensiones/,
    )
  })

  it("contenido que no es PNG/JPEG/WebP (aunque declare image/png) se rechaza y se BORRA del bucket", async () => {
    actAs(db.users.gerente)
    const t = unwrap(await newTicket("image/png", 200))
    const html = Buffer.from(`<html><script>alert(document.cookie)</script>${"x".repeat(150)}</html>`)
    expect((await putSigned(t.upload_url, html, "image/png")).status).toBe(200)
    expect(fake.objects.has(`${BUCKET}/${t.path}`)).toBe(true)
    expectError(await layerFromUpload(t.path), /no es un PNG, JPG o WebP válido/)
    expect(fake.objects.has(`${BUCKET}/${t.path}`)).toBe(false)
    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_plan_layers WHERE image_path = ${t.path}`
    expect(n[0].n).toBe(0)

    // Bucket heredado sin tipos permitidos: bytes de PNG pero declarado text/html → se rechaza y se borra.
    const bucket = fake.buckets.get(BUCKET)!
    bucket.allowed_mime_types = null
    try {
      const t3 = unwrap(await newTicket("image/png", 200))
      expect((await putSigned(t3.upload_url, pngBytes(20, 20, 200), "text/html")).status).toBe(200)
      expectError(await layerFromUpload(t3.path), /no es un PNG, JPG o WebP válido/)
      expect(fake.objects.has(`${BUCKET}/${t3.path}`)).toBe(false)
    } finally {
      bucket.allowed_mime_types = ["image/png", "image/jpeg", "image/webp"]
    }

    // El bucket ni siquiera acepta un SVG declarado como tal.
    const t2 = unwrap(await newTicket("image/png", 200))
    const svg = await putSigned(t2.upload_url, Buffer.from("<svg onload='alert(1)'/>"), "image/svg+xml")
    expect(await svg.json()).toMatchObject({ statusCode: "415" })
    expect(fake.objects.has(`${BUCKET}/${t2.path}`)).toBe(false)
  })

  it("JPEG con EXIF largo: lee más cabecera para obtener las dimensiones reales", async () => {
    actAs(db.users.gerente)
    const jpg = jpegWithLongExif(4500, 3000)
    const t = unwrap(await newTicket("image/jpeg", jpg.length))
    expect(t.path.endsWith(".jpg")).toBe(true)
    expect((await putSigned(t.upload_url, jpg, "image/jpeg")).status).toBe(200)
    const l = unwrap(await layerFromUpload(t.path, "Foto aérea"))
    expect(l).toMatchObject({ mime_type: "image/jpeg", width_px: 4500, height_px: 3000 })
  })

  it("tamaño: el ticket exige ≤ 25 MB, el bucket corta lo que pasa del límite y el servidor re-verifica (y borra)", async () => {
    actAs(db.users.gerente)
    expectError(await newTicket("image/png", 25 * MB + 1), /supera el máximo de 25 MB/)
    expectError(await newTicket("image/png", 0), /tamaño del archivo no es válido/)
    expectError(await newTicket("image/svg+xml", 1000), /PNG, JPG o WebP/)
    expectError(await newTicket("text/html", 1000), /PNG, JPG o WebP/)

    const huge = pngBytes(2000, 2000, 25 * MB + 10)
    const t = unwrap(await newTicket("image/png", 1000))
    const put = await putSigned(t.upload_url, huge)
    expect(put.status).toBe(400)
    expect(await put.json()).toMatchObject({ statusCode: "413" })
    expect(fake.objects.has(`${BUCKET}/${t.path}`)).toBe(false)

    // Bucket heredado sin límite propio (límite global de 50 MB): el servidor rechaza y borra.
    fake.buckets.get(BUCKET)!.file_size_limit = null
    try {
      const t2 = unwrap(await newTicket("image/png", 1000))
      expect((await putSigned(t2.upload_url, huge)).status).toBe(200)
      expectError(await layerFromUpload(t2.path), /supera el máximo de 25 MB/)
      expect(fake.objects.has(`${BUCKET}/${t2.path}`)).toBe(false)
    } finally {
      fake.buckets.get(BUCKET)!.file_size_limit = 25 * MB
    }
  })

  it("roles sin plans.manage no obtienen ticket ni crean capas con image_upload; sin sesión tampoco", async () => {
    for (const role of ["supervisor", "trabajador", "visita"] as const) {
      actAs(db.users[role])
      expectError(await newTicket(), /no permite/)
      expectError(await layerFromUpload(ticket.path), /no permite/)
    }
    actAs(db.users.extrano)
    expectError(await newTicket(), /no encontrado/)
    actAs(null)
    expectError(await newTicket(), /Sesión no válida/)
    expect(fake.objects.has(`${BUCKET}/${ticket.path}`)).toBe(true)
  })

  it("el token firmado vence y está ligado a su ruta", async () => {
    actAs(db.users.gerente)
    const a = unwrap(await newTicket("image/png", 100))
    const b = unwrap(await newTicket("image/png", 100))
    const crossed = a.upload_url.replace(a.path, b.path)
    expect(await (await putSigned(crossed, pngBytes(5, 5, 100))).json()).toMatchObject({ code: "InvalidSignature" })
    fake.advanceTime(2 * 3600 + 5)
    try {
      expect(await (await putSigned(a.upload_url, pngBytes(5, 5, 100))).json()).toMatchObject({ code: "InvalidJWT" })
    } finally {
      fake.advanceTime(-(2 * 3600 + 5))
    }
  })

  it("fallas de Storage: error genérico sin filtrar detalles y sin capa a medias ni objeto borrado", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    actAs(db.users.gerente)
    fake.setFailure({ method: "POST", path: "/object/upload/sign/", status: 500 })
    expectError(await newTicket("image/png", 100), /error inesperado/)
    fake.setFailure(null)

    const t = unwrap(await newTicket("image/png", 1000))
    expect((await putSigned(t.upload_url, pngBytes(30, 20, 1000))).status).toBe(200)
    fake.setFailure({ method: "HEAD", status: 503 })
    expectError(await layerFromUpload(t.path, "Falla HEAD"), /error inesperado/)
    fake.setFailure({ method: "GET", path: "/object/authenticated/", status: "network" })
    expectError(await layerFromUpload(t.path, "Falla red"), /error inesperado/)
    fake.setFailure(null)
    expect(fake.objects.has(`${BUCKET}/${t.path}`)).toBe(true)
    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_plan_layers WHERE name LIKE 'Falla %'`
    expect(n[0].n).toBe(0)
    // Se reintenta con la misma ruta y funciona.
    expect(unwrap(await layerFromUpload(t.path, "Reintento"))).toMatchObject({ width_px: 30, height_px: 20 })
    expect(spy).toHaveBeenCalled()
  })

  it("sin Supabase configurado: mensaje claro con el límite inline real y la ruta inline sigue funcionando", async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_KEY
    actAs(db.users.gerente)
    const r = await newTicket()
    expectError(r, /requiere Supabase Storage/)
    expect((r as { error: string }).error).toBe(
      "La subida de planos grandes requiere Supabase Storage; reduce el archivo a menos de 3,2 MB.",
    )
    expectError(await layerFromUpload(ticket.path), /requiere Supabase Storage/)

    const { createObraLayer } = await import("@/app/actions/obra/layers")
    const png = pngBytes(300, 200)
    const inline = unwrap(
      await createObraLayer(db.projectId, {
        name: "Inline sin Supabase",
        discipline: "otro",
        level: 0,
        image: { data_url: dataUrl("image/png", png), width_px: 300, height_px: 200 },
      }),
    )
    const row = await db.sql<{ image_path: string | null; image_data: string | null }[]>`
      SELECT image_path, image_data FROM obra_plan_layers WHERE id = ${inline.id}`
    expect(row[0]).toEqual({ image_path: null, image_data: dataUrl("image/png", png) })
    const res = await imageRoute(inline.id)
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true)
  })

  it("con Supabase, la ruta inline (data URL) sube por la API autenticada y se lee igual", async () => {
    actAs(db.users.gerente)
    const { createObraLayer } = await import("@/app/actions/obra/layers")
    const png = pngBytes(640, 480, 2000)
    const l = unwrap(
      await createObraLayer(db.projectId, {
        name: "Inline con Supabase",
        discipline: "electrico",
        level: 1,
        image: { data_url: dataUrl("image/png", png), width_px: 1, height_px: 1 },
      }),
    )
    const row = await db.sql<{ image_path: string | null; image_data: string | null }[]>`
      SELECT image_path, image_data FROM obra_plan_layers WHERE id = ${l.id}`
    expect(row[0].image_data).toBeNull()
    expect(row[0].image_path).toMatch(new RegExp(`^obra/${db.projectId}/${l.id}-[0-9a-f]{24}\\.png$`))
    const post = fake.requests.find((r) => r.method === "POST" && r.path === `/object/${BUCKET}/${row[0].image_path}`)
    expect(post).toMatchObject({ authorized: true, status: 200, headers: { "content-type": "image/png", "x-upsert": "false" } })
    expect(fake.objects.get(`${BUCKET}/${row[0].image_path}`)?.bytes.equals(png)).toBe(true)
    actAs(db.users.trabajador)
    const res = await imageRoute(l.id)
    expect(res.status).toBe(302)
    const followed = await fetch(res.headers.get("location")!)
    expect(Buffer.from(await followed.arrayBuffer()).equals(png)).toBe(true)
    // Si Storage no firma, la ruta sirve los bytes ella misma.
    fake.setFailure({ method: "POST", path: `/object/sign/${BUCKET}/${row[0].image_path}`, status: 500, times: 1 })
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const direct = await imageRoute(l.id)
    spy.mockRestore()
    expect(direct.status).toBe(200)
    expect(direct.headers.get("content-type")).toBe("image/png")
    expect(Buffer.from(await direct.arrayBuffer()).equals(png)).toBe(true)
  })

  it("fotos de hallazgos (pins.ts) se guardan en el bucket privado y se sirven con control de acceso", async () => {
    const { reportObraFinding } = await import("@/app/actions/obra/pins")
    const { GET } = await import("@/app/api/obra/findings/[id]/photo/route")
    const photoRoute = (id: number) =>
      GET(new Request(`http://localhost/api/obra/findings/${id}/photo?index=0`), { params: Promise.resolve({ id: String(id) }) })
    const photo = pngBytes(40, 30, 500)
    actAs(db.users.trabajador)
    const r = unwrap(
      await reportObraFinding(db.projectId, {
        layer_id: layer.id,
        x: 0.5,
        y: 0.5,
        title: "Baranda suelta en losa",
        severity: "high",
        photo_data_url: dataUrl("image/png", photo),
      }),
    )
    const rows = await db.sql<{ photos: unknown }[]>`SELECT photos FROM findings WHERE id = ${r.finding_id}`
    const photos = (typeof rows[0].photos === "string" ? JSON.parse(rows[0].photos) : rows[0].photos) as string[]
    expect(photos[0]).toMatch(new RegExp(`^obra-storage:obra/${db.projectId}/hallazgos/[0-9a-f]{24}\\.png$`))
    const key = `${BUCKET}/${photos[0].slice("obra-storage:".length)}`
    expect(fake.objects.get(key)?.bytes.equals(photo)).toBe(true)

    actAs(db.users.visita)
    const res = await photoRoute(r.finding_id)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(Buffer.from(await res.arrayBuffer()).equals(photo)).toBe(true)
    actAs(db.users.extrano)
    expect((await photoRoute(r.finding_id)).status).toBe(404)

    // Si el objeto desaparece del bucket, la ruta no revienta con detalles internos.
    fake.objects.delete(key)
    actAs(db.users.visita)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const gone = await photoRoute(r.finding_id)
    expect(gone.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(await gone.json())).not.toMatch(/HTTP|NoSuchKey|storage/i)
    spy.mockRestore()
  })

  it("bucket heredado público o sin límites: se hace privado y se le ponen límites; si no se puede, no se usa", async () => {
    const { resetStorageStateForTests } = await import("@/lib/obra/server/storage")
    const b = fake.buckets.get(BUCKET)!
    b.public = true
    b.file_size_limit = null
    b.allowed_mime_types = null
    resetStorageStateForTests()
    actAs(db.users.gerente)
    unwrap(await newTicket("image/png", 100))
    expect(fake.buckets.get(BUCKET)).toMatchObject({
      public: false,
      file_size_limit: 25 * MB,
      allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
    })

    // Público y el PUT de configuración falla: no se firman subidas a un bucket público.
    b.public = true
    resetStorageStateForTests()
    fake.setFailure({ method: "PUT", path: /^\/bucket\//, status: 500 })
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expectError(await newTicket("image/png", 100), /error inesperado/)
    expect(String(spy.mock.calls.flat().join(" "))).toMatch(/es público/)
    fake.setFailure(null)
    b.public = false
    resetStorageStateForTests()
    unwrap(await newTicket("image/png", 100))
  })

  it("límite global del proyecto menor que 25 MB: el bucket se crea sin límite propio y con tipos permitidos", async () => {
    const small = await startFakeStorage({ serviceKey: SERVICE_KEY, globalFileSizeLimit: 10 * MB })
    const { resetStorageStateForTests } = await import("@/lib/obra/server/storage")
    try {
      useFake(small)
      resetStorageStateForTests()
      actAs(db.users.gerente)
      const t = unwrap(await newTicket("image/png", 5 * MB))
      expect(small.buckets.get(BUCKET)).toMatchObject({ public: false, file_size_limit: null })
      expect(small.buckets.get(BUCKET)?.allowed_mime_types).toEqual(["image/png", "image/jpeg", "image/webp"])
      expect(small.requests.filter((r) => r.method === "POST" && r.path === "/bucket").map((r) => r.status)).toEqual([400, 200])
      // El límite global sigue mandando en la subida.
      const put = await putSigned(t.upload_url, pngBytes(10, 10, 10 * MB + 1))
      expect(await put.json()).toMatchObject({ statusCode: "413" })
    } finally {
      useFake(fake)
      resetStorageStateForTests()
      await small.stop()
    }
  })
})
