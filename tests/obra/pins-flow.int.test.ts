// @vitest-environment node
/**
 * Caso estrella de Obra Integral, de punta a punta contra Postgres real:
 * capa de arquitectura y capa de alcantarillado del mismo nivel con marcos
 * distintos (desplazamiento + rotación), colector como polilínea, un
 * trabajador reporta "Grieta en muro del eje B" a ~1,2 m del colector →
 * sugerencias por reglas pendientes (sin tareas) → solo un revisor
 * autorizado las aprueba → una tarea en la próxima revisión.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { fromLevelMeters } from "@/lib/obra/geometry"
import { addDaysISO, todayISO } from "@/lib/obra/metrics"
import type { ActionResult, AiSuggestion, CreateTaskPayload, PlanLayer } from "@/lib/obra/types"
import { actAs, HAS_TEST_DB, setupObraTestDb, type TestDb } from "./helpers"

vi.mock("@/lib/auth", async () => (await import("./helpers")).authMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateObject: vi.fn() }))

function unwrap<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`Se esperaba ok y llegó error: ${(r as { error?: string }).error}`)
  return r.data
}

function expectError<T>(r: ActionResult<T>, pattern: RegExp) {
  expect(r.ok).toBe(false)
  expect((r as { error?: string }).error).toMatch(pattern)
}

/** PNG mínimo con cabecera IHDR real (el servidor lee firma y dimensiones). */
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

function taskData(s: AiSuggestion): CreateTaskPayload {
  if (s.payload.kind !== "create_task") throw new Error("se esperaba create_task")
  return s.payload.data
}

const DENIED = /no permite/
const REVIEWED = /ya fue revisada/

describe.skipIf(!HAS_TEST_DB)("caso estrella: grieta junto al colector de alcantarillado (BD real)", () => {
  let db: TestDb
  const ids = {
    arq: 0,
    alc: 0,
    gas: 0,
    colector: 0,
    muro: 0,
    lineaGas: 0,
    grieta: 0,
    olor: 0,
    otherFinding: 0,
    otherLayer: 0,
    deletedLayer: 0,
  }
  let alcLayer: PlanLayer

  async function pendingFor(findingId: number): Promise<AiSuggestion[]> {
    const { listObraSuggestions } = await import("@/app/actions/obra/suggestions")
    actAs(db.users.prevencionista)
    return unwrap(await listObraSuggestions(db.projectId, { finding_id: findingId, status: ["pending"] }))
  }

  async function taskCount(findingId: number): Promise<number> {
    const r = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_tasks WHERE finding_id = ${findingId}`
    return r[0].n
  }

  async function configureAi(on: boolean) {
    await db.sql`DELETE FROM settings WHERE user_id = ${db.users.gerente} AND key = 'ai_api_key'`
    if (on) {
      await db.sql`INSERT INTO settings (user_id, key, value) VALUES (${db.users.gerente}, 'ai_api_key', 'clave-de-prueba')`
    }
  }

  beforeAll(async () => {
    delete process.env.AI_API_KEY
    delete process.env.GOOGLE_API_KEY
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_KEY
    db = await setupObraTestDb("pins_flow_int_test")
    const { createObraLayer, updateObraLayer, deleteObraLayer } = await import("@/app/actions/obra/layers")
    const { createObraElements, listObraElements } = await import("@/app/actions/obra/elements")

    actAs(db.users.jefe_obra)
    // Arquitectura: lámina de 40 m de ancho; la imagen de 1000×750 px fija la proporción 0,75 (30 m de alto).
    const arq = unwrap(
      await createObraLayer(db.projectId, {
        name: "Arquitectura N1",
        discipline: "arquitectura",
        level: 0,
        width_m: 40,
        image: { data_url: pngDataUrl(1000, 750), width_px: 1000, height_px: 750 },
      }),
    )
    expect(arq.frame).toMatchObject({ width_m: 40, aspect: 0.75, offset_x_m: 0, rotation_deg: 0 })
    ids.arq = arq.id

    // Alcantarillado: otra lámina (30 × 30 m) desplazada 35 m y rotada 90° respecto del marco del nivel.
    const alc = unwrap(
      await createObraLayer(db.projectId, { name: "Alcantarillado N1", discipline: "alcantarillado", level: 0, width_m: 30, aspect: 1 }),
    )
    alcLayer = unwrap(await updateObraLayer(alc.id, { frame: { offset_x_m: 35, offset_y_m: 0, rotation_deg: 90 } }))
    expect(alcLayer.frame).toMatchObject({ width_m: 30, aspect: 1, offset_x_m: 35, offset_y_m: 0, rotation_deg: 90 })
    ids.alc = alc.id

    const gas = unwrap(await createObraLayer(db.projectId, { name: "Gas N1", discipline: "gas", level: 0, width_m: 40, aspect: 0.75 }))
    ids.gas = gas.id

    // Colector C-3 Ø160: en el marco del nivel corre por x = 10 m, de y = 5 a y = 25.
    const colector = [
      { x: 10, y: 5 },
      { x: 10, y: 25 },
    ].map((p) => fromLevelMeters(p, alcLayer.frame))
    for (const p of colector) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(1)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(1)
    }
    expect(
      unwrap(
        await createObraElements(
          ids.alc,
          [{ element_type: "tuberia_alcantarillado", label: "C-3", geometry: { type: "polyline", points: colector }, attributes: { diameter_mm: 160 } }],
          "manual",
        ),
      ),
    ).toEqual({ inserted: 1 })
    // Muro del eje B (tabique) en x = 11,5 m de la lámina de arquitectura.
    unwrap(
      await createObraElements(
        ids.arq,
        [{ element_type: "muro", label: "Eje B", geometry: { type: "polyline", points: [{ x: 11.5 / 40, y: 0 }, { x: 11.5 / 40, y: 1 }] } }],
        "manual",
      ),
    )
    // Red de gas lejos de la grieta (x = 30 m), cerca de la sala de medidores.
    unwrap(
      await createObraElements(
        ids.gas,
        [{ element_type: "linea_gas", label: "G-1", geometry: { type: "polyline", points: [{ x: 0.75, y: 0 }, { x: 0.75, y: 1 }] } }],
        "manual",
      ),
    )
    const els = unwrap(await listObraElements(db.projectId, { level: 0 }))
    ids.colector = els.find((e) => e.element_type === "tuberia_alcantarillado")!.id
    ids.muro = els.find((e) => e.element_type === "muro")!.id
    ids.lineaGas = els.find((e) => e.element_type === "linea_gas")!.id

    const del = unwrap(await createObraLayer(db.projectId, { name: "Capa borrada", discipline: "otro", level: 0 }))
    unwrap(await deleteObraLayer(del.id))
    ids.deletedLayer = del.id

    const of = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${db.otherProjectId}, ${db.users.extrano}, 'Hallazgo ajeno', 'low', 'open') RETURNING id`
    ids.otherFinding = Number(of[0].id)
    const ol = await db.sql<{ id: number }[]>`
      INSERT INTO obra_plan_layers (project_id, name, discipline, level)
      VALUES (${db.otherProjectId}, 'Capa ajena', 'alcantarillado', 0) RETURNING id`
    ids.otherLayer = Number(ol[0].id)
  })
  afterAll(async () => {
    await db?.close()
  })

  it("un trabajador reporta la grieta: quedan sugerencias por reglas pendientes y NINGUNA tarea", async () => {
    const { reportObraFinding } = await import("@/app/actions/obra/pins")
    actAs(db.users.trabajador)
    const r = unwrap(
      await reportObraFinding(db.projectId, {
        layer_id: ids.arq,
        x: 11.2 / 40,
        y: 15 / 30,
        title: "Grieta en muro del eje B",
        description: "Fisura diagonal de unos 3 mm junto a la ventana.",
        severity: "medium",
      }),
    )
    ids.grieta = r.finding_id
    expect(r.pin).toMatchObject({
      finding_id: r.finding_id,
      project_id: db.projectId,
      layer_id: ids.arq,
      level: 0,
      category: "grieta",
      reported_by: db.users.trabajador,
      severity: "medium",
      status: "open",
      title: "Grieta en muro del eje B",
    })
    expect(r.suggestions).toHaveLength(2)
    for (const s of r.suggestions) {
      expect(s).toMatchObject({ kind: "create_task", status: "pending", generator: "reglas", finding_id: r.finding_id })
      expect(s.reviewed_at).toBeNull()
    }
    const top = r.suggestions.find((s) => s.evidence.correlations?.[0]?.element_id === ids.colector)!
    expect(top).toBeDefined()
    const c = top.evidence.correlations![0]
    expect(c).toMatchObject({
      rule_id: "grieta_alcantarillado",
      relation: "mismo_nivel",
      layer_id: ids.alc,
      layer_name: "Alcantarillado N1",
      element_label: "C-3",
      priority: "alta",
    })
    expect(c.distance_m).toBeCloseTo(1.2, 2)
    expect(top.severity).toBe("high")
    expect(top.rationale).toMatch(/1,2 m/)
    expect(top.rationale).toMatch(/colector de alcantarillado «C-3» Ø160/)
    expect(taskData(top)).toMatchObject({
      finding_id: r.finding_id,
      layer_id: ids.arq,
      level: 0,
      priority: "alta",
      assigned_role: "jefe_obra",
      due_in_days: 3,
    })
    expect(taskData(top).checklist.length).toBeGreaterThan(0)
    // La mejor correlación aparece primero.
    expect(r.suggestions[0].id).toBe(top.id)
    const muro = r.suggestions.find((s) => s.evidence.correlations?.[0]?.element_id === ids.muro)!
    // "Muro" sin calificar puede ser estructural: prioridad media (no fisura menor).
    expect(muro.evidence.correlations![0]).toMatchObject({ rule_id: "grieta_tabique", priority: "media" })

    // Nada se aplicó: no hay tareas.
    expect(await taskCount(r.finding_id)).toBe(0)
    const f = await db.sql<{ user_id: number; project_id: number; status: string; location: string; severity: string; photos: unknown }[]>`
      SELECT user_id, project_id, status, location, severity, photos FROM findings WHERE id = ${r.finding_id}`
    expect(f[0]).toMatchObject({
      user_id: db.users.gerente,
      project_id: db.projectId,
      status: "open",
      location: "Arquitectura N1 · nivel 0",
      severity: "medium",
      photos: [],
    })
    const audit = await db.sql<{ actor_user_id: number }[]>`
      SELECT actor_user_id FROM obra_audit_log WHERE action = 'finding.reported' AND entity_id = ${r.finding_id}`
    expect(audit[0].actor_user_id).toBe(db.users.trabajador)
  })

  it("el trabajador, el supervisor y la visita NO pueden aprobar (403)", async () => {
    const { approveObraSuggestion, rejectObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const { approveSuggestion } = await import("@/lib/obra/server/suggestions")
    const [top] = await pendingFor(ids.grieta)
    for (const role of ["trabajador", "supervisor", "visita"] as const) {
      actAs(db.users[role])
      expectError(await approveObraSuggestion(top.id), DENIED)
      expectError(await rejectObraSuggestion(top.id, "no"), DENIED)
      await expect(approveSuggestion(db.users[role], top.id)).rejects.toMatchObject({ status: 403 })
    }
    expect(await pendingFor(ids.grieta)).toHaveLength(2)
    expect(await taskCount(ids.grieta)).toBe(0)
  })

  it("el prevencionista aprueba: se crea exactamente 1 tarea origin 'ia' en una revisión creada sola para su vencimiento", async () => {
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const before = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_inspections WHERE project_id = ${db.projectId}`
    expect(before[0].n).toBe(0)
    const [top] = await pendingFor(ids.grieta)
    expect(top.evidence.correlations?.[0]?.element_id).toBe(ids.colector)

    actAs(db.users.prevencionista)
    const r = unwrap(await approveObraSuggestion(top.id, { notes: "Coordinar inspección con cámara." }))
    expect(r.applied_entity_type).toBe("task")
    expect(r.suggestion).toMatchObject({
      id: top.id,
      status: "approved",
      reviewed_by: db.users.prevencionista,
      reviewed_by_name: "prevencionista",
      review_notes: "Coordinar inspección con cámara.",
      applied_entity_type: "task",
      applied_entity_id: r.applied_entity_id,
    })
    expect(r.suggestion.reviewed_at).not.toBeNull()

    const { listObraTasks } = await import("@/app/actions/obra/tasks")
    const tasks = unwrap(await listObraTasks(db.projectId)).filter((t) => t.finding_id === ids.grieta)
    expect(tasks).toHaveLength(1)
    const t = tasks[0]
    expect(t).toMatchObject({
      id: r.applied_entity_id,
      origin: "ia",
      suggestion_id: top.id,
      finding_id: ids.grieta,
      layer_id: ids.arq,
      level: 0,
      priority: "alta",
      assigned_role: "jefe_obra",
      status: "pendiente",
      due_date: addDaysISO(todayISO(), 3),
      created_by: db.users.prevencionista,
    })
    expect(t.checklist.length).toBe(taskData(top).checklist.length)
    expect(t.checklist.every((i) => i.done === false)).toBe(true)
    expect(t.x).toBeCloseTo(0.28, 6)
    // No había revisiones y la tarea vence en 3 días: no espera a una "Revisión semanal" a 7 días.
    const ins = await db.sql<{ id: number; title: string; status: string; scheduled_for: string }[]>`
      SELECT id, title, status, to_char(scheduled_for, 'YYYY-MM-DD') AS scheduled_for
      FROM obra_inspections WHERE project_id = ${db.projectId}`
    expect(ins).toHaveLength(1)
    expect(ins[0]).toMatchObject({
      id: t.inspection_id,
      title: "Revisión prioritaria",
      status: "programada",
      scheduled_for: addDaysISO(todayISO(), 3),
    })
    // La respuesta nombra la revisión elegida (el aviso la muestra y enlaza a sus tareas).
    expect(r.inspection).toEqual({ id: t.inspection_id, title: "Revisión prioritaria", scheduled_for: addDaysISO(todayISO(), 3) })

    const audit = await db.sql<{ action: string; details: Record<string, unknown> }[]>`
      SELECT action, details FROM obra_audit_log
      WHERE project_id = ${db.projectId} AND action IN ('suggestion.approved', 'task.created') ORDER BY id`
    expect(audit.map((a) => a.action)).toEqual(["task.created", "suggestion.approved"])
    expect(audit[1].details).toMatchObject({ kind: "create_task", edited: false, applied_entity_type: "task" })
  })

  it("aprobar de nuevo responde 'ya fue revisada' y no duplica la tarea", async () => {
    const { approveObraSuggestion, rejectObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const s = await db.sql<{ id: number }[]>`
      SELECT id FROM obra_ai_suggestions WHERE finding_id = ${ids.grieta} AND status = 'approved'`
    for (const role of ["prevencionista", "jefe_obra", "gerente"] as const) {
      actAs(db.users[role])
      expectError(await approveObraSuggestion(Number(s[0].id)), REVIEWED)
      expectError(await rejectObraSuggestion(Number(s[0].id), "tarde"), REVIEWED)
    }
    expect(await taskCount(ids.grieta)).toBe(1)
  })

  it("dos aprobaciones concurrentes de la misma sugerencia crean una sola tarea", async () => {
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const [pending] = await pendingFor(ids.grieta)
    actAs(db.users.prevencionista)
    const results = await Promise.all([approveObraSuggestion(pending.id), approveObraSuggestion(pending.id)])
    const ok = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok)
    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect((failed[0] as { error: string }).error).toMatch(/ya fue revisada|ya fue anotada/)
    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_tasks WHERE suggestion_id = ${pending.id}`
    expect(n[0].n).toBe(1)
    expect(await taskCount(ids.grieta)).toBe(2)
    // Siguen en la misma revisión (vence en 5 días, después de la de 3): no se creó otra.
    const ins = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_inspections WHERE project_id = ${db.projectId}`
    expect(ins[0].n).toBe(1)
  })

  it("re-analizar no repite correlaciones que ya tienen una tarea abierta", async () => {
    const { analyzeObraFinding } = await import("@/app/actions/obra/pins")
    actAs(db.users.prevencionista)
    const a = unwrap(await analyzeObraFinding(ids.grieta))
    expect(a.correlations.map((c) => c.element_id)).toEqual([ids.colector, ids.muro])
    expect(a.suggestions).toEqual([])
    const audit = await db.sql<{ details: { already_tasked?: number } }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'finding.analyzed' AND entity_id = ${ids.grieta} ORDER BY id DESC LIMIT 1`
    expect(audit[0].details.already_tasked).toBe(2)
    expect(await taskCount(ids.grieta)).toBe(2)
  })

  it("rechazar una pendiente registra el motivo y es definitivo", async () => {
    const { analyzeObraFinding } = await import("@/app/actions/obra/pins")
    const { rejectObraSuggestion, approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    // La tarea del muro se cerró: su correlación vuelve a sugerirse.
    await db.sql`
      UPDATE obra_tasks SET status = 'hecha' WHERE finding_id = ${ids.grieta}
        AND suggestion_id IN (
          SELECT id FROM obra_ai_suggestions WHERE (evidence->'correlations'->0->>'element_id')::int = ${ids.muro}
        )`
    actAs(db.users.prevencionista)
    const a = unwrap(await analyzeObraFinding(ids.grieta))
    expect(a.suggestions).toHaveLength(1)
    const target = a.suggestions[0]
    expect(target.evidence.correlations![0].element_id).toBe(ids.muro)

    actAs(db.users.jefe_obra)
    expectError(await rejectObraSuggestion(target.id, "x".repeat(1001)), /como máximo 1000/)
    const r = unwrap(await rejectObraSuggestion(target.id, "  El colector se reemplazó en junio.  "))
    expect(r).toMatchObject({
      status: "rejected",
      reviewed_by: db.users.jefe_obra,
      review_notes: "El colector se reemplazó en junio.",
      applied_entity_type: null,
    })
    expect(r.reviewed_at).not.toBeNull()
    expectError(await rejectObraSuggestion(target.id), REVIEWED)
    expectError(await approveObraSuggestion(target.id), REVIEWED)
    const audit = await db.sql<{ details: { reason: string } }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'suggestion.rejected' AND entity_id = ${target.id}`
    expect(audit[0].details.reason).toBe("El colector se reemplazó en junio.")
  })

  it("el re-análisis marca como 'superseded' las pendientes anteriores", async () => {
    const { analyzeObraFinding } = await import("@/app/actions/obra/pins")
    actAs(db.users.supervisor)
    unwrap(await analyzeObraFinding(ids.grieta, { use_ai: false }))
    const old = await pendingFor(ids.grieta)
    expect(old).toHaveLength(1)
    actAs(db.users.supervisor)
    const a = unwrap(await analyzeObraFinding(ids.grieta, { use_ai: false }))
    expect(a.correlations.map((c) => c.element_id)).toEqual([ids.colector, ids.muro])
    expect(a.suggestions).toHaveLength(1)
    const st = await db.sql<{ status: string }[]>`SELECT status FROM obra_ai_suggestions WHERE id = ${old[0].id}`
    expect(st[0].status).toBe("superseded")
    const now = await pendingFor(ids.grieta)
    expect(now.map((s) => s.id).sort()).toEqual(a.suggestions.map((s) => s.id).sort())
    // Las aprobadas y rechazadas no cambian.
    const counts = await db.sql<{ status: string; n: number }[]>`
      SELECT status, COUNT(*)::int AS n FROM obra_ai_suggestions WHERE finding_id = ${ids.grieta} GROUP BY status`
    const by = Object.fromEntries(counts.map((c) => [c.status, c.n]))
    expect(by).toMatchObject({ approved: 2, rejected: 1, pending: 1 })
    const audit = await db.sql<{ details: { superseded: number; superseded_ids: number[] } }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'finding.analyzed' AND entity_id = ${ids.grieta} ORDER BY id DESC LIMIT 1`
    expect(audit[0].details.superseded).toBe(1)
    expect(audit[0].details.superseded_ids).toEqual([old[0].id])
  })

  it("re-analizar escribe: la visita y el trabajador que reportó no pueden (ni con reglas ni con IA)", async () => {
    const { analyzeObraFinding } = await import("@/app/actions/obra/pins")
    const before = await pendingFor(ids.grieta)
    for (const role of ["trabajador", "visita"] as const) {
      actAs(db.users[role])
      expectError(await analyzeObraFinding(ids.grieta, { use_ai: true }), DENIED)
      expectError(await analyzeObraFinding(ids.grieta), DENIED)
      expectError(await analyzeObraFinding(ids.grieta, { use_ai: false }), DENIED)
    }
    // Nada cambió: las pendientes siguen igual.
    expect((await pendingFor(ids.grieta)).map((s) => s.id)).toEqual(before.map((s) => s.id))
    actAs(db.users.extrano)
    expectError(await analyzeObraFinding(ids.grieta), /no encontrado/)
  })

  it("analizar con IA: redacta sobre la evidencia determinista; índices inventados se descartan", async () => {
    const { analyzeObraFinding } = await import("@/app/actions/obra/pins")
    const ai = await import("ai")
    const gen = vi.mocked(ai.generateObject)
    gen.mockReset()
    await configureAi(true)
    // La tarea del colector se cerró: su correlación vuelve a estar disponible para la IA.
    await db.sql`UPDATE obra_tasks SET status = 'hecha' WHERE finding_id = ${ids.grieta}`
    const old = await pendingFor(ids.grieta)
    gen.mockResolvedValueOnce({
      object: {
        items: [
          {
            correlation_index: 0,
            title: "Inspeccionar con cámara el colector C-3 bajo el eje B",
            rationale: "La grieta está a 1,2 m del colector C-3: una filtración podría socavar la fundación.",
            priority: "media",
            checklist: ["Pasar cámara CCTV por el tramo", "Instalar fisurómetro en la grieta"],
            assigned_role: "visita",
            due_in_days: 30,
          },
          {
            correlation_index: 7,
            title: "Revisar la tubería de gas inventada",
            rationale: "Inventado",
            priority: "critica",
            checklist: [],
            assigned_role: "jefe_obra",
            due_in_days: 1,
          },
          {
            correlation_index: 0,
            title: "Duplicado del mismo índice",
            rationale: "Duplicado",
            priority: "alta",
            checklist: [],
            assigned_role: null,
            due_in_days: 2,
          },
        ],
      },
    } as never)

    actAs(db.users.jefe_obra)
    const a = unwrap(await analyzeObraFinding(ids.grieta, { use_ai: true }))
    expect(gen).toHaveBeenCalledTimes(1)
    const call = gen.mock.calls[0][0] as { prompt?: string }
    expect(call.prompt).toContain("Grieta en muro del eje B")
    expect(call.prompt).toContain("[0]")
    expect(call.prompt).toMatch(/revisará/)

    expect(a.suggestions).toHaveLength(1)
    const s = a.suggestions[0]
    expect(s).toMatchObject({ kind: "create_task", status: "pending", generator: "ia", model: "google/gemini-2.5-flash" })
    expect(s.title).toBe("Inspeccionar con cámara el colector C-3 bajo el eje B")
    expect(s.rationale).toMatch(/1,2 m del colector/)
    // Evidencia SIEMPRE determinista.
    expect(s.evidence.correlations).toHaveLength(1)
    expect(s.evidence.correlations![0]).toMatchObject({ element_id: ids.colector, rule_id: "grieta_alcantarillado" })
    const d = taskData(s)
    // La IA no puede bajar la prioridad de la regla (alta) ni alargar su plazo (3 días); "visita" no ejecuta tareas.
    expect(d).toMatchObject({ priority: "alta", due_in_days: 3, assigned_role: "jefe_obra", finding_id: ids.grieta })
    expect(d.checklist).toEqual(["Pasar cámara CCTV por el tramo", "Instalar fisurómetro en la grieta"])
    expect(d.description).toMatch(/Evidencia: elemento #/)
    for (const o of old) {
      const st = await db.sql<{ status: string }[]>`SELECT status FROM obra_ai_suggestions WHERE id = ${o.id}`
      expect(st[0].status).toBe("superseded")
    }
  })

  it("si la IA falla o no está configurada, cae a reglas, lo indica y conserva lo que la IA ya redactó", async () => {
    const { analyzeObraFinding } = await import("@/app/actions/obra/pins")
    const ai = await import("ai")
    const gen = vi.mocked(ai.generateObject)
    gen.mockReset()
    const aiPending = (await pendingFor(ids.grieta)).filter((s) => s.generator === "ia")
    expect(aiPending).toHaveLength(1)
    gen.mockRejectedValueOnce(new Error("401: API key sk-SECRETA inválida; body {...}"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    actAs(db.users.prevencionista)
    const r = await analyzeObraFinding(ids.grieta, { use_ai: true })
    const a = unwrap(r)
    expect(JSON.stringify(r)).not.toContain("SECRETA")
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRETA")
    spy.mockRestore()
    // La correlación del colector ya tiene una sugerencia de IA pendiente: las reglas no la repiten.
    expect(a.suggestions).toHaveLength(1)
    expect(a.suggestions[0].evidence.correlations![0].element_id).toBe(ids.muro)
    expect(a.suggestions.every((s) => s.generator === "reglas" && s.model === null)).toBe(true)
    expect(a.suggestions[0].evidence.notes?.join(" ")).toMatch(/La IA no respondió/)
    const kept = await db.sql<{ status: string }[]>`SELECT status FROM obra_ai_suggestions WHERE id = ${aiPending[0].id}`
    expect(kept[0].status).toBe("pending")

    await configureAi(false)
    gen.mockReset()
    const b = unwrap(await analyzeObraFinding(ids.grieta, { use_ai: true }))
    expect(gen).not.toHaveBeenCalled()
    expect(b.suggestions.every((s) => s.generator === "reglas")).toBe(true)
    expect(b.suggestions[0].evidence.notes?.join(" ")).toMatch(/no está configurada/)
    const still = await db.sql<{ status: string }[]>`SELECT status FROM obra_ai_suggestions WHERE id = ${aiPending[0].id}`
    expect(still[0].status).toBe("pending")
  })

  it("olor a gas junto a la red: sugerencia crítica y cambio de severidad; el supervisor no puede aprobarlas", async () => {
    const { reportObraFinding } = await import("@/app/actions/obra/pins")
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    actAs(db.users.trabajador)
    const r = unwrap(
      await reportObraFinding(db.projectId, {
        layer_id: ids.arq,
        x: 28 / 40,
        y: 10 / 30,
        title: "Olor a gas en sala de medidores",
        severity: "high",
      }),
    )
    ids.olor = r.finding_id
    expect(r.pin.category).toBe("olor_gas")
    const task = r.suggestions.find((s) => s.kind === "create_task")!
    const sev = r.suggestions.find((s) => s.kind === "update_finding_severity")!
    expect(task.severity).toBe("critical")
    expect(task.evidence.correlations![0]).toMatchObject({ element_id: ids.lineaGas, rule_id: "olor_gas_red_gas", priority: "critica" })
    expect(sev).toMatchObject({ severity: "critical", status: "pending" })
    expect(sev.payload).toMatchObject({ kind: "update_finding_severity", data: { finding_id: r.finding_id, from: "high", to: "critical" } })

    actAs(db.users.supervisor)
    expectError(await approveObraSuggestion(sev.id), DENIED)
    expectError(await approveObraSuggestion(task.id), DENIED)

    actAs(db.users.prevencionista)
    const ap = unwrap(await approveObraSuggestion(sev.id))
    expect(ap).toMatchObject({ applied_entity_type: "finding", applied_entity_id: r.finding_id })
    const f = await db.sql<{ severity: string }[]>`SELECT severity FROM findings WHERE id = ${r.finding_id}`
    expect(f[0].severity).toBe("critical")
    const t = unwrap(await approveObraSuggestion(task.id))
    const row = await db.sql<{ priority: string; due_date: string }[]>`
      SELECT priority, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM obra_tasks WHERE id = ${t.applied_entity_id}`
    expect(row[0]).toEqual({ priority: "critica", due_date: todayISO() })
  })

  it("edited_payload: referencias de otro proyecto se rechazan; una edición válida se aplica y guarda el original", async () => {
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const [s] = await pendingFor(ids.grieta)
    const data = taskData(s)
    actAs(db.users.prevencionista)
    expectError(
      await approveObraSuggestion(s.id, { edited_payload: { ...data, finding_id: ids.otherFinding } }),
      /No se puede cambiar el hallazgo/,
    )
    expectError(await approveObraSuggestion(s.id, { edited_payload: { ...data, finding_id: null } }), /No se puede cambiar el hallazgo/)
    expectError(
      await approveObraSuggestion(s.id, { edited_payload: { ...data, layer_id: ids.otherLayer } }),
      /capa indicada no pertenece/,
    )
    expectError(
      await approveObraSuggestion(s.id, { edited_payload: { kind: "plan_elements", data: { layer_id: ids.arq, elements: [] } } }),
      /no coincide/,
    )
    expectError(await approveObraSuggestion(s.id, { edited_payload: { ...data, title: "" } }), /título/)
    expectError(await approveObraSuggestion(s.id, { edited_payload: { ...data, priority: "urgente" } }), /prioridad/)
    // Nada se aplicó en los intentos fallidos.
    const st = await db.sql<{ status: string }[]>`SELECT status FROM obra_ai_suggestions WHERE id = ${s.id}`
    expect(st[0].status).toBe("pending")

    const r = unwrap(
      await approveObraSuggestion(s.id, {
        edited_payload: { ...data, title: "Inspección CCTV del colector C-3", checklist: ["Grabar el tramo", "Emitir informe"], due_in_days: 10 },
        notes: "Editada por el prevencionista",
      }),
    )
    const t = await db.sql<{ title: string; checklist: unknown; due_date: string }[]>`
      SELECT title, checklist, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM obra_tasks WHERE id = ${r.applied_entity_id}`
    expect(t[0]).toEqual({
      title: "Inspección CCTV del colector C-3",
      checklist: [
        { text: "Grabar el tramo", done: false },
        { text: "Emitir informe", done: false },
      ],
      due_date: addDaysISO(todayISO(), 10),
    })
    expect(taskData(r.suggestion).title).toBe("Inspección CCTV del colector C-3")
    const ev = r.suggestion.evidence as { original_payload?: { data: { title: string } } }
    expect(ev.original_payload?.data.title).toBe(data.title)
    const audit = await db.sql<{ details: { edited: boolean } }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'suggestion.approved' AND entity_id = ${s.id}`
    expect(audit[0].details.edited).toBe(true)
  })

  it("contexto del hallazgo: pin, correlaciones en vivo, sugerencias y tareas vinculadas", async () => {
    const { getObraFindingContext } = await import("@/app/actions/obra/pins")
    actAs(db.users.visita)
    const ctx = unwrap(await getObraFindingContext(ids.grieta))
    expect(ctx.pin.finding_id).toBe(ids.grieta)
    expect(ctx.correlations[0]).toMatchObject({ element_id: ids.colector, relation: "mismo_nivel" })
    expect(ctx.suggestions.length).toBeGreaterThanOrEqual(6)
    const created = ctx.suggestions.map((s) => s.created_at)
    expect([...created].sort().reverse()).toEqual(created)
    expect(ctx.tasks.length).toBe(await taskCount(ids.grieta))

    // El trabajador que lo reportó lo ve, pero solo con las tareas que le tocan.
    actAs(db.users.trabajador)
    const own = unwrap(await getObraFindingContext(ids.grieta))
    expect(own.tasks.every((t) => t.assigned_user_id === db.users.trabajador || (t.assigned_user_id == null && t.assigned_role === "trabajador"))).toBe(true)
    // Un hallazgo que no reportó y que no puede ver: no encontrado.
    const other = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${db.projectId}, ${db.users.gerente}, 'Grieta reportada por otro', 'low', 'open') RETURNING id`
    await db.sql`INSERT INTO obra_finding_pins (finding_id, project_id, layer_id, level, x, y, category, reported_by)
                 VALUES (${other[0].id}, ${db.projectId}, ${ids.arq}, 0, 0.5, 0.5, 'grieta', ${db.users.supervisor})`
    expectError(await getObraFindingContext(Number(other[0].id)), /no encontrado/)
    actAs(db.users.extrano)
    expectError(await getObraFindingContext(ids.grieta), /no encontrado/)
  })

  it("listado de pines: con findings.view todos; el trabajador solo los suyos; filtro por nivel", async () => {
    const { listObraPins } = await import("@/app/actions/obra/pins")
    actAs(db.users.visita)
    const all = unwrap(await listObraPins(db.projectId))
    expect(all.length).toBeGreaterThanOrEqual(3)
    actAs(db.users.trabajador)
    const mine = unwrap(await listObraPins(db.projectId))
    expect(mine.map((p) => p.finding_id).sort()).toEqual([ids.grieta, ids.olor].sort())
    expect(unwrap(await listObraPins(db.projectId, { level: 3 }))).toEqual([])
    expectError(await listObraPins(db.projectId, { level: 1.5 }), /Nivel no válido/)
    actAs(db.users.extrano)
    expectError(await listObraPins(db.projectId), /no encontrado/)
  })

  it("ubicar hallazgos existentes: solo del proyecto, sin pin previo y con findings.view", async () => {
    const { listUnpinnedObraFindings, pinExistingObraFinding } = await import("@/app/actions/obra/pins")
    const legacy = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, description, severity, status)
      VALUES (${db.projectId}, ${db.users.gerente}, 'Humedad en muro del baño', 'Mancha con eflorescencia', 'medium', 'open')
      RETURNING id`
    const legacyId = Number(legacy[0].id)

    actAs(db.users.trabajador)
    expectError(await listUnpinnedObraFindings(db.projectId), DENIED)
    expectError(await pinExistingObraFinding(db.projectId, { finding_id: legacyId, layer_id: ids.arq, x: 0.1, y: 0.1 }), DENIED)

    actAs(db.users.supervisor)
    const unpinned = unwrap(await listUnpinnedObraFindings(db.projectId))
    expect(unpinned.map((f) => f.id)).toContain(legacyId)
    expect(unpinned.map((f) => f.id)).not.toContain(ids.grieta)
    expect(unpinned.map((f) => f.id)).not.toContain(ids.otherFinding)
    expect(unpinned.find((f) => f.id === legacyId)).toMatchObject({ title: "Humedad en muro del baño", severity: "medium", status: "open" })

    expectError(
      await pinExistingObraFinding(db.projectId, { finding_id: ids.otherFinding, layer_id: ids.arq, x: 0.1, y: 0.1 }),
      /no pertenece a esta obra/,
    )
    expectError(
      await pinExistingObraFinding(db.projectId, { finding_id: legacyId, layer_id: ids.otherLayer, x: 0.1, y: 0.1 }),
      /capa indicada no pertenece/,
    )
    const pin = unwrap(await pinExistingObraFinding(db.projectId, { finding_id: legacyId, layer_id: ids.arq, x: 0.1, y: 0.2 }))
    expect(pin).toMatchObject({ finding_id: legacyId, category: "humedad_filtracion", reported_by: db.users.supervisor, x: 0.1, y: 0.2 })
    expectError(
      await pinExistingObraFinding(db.projectId, { finding_id: legacyId, layer_id: ids.arq, x: 0.3, y: 0.3 }),
      /ya está ubicado/,
    )
    expect(unwrap(await listUnpinnedObraFindings(db.projectId)).map((f) => f.id)).not.toContain(legacyId)
  })

  it("valida el reporte: ubicación, textos, severidad, capa y foto", async () => {
    const { reportObraFinding } = await import("@/app/actions/obra/pins")
    const base = { layer_id: ids.arq, x: 0.5, y: 0.5, title: "Desprendimiento de estuco", severity: "low" as const }
    actAs(db.users.supervisor)
    expectError(await reportObraFinding(db.projectId, { ...base, x: 1.5 }), /ubicación en el plano/)
    expectError(await reportObraFinding(db.projectId, { ...base, y: Number.NaN }), /ubicación en el plano/)
    expectError(await reportObraFinding(db.projectId, { ...base, title: "ab" }), /título debe tener entre 3 y 200/)
    expectError(await reportObraFinding(db.projectId, { ...base, severity: "grave" as never }), /Severidad no válida/)
    expectError(await reportObraFinding(db.projectId, { ...base, category: "inventada" as never }), /Categoría/)
    expectError(await reportObraFinding(db.projectId, { ...base, layer_id: ids.otherLayer }), /capa indicada no pertenece/)
    expectError(await reportObraFinding(db.projectId, { ...base, layer_id: ids.deletedLayer }), /fue eliminada/)
    expectError(await reportObraFinding(db.projectId, { ...base, description: "x".repeat(4001) }), /como máximo 4000/)
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64")}`
    expectError(await reportObraFinding(db.projectId, { ...base, photo_data_url: svg }), /PNG, JPG o WebP/)
    const fake = `data:image/png;base64,${Buffer.from("<svg onload=alert(1)>no soy un png</svg>").toString("base64")}`
    expectError(await reportObraFinding(db.projectId, { ...base, photo_data_url: fake }), /no coincide/)
    actAs(db.users.visita)
    expectError(await reportObraFinding(db.projectId, base), DENIED)

    actAs(db.users.supervisor)
    const ok = unwrap(
      await reportObraFinding(db.projectId, { ...base, category: "desprendimiento", photo_data_url: pngDataUrl(40, 30) }),
    )
    expect(ok.pin.category).toBe("desprendimiento")
    expect(ok.suggestions).toEqual([])
    const f = await db.sql<{ photos: string[] }[]>`SELECT photos FROM findings WHERE id = ${ok.finding_id}`
    expect(f[0].photos).toHaveLength(1)
    expect(f[0].photos[0].startsWith("data:image/png;base64,")).toBe(true)
  })

  it("si la capa cambia de nivel, sus pines la acompañan y la correlación pasa a 'nivel inferior'", async () => {
    const { updateObraLayer } = await import("@/app/actions/obra/layers")
    const { listObraPins, getObraFindingContext } = await import("@/app/actions/obra/pins")
    actAs(db.users.jefe_obra)
    unwrap(await updateObraLayer(ids.arq, { level: 1 }))
    const pins = unwrap(await listObraPins(db.projectId, { level: 1 }))
    expect(pins.map((p) => p.finding_id)).toContain(ids.grieta)
    const ctx = unwrap(await getObraFindingContext(ids.grieta))
    expect(ctx.pin.level).toBe(1)
    expect(ctx.correlations[0]).toMatchObject({ element_id: ids.colector, relation: "nivel_inferior" })
    const t = await db.sql<{ level: number }[]>`SELECT DISTINCT level FROM obra_tasks WHERE layer_id = ${ids.arq}`
    expect(t.map((r) => r.level)).toEqual([1])
  })
})
