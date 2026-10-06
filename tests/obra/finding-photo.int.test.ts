// @vitest-environment node
/**
 * Fotos de hallazgos reportados en el plano (BD real): el panel recibe cuántas
 * fotos hay y GET /api/obra/findings/[id]/photo las sirve con el mismo control
 * de acceso que el contexto del hallazgo (findings.view o quien lo reportó).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/obra/types"
import { actAs, HAS_TEST_DB, setupObraTestDb, type TestDb } from "./helpers"

vi.mock("@/lib/auth", async () => (await import("./helpers")).authMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

function unwrap<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`Se esperaba ok y llegó error: ${(r as { error?: string }).error}`)
  return r.data
}

/** PNG mínimo con cabecera IHDR real (el servidor verifica firma y dimensiones). */
function pngBytes(width: number, height: number): Buffer {
  const b = Buffer.alloc(8 + 25 + 12)
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

describe.skipIf(!HAS_TEST_DB)("fotos de hallazgos en el plano (BD real)", () => {
  let db: TestDb
  let layerId = 0
  let withPhoto = 0
  let withoutPhoto = 0
  let otroTrabajador = 0
  const png = pngBytes(40, 30)

  async function getPhoto(findingId: number, index = "0") {
    const { GET } = await import("@/app/api/obra/findings/[id]/photo/route")
    return GET(new Request(`http://localhost/api/obra/findings/${findingId}/photo?index=${index}`), {
      params: Promise.resolve({ id: String(findingId) }),
    })
  }

  beforeAll(async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_KEY
    db = await setupObraTestDb("finding_photo_int_test")
    const r = await db.sql<{ id: number }[]>`
      INSERT INTO users (email, name, password_hash, role) VALUES ('otro.trabajador@test.cl', 'Otro', 'x', 'user') RETURNING id`
    otroTrabajador = Number(r[0].id)
    await db.sql`INSERT INTO obra_members (project_id, user_id, role) VALUES (${db.projectId}, ${otroTrabajador}, 'trabajador')`

    const { createObraLayer } = await import("@/app/actions/obra/layers")
    const { reportObraFinding } = await import("@/app/actions/obra/pins")
    actAs(db.users.jefe_obra)
    layerId = unwrap(await createObraLayer(db.projectId, { name: "Arquitectura N1", discipline: "arquitectura", level: 1, width_m: 30 })).id

    actAs(db.users.trabajador)
    const base = { layer_id: layerId, x: 0.4, y: 0.6, severity: "high" as const }
    withPhoto = unwrap(
      await reportObraFinding(db.projectId, {
        ...base,
        title: "Grieta en muro con foto",
        photo_data_url: `data:image/png;base64,${png.toString("base64")}`,
      }),
    ).finding_id
    withoutPhoto = unwrap(await reportObraFinding(db.projectId, { ...base, title: "Grieta en muro sin foto" })).finding_id
  })

  afterAll(async () => {
    await db?.close()
  })

  it("el contexto del hallazgo indica qué fotos se pueden mostrar", async () => {
    const { getObraFindingContext } = await import("@/app/actions/obra/pins")
    actAs(db.users.prevencionista)
    expect(unwrap(await getObraFindingContext(withPhoto)).photo_indexes).toEqual([0])
    expect(unwrap(await getObraFindingContext(withoutPhoto)).photo_indexes).toEqual([])
  })

  it("sirve la foto a quien puede ver el hallazgo, con cabeceras seguras", async () => {
    for (const user of [db.users.prevencionista, db.users.visita, db.users.gerente, db.users.trabajador]) {
      actAs(user)
      const res = await getPhoto(withPhoto)
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("image/png")
      expect(res.headers.get("x-content-type-options")).toBe("nosniff")
      expect(res.headers.get("cache-control")).toContain("private")
      expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true)
    }
  })

  it("responde 404 sin acceso, sin foto o con índice inválido, y 401 sin sesión", async () => {
    actAs(db.users.extrano)
    expect((await getPhoto(withPhoto)).status).toBe(404)
    // Otro trabajador: sin findings.view y no lo reportó.
    actAs(otroTrabajador)
    expect((await getPhoto(withPhoto)).status).toBe(404)
    actAs(db.users.prevencionista)
    expect((await getPhoto(withoutPhoto)).status).toBe(404)
    expect((await getPhoto(withPhoto, "1")).status).toBe(404)
    expect((await getPhoto(withPhoto, "-1")).status).toBe(404)
    expect((await getPhoto(withPhoto, "abc")).status).toBe(404)
    expect((await getPhoto(999999)).status).toBe(404)
    actAs(null)
    expect((await getPhoto(withPhoto)).status).toBe(401)
  })

  it("no sirve ni ofrece referencias que no sean de Obra (URLs externas) aunque estén en el hallazgo", async () => {
    const { getObraFindingContext } = await import("@/app/actions/obra/pins")
    const [ref] = (await db.sql<{ photos: string[] }[]>`SELECT photos FROM findings WHERE id = ${withPhoto}`)[0].photos
    await db.sql`UPDATE findings SET photos = ${db.sql.json(["https://example.com/x.png", ref])} WHERE id = ${withoutPhoto}`
    actAs(db.users.prevencionista)
    expect(unwrap(await getObraFindingContext(withoutPhoto)).photo_indexes).toEqual([1])
    expect((await getPhoto(withoutPhoto, "0")).status).toBe(404)
    expect((await getPhoto(withoutPhoto, "1")).status).toBe(200)
  })
})
