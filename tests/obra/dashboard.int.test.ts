// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { addDaysISO, todayISO } from "@/lib/obra/metrics"
import type { ActionResult } from "@/lib/obra/types"
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

describe.skipIf(!HAS_TEST_DB)("tablero y auditoría de obra (BD real)", () => {
  let db: TestDb
  const today = todayISO()
  const yesterday = addDaysISO(today, -1)
  let nextInspectionId = 0

  beforeAll(async () => {
    db = await setupObraTestDb("dashboard_int_test")
    const pid = db.projectId
    const owner = db.users.gerente

    // Hallazgos: 1 crítico, 2 altos, 1 medio abiertos; 1 resuelto; 1 de otra obra.
    for (const [sev, status] of [
      ["critical", "open"],
      ["high", "open"],
      ["high", "in_progress"],
      ["medium", "open"],
      ["low", "resolved"],
    ] as const) {
      await db.sql`INSERT INTO findings (project_id, user_id, title, severity, status)
                   VALUES (${pid}, ${owner}, ${`Hallazgo ${sev}`}, ${sev}, ${status})`
    }
    await db.sql`INSERT INTO findings (project_id, user_id, title, severity, status)
                 VALUES (${db.otherProjectId}, ${db.users.extrano}, 'Ajeno', 'critical', 'open')`

    // Tareas.
    const t = async (title: string, extra: { status?: string; due?: string | null; role?: string | null; user?: number | null }) => {
      await db.sql`
        INSERT INTO obra_tasks (project_id, title, status, due_date, assigned_role, assigned_user_id, created_by)
        VALUES (${pid}, ${title}, ${extra.status ?? "pendiente"}, ${extra.due ?? null}::date, ${extra.role ?? null},
                ${extra.user ?? null}, ${owner})`
    }
    await t("Vencida del trabajador", { due: yesterday, user: db.users.trabajador })
    await t("Rol trabajador", { role: "trabajador" })
    await t("Vencida del supervisor", { due: yesterday, role: "supervisor" })
    await t("En progreso jefe", { status: "en_progreso", user: db.users.jefe_obra })
    await t("Hecha", { status: "hecha", user: db.users.trabajador })
    await t("Cancelada", { status: "cancelada" })

    // Sugerencias pendientes (una crítica) y una ya revisada.
    await db.sql`INSERT INTO obra_ai_suggestions (project_id, kind, status, title, severity, payload)
                 VALUES (${pid}, 'create_task', 'pending', 'Sugerencia alta', 'high', ${db.sql.json({ kind: "create_task", data: { title: "x" } })})`
    await db.sql`INSERT INTO obra_ai_suggestions (project_id, kind, status, title, severity, payload)
                 VALUES (${pid}, 'create_task', 'pending', 'Sugerencia crítica', 'critical', '{"title":"y"}'::jsonb)`
    await db.sql`INSERT INTO obra_ai_suggestions (project_id, kind, status, title, severity, payload, reviewed_at, reviewed_by)
                 VALUES (${pid}, 'create_task', 'rejected', 'Rechazada', 'low', '{}'::jsonb, CURRENT_TIMESTAMP, ${owner})`

    // Capa con elementos, pin y revisiones.
    const layer = await db.sql<{ id: number }[]>`
      INSERT INTO obra_plan_layers (project_id, name, discipline, level, image_data)
      VALUES (${pid}, 'Arquitectura N1', 'arquitectura', 0, 'data:image/png;base64,AAAA') RETURNING id`
    await db.sql`INSERT INTO obra_plan_layers (project_id, name, discipline, level, deleted_at)
                 VALUES (${pid}, 'Borrada', 'gas', 0, CURRENT_TIMESTAMP)`
    for (let k = 0; k < 3; k++) {
      await db.sql`INSERT INTO obra_plan_elements (layer_id, project_id, element_type, geometry)
                   VALUES (${layer[0].id}, ${pid}, 'muro', '{"type":"point","points":[{"x":0.1,"y":0.1}]}'::jsonb)`
    }
    const f = await db.sql<{ id: number }[]>`SELECT id FROM findings WHERE project_id = ${pid} ORDER BY id LIMIT 1`
    await db.sql`INSERT INTO obra_finding_pins (finding_id, project_id, layer_id, level, x, y, category)
                 VALUES (${f[0].id}, ${pid}, ${layer[0].id}, 0, 0.5, 0.5, 'grieta')`
    await db.sql`INSERT INTO obra_inspections (project_id, title, scheduled_for) VALUES (${pid}, 'Atrasada', ${addDaysISO(today, -5)}::date)`
    const ni = await db.sql<{ id: number }[]>`
      INSERT INTO obra_inspections (project_id, title, scheduled_for) VALUES (${pid}, 'Próxima', ${addDaysISO(today, 3)}::date) RETURNING id`
    nextInspectionId = Number(ni[0].id)
    await db.sql`INSERT INTO obra_inspections (project_id, title, scheduled_for) VALUES (${pid}, 'Lejana', ${addDaysISO(today, 10)}::date)`

    // Auditoría: 15 entradas.
    for (let k = 0; k < 15; k++) {
      await db.sql`INSERT INTO obra_audit_log (project_id, actor_user_id, action, entity_type, entity_id, details)
                   VALUES (${pid}, ${owner}, ${`test.${k}`}, 'task', ${k}, ${db.sql.json({ k })})`
    }
    await db.sql`INSERT INTO obra_audit_log (project_id, actor_user_id, action, entity_type)
                 VALUES (${db.otherProjectId}, ${db.users.extrano}, 'ajeno', 'task')`
  })
  afterAll(async () => {
    await db?.close()
  })

  it("gerente: conteos completos, riesgo, aprobaciones críticas primero y actividad", async () => {
    const { getObraDashboard } = await import("@/app/actions/obra/dashboard")
    actAs(db.users.gerente)
    const d = unwrap(await getObraDashboard(db.projectId))
    expect(d.access).toMatchObject({ role: "gerente", is_owner: true, project_id: db.projectId })
    expect(d.access.permissions).toContain("members.manage")
    expect(d.counts).toEqual({
      open_tasks: 4,
      overdue_tasks: 2,
      my_open_tasks: 0,
      pending_suggestions: 2,
      pending_critical_suggestions: 1,
      open_findings: 4,
      pinned_findings: 1,
      layers: 1,
      elements: 3,
      members: 6,
    })
    expect(d.findings_by_severity).toEqual({ low: 0, medium: 1, high: 2, critical: 1 })
    expect(d.tasks_by_status).toEqual({ pendiente: 3, en_progreso: 1, hecha: 1, cancelada: 1 })
    expect(d.next_inspection).toMatchObject({ id: nextInspectionId, title: "Próxima", scheduled_for: addDaysISO(today, 3) })
    expect(d.pending_suggestions.map((s) => s.title)).toEqual(["Sugerencia crítica", "Sugerencia alta"])
    expect(d.pending_suggestions[1].payload).toEqual({ kind: "create_task", data: { title: "x" } })
    expect(d.pending_suggestions[0].payload).toEqual({ kind: "create_task", data: { title: "y" } })
    expect(d.recent_activity).toHaveLength(10)
    expect(d.recent_activity[0]).toMatchObject({ action: "test.14", actor_name: "gerente", details: { k: 14 } })
    expect(typeof d.recent_activity[0].id).toBe("number")
    expect(d.risk.score).toBeGreaterThan(0)
    expect(["alto", "critico"]).toContain(d.risk.level)
  })

  it("trabajador: solo sus tareas, sin aprobaciones ni auditoría; mismo índice de riesgo", async () => {
    const { getObraDashboard } = await import("@/app/actions/obra/dashboard")
    actAs(db.users.gerente)
    const g = unwrap(await getObraDashboard(db.projectId))
    actAs(db.users.trabajador)
    const d = unwrap(await getObraDashboard(db.projectId))
    expect(d.access.role).toBe("trabajador")
    expect(d.counts.open_tasks).toBe(2)
    expect(d.counts.my_open_tasks).toBe(2)
    expect(d.counts.overdue_tasks).toBe(1)
    expect(d.my_tasks.map((t) => t.title).sort()).toEqual(["Rol trabajador", "Vencida del trabajador"])
    expect(d.tasks_by_status).toEqual({ pendiente: 2, en_progreso: 0, hecha: 1, cancelada: 0 })
    expect(d.pending_suggestions).toEqual([])
    expect(d.recent_activity).toEqual([])
    expect(d.risk).toEqual(g.risk)
  })

  it("supervisor ve todas las tareas pero no aprobaciones; visita ve auditoría pero no aprobaciones", async () => {
    const { getObraDashboard } = await import("@/app/actions/obra/dashboard")
    actAs(db.users.supervisor)
    const s = unwrap(await getObraDashboard(db.projectId))
    expect(s.counts.open_tasks).toBe(4)
    expect(s.counts.my_open_tasks).toBe(1)
    expect(s.my_tasks.map((t) => t.title)).toEqual(["Vencida del supervisor"])
    expect(s.pending_suggestions).toEqual([])
    expect(s.recent_activity).toEqual([])

    actAs(db.users.visita)
    const v = unwrap(await getObraDashboard(db.projectId))
    expect(v.pending_suggestions).toEqual([])
    expect(v.recent_activity.length).toBe(10)

    actAs(db.users.prevencionista)
    const p = unwrap(await getObraDashboard(db.projectId))
    expect(p.pending_suggestions).toHaveLength(2)

    actAs(db.users.extrano)
    expectError(await getObraDashboard(db.projectId), /Proyecto no encontrado/)
  })

  it("listMyObraProjects: agregados por obra según el rol", async () => {
    const { listMyObraProjects } = await import("@/app/actions/obra/projects")
    actAs(db.users.gerente)
    const [p] = unwrap(await listMyObraProjects())
    expect(p).toMatchObject({
      project_id: db.projectId,
      project_name: "Edificio Los Aromos",
      role: "gerente",
      open_tasks: 4,
      my_open_tasks: 0,
      overdue_tasks: 2,
      pending_suggestions: 2,
      open_findings: 4,
      critical_findings: 1,
      next_inspection_date: addDaysISO(today, 3),
    })

    actAs(db.users.trabajador)
    const [w] = unwrap(await listMyObraProjects())
    expect(w).toMatchObject({ role: "trabajador", open_tasks: 2, my_open_tasks: 2, overdue_tasks: 1 })

    actAs(db.users.extrano)
    const theirs = unwrap(await listMyObraProjects())
    expect(theirs.map((x) => x.project_id)).toEqual([db.otherProjectId])
    expect(theirs[0]).toMatchObject({ open_findings: 1, critical_findings: 1, open_tasks: 0 })
  })

  it("auditoría: visita y gerente la ven, paginada; trabajador y supervisor no", async () => {
    const { listObraAudit } = await import("@/app/actions/obra/audit")
    actAs(db.users.visita)
    const first = unwrap(await listObraAudit(db.projectId, { limit: 5 }))
    expect(first.map((e) => e.action)).toEqual(["test.14", "test.13", "test.12", "test.11", "test.10"])
    expect(first.every((e) => e.project_id === db.projectId)).toBe(true)
    const second = unwrap(await listObraAudit(db.projectId, { limit: 5, before_id: first[4].id }))
    expect(second.map((e) => e.action)).toEqual(["test.9", "test.8", "test.7", "test.6", "test.5"])
    const capped = unwrap(await listObraAudit(db.projectId, { limit: 1000 }))
    expect(capped.length).toBe(15)
    expect(capped.some((e) => e.action === "ajeno")).toBe(false)
    expectError(await listObraAudit(db.projectId, { before_id: -3 }), /Cursor de paginación no válido/)

    for (const role of ["trabajador", "supervisor"] as const) {
      actAs(db.users[role])
      expectError(await listObraAudit(db.projectId), /no permite esta acción/)
    }
    actAs(db.users.extrano)
    expectError(await listObraAudit(db.projectId), /Proyecto no encontrado/)
  })
  it("los hallazgos de otra cuenta con el mismo project_id no inflan el riesgo; pines de capas borradas no cuentan", async () => {
    const { getObraDashboard } = await import("@/app/actions/obra/dashboard")
    const { listMyObraProjects } = await import("@/app/actions/obra/projects")
    actAs(db.users.gerente)
    const before = unwrap(await getObraDashboard(db.projectId))
    const hubBefore = unwrap(await listMyObraProjects()).find((p) => p.project_id === db.projectId)!
    // Lo mismo que permite el createFinding heredado: otra cuenta inserta críticos en un proyecto ajeno.
    for (let k = 0; k < 4; k++) {
      await db.sql`INSERT INTO findings (project_id, user_id, title, severity, status)
                   VALUES (${db.projectId}, ${db.users.extrano}, 'Intruso', 'critical', 'open')`
    }
    const after = unwrap(await getObraDashboard(db.projectId))
    expect(after.counts.open_findings).toBe(before.counts.open_findings)
    expect(after.findings_by_severity).toEqual(before.findings_by_severity)
    expect(after.risk).toEqual(before.risk)
    const hubAfter = unwrap(await listMyObraProjects()).find((p) => p.project_id === db.projectId)!
    expect(hubAfter).toMatchObject({ open_findings: hubBefore.open_findings, critical_findings: hubBefore.critical_findings })

    // Un pin en una capa borrada lógicamente deja de contar como "ubicado".
    const gone = await db.sql<{ id: number }[]>`
      INSERT INTO obra_plan_layers (project_id, name, discipline, level, deleted_at)
      VALUES (${db.projectId}, 'Capa borrada con pin', 'otro', 0, CURRENT_TIMESTAMP) RETURNING id`
    const f = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${db.projectId}, ${db.users.gerente}, 'Ubicado en capa borrada', 'low', 'resolved') RETURNING id`
    await db.sql`INSERT INTO obra_finding_pins (finding_id, project_id, layer_id, level, x, y, category)
                 VALUES (${f[0].id}, ${db.projectId}, ${gone[0].id}, 0, 0.5, 0.5, 'otro')`
    expect(unwrap(await getObraDashboard(db.projectId)).counts.pinned_findings).toBe(before.counts.pinned_findings)
  })
})
