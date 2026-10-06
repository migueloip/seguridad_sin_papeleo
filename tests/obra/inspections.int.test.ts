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

const DENIED = /no permite esta acción/
const NOT_FOUND = /Revisión no encontrada/

describe.skipIf(!HAS_TEST_DB)("revisiones de obra (BD real)", () => {
  let db: TestDb
  const today = todayISO()

  /** Proyecto nuevo del gerente (aislado de los demás tests). */
  async function freshProject(name: string): Promise<number> {
    const p = await db.sql<{ id: number }[]>`
      INSERT INTO projects (name, user_id, status) VALUES (${name}, ${db.users.gerente}, 'active') RETURNING id`
    return Number(p[0].id)
  }

  beforeAll(async () => {
    db = await setupObraTestDb("inspections_int_test")
  })
  afterAll(async () => {
    await db?.close()
  })

  it("programar revisiones: gerente, jefe y prevencionista sí; el resto no", async () => {
    const { createObraInspection } = await import("@/app/actions/obra/inspections")
    for (const role of ["gerente", "jefe_obra", "prevencionista"] as const) {
      actAs(db.users[role])
      const i = unwrap(await createObraInspection(db.projectId, { title: `Revisión de ${role}`, scheduled_for: addDaysISO(today, 30) }))
      expect(i).toMatchObject({ project_id: db.projectId, status: "programada", scheduled_for: addDaysISO(today, 30), created_by: db.users[role] })
      expect(i).toMatchObject({ task_count: 0, open_task_count: 0, closed_at: null })
    }
    for (const role of ["supervisor", "trabajador", "visita"] as const) {
      actAs(db.users[role])
      expectError(await createObraInspection(db.projectId, { title: "No", scheduled_for: today }), DENIED)
    }
    actAs(db.users.extrano)
    expectError(await createObraInspection(db.projectId, { title: "No", scheduled_for: today }), /Proyecto no encontrado/)
  })

  it("valida fecha, título y responsable del mismo equipo", async () => {
    const { createObraInspection } = await import("@/app/actions/obra/inspections")
    actAs(db.users.gerente)
    expectError(await createObraInspection(db.projectId, { title: "Fecha", scheduled_for: "2026-13-01" }), /AAAA-MM-DD/)
    expectError(await createObraInspection(db.projectId, { title: "x", scheduled_for: today }), /título/)
    expectError(
      await createObraInspection(db.projectId, { title: "Responsable", scheduled_for: today, lead_user_id: db.users.extrano }),
      /no pertenece al equipo/,
    )
    const i = unwrap(
      await createObraInspection(db.projectId, {
        title: "Con responsable",
        scheduled_for: addDaysISO(today, 2),
        lead_user_id: db.users.supervisor,
        notes: "Llevar arnés",
      }),
    )
    expect(i).toMatchObject({ lead_user_id: db.users.supervisor, lead_user_name: "supervisor", notes: "Llevar arnés" })
  })

  it("lista abiertas por fecha ascendente y luego cerradas; cualquier rol puede ver", async () => {
    const { listObraInspections } = await import("@/app/actions/obra/inspections")
    await db.sql`INSERT INTO obra_inspections (project_id, title, scheduled_for, status, closed_at)
                 VALUES (${db.projectId}, 'Cerrada antigua', CURRENT_DATE - 20, 'cerrada', CURRENT_TIMESTAMP)`
    actAs(db.users.trabajador)
    const list = unwrap(await listObraInspections(db.projectId))
    const open = list.filter((i) => i.status !== "cerrada")
    expect(list.slice(0, open.length)).toEqual(open)
    for (let k = 1; k < open.length; k++) expect(open[k - 1].scheduled_for <= open[k].scheduled_for).toBe(true)
    expect(list[list.length - 1].title).toBe("Cerrada antigua")
    actAs(db.users.extrano)
    expectError(await listObraInspections(db.projectId), /Proyecto no encontrado/)
  })

  it("editar: cambia estado a en curso, no permite cerrar por esta vía y protege por proyecto", async () => {
    const { createObraInspection, updateObraInspection } = await import("@/app/actions/obra/inspections")
    actAs(db.users.jefe_obra)
    const i = unwrap(await createObraInspection(db.projectId, { title: "Para editar", scheduled_for: addDaysISO(today, 5) }))
    const u = unwrap(await updateObraInspection(i.id, { status: "en_curso", title: "Editada", lead_user_id: db.users.prevencionista }))
    expect(u).toMatchObject({ status: "en_curso", title: "Editada", lead_user_id: db.users.prevencionista })
    const cleared = unwrap(await updateObraInspection(i.id, { lead_user_id: null }))
    expect(cleared.lead_user_id).toBeNull()
    expectError(await updateObraInspection(i.id, { status: "cerrada" }), /Cerrar revisión/)
    expectError(await updateObraInspection(i.id, { status: "pausada" as never }), /Estado de revisión no válido/)

    actAs(db.users.supervisor)
    expectError(await updateObraInspection(i.id, { title: "No" }), DENIED)
    actAs(db.users.extrano)
    expectError(await updateObraInspection(i.id, { title: "No" }), NOT_FOUND)
    expectError(await updateObraInspection(987654, { title: "No" }), NOT_FOUND)

    const audit = await db.sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM obra_audit_log WHERE action = 'inspection.updated' AND entity_id = ${i.id}`
    expect(audit[0].n).toBe(2)
  })

  it("getOrCreateNextInspection: llamadas concurrentes crean UNA sola revisión semanal", async () => {
    const { getOrCreateNextInspection } = await import("@/lib/obra/server/inspections")
    const { sql } = await import("@/lib/db")
    const pid = await freshProject("Obra concurrente")
    const results = await Promise.all(
      Array.from({ length: 8 }, () => sql.begin((tx) => getOrCreateNextInspection(tx, pid, db.users.gerente))),
    )
    const idsSeen = new Set(results.map((r) => r.id))
    expect(idsSeen.size).toBe(1)
    expect(results[0]).toMatchObject({ title: "Revisión semanal", status: "programada", scheduled_for: addDaysISO(today, 7) })
    const rows = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_inspections WHERE project_id = ${pid}`
    expect(rows[0].n).toBe(1)
    const audit = await db.sql<{ details: { auto: boolean } }[]>`
      SELECT details FROM obra_audit_log WHERE project_id = ${pid} AND action = 'inspection.created'`
    expect(audit).toHaveLength(1)
    expect(audit[0].details.auto).toBe(true)

    // Sin transacción explícita también funciona (abre la suya).
    const again = await getOrCreateNextInspection(sql, pid, db.users.gerente)
    expect(again.id).toBe(results[0].id)
  })

  it("tareas concurrentes con inspection_id 'next' quedan en la misma revisión", async () => {
    const { createObraTask } = await import("@/app/actions/obra/tasks")
    const pid = await freshProject("Obra concurrente 2")
    actAs(db.users.gerente)
    const res = await Promise.all(
      Array.from({ length: 6 }, (_, k) => createObraTask(pid, { title: `Tarea concurrente ${k}`, inspection_id: "next" })),
    )
    const tasks = res.map(unwrap)
    expect(new Set(tasks.map((t) => t.inspection_id)).size).toBe(1)
    const rows = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_inspections WHERE project_id = ${pid}`
    expect(rows[0].n).toBe(1)
  })

  it("la próxima usa el criterio único del módulo: en curso; luego programada desde hoy; luego atrasada", async () => {
    const { getOrCreateNextInspection } = await import("@/lib/obra/server/inspections")
    const { sql } = await import("@/lib/db")
    const pid = await freshProject("Obra con agenda")
    const add = async (title: string, days: number, status = "programada") => {
      const r = await db.sql<{ id: number }[]>`
        INSERT INTO obra_inspections (project_id, title, scheduled_for, status)
        VALUES (${pid}, ${title}, ${addDaysISO(today, days)}::date, ${status}) RETURNING id`
      return Number(r[0].id)
    }
    const pasada = await add("Pasada", -1)
    await add("Cerrada", 1, "cerrada")
    const enCurso = await add("En curso", 1, "en_curso")
    await add("Lejana", 20)
    const hoy = await add("Hoy", 0)
    const pick = () => sql.begin((tx) => getOrCreateNextInspection(tx, pid, db.users.gerente))
    // Es la misma que muestran el resumen y la página Revisiones (pickNextInspection).
    expect((await pick()).id).toBe(enCurso)
    await db.sql`UPDATE obra_inspections SET status = 'cerrada' WHERE id = ${enCurso}`
    expect((await pick()).id).toBe(hoy)
    await db.sql`UPDATE obra_inspections SET status = 'cerrada' WHERE project_id = ${pid} AND id <> ${pasada}`
    expect((await pick()).id).toBe(pasada)
    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_inspections WHERE project_id = ${pid}`
    expect(n[0].n).toBe(5)
  })

  it("una tarea que vence antes de la próxima revisión programada crea una revisión prioritaria para su vencimiento", async () => {
    const { getOrCreateNextInspection } = await import("@/lib/obra/server/inspections")
    const { sql } = await import("@/lib/db")
    const pid = await freshProject("Obra urgente")
    await db.sql`INSERT INTO obra_inspections (project_id, title, scheduled_for) VALUES (${pid}, 'Semanal', ${addDaysISO(today, 6)}::date)`
    const pick = (dueBy: string | null) => sql.begin((tx) => getOrCreateNextInspection(tx, pid, db.users.gerente, { dueBy }))
    // Vence después de la revisión: va a la programada.
    expect((await pick(addDaysISO(today, 10))).title).toBe("Semanal")
    // Vence hoy: no espera 6 días.
    const urgent = await pick(today)
    expect(urgent).toMatchObject({ title: "Revisión prioritaria", scheduled_for: today, status: "programada" })
    // Otra tarea que vence en 2 días reutiliza la prioritaria de hoy.
    expect((await pick(addDaysISO(today, 2))).id).toBe(urgent.id)
    // Sin revisiones abiertas y con vencimiento a 3 días: la revisión se agenda para ese día.
    const pid2 = await freshProject("Obra sin agenda")
    const r = await sql.begin((tx) => getOrCreateNextInspection(tx, pid2, db.users.gerente, { dueBy: addDaysISO(today, 3) }))
    expect(r).toMatchObject({ title: "Revisión prioritaria", scheduled_for: addDaysISO(today, 3) })
    const audit = await db.sql<{ details: Record<string, unknown> }[]>`
      SELECT details FROM obra_audit_log WHERE project_id = ${pid} AND action = 'inspection.created' ORDER BY id DESC LIMIT 1`
    expect(audit[0].details).toMatchObject({ auto: true, title: "Revisión prioritaria", due_by: today })
  })

  it("cerrar una revisión espera a la aprobación en curso: la tarea nueva se traslada y no queda en una revisión cerrada", async () => {
    const { getOrCreateNextInspection, closeInspection } = await import("@/lib/obra/server/inspections")
    const { createTask } = await import("@/lib/obra/server/tasks")
    const { sql } = await import("@/lib/db")
    const pid = await freshProject("Obra carrera")
    await db.sql`INSERT INTO obra_members (project_id, user_id, role) VALUES (${pid}, ${db.users.prevencionista}, 'prevencionista')`
    const x = await db.sql<{ id: number }[]>`
      INSERT INTO obra_inspections (project_id, title, scheduled_for) VALUES (${pid}, 'X', ${today}::date) RETURNING id`
    const xId = Number(x[0].id)
    // Una "aprobación" abre su transacción, elige la próxima (X) y aún no confirma.
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    let chosen = 0
    const approval = sql.begin(async (tx) => {
      const next = await getOrCreateNextInspection(tx, pid, db.users.gerente)
      chosen = next.id
      await gate
      return createTask(db.users.gerente, pid, { title: "Tarea aprobada", inspection_id: next.id }, tx)
    })
    while (chosen === 0) await new Promise((r) => setTimeout(r, 10))
    expect(chosen).toBe(xId)
    // El cierre (con traslado) queda esperando el mismo lock por proyecto.
    const closing = closeInspection(db.users.prevencionista, xId, { summary: "Cierre", carry_over_open_tasks: true })
    await new Promise((r) => setTimeout(r, 150))
    release()
    const task = await approval
    await closing
    const row = await db.sql<{ status: string; ins_status: string; inspection_id: number }[]>`
      SELECT t.status, i.status AS ins_status, t.inspection_id
      FROM obra_tasks t JOIN obra_inspections i ON i.id = t.inspection_id WHERE t.id = ${task.id}`
    expect(row[0].status).toBe("pendiente")
    expect(row[0].ins_status).not.toBe("cerrada")
    expect(row[0].inspection_id).not.toBe(xId)
  })

  it("cerrar con traslado mueve solo las tareas abiertas a la próxima revisión", async () => {
    const { closeObraInspection, createObraInspection, listObraInspections } = await import("@/app/actions/obra/inspections")
    const { createObraTask, setObraTaskStatus } = await import("@/app/actions/obra/tasks")
    const pid = await freshProject("Obra cierre")
    for (const role of ["prevencionista", "supervisor"] as const) {
      await db.sql`INSERT INTO obra_members (project_id, user_id, role) VALUES (${pid}, ${db.users[role]}, ${role})`
    }
    actAs(db.users.gerente)
    const insp = unwrap(await createObraInspection(pid, { title: "Revisión lunes", scheduled_for: today }))
    const t1 = unwrap(await createObraTask(pid, { title: "Abierta 1", inspection_id: insp.id }))
    const t2 = unwrap(await createObraTask(pid, { title: "Abierta 2", inspection_id: insp.id }))
    const t3 = unwrap(await createObraTask(pid, { title: "Terminada", inspection_id: insp.id }))
    unwrap(await setObraTaskStatus(t2.id, "en_progreso"))
    unwrap(await setObraTaskStatus(t3.id, "hecha"))

    const before = unwrap(await listObraInspections(pid)).find((i) => i.id === insp.id)
    expect(before).toMatchObject({ task_count: 3, open_task_count: 2 })

    actAs(db.users.supervisor)
    expectError(await closeObraInspection(insp.id, { summary: "No", carry_over_open_tasks: true }), DENIED)
    actAs(db.users.trabajador) // no es integrante de esta obra
    expectError(await closeObraInspection(insp.id, { summary: "No", carry_over_open_tasks: true }), NOT_FOUND)

    actAs(db.users.prevencionista)
    const closed = unwrap(await closeObraInspection(insp.id, { summary: "Se revisó el eje B", carry_over_open_tasks: true }))
    expect(closed).toMatchObject({ status: "cerrada", summary: "Se revisó el eje B", task_count: 1, open_task_count: 0 })
    expect(closed.closed_at).not.toBeNull()

    const tasks = await db.sql<{ id: number; inspection_id: number }[]>`
      SELECT id, inspection_id FROM obra_tasks WHERE project_id = ${pid} ORDER BY id`
    const byId = new Map(tasks.map((t) => [Number(t.id), Number(t.inspection_id)]))
    expect(byId.get(t3.id)).toBe(insp.id)
    const nextId = byId.get(t1.id)
    expect(nextId).not.toBe(insp.id)
    expect(byId.get(t2.id)).toBe(nextId)
    const next = await db.sql<{ title: string; status: string }[]>`SELECT title, status FROM obra_inspections WHERE id = ${nextId}`
    expect(next[0]).toEqual({ title: "Revisión semanal", status: "programada" })

    expectError(await closeObraInspection(insp.id, { summary: "Otra vez", carry_over_open_tasks: false }), /ya está cerrada/)
    const audit = await db.sql<{ details: { carried_over: number; next_inspection_id: number } }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'inspection.closed' AND entity_id = ${insp.id}`
    expect(audit[0].details).toMatchObject({ carried_over: 2, next_inspection_id: nextId })
  })

  it("cerrar sin traslado deja las tareas en la revisión cerrada; IDOR responde 404", async () => {
    const { closeObraInspection, createObraInspection } = await import("@/app/actions/obra/inspections")
    const { createObraTask } = await import("@/app/actions/obra/tasks")
    actAs(db.users.gerente)
    const insp = unwrap(await createObraInspection(db.projectId, { title: "Sin traslado", scheduled_for: today }))
    const t = unwrap(await createObraTask(db.projectId, { title: "Queda aquí", inspection_id: insp.id }))

    actAs(db.users.extrano)
    expectError(await closeObraInspection(insp.id, { summary: "hack", carry_over_open_tasks: true }), NOT_FOUND)

    actAs(db.users.gerente)
    const closed = unwrap(await closeObraInspection(insp.id, { summary: "", carry_over_open_tasks: false }))
    expect(closed).toMatchObject({ status: "cerrada", summary: null, task_count: 1, open_task_count: 1 })
    const row = await db.sql<{ inspection_id: number }[]>`SELECT inspection_id FROM obra_tasks WHERE id = ${t.id}`
    expect(Number(row[0].inspection_id)).toBe(insp.id)

    // Una revisión ajena (con id válido) tampoco se puede cerrar ni editar.
    const foreign = await db.sql<{ id: number }[]>`
      INSERT INTO obra_inspections (project_id, title, scheduled_for) VALUES (${db.otherProjectId}, 'Ajena', CURRENT_DATE) RETURNING id`
    expectError(await closeObraInspection(Number(foreign[0].id), { summary: "x", carry_over_open_tasks: false }), NOT_FOUND)
    const f = await db.sql<{ status: string }[]>`SELECT status FROM obra_inspections WHERE id = ${foreign[0].id}`
    expect(f[0].status).toBe("programada")
  })
})
