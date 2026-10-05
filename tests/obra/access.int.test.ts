// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { actAs, HAS_TEST_DB, setupObraTestDb, type TestDb } from "./helpers"

vi.mock("@/lib/auth", async () => (await import("./helpers")).authMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

describe.skipIf(!HAS_TEST_DB)("acceso a proyectos de obra (BD real)", () => {
  let db: TestDb

  beforeAll(async () => {
    db = await setupObraTestDb("access")
  })
  afterAll(async () => {
    await db?.close()
  })

  it("el dueño del proyecto es gerente implícito", async () => {
    const { getProjectAccessForUser } = await import("@/lib/obra/access")
    const a = await getProjectAccessForUser(db.users.gerente, db.projectId)
    expect(a?.role).toBe("gerente")
    expect(a?.is_owner).toBe(true)
  })

  it("los miembros reciben su rol", async () => {
    const { getProjectAccessForUser } = await import("@/lib/obra/access")
    const a = await getProjectAccessForUser(db.users.trabajador, db.projectId)
    expect(a?.role).toBe("trabajador")
    expect(a?.owner_user_id).toBe(db.users.gerente)
  })

  it("un extraño no tiene acceso (404, no 403)", async () => {
    const { requireProjectPermission, ObraAccessError } = await import("@/lib/obra/access")
    actAs(db.users.extrano)
    await expect(requireProjectPermission(db.projectId, "project.view")).rejects.toMatchObject({ status: 404 })
    await expect(requireProjectPermission(db.projectId, "project.view")).rejects.toBeInstanceOf(ObraAccessError)
  })

  it("sin sesión responde 401", async () => {
    const { requireProjectPermission } = await import("@/lib/obra/access")
    actAs(null)
    await expect(requireProjectPermission(db.projectId, "project.view")).rejects.toMatchObject({ status: 401 })
  })

  it("rol sin el permiso responde 403", async () => {
    const { requireProjectPermission } = await import("@/lib/obra/access")
    actAs(db.users.trabajador)
    await expect(requireProjectPermission(db.projectId, "ai.review")).rejects.toMatchObject({ status: 403 })
  })

  it("lista solo proyectos propios o donde es miembro", async () => {
    const { listProjectAccessForUser } = await import("@/lib/obra/access")
    const mine = await listProjectAccessForUser(db.users.supervisor)
    expect(mine.map((p) => p.project_id)).toEqual([db.projectId])
    const theirs = await listProjectAccessForUser(db.users.extrano)
    expect(theirs.map((p) => p.project_id)).toEqual([db.otherProjectId])
  })

  it("escribe auditoría", async () => {
    const { writeAudit } = await import("@/lib/obra/access")
    await writeAudit({ project_id: db.projectId, actor_user_id: db.users.gerente, action: "test", entity_type: "project", entity_id: db.projectId, details: { a: 1 } })
    const rows = await db.sql<{ action: string; details: unknown }[]>`SELECT action, details FROM obra_audit_log WHERE project_id = ${db.projectId}`
    expect(rows[0].action).toBe("test")
    expect(rows[0].details).toEqual({ a: 1 })
  })

  it("la BD impide aprobar una sugerencia sin revisión humana registrada", async () => {
    await expect(
      db.sql`INSERT INTO obra_ai_suggestions (project_id, kind, status, title, payload)
             VALUES (${db.projectId}, 'create_task', 'approved', 't', '{}'::jsonb)`,
    ).rejects.toThrow(/obra_suggestion_reviewed_by_human/)
  })
})
