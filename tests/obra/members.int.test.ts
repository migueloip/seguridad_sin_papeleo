// @vitest-environment node
import bcrypt from "bcryptjs"
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

  it("crea un usuario nuevo con contraseña temporal (una sola vez) y email en minúsculas", async () => {
    const { addObraMember } = await import("@/app/actions/obra/members")
    actAs(db.users.gerente)
    const r = unwrap(await addObraMember(db.projectId, { email: "  Nuevo.Integrante@Test.CL ", name: "Nuevo Integrante", role: "trabajador" }))
    expect(r.member).toMatchObject({ email: "nuevo.integrante@test.cl", role: "trabajador", is_owner: false, project_id: db.projectId })
    expect(r.temporary_password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]{12}$/)

    const u = await db.sql<{ email: string; name: string; password_hash: string; role: string }[]>`
      SELECT email, name, password_hash, role FROM users WHERE id = ${r.member.user_id}`
    expect(u[0].email).toBe("nuevo.integrante@test.cl")
    expect(u[0].role).toBe("user")
    expect(await bcrypt.compare(r.temporary_password as string, u[0].password_hash)).toBe(true)

    // Duplicado (mismo email con otra capitalización) → error claro.
    expectError(await addObraMember(db.projectId, { email: "NUEVO.integrante@test.cl", role: "supervisor" }), /ya es parte del equipo/)

    const audit = await db.sql<{ details: { new_user: boolean; email: string } }[]>`
      SELECT details FROM obra_audit_log WHERE project_id = ${db.projectId} AND action = 'member.added' AND entity_id = ${r.member.id}`
    expect(audit[0].details).toMatchObject({ new_user: true, email: "nuevo.integrante@test.cl" })
    expect(JSON.stringify(audit[0].details)).not.toContain(r.temporary_password as string)
  })

  it("reutiliza un usuario existente sin contraseña temporal y sin tocar su clave", async () => {
    const { addObraMember } = await import("@/app/actions/obra/members")
    const existing = await mkUser("existente")
    actAs(db.users.jefe_obra)
    const r = unwrap(await addObraMember(db.projectId, { email: "EXISTENTE@test.cl", role: "supervisor" }))
    expect(r.temporary_password).toBeNull()
    expect(r.member.user_id).toBe(existing)
    const u = await db.sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${existing}`
    expect(u[0].password_hash).toBe("x")
  })

  it("no permite agregar al dueño, emails inválidos ni roles desconocidos", async () => {
    const { addObraMember } = await import("@/app/actions/obra/members")
    actAs(db.users.gerente)
    expectError(await addObraMember(db.projectId, { email: "gerente@test.cl", role: "supervisor" }), /dueño/)
    expectError(await addObraMember(db.projectId, { email: "no-es-correo", role: "supervisor" }), /correo electrónico válido/)
    expectError(
      await addObraMember(db.projectId, { email: "rol@test.cl", role: "admin" as never }),
      /Rol no válido/,
    )
  })

  it("solo members.manage agrega integrantes; solo un gerente nombra gerentes", async () => {
    const { addObraMember } = await import("@/app/actions/obra/members")
    for (const role of ["prevencionista", "supervisor", "trabajador", "visita"] as const) {
      actAs(db.users[role])
      expectError(await addObraMember(db.projectId, { email: `x-${role}@test.cl`, role: "trabajador" }), DENIED)
    }
    actAs(db.users.extrano)
    expectError(await addObraMember(db.projectId, { email: "x-extrano@test.cl", role: "trabajador" }), NOT_FOUND_PROJECT)

    actAs(db.users.jefe_obra)
    expectError(await addObraMember(db.projectId, { email: "x-gerente@test.cl", role: "gerente" }), /no puede asignar el rol/)
    actAs(db.users.gerente)
    const g = unwrap(await addObraMember(db.projectId, { email: "segundo.gerente@test.cl", role: "gerente" }))
    expect(g.member.role).toBe("gerente")
  })

  it("vincula solo trabajadores del dueño del proyecto", async () => {
    const { addObraMember, listObraLinkableWorkers } = await import("@/app/actions/obra/members")
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
      await addObraMember(db.projectId, { email: "vinculo1@test.cl", role: "trabajador", worker_id: Number(foreign[0].id) }),
      /no pertenece a esta obra/,
    )
    const ok = unwrap(await addObraMember(db.projectId, { email: "vinculo2@test.cl", role: "trabajador", worker_id: Number(own[0].id) }))
    expect(ok.member).toMatchObject({ worker_id: Number(own[0].id), worker_name: "Juan Pérez" })

    actAs(db.users.trabajador)
    expectError(await listObraLinkableWorkers(db.projectId), DENIED)
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
})
