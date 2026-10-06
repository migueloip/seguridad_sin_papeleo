// @vitest-environment node
/**
 * Bandeja de sugerencias con aprobación humana, contra Postgres real:
 * detección de elementos con IA (solo sugiere), aprobación de plan_elements
 * (con y sin edición), cambio de severidad, listado y filtros, y payloads
 * inválidos o ajenos.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActionResult, AiSuggestion, PlanElementsPayload } from "@/lib/obra/types"
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

function elementsData(s: AiSuggestion): PlanElementsPayload {
  if (s.payload.kind !== "plan_elements") throw new Error("se esperaba plan_elements")
  return s.payload.data
}

const DENIED = /no permite/
const NOT_CONFIGURED = "La IA no está configurada para esta obra: el gerente debe configurar la API key en Configuración."

/** Respuesta simulada del modelo de visión: 2 válidos y 3 que deben descartarse. */
const VISION_OUTPUT = {
  elements: [
    {
      element_type: "tuberia_alcantarillado",
      label: "C-1",
      geometry_type: "polyline",
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
      diameter_mm: 160,
      confidence: 0.9,
    },
    { element_type: "camara_inspeccion", label: null, geometry_type: "point", points: [{ x: 0.1, y: 0.5 }], diameter_mm: null, confidence: 0.7 },
    // Fuera de la lámina.
    { element_type: "tuberia_alcantarillado", label: "X", geometry_type: "polyline", points: [{ x: 1.5, y: 0.2 }, { x: 0.2, y: 0.2 }], diameter_mm: null, confidence: 0.5 },
    // Tipo de otra especialidad.
    { element_type: "muro", label: null, geometry_type: "polyline", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }], diameter_mm: null, confidence: 0.9 },
    // Polilínea de un punto.
    { element_type: "tuberia_alcantarillado", label: null, geometry_type: "polyline", points: [{ x: 0.3, y: 0.3 }], diameter_mm: null, confidence: 0.9 },
  ],
}

describe.skipIf(!HAS_TEST_DB)("sugerencias de IA con aprobación humana (BD real)", () => {
  let db: TestDb
  const ids = { alc: 0, alc2: 0, plain: 0, otherLayer: 0, finding: 0, otherFinding: 0 }

  async function gen() {
    const ai = await import("ai")
    return vi.mocked(ai.generateObject)
  }

  async function configureAi(on: boolean) {
    await db.sql`DELETE FROM settings WHERE user_id = ${db.users.gerente} AND key = 'ai_api_key'`
    if (on) await db.sql`INSERT INTO settings (user_id, key, value) VALUES (${db.users.gerente}, 'ai_api_key', 'clave-de-prueba')`
  }

  async function elementCount(layerId: number): Promise<number> {
    const r = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_plan_elements WHERE layer_id = ${layerId}`
    return r[0].n
  }

  async function insertSuggestion(
    kind: string,
    severity: string,
    payload: unknown,
    extra: { finding_id?: number; layer_id?: number; generator?: "ia" | "reglas" } = {},
  ) {
    // Sin generator explícito queda el default de la tabla ('reglas').
    const r = await db.sql<{ id: number }[]>`
      INSERT INTO obra_ai_suggestions (project_id, kind, title, severity, payload, finding_id, layer_id, requested_by, generator, model)
      VALUES (${db.projectId}, ${kind}, 'Sugerencia de prueba', ${severity}, ${db.sql.json(payload as never)},
              ${extra.finding_id ?? null}, ${extra.layer_id ?? null}, ${db.users.supervisor},
              ${extra.generator ?? "reglas"}, ${extra.generator === "ia" ? "google/gemini-2.5-flash" : null})
      RETURNING id`
    return Number(r[0].id)
  }

  beforeAll(async () => {
    delete process.env.AI_API_KEY
    delete process.env.GOOGLE_API_KEY
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_KEY
    db = await setupObraTestDb("suggestions_int_test")
    const { createObraLayer } = await import("@/app/actions/obra/layers")
    actAs(db.users.gerente)
    const image = { data_url: pngDataUrl(1000, 1000), width_px: 1000, height_px: 1000 }
    ids.alc = unwrap(await createObraLayer(db.projectId, { name: "Alcantarillado N1", discipline: "alcantarillado", level: 0, image })).id
    ids.alc2 = unwrap(await createObraLayer(db.projectId, { name: "Alcantarillado N2", discipline: "alcantarillado", level: 1, image })).id
    ids.plain = unwrap(await createObraLayer(db.projectId, { name: "Sin lámina", discipline: "otro", level: 0 })).id
    const ol = await db.sql<{ id: number }[]>`
      INSERT INTO obra_plan_layers (project_id, name, discipline, level) VALUES (${db.otherProjectId}, 'Capa ajena', 'otro', 0) RETURNING id`
    ids.otherLayer = Number(ol[0].id)
    const f = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${db.projectId}, ${db.users.gerente}, 'Hundimiento en vereda', 'medium', 'open') RETURNING id`
    ids.finding = Number(f[0].id)
    const of = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${db.otherProjectId}, ${db.users.extrano}, 'Hallazgo ajeno', 'low', 'open') RETURNING id`
    ids.otherFinding = Number(of[0].id)
  })
  afterAll(async () => {
    await db?.close()
  })

  it("detección con IA: sin IA configurada responde un mensaje claro; sin ai.request, 403; sin lámina, error", async () => {
    const { requestObraLayerExtraction } = await import("@/app/actions/obra/elements")
    const g = await gen()
    g.mockReset()
    await configureAi(false)
    actAs(db.users.supervisor)
    const r = await requestObraLayerExtraction(ids.alc)
    expect(r).toEqual({ ok: false, error: NOT_CONFIGURED })
    for (const role of ["trabajador", "visita"] as const) {
      actAs(db.users[role])
      expectError(await requestObraLayerExtraction(ids.alc), DENIED)
    }
    actAs(db.users.jefe_obra)
    expectError(await requestObraLayerExtraction(ids.plain), /no tiene imagen/)
    expect(g).not.toHaveBeenCalled()
  })

  it("detección con IA: crea UNA sugerencia plan_elements pendiente y no inserta elementos", async () => {
    const { requestObraLayerExtraction } = await import("@/app/actions/obra/elements")
    const g = await gen()
    g.mockReset()
    await configureAi(true)
    g.mockResolvedValueOnce({ object: VISION_OUTPUT } as never)
    actAs(db.users.supervisor)
    const r = unwrap(await requestObraLayerExtraction(ids.alc))
    expect(r.element_count).toBe(2)
    expect(g).toHaveBeenCalledTimes(1)
    const call = g.mock.calls[0][0] as unknown as { messages: Array<{ content: Array<{ type: string; text?: string; mediaType?: string }> }> }
    const parts = call.messages[0].content
    expect(parts.find((p) => p.type === "image")?.mediaType).toBe("image/png")
    expect(parts.find((p) => p.type === "text")?.text).toMatch(/SOLO los elementos de esta especialidad/)
    expect(parts.find((p) => p.type === "text")?.text).toMatch(/revisado y aprobado por una persona/)

    expect(await elementCount(ids.alc)).toBe(0)
    const { listObraSuggestions } = await import("@/app/actions/obra/suggestions")
    actAs(db.users.visita)
    const list = unwrap(await listObraSuggestions(db.projectId, { status: ["pending"] }))
    const s = list.find((x) => x.id === r.suggestion_id)!
    expect(s).toMatchObject({
      kind: "plan_elements",
      status: "pending",
      generator: "ia",
      model: "google/gemini-2.5-flash",
      severity: "low",
      layer_id: ids.alc,
      requested_by: db.users.supervisor,
      evidence: { layer_id: ids.alc },
    })
    expect(s.confidence).toBeCloseTo(0.8, 5)
    const d = elementsData(s)
    expect(d.layer_id).toBe(ids.alc)
    expect(d.elements).toHaveLength(2)
    expect(d.elements[0]).toMatchObject({ element_type: "tuberia_alcantarillado", label: "C-1", attributes: { diameter_mm: 160 }, confidence: 0.9 })
  })

  it("una nueva detección reemplaza la pendiente anterior; fallas de la IA no filtran detalles", async () => {
    const { requestObraLayerExtraction } = await import("@/app/actions/obra/elements")
    const g = await gen()
    g.mockReset()
    const before = await db.sql<{ id: number }[]>`
      SELECT id FROM obra_ai_suggestions WHERE layer_id = ${ids.alc} AND status = 'pending'`
    expect(before).toHaveLength(1)
    g.mockResolvedValueOnce({ object: VISION_OUTPUT } as never)
    actAs(db.users.prevencionista)
    const r = unwrap(await requestObraLayerExtraction(ids.alc))
    const st = await db.sql<{ status: string }[]>`SELECT status FROM obra_ai_suggestions WHERE id = ${before[0].id}`
    expect(st[0].status).toBe("superseded")
    expect(r.suggestion_id).not.toBe(before[0].id)

    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    g.mockRejectedValueOnce(new Error("Invalid API key: clave-de-prueba (request body …)"))
    const fail = await requestObraLayerExtraction(ids.alc)
    expect(fail).toEqual({ ok: false, error: "La IA no pudo analizar el plano. Intenta de nuevo más tarde." })
    expect(JSON.stringify(spy.mock.calls)).not.toContain("clave-de-prueba")
    spy.mockRestore()

    g.mockResolvedValueOnce({ object: { elements: [VISION_OUTPUT.elements[3]] } } as never)
    expectError(await requestObraLayerExtraction(ids.alc), /no detectó elementos/)
    // Las fallas no reemplazaron la pendiente vigente.
    const pending = await db.sql<{ id: number }[]>`
      SELECT id FROM obra_ai_suggestions WHERE layer_id = ${ids.alc} AND status = 'pending'`
    expect(pending.map((p) => Number(p.id))).toEqual([r.suggestion_id])
  })

  it("aprobar plan_elements editado: se insertan solo los marcados, con source 'ia' y suggestion_id", async () => {
    const { approveObraSuggestion, listObraSuggestions } = await import("@/app/actions/obra/suggestions")
    actAs(db.users.jefe_obra)
    const [s] = unwrap(await listObraSuggestions(db.projectId, { status: ["pending"] })).filter((x) => x.kind === "plan_elements")
    const d = elementsData(s)
    // El revisor desmarca la cámara.
    const edited = { layer_id: d.layer_id, elements: d.elements.filter((e) => e.element_type !== "camara_inspeccion") }
    // Editar no puede llevar los elementos a otra capa (ni ajena ni de la misma obra).
    expectError(await approveObraSuggestion(s.id, { edited_payload: { ...edited, layer_id: ids.otherLayer } }), /No se puede cambiar la capa/)
    expectError(await approveObraSuggestion(s.id, { edited_payload: { ...edited, layer_id: ids.plain } }), /No se puede cambiar la capa/)
    expectError(await approveObraSuggestion(s.id, { edited_payload: { ...edited, elements: [] } }), /al menos un elemento/)
    expect(await elementCount(ids.alc)).toBe(0)

    const r = unwrap(await approveObraSuggestion(s.id, { edited_payload: edited, notes: "Se descartó la cámara: no existe." }))
    expect(r).toMatchObject({ applied_entity_type: "layer", applied_entity_id: ids.alc })
    expect(r.suggestion).toMatchObject({ status: "approved", reviewed_by: db.users.jefe_obra, review_notes: "Se descartó la cámara: no existe." })
    expect(elementsData(r.suggestion).elements).toHaveLength(1)
    const ev = r.suggestion.evidence as { original_payload?: { data: PlanElementsPayload } }
    expect(ev.original_payload?.data.elements).toHaveLength(2)

    const rows = await db.sql<{ element_type: string; source: string; suggestion_id: number; confidence: number; created_by: number; label: string }[]>`
      SELECT element_type, source, suggestion_id, confidence, created_by, label FROM obra_plan_elements WHERE layer_id = ${ids.alc}`
    expect(rows).toEqual([
      { element_type: "tuberia_alcantarillado", source: "ia", suggestion_id: s.id, confidence: 0.9, created_by: db.users.jefe_obra, label: "C-1" },
    ])
    expectError(await approveObraSuggestion(s.id), /ya fue revisada/)
    expect(await elementCount(ids.alc)).toBe(1)
    const audit = await db.sql<{ details: Record<string, unknown> }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'suggestion.approved' AND entity_id = ${s.id}`
    expect(audit[0].details).toMatchObject({ kind: "plan_elements", edited: true, inserted: 1, applied_entity_type: "layer" })
  })

  it("dos aprobaciones concurrentes de plan_elements insertan los elementos una sola vez (FOR UPDATE)", async () => {
    const { requestObraLayerExtraction } = await import("@/app/actions/obra/elements")
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const g = await gen()
    g.mockReset()
    g.mockResolvedValueOnce({ object: VISION_OUTPUT } as never)
    actAs(db.users.prevencionista)
    const r = unwrap(await requestObraLayerExtraction(ids.alc))
    const before = await elementCount(ids.alc)
    const results = await Promise.all([approveObraSuggestion(r.suggestion_id), approveObraSuggestion(r.suggestion_id)])
    expect(results.filter((x) => x.ok)).toHaveLength(1)
    expect(results.find((x) => !x.ok)).toEqual({ ok: false, error: "Esta sugerencia ya fue revisada." })
    expect(await elementCount(ids.alc)).toBe(before + 2)
    const bySuggestion = await db.sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM obra_plan_elements WHERE suggestion_id = ${r.suggestion_id}`
    expect(bySuggestion[0].n).toBe(2)
  })

  it("plan_elements sobre una capa eliminada no se aplica: al borrar la capa la sugerencia queda sin efecto", async () => {
    const { requestObraLayerExtraction } = await import("@/app/actions/obra/elements")
    const { deleteObraLayer } = await import("@/app/actions/obra/layers")
    const { approveObraSuggestion, rejectObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const g = await gen()
    g.mockReset()
    g.mockResolvedValueOnce({ object: VISION_OUTPUT } as never)
    actAs(db.users.prevencionista)
    const r = unwrap(await requestObraLayerExtraction(ids.alc2))
    unwrap(await deleteObraLayer(ids.alc2))
    const st = await db.sql<{ status: string }[]>`SELECT status FROM obra_ai_suggestions WHERE id = ${r.suggestion_id}`
    expect(st[0].status).toBe("superseded")
    expectError(await approveObraSuggestion(r.suggestion_id), /quedó sin efecto/)
    expectError(await rejectObraSuggestion(r.suggestion_id, "La capa se eliminó."), /quedó sin efecto/)
    const audit = await db.sql<{ details: { superseded_suggestion_ids?: number[] } }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'layer.deleted' AND entity_id = ${ids.alc2}`
    expect(audit[0].details.superseded_suggestion_ids).toEqual([r.suggestion_id])
  })

  it("update_finding_severity: aplica el cambio; no permite cambiar de hallazgo; las críticas exigen perfil autorizado", async () => {
    const { approveObraSuggestion, rejectObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const payload = { kind: "update_finding_severity", data: { finding_id: ids.finding, from: "medium", to: "critical", reason: "Colector a 1 m." } }
    const id = await insertSuggestion("update_finding_severity", "critical", payload, { finding_id: ids.finding })

    actAs(db.users.supervisor)
    expectError(await approveObraSuggestion(id), DENIED)
    expectError(await rejectObraSuggestion(id), DENIED)

    actAs(db.users.prevencionista)
    expectError(
      await approveObraSuggestion(id, { edited_payload: { ...payload.data, finding_id: ids.otherFinding } }),
      /No se puede cambiar el hallazgo/,
    )
    expectError(await approveObraSuggestion(id, { edited_payload: { ...payload.data, to: "medium" } }), /distinta de la actual/)
    const r = unwrap(await approveObraSuggestion(id, { edited_payload: { ...payload.data, to: "high" } }))
    expect(r).toMatchObject({ applied_entity_type: "finding", applied_entity_id: ids.finding })
    const f = await db.sql<{ severity: string }[]>`SELECT severity FROM findings WHERE id = ${ids.finding}`
    expect(f[0].severity).toBe("high")
    const audit = await db.sql<{ details: Record<string, unknown> }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'suggestion.approved' AND entity_id = ${id}`
    expect(audit[0].details).toMatchObject({ previous_severity: "medium", new_severity: "high", edited: true })

    // Un payload que apunta a un hallazgo de otra obra nunca se aplica.
    const foreign = await insertSuggestion(
      "update_finding_severity",
      "high",
      { finding_id: ids.otherFinding, from: "low", to: "high", reason: "x" },
      { finding_id: ids.otherFinding },
    )
    expectError(await approveObraSuggestion(foreign), /no pertenece a esta obra/)
    const of = await db.sql<{ severity: string }[]>`SELECT severity FROM findings WHERE id = ${ids.otherFinding}`
    expect(of[0].severity).toBe("low")
  })

  it("payload guardado inválido: solo se aprueba editándolo; create_task ajeno se rechaza", async () => {
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const broken = await insertSuggestion("create_task", "medium", {})
    actAs(db.users.gerente)
    expectError(await approveObraSuggestion(broken), /datos inválidos/)
    const r = unwrap(
      await approveObraSuggestion(broken, { edited_payload: { title: "Revisar vereda hundida", checklist: ["Medir"], due_in_days: 2 } }),
    )
    expect(r.applied_entity_type).toBe("task")
    const t = await db.sql<{ origin: string; suggestion_id: number; title: string }[]>`
      SELECT origin, suggestion_id, title FROM obra_tasks WHERE id = ${r.applied_entity_id}`
    // La sugerencia de prueba es del motor de reglas (default de generator).
    expect(t[0]).toEqual({ origin: "reglas", suggestion_id: broken, title: "Revisar vereda hundida" })

    const foreignTask = await insertSuggestion(
      "create_task",
      "low",
      { title: "Tarea con referencias ajenas", finding_id: ids.otherFinding },
      { finding_id: ids.otherFinding },
    )
    expectError(await approveObraSuggestion(foreignTask), /hallazgo indicado no pertenece/)
    const sameId = await insertSuggestion("create_task", "low", { title: "Capa ajena", layer_id: ids.otherLayer })
    expectError(await approveObraSuggestion(sameId), /capa indicada no pertenece/)
  })

  it("update_finding_severity con datos viejos: si el hallazgo cambió o se resolvió, no se aplica", async () => {
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const f = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${db.projectId}, ${db.users.gerente}, 'Grieta en losa', 'medium', 'open') RETURNING id`
    const fid = Number(f[0].id)
    const payload = { kind: "update_finding_severity", data: { finding_id: fid, from: "medium", to: "critical", reason: "x" } }
    const id = await insertSuggestion("update_finding_severity", "critical", payload, { finding_id: fid })
    actAs(db.users.prevencionista)
    await db.sql`UPDATE findings SET severity = 'low' WHERE id = ${fid}`
    expectError(await approveObraSuggestion(id), /cambió desde que se generó/)
    await db.sql`UPDATE findings SET severity = 'medium', status = 'resolved' WHERE id = ${fid}`
    expectError(await approveObraSuggestion(id), /resuelto o cerrado/)
    const row = await db.sql<{ severity: string; status: string }[]>`SELECT severity, status FROM findings WHERE id = ${fid}`
    expect(row[0]).toEqual({ severity: "medium", status: "resolved" })
  })

  it("una tarea o un cambio de severidad cuyo hallazgo se borró queda fuera de la bandeja y no se aplica", async () => {
    const { approveObraSuggestion, listObraSuggestions } = await import("@/app/actions/obra/suggestions")
    const { getObraDashboard } = await import("@/app/actions/obra/dashboard")
    const f = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${db.projectId}, ${db.users.gerente}, 'Hallazgo que se borrará', 'high', 'open') RETURNING id`
    const fid = Number(f[0].id)
    const id = await insertSuggestion(
      "create_task",
      "critical",
      { title: "Revisar algo", priority: "critica", finding_id: fid },
      { finding_id: fid },
    )
    actAs(db.users.gerente)
    const before = unwrap(await getObraDashboard(db.projectId)).counts.pending_critical_suggestions
    await db.sql`DELETE FROM findings WHERE id = ${fid}`
    const after = unwrap(await getObraDashboard(db.projectId)).counts.pending_critical_suggestions
    expect(after).toBe(before - 1)
    const pending = unwrap(await listObraSuggestions(db.projectId, { status: ["pending"] }))
    expect(pending.some((s) => s.id === id)).toBe(false)
    expectError(await approveObraSuggestion(id), /fue eliminado/)
  })

  it("subir la prioridad al editar eleva la severidad efectiva revisada (queda auditada como crítica)", async () => {
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const id = await insertSuggestion("create_task", "low", { title: "Revisar cámara", priority: "baja" })
    actAs(db.users.prevencionista)
    const r = unwrap(await approveObraSuggestion(id, { edited_payload: { title: "Revisar cámara YA", priority: "critica", due_in_days: 0 } }))
    const audit = await db.sql<{ details: { severity: string } }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'suggestion.approved' AND entity_id = ${id}`
    expect(audit[0].details.severity).toBe("critical")
    const t = await db.sql<{ priority: string }[]>`SELECT priority FROM obra_tasks WHERE id = ${r.applied_entity_id}`
    expect(t[0].priority).toBe("critica")
  })

  it("origen de la tarea aprobada: 'reglas' si la redactó el motor de reglas e 'ia' si la redactó un modelo", async () => {
    const { approveObraSuggestion } = await import("@/app/actions/obra/suggestions")
    const { listObraTasks } = await import("@/app/actions/obra/tasks")
    const data = { title: "Revisar colector bajo vereda", priority: "media", due_in_days: 3, finding_id: ids.finding, checklist: ["Inspeccionar"] }
    const byRules = await insertSuggestion("create_task", "medium", { kind: "create_task", data }, { finding_id: ids.finding, generator: "reglas" })
    const byAi = await insertSuggestion(
      "create_task",
      "medium",
      { kind: "create_task", data: { ...data, title: "Sellar fisura junto a cámara" } },
      { finding_id: ids.finding, generator: "ia" },
    )
    const byAiEdited = await insertSuggestion(
      "create_task",
      "low",
      { kind: "create_task", data: { ...data, title: "Medir hundimiento", priority: "baja" } },
      { finding_id: ids.finding, generator: "ia" },
    )

    actAs(db.users.jefe_obra)
    const rr = unwrap(await approveObraSuggestion(byRules))
    const ra = unwrap(await approveObraSuggestion(byAi))
    // Editar una redactada por IA no cambia quién la redactó.
    const re = unwrap(await approveObraSuggestion(byAiEdited, { edited_payload: { ...data, title: "Medir hundimiento con nivel" } }))

    const rows = await db.sql<{ id: number; origin: string; suggestion_id: number }[]>`
      SELECT id, origin, suggestion_id FROM obra_tasks
      WHERE id IN ${db.sql([rr.applied_entity_id!, ra.applied_entity_id!, re.applied_entity_id!])} ORDER BY id`
    expect(rows.map((r) => [Number(r.suggestion_id), r.origin])).toEqual([
      [byRules, "reglas"],
      [byAi, "ia"],
      [byAiEdited, "ia"],
    ])
    // El DTO también lo trae (la UI decide el texto con origin).
    const tasks = unwrap(await listObraTasks(db.projectId))
    expect(tasks.find((t) => t.id === rr.applied_entity_id)).toMatchObject({ origin: "reglas", suggestion_id: byRules })
    expect(tasks.find((t) => t.id === ra.applied_entity_id)).toMatchObject({ origin: "ia", suggestion_id: byAi })

    const audit = await db.sql<{ action: string; entity_id: number; details: Record<string, unknown> }[]>`
      SELECT action, entity_id, details FROM obra_audit_log
      WHERE (action = 'task.created' AND entity_id IN ${db.sql([rr.applied_entity_id!, ra.applied_entity_id!])})
         OR (action = 'suggestion.approved' AND entity_id IN ${db.sql([byRules, byAi])})`
    const created = Object.fromEntries(audit.filter((a) => a.action === "task.created").map((a) => [Number(a.entity_id), a.details]))
    expect(created[rr.applied_entity_id!]).toMatchObject({ origin: "reglas", suggestion_id: byRules })
    expect(created[ra.applied_entity_id!]).toMatchObject({ origin: "ia", suggestion_id: byAi })
    const approved = Object.fromEntries(audit.filter((a) => a.action === "suggestion.approved").map((a) => [Number(a.entity_id), a.details]))
    expect(approved[byRules]).toMatchObject({ generator: "reglas", task_origin: "reglas" })
    expect(approved[byAi]).toMatchObject({ generator: "ia", task_origin: "ia" })
  })

  it("listado: findings.view, filtros validados y límite", async () => {
    const { listObraSuggestions } = await import("@/app/actions/obra/suggestions")
    actAs(db.users.trabajador)
    expectError(await listObraSuggestions(db.projectId), DENIED)
    actAs(db.users.visita)
    const all = unwrap(await listObraSuggestions(db.projectId))
    expect(all.length).toBeGreaterThanOrEqual(6)
    expect(all.every((s) => s.project_id === db.projectId)).toBe(true)
    const byFinding = unwrap(await listObraSuggestions(db.projectId, { finding_id: ids.finding }))
    expect(byFinding.length).toBeGreaterThanOrEqual(1)
    expect(byFinding.every((s) => s.finding_id === ids.finding)).toBe(true)
    const approved = unwrap(await listObraSuggestions(db.projectId, { status: ["approved"], limit: 2 }))
    expect(approved).toHaveLength(2)
    expect(approved.every((s) => s.status === "approved" && s.reviewed_at !== null)).toBe(true)
    expectError(await listObraSuggestions(db.projectId, { status: ["aprobada" as never] }), /Estado de sugerencia no válido/)
    expectError(await listObraSuggestions(db.projectId, { limit: 0 }), /límite/)
    expectError(await listObraSuggestions(db.projectId, { limit: 1000 }), /límite/)
    expectError(await listObraSuggestions(db.projectId, { finding_id: -3 }), /Hallazgo no válido/)
  })

  it("detección con IA y aprobación simultáneas no se interbloquean (sugerencia → capa en ambos caminos)", async () => {
    const { requestObraLayerExtraction } = await import("@/app/actions/obra/elements")
    const g = await gen()
    g.mockReset()
    g.mockResolvedValue({ object: VISION_OUTPUT } as never)
    await configureAi(true)
    actAs(db.users.prevencionista)
    const first = unwrap(await requestObraLayerExtraction(ids.alc))
    // Simula approveSuggestion: bloquea la sugerencia, espera y después bloquea la capa.
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const approval = db.sql.begin(async (t) => {
      const q = t as unknown as typeof db.sql
      await q`SELECT id FROM obra_ai_suggestions WHERE id = ${first.suggestion_id} FOR UPDATE`
      await gate
      await q`SELECT id FROM obra_plan_layers WHERE id = ${ids.alc} FOR UPDATE`
    })
    await new Promise((r) => setTimeout(r, 50))
    const extraction = requestObraLayerExtraction(ids.alc)
    await new Promise((r) => setTimeout(r, 300))
    release()
    await approval
    const r = await extraction
    expect(r.ok).toBe(true)
    const st = await db.sql<{ status: string }[]>`SELECT status FROM obra_ai_suggestions WHERE id = ${first.suggestion_id}`
    expect(st[0].status).toBe("superseded")
    g.mockReset()
  })

  it("límite de uso de IA: pasado el máximo por hora no se llama al modelo", async () => {
    const { requestObraLayerExtraction } = await import("@/app/actions/obra/elements")
    const g = await gen()
    g.mockReset()
    await configureAi(true)
    for (let k = 0; k < 10; k++) {
      await db.sql`INSERT INTO obra_audit_log (project_id, actor_user_id, action, entity_type, entity_id)
                   VALUES (${db.projectId}, ${db.users.supervisor}, 'layer.extraction_requested', 'layer', ${ids.alc})`
    }
    actAs(db.users.supervisor)
    expectError(await requestObraLayerExtraction(ids.alc), /máximo de 10 detecciones con IA en láminas por hora/)
    expect(g).not.toHaveBeenCalled()
    await db.sql`DELETE FROM obra_audit_log WHERE actor_user_id = ${db.users.supervisor} AND action = 'layer.extraction_requested'`
  })

  it("la BD garantiza que no hay sugerencias aprobadas o rechazadas sin revisión humana", async () => {
    const bad = await db.sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM obra_ai_suggestions
      WHERE status IN ('approved', 'rejected') AND (reviewed_at IS NULL OR reviewed_by IS NULL)`
    expect(bad[0].n).toBe(0)
  })
})
