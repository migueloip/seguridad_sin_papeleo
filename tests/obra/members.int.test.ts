// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
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
const NOT_FOUND_PROJECT = /Proyecto no encontrado/

describe.skipIf(!HAS_TEST_DB)("equipo de obra (BD real)", () => {
  let db: TestDb

  async function mkUser(key: string): Promise<number> {
    const r = await db.sql<{ id: number }[]>`
      INSERT INTO users (email, name, password_hash, role) VALUES (${`${key}@test.cl`}, ${key}, 'x', 'user') RETURNING id`
    return Number(r[0].id)
  }

  async function addRawMember(userId: number, role: string): Promise<void> {
    await db.sql`INSERT INTO obra_members (project_id, user_id, role, invited_by)
                 VALUES (${db.projectId}, ${userId}, ${role}, ${db.users.gerente})`
  }

  async function auditActions(): Promise<string[]> {
    const rows = await db.sql<{ action: string }[]>`
      SELECT action FROM obra_audit_log WHERE project_id = ${db.projectId} ORDER BY id`
    return rows.map((r) => r.action)
  }

  beforeAll(async () => {
    db = await setupObraTestDb("members_int_test")
    // Base de los enlaces de invitación (fuera de una petición no hay headers()).
    process.env.APP_URL = "https://easysecure.test"
  })
  afterAll(async () => {
    await db?.close()
  })

  it("lista el equipo con el dueño primero; cualquier rol con acceso puede verlo", async () => {
    const { listObraMembers } = await import("@/app/actions/obra/members")
    actAs(db.users.trabajador)
    const members = unwrap(await listObraMembers(db.projectId))
    expect(members[0]).toMatchObject({ user_id: db.users.gerente, is_owner: true, role: "gerente", id: null })
    expect(members.map((m) => m.role).slice(1)).toEqual(["jefe_obra", "prevencionista", "supervisor", "trabajador", "visita"])
    expect(members.every((m) => m.project_id === db.projectId)).toBe(true)

    actAs(db.users.extrano)
    expectError(await listObraMembers(db.projectId), NOT_FOUND_PROJECT)
    actAs(null)
    expectError(await listObraMembers(db.projectId), /Sesión no válida/)
  })

  it("getObraAccess devuelve rol y permisos; un extraño recibe 'no encontrado'", async () => {
    const { getObraAccess, listMyObraProjects } = await import("@/app/actions/obra/projects")
    actAs(db.users.trabajador)
    const a = unwrap(await getObraAccess(db.projectId))
    expect(a.role).toBe("trabajador")
    expect(a.owner_user_id).toBe(db.users.gerente)
    expect(a.permissions).toContain("tasks.complete_own")
    expect(a.permissions).not.toContain("tasks.manage")

    actAs(db.users.extrano)
    expectError(await getObraAccess(db.projectId), NOT_FOUND_PROJECT)
    const mine = unwrap(await listMyObraProjects())
    expect(mine.map((p) => p.project_id)).toEqual([db.otherProjectId])
  })

  it("ya no existe el alta directa con contraseña temporal: se entra solo por invitación", async () => {
    const actions = await import("@/app/actions/obra/members")
    expect(Object.keys(actions)).not.toContain("addObraMember")
    const server = await import("@/lib/obra/server/members")
    expect(Object.keys(server)).not.toContain("addMember")
    expect(Object.keys(server)).not.toContain("generateTemporaryPassword")
  })

  it("vincula solo trabajadores del dueño del proyecto", async () => {
    const { listObraLinkableWorkers } = await import("@/app/actions/obra/members")
    const { createObraInvitation } = await import("@/app/actions/obra/invitations")
    const own = await db.sql<{ id: number }[]>`
      INSERT INTO workers (rut, first_name, last_name, user_id, project_id)
      VALUES ('11.111.111-1', 'Juan', 'Pérez', ${db.users.gerente}, ${db.projectId}) RETURNING id`
    const foreign = await db.sql<{ id: number }[]>`
      INSERT INTO workers (rut, first_name, last_name, user_id, project_id)
      VALUES ('22.222.222-2', 'Ana', 'Ajena', ${db.users.extrano}, ${db.otherProjectId}) RETURNING id`

    actAs(db.users.gerente)
    const list = unwrap(await listObraLinkableWorkers(db.projectId))
    expect(list).toEqual([{ id: Number(own[0].id), name: "Juan Pérez", rut: "11.111.111-1" }])

    expectError(
      await createObraInvitation(db.projectId, { email: "vinculo1@test.cl", role: "trabajador", worker_id: Number(foreign[0].id) }),
      /no pertenece a esta obra/,
    )
    const ok = unwrap(
      await createObraInvitation(db.projectId, { email: "vinculo2@test.cl", role: "trabajador", worker_id: Number(own[0].id) }),
    )
    expect(ok.invitation).toMatchObject({ worker_id: Number(own[0].id), worker_name: "Juan Pérez" })

    actAs(db.users.trabajador)
    expectError(await listObraLinkableWorkers(db.projectId), DENIED)
  })

  it("un jefe de obra que no es dueño solo ve el personal de esta obra, con el RUT abreviado", async () => {
    const { listObraLinkableWorkers } = await import("@/app/actions/obra/members")
    const { createObraInvitation } = await import("@/app/actions/obra/invitations")
    const otraObra = await db.sql<{ id: number }[]>`
      INSERT INTO projects (name, user_id, status) VALUES ('Otra obra del dueño', ${db.users.gerente}, 'active') RETURNING id`
    const deOtraObra = await db.sql<{ id: number }[]>`
      INSERT INTO workers (rut, first_name, last_name, user_id, project_id)
      VALUES ('33.333.333-3', 'Pedro', 'Otraobra', ${db.users.gerente}, ${otraObra[0].id}) RETURNING id`
    const sinObra = await db.sql<{ id: number }[]>`
      INSERT INTO workers (rut, first_name, last_name, user_id, project_id)
      VALUES ('12.345.678-K', 'Rosa', 'Libre', ${db.users.gerente}, NULL) RETURNING id`

    actAs(db.users.jefe_obra)
    const list = unwrap(await listObraLinkableWorkers(db.projectId))
    const ids = list.map((w) => w.id)
    expect(ids).not.toContain(Number(deOtraObra[0].id))
    expect(ids).toContain(Number(sinObra[0].id))
    expect(list.find((w) => w.id === Number(sinObra[0].id))?.rut).toBe("•••678-K")
    expect(JSON.stringify(list)).not.toContain("11.111.111-1")
    expectError(
      await createObraInvitation(db.projectId, { email: "vinculo3@test.cl", role: "trabajador", worker_id: Number(deOtraObra[0].id) }),
      /no pertenece a esta obra/,
    )

    // El dueño sí ve todo su personal con el RUT completo.
    actAs(db.users.gerente)
    const full = unwrap(await listObraLinkableWorkers(db.projectId))
    expect(full.find((w) => w.id === Number(deOtraObra[0].id))?.rut).toBe("33.333.333-3")
  })

  it("cambia roles con las reglas: no al dueño, no a sí mismo, gerentes solo por gerentes", async () => {
    const { updateObraMemberRole } = await import("@/app/actions/obra/members")
    const target = await mkUser("cambio_rol")
    await addRawMember(target, "supervisor")
    const otroGerente = await mkUser("otro_gerente")
    await addRawMember(otroGerente, "gerente")

    actAs(db.users.jefe_obra)
    const m = unwrap(await updateObraMemberRole(db.projectId, target, "prevencionista"))
    expect(m).toMatchObject({ user_id: target, role: "prevencionista" })
    expectError(await updateObraMemberRole(db.projectId, target, "gerente"), /no puede asignar el rol/)
    expectError(await updateObraMemberRole(db.projectId, db.users.gerente, "visita"), /dueño/)
    expectError(await updateObraMemberRole(db.projectId, db.users.jefe_obra, "gerente"), /propio rol/)
    expectError(await updateObraMemberRole(db.projectId, otroGerente, "visita"), /Solo un gerente/)
    expectError(await updateObraMemberRole(db.projectId, target, "superadmin" as never), /Rol no válido/)

    actAs(db.users.gerente)
    unwrap(await updateObraMemberRole(db.projectId, otroGerente, "jefe_obra"))

    actAs(db.users.prevencionista)
    expectError(await updateObraMemberRole(db.projectId, target, "visita"), DENIED)

    expect(await auditActions()).toContain("member.role_changed")
  })

  it("IDOR: el gerente de otra obra no puede tocar miembros de esta", async () => {
    const { removeObraMember, updateObraMemberRole } = await import("@/app/actions/obra/members")
    actAs(db.users.extrano)
    // Contra este proyecto: no tiene acceso → no encontrado.
    expectError(await updateObraMemberRole(db.projectId, db.users.supervisor, "visita"), NOT_FOUND_PROJECT)
    expectError(await removeObraMember(db.projectId, db.users.supervisor), NOT_FOUND_PROJECT)
    // Con su propio proyecto y un usuario de este: el integrante no existe allí.
    expectError(await updateObraMemberRole(db.otherProjectId, db.users.supervisor, "visita"), /Integrante no encontrado/)
    expectError(await removeObraMember(db.otherProjectId, db.users.supervisor), /Integrante no encontrado/)
    const still = await db.sql<{ role: string }[]>`
      SELECT role FROM obra_members WHERE project_id = ${db.projectId} AND user_id = ${db.users.supervisor}`
    expect(still[0].role).toBe("supervisor")
  })

  it("quita integrantes con las mismas reglas y lo audita", async () => {
    const { removeObraMember } = await import("@/app/actions/obra/members")
    const target = await mkUser("a_quitar")
    await addRawMember(target, "visita")
    const gerenteMiembro = await mkUser("gerente_miembro")
    await addRawMember(gerenteMiembro, "gerente")

    actAs(db.users.jefe_obra)
    expectError(await removeObraMember(db.projectId, db.users.gerente), /dueño/)
    expectError(await removeObraMember(db.projectId, db.users.jefe_obra), /ti mismo/)
    expectError(await removeObraMember(db.projectId, gerenteMiembro), /Solo un gerente/)
    expect(unwrap(await removeObraMember(db.projectId, target))).toBeNull()
    expectError(await removeObraMember(db.projectId, target), /Integrante no encontrado/)

    actAs(db.users.visita)
    expectError(await removeObraMember(db.projectId, db.users.trabajador), DENIED)

    actAs(db.users.gerente)
    unwrap(await removeObraMember(db.projectId, gerenteMiembro))

    const rows = await db.sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM obra_members WHERE project_id = ${db.projectId} AND user_id IN (${target}, ${gerenteMiembro})`
    expect(rows[0].n).toBe(0)
    const removed = await db.sql<{ details: { user_id: number } }[]>`
      SELECT details FROM obra_audit_log WHERE project_id = ${db.projectId} AND action = 'member.removed' ORDER BY id`
    expect(removed.map((r) => r.details.user_id)).toEqual([target, gerenteMiembro])
  })

  it("al quitar a un integrante sus tareas abiertas quedan sin persona (con su rol) y las hechas no cambian", async () => {
    const { removeObraMember } = await import("@/app/actions/obra/members")
    const target = await mkUser("con_tareas")
    await addRawMember(target, "supervisor")
    const mkTask = async (title: string, status: string, assignedRole: string | null, assignedUser: number | null) => {
      const r = await db.sql<{ id: number }[]>`
        INSERT INTO obra_tasks (project_id, title, status, assigned_role, assigned_user_id, created_by)
        VALUES (${db.projectId}, ${title}, ${status}, ${assignedRole}, ${assignedUser}, ${db.users.gerente})
        RETURNING id`
      return Number(r[0].id)
    }
    const pendienteSinRol = await mkTask("Revisar colector", "pendiente", null, target)
    const enProgresoConRol = await mkTask("Apuntalar muro", "en_progreso", "trabajador", target)
    const hecha = await mkTask("Señalizar zanja", "hecha", "supervisor", target)
    const cancelada = await mkTask("Tarea cancelada", "cancelada", null, target)
    const ajena = await mkTask("De otra persona", "pendiente", null, db.users.trabajador)
    // Una tarea del mismo usuario en OTRA obra no se toca.
    await db.sql`INSERT INTO obra_members (project_id, user_id, role) VALUES (${db.otherProjectId}, ${target}, 'trabajador')`
    const otraObra = await db.sql<{ id: number }[]>`
      INSERT INTO obra_tasks (project_id, title, status, assigned_user_id)
      VALUES (${db.otherProjectId}, 'En otra obra', 'pendiente', ${target}) RETURNING id`

    actAs(db.users.jefe_obra)
    unwrap(await removeObraMember(db.projectId, target))

    const rows = await db.sql<{ id: number; assigned_user_id: number | null; assigned_role: string | null; status: string }[]>`
      SELECT id, assigned_user_id, assigned_role, status FROM obra_tasks
      WHERE id IN (${pendienteSinRol}, ${enProgresoConRol}, ${hecha}, ${cancelada}, ${ajena}, ${Number(otraObra[0].id)})`
    const byId = new Map(rows.map((r) => [Number(r.id), r]))
    expect(byId.get(pendienteSinRol)).toMatchObject({ assigned_user_id: null, assigned_role: "supervisor", status: "pendiente" })
    expect(byId.get(enProgresoConRol)).toMatchObject({ assigned_user_id: null, assigned_role: "trabajador", status: "en_progreso" })
    expect(byId.get(hecha)).toMatchObject({ assigned_user_id: target, assigned_role: "supervisor" })
    expect(byId.get(cancelada)).toMatchObject({ assigned_user_id: target, assigned_role: null })
    expect(byId.get(ajena)).toMatchObject({ assigned_user_id: db.users.trabajador })
    expect(byId.get(Number(otraObra[0].id))).toMatchObject({ assigned_user_id: target })

    const audit = await db.sql<{ details: { user_id: number; unassigned_tasks: number; unassigned_task_ids: number[] } }[]>`
      SELECT details FROM obra_audit_log
      WHERE project_id = ${db.projectId} AND action = 'member.removed' AND (details->>'user_id')::int = ${target}`
    expect(audit).toHaveLength(1)
    expect(audit[0].details.unassigned_tasks).toBe(2)
    expect([...audit[0].details.unassigned_task_ids].sort((a, b) => a - b)).toEqual(
      [pendienteSinRol, enProgresoConRol].sort((a, b) => a - b),
    )

    // Las tareas siguen visibles para su rol: un supervisor las ve como "suyas" (sin persona asignada).
    const { listObraTasks } = await import("@/app/actions/obra/tasks")
    actAs(db.users.supervisor)
    const mine = unwrap(await listObraTasks(db.projectId, { mine: true }))
    expect(mine.map((t) => t.id)).toContain(pendienteSinRol)
  })
})
