// @vitest-environment node
/**
 * IDOR exhaustivo del módulo de planos, hallazgos y sugerencias: con ids
 * REALES de otra obra, cada acción responde "no encontrado" (404) y no cambia
 * nada en la BD. También cubre referencias cruzadas entre obras y la ruta de
 * imagen con sesión ajena.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/obra/types"
import { actAs, HAS_TEST_DB, setupObraTestDb, type TestDb } from "./helpers"

vi.mock("@/lib/auth", async () => (await import("./helpers")).authMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateObject: vi.fn() }))

const NOT_FOUND = /no encontrad/

function expectNotFound<T>(r: ActionResult<T>, label: string) {
  expect(r.ok, `${label} debió fallar`).toBe(false)
  expect((r as { error?: string }).error, label).toMatch(NOT_FOUND)
}

function pngDataUrl(width: number, height: number): string {
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
  return `data:image/png;base64,${b.toString("base64")}`
}

type Fixture = { projectId: number; layer: number; element: number; finding: number; suggestion: number; unpinned: number }

describe.skipIf(!HAS_TEST_DB)("IDOR: planos, hallazgos y sugerencias entre obras (BD real)", () => {
  let db: TestDb
  const mine = {} as Fixture
  const theirs = {} as Fixture
  let snapshot = ""

  /** Siembra una obra completa con SQL directo (capa con imagen, elemento, hallazgo con pin, sugerencia). */
  async function seed(projectId: number, ownerId: number, out: Fixture) {
    out.projectId = projectId
    const l = await db.sql<{ id: number }[]>`
      INSERT INTO obra_plan_layers (project_id, name, discipline, level, image_data, mime_type, width_px, height_px)
      VALUES (${projectId}, 'Alcantarillado', 'alcantarillado', 0, ${pngDataUrl(100, 70)}, 'image/png', 100, 70)
      RETURNING id`
    out.layer = Number(l[0].id)
    const e = await db.sql<{ id: number }[]>`
      INSERT INTO obra_plan_elements (layer_id, project_id, element_type, label, geometry)
      VALUES (${out.layer}, ${projectId}, 'tuberia_alcantarillado', 'C-9',
              ${db.sql.json({ type: "polyline", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] })})
      RETURNING id`
    out.element = Number(e[0].id)
    const f = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${projectId}, ${ownerId}, 'Grieta en radier', 'medium', 'open') RETURNING id`
    out.finding = Number(f[0].id)
    await db.sql`
      INSERT INTO obra_finding_pins (finding_id, project_id, layer_id, level, x, y, category, reported_by)
      VALUES (${out.finding}, ${projectId}, ${out.layer}, 0, 0.5, 0.52, 'grieta', ${ownerId})`
    const u = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${projectId}, ${ownerId}, 'Sin ubicar', 'low', 'open') RETURNING id`
    out.unpinned = Number(u[0].id)
    const s = await db.sql<{ id: number }[]>`
      INSERT INTO obra_ai_suggestions (project_id, kind, title, severity, payload, finding_id, layer_id)
      VALUES (${projectId}, 'create_task', 'Revisar colector', 'high',
              ${db.sql.json({ kind: "create_task", data: { title: "Revisar colector", finding_id: out.finding } })},
              ${out.finding}, ${out.layer})
      RETURNING id`
    out.suggestion = Number(s[0].id)
  }

  /** Estado completo de las tablas tocadas por las acciones (para verificar que nada cambió). */
  async function dbState(): Promise<string> {
    const rows = await Promise.all([
      db.sql`SELECT id, name, level, opacity, width_m, offset_x_m, deleted_at FROM obra_plan_layers ORDER BY id`,
      db.sql`SELECT id, layer_id, element_type, label, geometry FROM obra_plan_elements ORDER BY id`,
      db.sql`SELECT finding_id, layer_id, level, x, y FROM obra_finding_pins ORDER BY finding_id`,
      db.sql`SELECT id, title, severity, project_id FROM findings ORDER BY id`,
      db.sql`SELECT id, status, reviewed_by FROM obra_ai_suggestions ORDER BY id`,
      db.sql`SELECT id FROM obra_tasks ORDER BY id`,
    ])
    return JSON.stringify(rows)
  }

  async function imageRoute(id: number) {
    const { GET } = await import("@/app/api/obra/layers/[id]/image/route")
    return GET(new Request(`http://localhost/api/obra/layers/${id}/image`), { params: Promise.resolve({ id: String(id) }) })
  }

  /** Ejecuta TODAS las acciones con ids de `target` y espera 404 en cada una. */
  async function attackAll(target: Fixture, foreignLayerForDrafts: number) {
    const layers = await import("@/app/actions/obra/layers")
    const elements = await import("@/app/actions/obra/elements")
    const pins = await import("@/app/actions/obra/pins")
    const sugg = await import("@/app/actions/obra/suggestions")
    const draft = { element_type: "muro" as const, geometry: { type: "point" as const, points: [{ x: 0.5, y: 0.5 }] as [{ x: number; y: number }] } }

    expectNotFound(await layers.listObraLayers(target.projectId), "listObraLayers")
    expectNotFound(await layers.createObraLayer(target.projectId, { name: "Intrusa", discipline: "otro", level: 0 }), "createObraLayer")
    expectNotFound(await layers.updateObraLayer(target.layer, { name: "hackeada", opacity: 0 }), "updateObraLayer")
    expectNotFound(await layers.deleteObraLayer(target.layer), "deleteObraLayer")

    expectNotFound(await elements.listObraElements(target.projectId), "listObraElements")
    expectNotFound(await elements.createObraElements(target.layer, [draft], "manual"), "createObraElements")
    expectNotFound(await elements.updateObraElement(target.element, { label: "hackeado" }), "updateObraElement")
    expectNotFound(await elements.deleteObraElement(target.element), "deleteObraElement")
    expectNotFound(await elements.requestObraLayerExtraction(target.layer), "requestObraLayerExtraction")

    expectNotFound(await pins.listObraPins(target.projectId), "listObraPins")
    expectNotFound(
      await pins.reportObraFinding(target.projectId, { layer_id: target.layer, x: 0.5, y: 0.5, title: "Intruso", severity: "low" }),
      "reportObraFinding",
    )
    expectNotFound(
      await pins.pinExistingObraFinding(target.projectId, { finding_id: target.unpinned, layer_id: target.layer, x: 0.1, y: 0.1 }),
      "pinExistingObraFinding",
    )
    expectNotFound(await pins.listUnpinnedObraFindings(target.projectId), "listUnpinnedObraFindings")
    expectNotFound(await pins.analyzeObraFinding(target.finding), "analyzeObraFinding")
    expectNotFound(await pins.analyzeObraFinding(target.finding, { use_ai: true }), "analyzeObraFinding (IA)")
    expectNotFound(await pins.getObraFindingContext(target.finding), "getObraFindingContext")

    expectNotFound(await sugg.listObraSuggestions(target.projectId), "listObraSuggestions")
    expectNotFound(await sugg.approveObraSuggestion(target.suggestion), "approveObraSuggestion")
    expectNotFound(
      await sugg.approveObraSuggestion(target.suggestion, { edited_payload: { title: "x", layer_id: foreignLayerForDrafts } }),
      "approveObraSuggestion (editada)",
    )
    expectNotFound(await sugg.rejectObraSuggestion(target.suggestion, "no"), "rejectObraSuggestion")

    expect((await imageRoute(target.layer)).status).toBe(404)
  }

  beforeAll(async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_KEY
    db = await setupObraTestDb("idor_int_test")
    await seed(db.projectId, db.users.gerente, mine)
    await seed(db.otherProjectId, db.users.extrano, theirs)
    // La IA del dueño ajeno está configurada: aun así no se debe poder gastar su cuota.
    await db.sql`INSERT INTO settings (user_id, key, value) VALUES (${db.users.extrano}, 'ai_api_key', 'clave-ajena')`
    snapshot = await dbState()
  })
  afterAll(async () => {
    await db?.close()
  })

  it("un usuario de otra obra recibe 404 en cada acción con ids reales y no cambia nada", async () => {
    actAs(db.users.extrano)
    await attackAll(mine, theirs.layer)
    expect(await dbState()).toBe(snapshot)
  })

  it("el gerente de una obra recibe 404 con ids reales de la obra ajena (y no gasta su IA)", async () => {
    const ai = await import("ai")
    vi.mocked(ai.generateObject).mockReset()
    actAs(db.users.gerente)
    await attackAll(theirs, mine.layer)
    expect(ai.generateObject).not.toHaveBeenCalled()
    expect(await dbState()).toBe(snapshot)
  })

  it("todos los roles del equipo reciben 404 contra la obra ajena", async () => {
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const { getObraFindingContext } = await import("@/app/actions/obra/pins")
    const { updateObraElement } = await import("@/app/actions/obra/elements")
    for (const role of ["jefe_obra", "prevencionista", "supervisor", "trabajador", "visita"] as const) {
      actAs(db.users[role])
      expectNotFound(await approveObraSuggestion(theirs.suggestion), `${role}: approve`)
      expectNotFound(await getObraFindingContext(theirs.finding), `${role}: context`)
      expectNotFound(await updateObraElement(theirs.element, { label: "x" }), `${role}: element`)
      expect((await imageRoute(theirs.layer)).status).toBe(404)
    }
    expect(await dbState()).toBe(snapshot)
  })

  it("las funciones de servidor responden con status 404 (no 403) para no revelar que la entidad existe", async () => {
    const { approveSuggestion, rejectSuggestion } = await import("@/lib/obra/server/suggestions")
    const { analyzeFinding, getFindingContext } = await import("@/lib/obra/server/pins")
    const { updateLayer, readLayerImage } = await import("@/lib/obra/server/layers")
    const { deleteElement, requestLayerExtraction } = await import("@/lib/obra/server/elements")
    const u = db.users.extrano
    await expect(approveSuggestion(u, mine.suggestion)).rejects.toMatchObject({ status: 404 })
    await expect(rejectSuggestion(u, mine.suggestion)).rejects.toMatchObject({ status: 404 })
    await expect(analyzeFinding(u, mine.finding, { use_ai: true })).rejects.toMatchObject({ status: 404 })
    await expect(getFindingContext(u, mine.finding)).rejects.toMatchObject({ status: 404 })
    await expect(updateLayer(u, mine.layer, { opacity: 0.1 })).rejects.toMatchObject({ status: 404 })
    await expect(readLayerImage(u, mine.layer)).rejects.toMatchObject({ status: 404 })
    await expect(deleteElement(u, mine.element)).rejects.toMatchObject({ status: 404 })
    await expect(requestLayerExtraction(u, mine.layer)).rejects.toMatchObject({ status: 404 })
  })

  it("ids malformados o inexistentes responden 404", async () => {
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const { analyzeObraFinding } = await import("@/app/actions/obra/pins")
    const { updateObraLayer } = await import("@/app/actions/obra/layers")
    const { deleteObraElement } = await import("@/app/actions/obra/elements")
    actAs(db.users.gerente)
    for (const bad of ["1 OR 1=1", -1, 0, 1.5, 99_999_999, 2 ** 40, null, { id: 1 }] as never[]) {
      expectNotFound(await approveObraSuggestion(bad), `approve(${JSON.stringify(bad)})`)
      expectNotFound(await analyzeObraFinding(bad), `analyze(${JSON.stringify(bad)})`)
      expectNotFound(await updateObraLayer(bad, { opacity: 0.5 }), `updateLayer(${JSON.stringify(bad)})`)
      expectNotFound(await deleteObraElement(bad), `deleteElement(${JSON.stringify(bad)})`)
    }
    expectNotFound(await approveObraSuggestion(mine.suggestion + 1000), "approve inexistente")
  })

  it("referencias cruzadas: no se puede usar una capa, un hallazgo o una sugerencia de otra obra desde la propia", async () => {
    const { reportObraFinding, pinExistingObraFinding } = await import("@/app/actions/obra/pins")
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const { listObraElements } = await import("@/app/actions/obra/elements")
    const { listObraSuggestions } = await import("@/app/actions/obra/suggestions")
    actAs(db.users.gerente)
    const r1 = await reportObraFinding(db.projectId, { layer_id: theirs.layer, x: 0.5, y: 0.5, title: "Grieta cruzada", severity: "low" })
    expect(r1).toEqual({ ok: false, error: "La capa indicada no pertenece a esta obra o fue eliminada." })
    const r2 = await pinExistingObraFinding(db.projectId, { finding_id: theirs.unpinned, layer_id: mine.layer, x: 0.1, y: 0.1 })
    expect(r2).toEqual({ ok: false, error: "El hallazgo indicado no pertenece a esta obra." })
    const r3 = await pinExistingObraFinding(db.projectId, { finding_id: mine.unpinned, layer_id: theirs.layer, x: 0.1, y: 0.1 })
    expect(r3).toEqual({ ok: false, error: "La capa indicada no pertenece a esta obra o fue eliminada." })
    // Editar la sugerencia propia para que apunte al hallazgo ajeno: rechazado (no se puede cambiar el hallazgo).
    const r4 = await approveObraSuggestion(mine.suggestion, { edited_payload: { title: "Revisar", finding_id: theirs.finding } })
    expect(r4).toEqual({ ok: false, error: "No se puede cambiar el hallazgo de una tarea sugerida." })
    // Filtros con ids ajenos dentro de la obra propia no filtran datos ajenos.
    const els = await listObraElements(db.projectId, { layer_id: theirs.layer })
    expect(els).toEqual({ ok: true, data: [] })
    const sg = await listObraSuggestions(db.projectId, { finding_id: theirs.finding })
    expect(sg).toEqual({ ok: true, data: [] })
    expect(await dbState()).toBe(snapshot)
  })
})
