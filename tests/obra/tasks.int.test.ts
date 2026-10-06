// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActionResult, ObraTask, TaskInput } from "@/lib/obra/types"
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

const DENIED = /no permite/
const TASK_NOT_FOUND = /Tarea no encontrada/

describe.skipIf(!HAS_TEST_DB)("tareas de obra (BD real)", () => {
  let db: TestDb
  const ids = {
    finding: 0,
    otherFinding: 0,
    layer: 0,
    otherLayer: 0,
    otherInspection: 0,
    closedInspection: 0,
  }

  async function create(input: TaskInput, as: number = db.users.gerente): Promise<ObraTask> {
    const { createObraTask } = await import("@/app/actions/obra/tasks")
    actAs(as)
    return unwrap(await createObraTask(db.projectId, input))
  }

  beforeAll(async () => {
    db = await setupObraTestDb("tasks_int_test")
    const f = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${db.projectId}, ${db.users.gerente}, 'Grieta en muro eje B', 'high', 'open') RETURNING id`
    ids.finding = Number(f[0].id)
    const of = await db.sql<{ id: number }[]>`
      INSERT INTO findings (project_id, user_id, title, severity, status)
      VALUES (${db.otherProjectId}, ${db.users.extrano}, 'Hallazgo ajeno', 'low', 'open') RETURNING id`
    ids.otherFinding = Number(of[0].id)
    const l = await db.sql<{ id: number }[]>`
      INSERT INTO obra_plan_layers (project_id, name, discipline, level)
      VALUES (${db.projectId}, 'Alcantarillado N-1', 'alcantarillado', -1) RETURNING id`
    ids.layer = Number(l[0].id)
    const ol = await db.sql<{ id: number }[]>`
      INSERT INTO obra_plan_layers (project_id, name, discipline, level)
      VALUES (${db.otherProjectId}, 'Capa ajena', 'electrico', 0) RETURNING id`
    ids.otherLayer = Number(ol[0].id)
    const oi = await db.sql<{ id: number }[]>`
      INSERT INTO obra_inspections (project_id, title, scheduled_for)
      VALUES (${db.otherProjectId}, 'Revisión ajena', CURRENT_DATE + 3) RETURNING id`
    ids.otherInspection = Number(oi[0].id)
    const ci = await db.sql<{ id: number }[]>`
      INSERT INTO obra_inspections (project_id, title, scheduled_for, status, closed_at)
      VALUES (${db.projectId}, 'Revisión cerrada', CURRENT_DATE - 3, 'cerrada', CURRENT_TIMESTAMP) RETURNING id`
    ids.closedInspection = Number(ci[0].id)
  })
  afterAll(async () => {
    await db?.close()
  })

  it("crear tareas: gerente, jefe y prevencionista sí; supervisor, trabajador y visita no; extraño 404", async () => {
    const { createObraTask } = await import("@/app/actions/obra/tasks")
    for (const role of ["gerente", "jefe_obra", "prevencionista"] as const) {
      const t = await create({ title: `Tarea de ${role}`, priority: "baja" }, db.users[role])
      expect(t).toMatchObject({ project_id: db.projectId, status: "pendiente", origin: "manual", created_by: db.users[role] })
      expect(t.created_by_name).toBe(role)
    }
    for (const role of ["supervisor", "trabajador", "visita"] as const) {
      actAs(db.users[role])
      expectError(await createObraTask(db.projectId, { title: "No debería" }), DENIED)
    }
    actAs(db.users.extrano)
    expectError(await createObraTask(db.projectId, { title: "No debería" }), /Proyecto no encontrado/)
    actAs(null)
    expectError(await createObraTask(db.projectId, { title: "No debería" }), /Sesión no válida/)
  })

  it("valida la entrada con mensajes claros", async () => {
    const { createObraTask } = await import("@/app/actions/obra/tasks")
    actAs(db.users.gerente)
    expectError(await createObraTask(db.projectId, { title: "ab" }), /título debe tener entre 3 y 200/)
    expectError(await createObraTask(db.projectId, { title: "x".repeat(201) }), /título/)
    expectError(await createObraTask(db.projectId, { title: "Fecha mala", due_date: "2026-02-30" }), /AAAA-MM-DD/)
    expectError(await createObraTask(db.projectId, { title: "Fecha mala", due_date: "30-01-2026" }), /AAAA-MM-DD/)
    expectError(
      await createObraTask(db.projectId, { title: "Checklist largo", checklist: Array.from({ length: 21 }, (_, i) => `Paso ${i}`) }),
      /como máximo 20 ítems/,
    )
    expectError(await createObraTask(db.projectId, { title: "Prioridad", priority: "urgente" as never }), /Prioridad no válida/)
    expectError(await createObraTask(db.projectId, { title: "Rol", assigned_role: "jefe" as never }), /Rol asignado no válido/)
    expectError(await createObraTask(db.projectId, { title: "Posición", x: 0.5 }), /requiere x e y/)
    expectError(await createObraTask(db.projectId, { title: "Posición", x: 1.5, y: 0.2 }), /posición en el plano/)
    expectError(await createObraTask(db.projectId, null as never), /no válidos/)
  })

  it("las referencias cruzadas deben ser del mismo proyecto", async () => {
    const { createObraTask } = await import("@/app/actions/obra/tasks")
    actAs(db.users.gerente)
    expectError(await createObraTask(db.projectId, { title: "Ref", finding_id: ids.otherFinding }), /hallazgo indicado no pertenece/)
    expectError(await createObraTask(db.projectId, { title: "Ref", layer_id: ids.otherLayer }), /capa indicada no pertenece/)
    expectError(await createObraTask(db.projectId, { title: "Ref", inspection_id: ids.otherInspection }), /revisión indicada no pertenece/)
    expectError(await createObraTask(db.projectId, { title: "Ref", inspection_id: ids.closedInspection }), /ya está cerrada/)
    expectError(await createObraTask(db.projectId, { title: "Ref", assigned_user_id: db.users.extrano }), /no pertenece al equipo/)

    const t = unwrap(
      await createObraTask(db.projectId, {
        title: "  Revisar   colector bajo grieta ",
        finding_id: ids.finding,
        layer_id: ids.layer,
        x: 0.25,
        y: 0.75,
        assigned_user_id: db.users.supervisor,
        due_date: "2026-11-15",
        checklist: ["Inspeccionar cámara", "  ", "Medir filtración"],
      }),
    )
    expect(t).toMatchObject({
      title: "Revisar colector bajo grieta",
      origin: "hallazgo",
      finding_id: ids.finding,
      layer_id: ids.layer,
      level: -1,
      x: 0.25,
      y: 0.75,
      assigned_user_id: db.users.supervisor,
      assigned_user_name: "supervisor",
      due_date: "2026-11-15",
      checklist: [
        { text: "Inspeccionar cámara", done: false },
        { text: "Medir filtración", done: false },
      ],
    })
  })

  it("inspection_id 'next' crea la revisión semanal una sola vez", async () => {
    const a = await create({ title: "Primera para la próxima", inspection_id: "next" })
    const b = await create({ title: "Segunda para la próxima", inspection_id: "next" })
    expect(a.inspection_id).not.toBeNull()
    expect(b.inspection_id).toBe(a.inspection_id)
    const ins = await db.sql<{ title: string; n: number }[]>`
      SELECT title, COUNT(*) OVER ()::int AS n FROM obra_inspections
      WHERE project_id = ${db.projectId} AND status = 'programada'`
    expect(ins).toHaveLength(1)
    expect(ins[0].title).toBe("Revisión semanal")
  })

  describe("visibilidad, estados y checklist", () => {
    let own: ObraTask
    let byRole: ObraTask
    let supervisorRole: ObraTask
    let forJefe: ObraTask

    beforeAll(async () => {
      own = await create({ title: "Asignada al trabajador", assigned_user_id: db.users.trabajador, priority: "alta", checklist: ["Uno", "Dos"] })
      byRole = await create({ title: "Para cualquier trabajador", assigned_role: "trabajador", priority: "critica", due_date: "2026-10-01" })
      supervisorRole = await create({ title: "Para supervisores", assigned_role: "supervisor" })
      forJefe = await create({ title: "Para el jefe", assigned_user_id: db.users.jefe_obra, assigned_role: "trabajador" })
    })

    it("el trabajador solo ve lo asignado a él o a su rol sin persona", async () => {
      const { listObraTasks } = await import("@/app/actions/obra/tasks")
      actAs(db.users.trabajador)
      const list = unwrap(await listObraTasks(db.projectId))
      expect(list.map((t) => t.id).sort()).toEqual([own.id, byRole.id].sort())
      // Orden: prioridad crítica primero.
      expect(list[0].id).toBe(byRole.id)
      const mine = unwrap(await listObraTasks(db.projectId, { mine: true }))
      expect(mine.map((t) => t.id).sort()).toEqual([own.id, byRole.id].sort())
    })

    it("con tasks.view_all se ven todas; mine filtra las propias", async () => {
      const { listObraTasks } = await import("@/app/actions/obra/tasks")
      actAs(db.users.supervisor)
      const all = unwrap(await listObraTasks(db.projectId))
      const allIds = all.map((t) => t.id)
      for (const t of [own, byRole, supervisorRole, forJefe]) expect(allIds).toContain(t.id)
      const mine = unwrap(await listObraTasks(db.projectId, { mine: true }))
      expect(mine.every((t) => t.assigned_user_id === db.users.supervisor || (t.assigned_user_id == null && t.assigned_role === "supervisor"))).toBe(true)
      expect(mine.map((t) => t.id)).toContain(supervisorRole.id)

      actAs(db.users.visita)
      expect(unwrap(await listObraTasks(db.projectId)).length).toBe(all.length)
      expectError(await listObraTasks(db.projectId, { status: ["abierta" as never] }), /Estado de tarea no válido/)
      actAs(db.users.extrano)
      expectError(await listObraTasks(db.projectId), /Proyecto no encontrado/)
    })

    it("ordena: abiertas primero, prioridad y vencimiento", async () => {
      const { listObraTasks } = await import("@/app/actions/obra/tasks")
      actAs(db.users.gerente)
      const list = unwrap(await listObraTasks(db.projectId))
      const rank = { critica: 0, alta: 1, media: 2, baja: 3 }
      const open = list.filter((t) => t.status === "pendiente" || t.status === "en_progreso")
      for (let i = 1; i < open.length; i++) expect(rank[open[i - 1].priority]).toBeLessThanOrEqual(rank[open[i].priority])
    })

    it("ciclo de estado del trabajador sobre su tarea", async () => {
      const { setObraTaskStatus } = await import("@/app/actions/obra/tasks")
      actAs(db.users.trabajador)
      const p = unwrap(await setObraTaskStatus(own.id, "en_progreso"))
      expect(p.status).toBe("en_progreso")
      expect(p.completed_at).toBeNull()

      const done = unwrap(await setObraTaskStatus(own.id, "hecha", "Listo, sin filtración"))
      expect(done).toMatchObject({ status: "hecha", completed_by: db.users.trabajador, completion_notes: "Listo, sin filtración" })
      expect(done.completed_at).not.toBeNull()

      const back = unwrap(await setObraTaskStatus(own.id, "pendiente"))
      expect(back).toMatchObject({ status: "pendiente", completed_by: null, completed_at: null, completion_notes: null })

      // Tarea de su rol sin persona asignada: también puede cerrarla.
      expect(unwrap(await setObraTaskStatus(byRole.id, "hecha")).status).toBe("hecha")
      // No puede cancelar.
      expectError(await setObraTaskStatus(own.id, "cancelada"), /cancelarlas/)
      // Tareas ajenas: no las ve → no encontrada.
      expectError(await setObraTaskStatus(supervisorRole.id, "hecha"), TASK_NOT_FOUND)
      expectError(await setObraTaskStatus(forJefe.id, "hecha"), TASK_NOT_FOUND)
      expectError(await setObraTaskStatus(own.id, "terminada" as never), /Estado de tarea no válido/)

      const audit = await db.sql<{ details: { from: string; to: string } }[]>`
        SELECT details FROM obra_audit_log WHERE action = 'task.status_changed' AND entity_id = ${own.id} ORDER BY id`
      expect(audit.map((a) => `${a.details.from}>${a.details.to}`)).toEqual(["pendiente>en_progreso", "en_progreso>hecha", "hecha>pendiente"])
    })

    it("supervisor cierra cualquiera pero no cancela; visita no cierra; prevencionista cancela", async () => {
      const { setObraTaskStatus } = await import("@/app/actions/obra/tasks")
      actAs(db.users.supervisor)
      expect(unwrap(await setObraTaskStatus(forJefe.id, "en_progreso")).status).toBe("en_progreso")
      expectError(await setObraTaskStatus(forJefe.id, "cancelada"), /cancelarlas/)
      actAs(db.users.visita)
      expectError(await setObraTaskStatus(forJefe.id, "hecha"), DENIED)
      actAs(db.users.prevencionista)
      expect(unwrap(await setObraTaskStatus(forJefe.id, "cancelada")).status).toBe("cancelada")
      actAs(db.users.supervisor)
      expectError(await setObraTaskStatus(forJefe.id, "pendiente"), /cancelarlas/)
    })

    it("checklist: el dueño de la tarea marca ítems; índices inválidos fallan", async () => {
      const { toggleObraTaskChecklist } = await import("@/app/actions/obra/tasks")
      actAs(db.users.trabajador)
      const t = unwrap(await toggleObraTaskChecklist(own.id, 1, true))
      expect(t.checklist).toEqual([
        { text: "Uno", done: false },
        { text: "Dos", done: true },
      ])
      expectError(await toggleObraTaskChecklist(own.id, 2, true), /no existe/)
      expectError(await toggleObraTaskChecklist(own.id, -1, true), /no existe/)
      expectError(await toggleObraTaskChecklist(supervisorRole.id, 0, true), TASK_NOT_FOUND)
      actAs(db.users.visita)
      expectError(await toggleObraTaskChecklist(own.id, 0, true), DENIED)
    })

    it("editar exige tasks.manage y conserva lo marcado del checklist", async () => {
      const { updateObraTask } = await import("@/app/actions/obra/tasks")
      actAs(db.users.supervisor)
      expectError(await updateObraTask(own.id, { title: "Nuevo título" }), DENIED)
      actAs(db.users.trabajador)
      expectError(await updateObraTask(own.id, { title: "Nuevo título" }), DENIED)

      actAs(db.users.prevencionista)
      const u = unwrap(
        await updateObraTask(own.id, {
          title: "Asignada al trabajador (editada)",
          checklist: ["Dos", "Tres"],
          due_date: "2026-12-01",
          description: null,
        }),
      )
      expect(u.title).toBe("Asignada al trabajador (editada)")
      expect(u.checklist).toEqual([
        { text: "Dos", done: true },
        { text: "Tres", done: false },
      ])
      expect(u.due_date).toBe("2026-12-01")
      expect(u.assigned_user_id).toBe(db.users.trabajador)

      expectError(await updateObraTask(own.id, { layer_id: ids.otherLayer }), /capa indicada no pertenece/)
      expectError(await updateObraTask(own.id, { assigned_user_id: db.users.extrano }), /no pertenece al equipo/)
      expectError(await updateObraTask(own.id, { title: null as never }), /título es obligatorio/)

      const moved = unwrap(await updateObraTask(own.id, { layer_id: ids.layer, x: 0.1, y: 0.2 }))
      expect(moved).toMatchObject({ layer_id: ids.layer, level: -1, x: 0.1, y: 0.2 })

      const audit = await db.sql<{ details: { changes: string[] } }[]>`
        SELECT details FROM obra_audit_log WHERE action = 'task.updated' AND entity_id = ${own.id} ORDER BY id`
      expect(audit[0].details.changes).toEqual(expect.arrayContaining(["title", "checklist", "due_date"]))
    })
  })

  it("IDOR: ids válidos de otra obra responden 'no encontrada'", async () => {
    const { setObraTaskStatus, toggleObraTaskChecklist, updateObraTask } = await import("@/app/actions/obra/tasks")
    const mine = await create({ title: "Tarea propia del gerente", checklist: ["a"] })
    const foreign = await db.sql<{ id: number }[]>`
      INSERT INTO obra_tasks (project_id, title, checklist) VALUES (${db.otherProjectId}, 'Tarea ajena', '[{"text":"x","done":false}]'::jsonb) RETURNING id`
    const foreignId = Number(foreign[0].id)

    actAs(db.users.extrano)
    expectError(await setObraTaskStatus(mine.id, "hecha"), TASK_NOT_FOUND)
    expectError(await updateObraTask(mine.id, { title: "hackeada" }), TASK_NOT_FOUND)
    expectError(await toggleObraTaskChecklist(mine.id, 0, true), TASK_NOT_FOUND)

    actAs(db.users.gerente)
    expectError(await setObraTaskStatus(foreignId, "hecha"), TASK_NOT_FOUND)
    expectError(await updateObraTask(foreignId, { title: "hackeada" }), TASK_NOT_FOUND)
    expectError(await toggleObraTaskChecklist(foreignId, 0, true), TASK_NOT_FOUND)
    expectError(await setObraTaskStatus(999999, "hecha"), TASK_NOT_FOUND)
    expectError(await setObraTaskStatus("1 OR 1=1" as never, "hecha"), TASK_NOT_FOUND)

    const t = await db.sql<{ title: string; status: string }[]>`SELECT title, status FROM obra_tasks WHERE id = ${foreignId}`
    expect(t[0]).toEqual({ title: "Tarea ajena", status: "pendiente" })
  })

  it("createTaskInTx: valida referencias y no duplica la tarea de una sugerencia", async () => {
    const { createTaskInTx } = await import("@/lib/obra/server/tasks")
    const { getProjectAccessForUser, ObraValidationError } = await import("@/lib/obra/access")
    const { sql } = await import("@/lib/db")
    const access = await getProjectAccessForUser(db.users.prevencionista, db.projectId)
    if (!access) throw new Error("sin acceso")
    const sg = await db.sql<{ id: number }[]>`
      INSERT INTO obra_ai_suggestions (project_id, kind, title, payload) VALUES (${db.projectId}, 'create_task', 'Sugerida', '{}'::jsonb) RETURNING id`
    const foreignSg = await db.sql<{ id: number }[]>`
      INSERT INTO obra_ai_suggestions (project_id, kind, title, payload) VALUES (${db.otherProjectId}, 'create_task', 'Ajena', '{}'::jsonb) RETURNING id`
    const suggestionId = Number(sg[0].id)

    const t = await sql.begin((tx) =>
      createTaskInTx(tx, access, { title: "Desde sugerencia", inspection_id: "next" }, { origin: "ia", suggestion_id: suggestionId }),
    )
    expect(t).toMatchObject({ origin: "ia", suggestion_id: suggestionId, created_by: db.users.prevencionista })
    expect(t.inspection_id).not.toBeNull()

    await expect(
      sql.begin((tx) => createTaskInTx(tx, access, { title: "Duplicada" }, { origin: "ia", suggestion_id: suggestionId })),
    ).rejects.toBeInstanceOf(ObraValidationError)
    await expect(
      sql.begin((tx) =>
        createTaskInTx(tx, access, { title: "Ajena" }, { origin: "ia", suggestion_id: Number(foreignSg[0].id) }),
      ),
    ).rejects.toThrow(/no pertenece a esta obra/)
    await expect(
      sql.begin((tx) => createTaskInTx(tx, access, { title: "Ajena", finding_id: ids.otherFinding }, { origin: "ia" })),
    ).rejects.toThrow(/hallazgo indicado no pertenece/)

    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_tasks WHERE suggestion_id = ${suggestionId}`
    expect(n[0].n).toBe(1)
  })

  it("audita la creación de tareas", async () => {
    const rows = await db.sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM obra_audit_log WHERE project_id = ${db.projectId} AND action = 'task.created'`
    const tasks = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_tasks WHERE project_id = ${db.projectId}`
    expect(rows[0].n).toBe(tasks[0].n)
  })
})
