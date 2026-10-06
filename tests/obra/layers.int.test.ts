// @vitest-environment node
/**
 * Capas de plano, su imagen (inline o en el bucket privado de Supabase), la
 * ruta protegida /api/obra/layers/[id]/image y los elementos manuales/DXF,
 * contra Postgres real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActionResult, PlanElementDraft, PlanLayer } from "@/lib/obra/types"
import { actAs, HAS_TEST_DB, setupObraTestDb, type TestDb } from "./helpers"

vi.mock("@/lib/auth", async () => (await import("./helpers")).authMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

function unwrap<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`Se esperaba ok y llegó error: ${(r as { error?: string }).error}`)
  return r.data
}

function expectError<T>(r: ActionResult<T>, pattern: RegExp) {
  expect(r.ok).toBe(false)
  expect((r as { error?: string }).error).toMatch(pattern)
}

/** Bytes de un PNG mínimo con cabecera IHDR real. */
function pngBytes(width: number, height: number, extra = 0): Buffer {
  const b = Buffer.alloc(8 + 25 + 12 + extra)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write("IHDR", 12, "ascii")
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  b[24] = 8
  b[25] = 2
  b.writeUInt32BE(0, 33)
  b.write("IEND", 37, "ascii")
  return b
}

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`

/** JPEG mínimo: SOI + APP0 + SOF0 con alto y ancho. */
function jpegBytes(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  const sof = Buffer.alloc(19)
  sof[0] = 0xff
  sof[1] = 0xc0
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 3
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])])
}

/** WebP mínimo (VP8X) con ancho y alto. */
function webpBytes(width: number, height: number): Buffer {
  const b = Buffer.alloc(30)
  b.write("RIFF", 0, "ascii")
  b.writeUInt32LE(22, 4)
  b.write("WEBP", 8, "ascii")
  b.write("VP8X", 12, "ascii")
  b.writeUInt32LE(10, 16)
  b.writeUIntLE(width - 1, 24, 3)
  b.writeUIntLE(height - 1, 27, 3)
  return b
}

const DENIED = /no permite/
const NOT_FOUND = /no encontrad/

describe.skipIf(!HAS_TEST_DB)("capas de plano, imágenes y elementos (BD real)", () => {
  let db: TestDb
  let layer: PlanLayer
  const png = pngBytes(1200, 840)

  async function imageRoute(id: string | number) {
    const { GET } = await import("@/app/api/obra/layers/[id]/image/route")
    return GET(new Request(`http://localhost/api/obra/layers/${id}/image`), { params: Promise.resolve({ id: String(id) }) })
  }

  beforeAll(async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_KEY
    db = await setupObraTestDb("layers_int_test")
  })
  afterAll(async () => {
    await db?.close()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_KEY
  })

  it("crea una capa con imagen PNG: la proporción sale de la imagen real y el DTO no trae image_data", async () => {
    const { createObraLayer } = await import("@/app/actions/obra/layers")
    actAs(db.users.prevencionista)
    layer = unwrap(
      await createObraLayer(db.projectId, {
        name: "  Arquitectura   Nivel 1 ",
        discipline: "arquitectura",
        level: 0,
        level_label: "Primer piso",
        width_m: 40,
        // Dimensiones declaradas falsas: mandan las del archivo.
        image: { data_url: dataUrl("image/png", png), width_px: 10, height_px: 10 },
        aspect: 3,
      }),
    )
    expect(layer).toMatchObject({
      project_id: db.projectId,
      name: "Arquitectura Nivel 1",
      discipline: "arquitectura",
      level: 0,
      level_label: "Primer piso",
      has_image: true,
      mime_type: "image/png",
      width_px: 1200,
      height_px: 840,
      element_count: 0,
      uploaded_by: db.users.prevencionista,
      opacity: 0.85,
    })
    expect(layer.frame).toEqual({ width_m: 40, aspect: 0.7, offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 })
    expect(Object.keys(layer)).not.toContain("image_data")
    expect(Object.keys(layer)).not.toContain("image_path")
    const row = await db.sql<{ image_data: string | null; image_path: string | null }[]>`
      SELECT image_data, image_path FROM obra_plan_layers WHERE id = ${layer.id}`
    expect(row[0].image_path).toBeNull()
    expect(row[0].image_data).toBe(dataUrl("image/png", png))
    const audit = await db.sql<{ actor_user_id: number; details: Record<string, unknown> }[]>`
      SELECT actor_user_id, details FROM obra_audit_log WHERE action = 'layer.created' AND entity_id = ${layer.id}`
    expect(audit[0]).toMatchObject({ actor_user_id: db.users.prevencionista, details: { has_image: true, mime_type: "image/png" } })
  })

  it("acepta JPEG y WebP (dimensiones leídas del archivo) y capas sin imagen con valores por defecto", async () => {
    const { createObraLayer } = await import("@/app/actions/obra/layers")
    actAs(db.users.jefe_obra)
    const jpg = unwrap(
      await createObraLayer(db.projectId, {
        name: "Eléctrico N1",
        discipline: "electrico",
        level: 0,
        image: { data_url: dataUrl("image/jpeg", jpegBytes(800, 600)), width_px: 800, height_px: 600 },
      }),
    )
    expect(jpg).toMatchObject({ mime_type: "image/jpeg", width_px: 800, height_px: 600 })
    expect(jpg.frame).toMatchObject({ width_m: 50, aspect: 0.75 })
    const webp = unwrap(
      await createObraLayer(db.projectId, {
        name: "Gas N1",
        discipline: "gas",
        level: 0,
        image: { data_url: dataUrl("image/webp", webpBytes(500, 1000)), width_px: 500, height_px: 1000 },
      }),
    )
    expect(webp).toMatchObject({ mime_type: "image/webp", width_px: 500, height_px: 1000 })
    expect(webp.frame.aspect).toBe(2)
    const plain = unwrap(await createObraLayer(db.projectId, { name: "Estructura -1", discipline: "estructura", level: -1 }))
    expect(plain).toMatchObject({ has_image: false, mime_type: null, width_px: null })
    expect(plain.frame).toEqual({ width_m: 50, aspect: 0.7, offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 })
  })

  it("rechaza imágenes peligrosas o inválidas: SVG, firma falsa, base64 corrupto y más de 7 MB", async () => {
    const { createObraLayer } = await import("@/app/actions/obra/layers")
    const base = { name: "Capa", discipline: "otro" as const, level: 0 }
    actAs(db.users.gerente)
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>')
    expectError(
      await createObraLayer(db.projectId, { ...base, image: { data_url: dataUrl("image/svg+xml", svg), width_px: 10, height_px: 10 } }),
      /PNG, JPG o WebP/,
    )
    // SVG disfrazado de PNG: los magic bytes no coinciden.
    expectError(
      await createObraLayer(db.projectId, { ...base, image: { data_url: dataUrl("image/png", svg), width_px: 10, height_px: 10 } }),
      /no coincide/,
    )
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)])
    expectError(
      await createObraLayer(db.projectId, { ...base, image: { data_url: dataUrl("image/jpeg", gif), width_px: 10, height_px: 10 } }),
      /no coincide/,
    )
    expectError(
      await createObraLayer(db.projectId, { ...base, image: { data_url: "data:image/png;base64,@@@@", width_px: 10, height_px: 10 } }),
      /base64/,
    )
    expectError(
      await createObraLayer(db.projectId, { ...base, image: { data_url: "https://evil.example/x.png", width_px: 10, height_px: 10 } }),
      /PNG, JPG o WebP/,
    )
    const big = pngBytes(100, 100, 7 * 1024 * 1024 + 10)
    expectError(
      await createObraLayer(db.projectId, { ...base, image: { data_url: dataUrl("image/png", big), width_px: 100, height_px: 100 } }),
      /7 MB/,
    )
    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_plan_layers WHERE name = 'Capa'`
    expect(n[0].n).toBe(0)
  })

  it("valida nombre, especialidad, nivel y ancho", async () => {
    const { createObraLayer } = await import("@/app/actions/obra/layers")
    actAs(db.users.gerente)
    expectError(await createObraLayer(db.projectId, { name: "   ", discipline: "otro", level: 0 }), /nombre de la capa/)
    expectError(await createObraLayer(db.projectId, { name: "x".repeat(121), discipline: "otro", level: 0 }), /nombre de la capa/)
    expectError(await createObraLayer(db.projectId, { name: "Capa", discipline: "sanitario" as never, level: 0 }), /Especialidad/)
    expectError(await createObraLayer(db.projectId, { name: "Capa", discipline: "otro", level: 201 }), /nivel/)
    expectError(await createObraLayer(db.projectId, { name: "Capa", discipline: "otro", level: -11 }), /nivel/)
    expectError(await createObraLayer(db.projectId, { name: "Capa", discipline: "otro", level: 0.5 }), /nivel/)
    expectError(await createObraLayer(db.projectId, { name: "Capa", discipline: "otro", level: 0, width_m: 0.5 }), /ancho real/)
    expectError(await createObraLayer(db.projectId, { name: "Capa", discipline: "otro", level: 0, width_m: 5001 }), /ancho real/)
    expectError(await createObraLayer(db.projectId, { name: "Capa", discipline: "otro", level: 0, aspect: -1 }), /proporción/)
    expectError(await createObraLayer(db.projectId, null as never), /no válidos/)
  })

  it("permisos: solo plans.manage crea; todos los roles listan; un extraño recibe 404", async () => {
    const { createObraLayer, listObraLayers } = await import("@/app/actions/obra/layers")
    for (const role of ["supervisor", "trabajador", "visita"] as const) {
      actAs(db.users[role])
      expectError(await createObraLayer(db.projectId, { name: "No", discipline: "otro", level: 0 }), DENIED)
      const list = unwrap(await listObraLayers(db.projectId))
      expect(list.map((l) => l.id)).toContain(layer.id)
    }
    actAs(db.users.extrano)
    expectError(await createObraLayer(db.projectId, { name: "No", discipline: "otro", level: 0 }), NOT_FOUND)
    expectError(await listObraLayers(db.projectId), NOT_FOUND)
    actAs(null)
    expectError(await listObraLayers(db.projectId), /Sesión no válida/)
  })

  it("edita el marco (parcial y validado) y la opacidad, con auditoría", async () => {
    const { updateObraLayer } = await import("@/app/actions/obra/layers")
    actAs(db.users.jefe_obra)
    const u = unwrap(await updateObraLayer(layer.id, { frame: { offset_x_m: 12.5, rotation_deg: -15 }, opacity: 0.4, name: "Arquitectura N1" }))
    expect(u.frame).toEqual({ width_m: 40, aspect: 0.7, offset_x_m: 12.5, offset_y_m: 0, rotation_deg: -15 })
    expect(u.opacity).toBe(0.4)
    expect(u.name).toBe("Arquitectura N1")
    expectError(await updateObraLayer(layer.id, { frame: { rotation_deg: 400 } }), /rotación/)
    expectError(await updateObraLayer(layer.id, { frame: { offset_x_m: 20000 } }), /desplazamiento/)
    expectError(await updateObraLayer(layer.id, { frame: { offset_y_m: Number.POSITIVE_INFINITY } }), /desplazamiento/)
    expectError(await updateObraLayer(layer.id, { frame: { aspect: 0 } }), /proporción/)
    expectError(await updateObraLayer(layer.id, { frame: { width_m: 0 } }), /ancho real/)
    expectError(await updateObraLayer(layer.id, { opacity: 1.5 }), /opacidad/)
    expectError(await updateObraLayer(layer.id, { frame: "x" as never }), /marco/)
    actAs(db.users.supervisor)
    expectError(await updateObraLayer(layer.id, { opacity: 0.2 }), DENIED)
    const audit = await db.sql<{ details: { changes: string[] } }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'layer.updated' AND entity_id = ${layer.id}`
    expect(audit).toHaveLength(1)
    expect(audit[0].details.changes).toEqual(expect.arrayContaining(["name", "frame.offset_x_m", "frame.rotation_deg", "opacity"]))
  })

  it("ruta de imagen: bytes reales con cabeceras seguras; sesión ajena o sin sesión no accede", async () => {
    actAs(db.users.trabajador)
    const res = await imageRoute(layer.id)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(res.headers.get("cache-control")).toBe("private, max-age=300")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true)

    actAs(db.users.extrano)
    expect((await imageRoute(layer.id)).status).toBe(404)
    actAs(null)
    expect((await imageRoute(layer.id)).status).toBe(401)
    actAs(db.users.gerente)
    expect((await imageRoute("abc")).status).toBe(404)
    expect((await imageRoute("1 OR 1=1")).status).toBe(404)
    expect((await imageRoute(999999)).status).toBe(404)
    const plain = await db.sql<{ id: number }[]>`SELECT id FROM obra_plan_layers WHERE name = 'Estructura -1'`
    expect((await imageRoute(Number(plain[0].id))).status).toBe(404)
  })

  it("con Supabase: bucket privado creado una vez, subida a obra/{proyecto}/{capa}-… y lectura autenticada", async () => {
    const { resetStorageStateForTests } = await import("@/lib/obra/server/storage")
    const { createObraLayer } = await import("@/app/actions/obra/layers")
    resetStorageStateForTests()
    process.env.SUPABASE_URL = "https://proyecto-prueba.supabase.co"
    process.env.SUPABASE_SERVICE_KEY = "service-key-de-prueba"
    const objects = new Map<string, Buffer>()
    const calls: Array<{ method: string; url: string; auth: string | null; body?: string }> = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      const headers = new Headers(init?.headers)
      calls.push({ method, url, auth: headers.get("authorization"), body: typeof init?.body === "string" ? init.body : undefined })
      if (method === "POST" && url.endsWith("/storage/v1/bucket")) {
        return new Response(JSON.stringify({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }), {
          status: 400,
        })
      }
      const up = /\/storage\/v1\/object\/obra-planos\/(.+)$/.exec(url)
      if (method === "POST" && up) {
        objects.set(decodeURIComponent(up[1]), Buffer.from(init?.body as Uint8Array))
        return new Response(JSON.stringify({ Key: up[1] }), { status: 200 })
      }
      const down = /\/storage\/v1\/object\/authenticated\/obra-planos\/(.+)$/.exec(url)
      if (method === "GET" && down) {
        const b = objects.get(decodeURIComponent(down[1]))
        return b ? new Response(new Uint8Array(b), { status: 200 }) : new Response("not found", { status: 404 })
      }
      return new Response("unexpected", { status: 500 })
    })
    vi.stubGlobal("fetch", fetchMock)

    actAs(db.users.gerente)
    const a = unwrap(
      await createObraLayer(db.projectId, {
        name: "Alcantarillado N1",
        discipline: "alcantarillado",
        level: 0,
        image: { data_url: dataUrl("image/png", png), width_px: 1200, height_px: 840 },
      }),
    )
    const b = unwrap(
      await createObraLayer(db.projectId, {
        name: "Aguas lluvia N1",
        discipline: "aguas_lluvia",
        level: 0,
        image: { data_url: dataUrl("image/png", png), width_px: 1200, height_px: 840 },
      }),
    )
    const bucketCalls = calls.filter((c) => c.url.endsWith("/storage/v1/bucket"))
    expect(bucketCalls).toHaveLength(1)
    expect(JSON.parse(bucketCalls[0].body!)).toEqual({ id: "obra-planos", name: "obra-planos", public: false })
    expect(calls.every((c) => c.auth === "Bearer service-key-de-prueba")).toBe(true)

    const rows = await db.sql<{ id: number; image_path: string | null; image_data: string | null }[]>`
      SELECT id, image_path, image_data FROM obra_plan_layers WHERE id IN ${db.sql([a.id, b.id])} ORDER BY id`
    for (const r of rows) {
      expect(r.image_data).toBeNull()
      expect(r.image_path).toMatch(new RegExp(`^obra/${db.projectId}/${r.id}-[0-9a-f]{24}\\.png$`))
    }
    expect(a.has_image).toBe(true)

    actAs(db.users.visita)
    const res = await imageRoute(a.id)
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true)
    const get = calls.find((c) => c.method === "GET")!
    expect(get.url).toBe(`https://proyecto-prueba.supabase.co/storage/v1/object/authenticated/obra-planos/${rows[0].image_path}`)
    actAs(db.users.extrano)
    expect((await imageRoute(a.id)).status).toBe(404)

    // Fotos de hallazgos: misma subida privada, referenciadas como "obra-storage:<ruta>".
    const { decodeImageDataUrl, readObraStorageRef, storeFindingPhoto } = await import("@/lib/obra/server/storage")
    const photo = await storeFindingPhoto(db.projectId, decodeImageDataUrl(dataUrl("image/png", png)))
    expect(photo.ref).toMatch(new RegExp(`^obra-storage:obra/${db.projectId}/hallazgos/[0-9a-f]{24}\\.png$`))
    const back = await readObraStorageRef(photo.ref)
    expect(back.mime).toBe("image/png")
    expect(back.bytes.equals(png)).toBe(true)
    await expect(readObraStorageRef("obra-storage:../../otro-bucket/secreto.png")).rejects.toThrow()
  })

  it("si la subida a Supabase falla no queda la capa a medias", async () => {
    const { resetStorageStateForTests } = await import("@/lib/obra/server/storage")
    const { createObraLayer } = await import("@/app/actions/obra/layers")
    resetStorageStateForTests()
    process.env.SUPABASE_URL = "https://proyecto-prueba.supabase.co"
    process.env.SUPABASE_SERVICE_KEY = "service-key-de-prueba"
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/bucket") ? new Response("{}", { status: 200 }) : new Response("boom", { status: 500 }),
      ),
    )
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    actAs(db.users.gerente)
    const r = await createObraLayer(db.projectId, {
      name: "Falla de subida",
      discipline: "otro",
      level: 0,
      image: { data_url: dataUrl("image/png", png), width_px: 1, height_px: 1 },
    })
    spy.mockRestore()
    expectError(r, /error inesperado/)
    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_plan_layers WHERE name = 'Falla de subida'`
    expect(n[0].n).toBe(0)
  })

  describe("elementos", () => {
    const colector: PlanElementDraft = {
      element_type: "tuberia_alcantarillado",
      label: "  C-1  ",
      geometry: { type: "polyline", points: [{ x: 0.1, y: 0.2 }, { x: 0.123456789, y: 0.9 }] },
      attributes: { diameter_mm: "160" as never, material: "PVC", nested: { a: 1 } as never, depth_m: -3 },
    }
    const camara: PlanElementDraft = { element_type: "camara_inspeccion", geometry: { type: "point", points: [{ x: 0.1, y: 0.2 }] } }

    it("inserta en lote (manual y DXF), normaliza geometría y atributos, y audita", async () => {
      const { createObraElements, listObraElements } = await import("@/app/actions/obra/elements")
      const { listObraLayers } = await import("@/app/actions/obra/layers")
      actAs(db.users.prevencionista)
      expect(unwrap(await createObraElements(layer.id, [colector, camara], "manual"))).toEqual({ inserted: 2 })
      const many: PlanElementDraft[] = Array.from({ length: 1500 }, (_, i) => ({
        element_type: "muro",
        label: `M-${i}`,
        geometry: { type: "polyline", points: [{ x: (i % 100) / 100, y: 0 }, { x: (i % 100) / 100, y: 1 }] },
        attributes: { dxf_layer: "ARQ-MUROS" },
      }))
      expect(unwrap(await createObraElements(layer.id, many, "dxf"))).toEqual({ inserted: 1500 })

      const els = unwrap(await listObraElements(db.projectId, { layer_id: layer.id }))
      expect(els).toHaveLength(1502)
      const c = els.find((e) => e.element_type === "tuberia_alcantarillado")!
      expect(c).toMatchObject({
        layer_id: layer.id,
        project_id: db.projectId,
        label: "C-1",
        source: "manual",
        confidence: null,
        created_by: db.users.prevencionista,
        attributes: { diameter_mm: 160, material: "PVC" },
        geometry: { type: "polyline", points: [{ x: 0.1, y: 0.2 }, { x: 0.123457, y: 0.9 }] },
      })
      expect(els.filter((e) => e.source === "dxf")).toHaveLength(1500)
      const layers = unwrap(await listObraLayers(db.projectId))
      expect(layers.find((l) => l.id === layer.id)!.element_count).toBe(1502)
      expect(unwrap(await listObraElements(db.projectId, { level: -1 }))).toEqual([])
      expect(unwrap(await listObraElements(db.projectId, { level: 0 })).length).toBe(1502)
      const audit = await db.sql<{ details: { count: number; source: string } }[]>`
        SELECT details FROM obra_audit_log WHERE action = 'elements.created' AND entity_id = ${layer.id} ORDER BY id`
      expect(audit.map((a) => a.details)).toEqual([
        { count: 2, source: "manual" },
        { count: 1500, source: "dxf" },
      ])
    })

    it("valida cada borrador: todo o nada", async () => {
      const { createObraElements } = await import("@/app/actions/obra/elements")
      actAs(db.users.prevencionista)
      const bad1 = { element_type: "muro", geometry: { type: "polyline", points: [{ x: 0.1, y: 0.1 }] } } as PlanElementDraft
      expectError(await createObraElements(layer.id, [camara, bad1], "manual"), /Elemento n\.º 2: la geometría no es válida/)
      const bad2 = { element_type: "tuberia", geometry: camara.geometry } as never
      expectError(await createObraElements(layer.id, [bad2], "manual"), /Elemento n\.º 1: el tipo de elemento no es válido/)
      const bad3 = { element_type: "muro", geometry: { type: "point", points: [{ x: 1.2, y: 0.1 }] } } as PlanElementDraft
      expectError(await createObraElements(layer.id, [bad3], "manual"), /geometría/)
      expectError(await createObraElements(layer.id, [{ ...camara, label: "x".repeat(256) }], "manual"), /etiqueta/)
      expectError(await createObraElements(layer.id, [], "manual"), /al menos un elemento/)
      expectError(await createObraElements(layer.id, Array.from({ length: 5001 }, () => camara), "dxf"), /como máximo 5000/)
      expectError(await createObraElements(layer.id, [camara], "ia" as never), /Origen/)
      expectError(await createObraElements(layer.id, "x" as never, "manual"), /al menos un elemento/)
      const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_plan_elements WHERE layer_id = ${layer.id}`
      expect(n[0].n).toBe(1502)
      actAs(db.users.supervisor)
      expectError(await createObraElements(layer.id, [camara], "manual"), DENIED)
    })

    it("edita y elimina elementos (plans.manage), resolviendo el proyecto desde el elemento", async () => {
      const { listObraElements, updateObraElement, deleteObraElement } = await import("@/app/actions/obra/elements")
      actAs(db.users.jefe_obra)
      const els = unwrap(await listObraElements(db.projectId, { layer_id: layer.id }))
      const cam = els.find((e) => e.element_type === "camara_inspeccion")!
      const u = unwrap(
        await updateObraElement(cam.id, {
          label: "CI-1",
          attributes: { depth_m: 1.8 },
          geometry: { type: "point", points: [{ x: 0.3, y: 0.4 }] },
        }),
      )
      expect(u).toMatchObject({ id: cam.id, label: "CI-1", attributes: { depth_m: 1.8 }, geometry: { type: "point", points: [{ x: 0.3, y: 0.4 }] } })
      expectError(await updateObraElement(cam.id, { element_type: "nada" as never }), /Tipo de elemento/)
      expectError(await updateObraElement(cam.id, { geometry: { type: "polygon", points: [{ x: 0, y: 0 }] } as never }), /geometría/)
      actAs(db.users.trabajador)
      expectError(await updateObraElement(cam.id, { label: "x" }), DENIED)
      expectError(await deleteObraElement(cam.id), DENIED)
      actAs(db.users.jefe_obra)
      expect(unwrap(await deleteObraElement(cam.id))).toBeNull()
      expectError(await deleteObraElement(cam.id), NOT_FOUND)
      const audit = await db.sql<{ action: string }[]>`
        SELECT action FROM obra_audit_log WHERE entity_type = 'element' AND entity_id = ${cam.id} ORDER BY id`
      expect(audit.map((a) => a.action)).toEqual(["element.updated", "element.deleted"])
    })
  })

  it("borrado lógico: deja de listarse, no se edita ni sirve su imagen ni sus elementos", async () => {
    const { deleteObraLayer, listObraLayers, updateObraLayer } = await import("@/app/actions/obra/layers")
    const { createObraElements, listObraElements } = await import("@/app/actions/obra/elements")
    actAs(db.users.supervisor)
    expectError(await deleteObraLayer(layer.id), DENIED)
    actAs(db.users.gerente)
    expect(unwrap(await deleteObraLayer(layer.id))).toBeNull()
    expect(unwrap(await listObraLayers(db.projectId)).map((l) => l.id)).not.toContain(layer.id)
    expectError(await updateObraLayer(layer.id, { opacity: 0.5 }), NOT_FOUND)
    expectError(await deleteObraLayer(layer.id), NOT_FOUND)
    expectError(
      await createObraElements(layer.id, [{ element_type: "muro", geometry: { type: "point", points: [{ x: 0, y: 0 }] } }], "manual"),
      NOT_FOUND,
    )
    expect(unwrap(await listObraElements(db.projectId, { layer_id: layer.id }))).toEqual([])
    expect((await imageRoute(layer.id)).status).toBe(404)
    const row = await db.sql<{ deleted_at: Date | null }[]>`SELECT deleted_at FROM obra_plan_layers WHERE id = ${layer.id}`
    expect(row[0].deleted_at).not.toBeNull()
    const audit = await db.sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM obra_audit_log WHERE action = 'layer.deleted' AND entity_id = ${layer.id}`
    expect(audit[0].n).toBe(1)
  })
})
