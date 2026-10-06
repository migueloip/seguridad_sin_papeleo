// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { ObraProjectSummary, ObraTask } from "@/lib/obra/types"
import { HAS_TEST_DB, setupObraTestDb, type TestDb } from "./helpers"

vi.mock("@/lib/auth", async () => (await import("./helpers")).authMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const BASE = "http://localhost/api/mobile/obra/tasks"

describe.skipIf(!HAS_TEST_DB)("API móvil de tareas de obra (BD real, Bearer)", () => {
  let db: TestDb
  const tokens = { trabajador: "tok-trabajador", supervisor: "tok-supervisor", extrano: "tok-extrano", vencido: "tok-vencido" }
  const tasks = { own: 0, byRole: 0, other: 0, foreign: 0 }

  function get(query: string, token?: string) {
    return new Request(`${BASE}${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  }

  function post(id: string | number, body: unknown, token?: string) {
    return new Request(`${BASE}/${id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  }

  async function callPost(id: string | number, body: unknown, token?: string) {
    const { POST } = await import("@/app/api/mobile/obra/tasks/[id]/status/route")
    return POST(post(id, body, token), { params: Promise.resolve({ id: String(id) }) })
  }

  beforeAll(async () => {
    db = await setupObraTestDb("mobile_int_test")
    for (const [key, user] of [
      ["trabajador", db.users.trabajador],
      ["supervisor", db.users.supervisor],
      ["extrano", db.users.extrano],
    ] as const) {
      await db.sql`INSERT INTO sessions (user_id, token, expires_at)
                   VALUES (${user}, ${tokens[key]}, CURRENT_TIMESTAMP + interval '1 day')`
    }
    await db.sql`INSERT INTO sessions (user_id, token, expires_at)
                 VALUES (${db.users.trabajador}, ${tokens.vencido}, CURRENT_TIMESTAMP - interval '1 minute')`

    const mk = async (projectId: number, title: string, role: string | null, user: number | null) => {
      const r = await db.sql<{ id: number }[]>`
        INSERT INTO obra_tasks (project_id, title, assigned_role, assigned_user_id)
        VALUES (${projectId}, ${title}, ${role}, ${user}) RETURNING id`
      return Number(r[0].id)
    }
    tasks.own = await mk(db.projectId, "Asignada al trabajador", null, db.users.trabajador)
    tasks.byRole = await mk(db.projectId, "Para su rol", "trabajador", null)
    tasks.other = await mk(db.projectId, "Para supervisores", "supervisor", null)
    tasks.foreign = await mk(db.otherProjectId, "De otra obra", "trabajador", null)
  })
  afterAll(async () => {
    await db?.close()
  })

  it("OPTIONS responde 204 con CORS", async () => {
    const list = await import("@/app/api/mobile/obra/tasks/route")
    const status = await import("@/app/api/mobile/obra/tasks/[id]/status/route")
    for (const res of [list.OPTIONS(), status.OPTIONS()]) {
      expect(res.status).toBe(204)
      expect(res.headers.get("access-control-allow-origin")).toBe("*")
      expect(res.headers.get("access-control-allow-headers")).toMatch(/Authorization/)
    }
  })

  it("sin token o con token vencido responde 401", async () => {
    const { GET } = await import("@/app/api/mobile/obra/tasks/route")
    expect((await GET(get(""))).status).toBe(401)
    expect((await GET(get("", tokens.vencido))).status).toBe(401)
    expect((await GET(get("", "token-inventado"))).status).toBe(401)
    expect((await callPost(tasks.own, { status: "hecha" })).status).toBe(401)
    expect((await callPost(tasks.own, { status: "hecha" }, tokens.vencido)).status).toBe(401)
  })

  it("sin project_id lista las obras del usuario con su rol", async () => {
    const { GET } = await import("@/app/api/mobile/obra/tasks/route")
    const res = await GET(get("", tokens.trabajador))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { projects: ObraProjectSummary[] }
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0]).toMatchObject({ project_id: db.projectId, role: "trabajador", my_open_tasks: 2, open_tasks: 2 })
  })

  it("con project_id devuelve solo las tareas visibles para ese usuario", async () => {
    const { GET } = await import("@/app/api/mobile/obra/tasks/route")
    const res = await GET(get(`?project_id=${db.projectId}`, tokens.trabajador))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tasks: ObraTask[] }
    expect(body.tasks.map((t) => t.id).sort()).toEqual([tasks.own, tasks.byRole].sort())

    const sup = (await (await GET(get(`?project_id=${db.projectId}`, tokens.supervisor))).json()) as { tasks: ObraTask[] }
    expect(sup.tasks).toHaveLength(3)
    const supMine = (await (await GET(get(`?project_id=${db.projectId}&mine=1`, tokens.supervisor))).json()) as {
      tasks: ObraTask[]
    }
    expect(supMine.tasks.map((t) => t.id)).toEqual([tasks.other])

    const filtered = await GET(get(`?project_id=${db.projectId}&status=hecha`, tokens.trabajador))
    expect(((await filtered.json()) as { tasks: ObraTask[] }).tasks).toEqual([])
    expect((await GET(get(`?project_id=${db.projectId}&status=nope`, tokens.trabajador))).status).toBe(400)
  })

  it("project_id ajeno → 404; project_id inválido → 400", async () => {
    const { GET } = await import("@/app/api/mobile/obra/tasks/route")
    const res = await GET(get(`?project_id=${db.otherProjectId}`, tokens.trabajador))
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toMatch(/Proyecto no encontrado/)
    expect((await GET(get(`?project_id=${db.projectId}`, tokens.extrano))).status).toBe(404)
    expect((await GET(get("?project_id=abc", tokens.trabajador))).status).toBe(400)
    expect((await GET(get("?project_id=1%20OR%201=1", tokens.trabajador))).status).toBe(400)
  })

  it("POST status: el trabajador cierra su tarea con notas", async () => {
    const res = await callPost(tasks.own, { status: "hecha", notes: "Retirado el material" }, tokens.trabajador)
    expect(res.status).toBe(200)
    const { task } = (await res.json()) as { task: ObraTask }
    expect(task).toMatchObject({ id: tasks.own, status: "hecha", completed_by: db.users.trabajador, completion_notes: "Retirado el material" })
    const row = await db.sql<{ status: string }[]>`SELECT status FROM obra_tasks WHERE id = ${tasks.own}`
    expect(row[0].status).toBe("hecha")
    const audit = await db.sql<{ actor_user_id: number }[]>`
      SELECT actor_user_id FROM obra_audit_log WHERE action = 'task.status_changed' AND entity_id = ${tasks.own}`
    expect(audit.map((a) => Number(a.actor_user_id))).toEqual([db.users.trabajador])
  })

  it("POST status: tareas que no ve o de otra obra → 404; sin permiso → 403; entrada inválida → 400", async () => {
    expect((await callPost(tasks.other, { status: "hecha" }, tokens.trabajador)).status).toBe(404)
    expect((await callPost(tasks.foreign, { status: "hecha" }, tokens.trabajador)).status).toBe(404)
    expect((await callPost(tasks.byRole, { status: "hecha" }, tokens.extrano)).status).toBe(404)
    expect((await callPost(999999, { status: "hecha" }, tokens.trabajador)).status).toBe(404)
    expect((await callPost("abc", { status: "hecha" }, tokens.trabajador)).status).toBe(404)
    expect((await callPost(tasks.byRole, { status: "cancelada" }, tokens.trabajador)).status).toBe(403)
    expect((await callPost(tasks.byRole, { status: "lista" }, tokens.trabajador)).status).toBe(400)
    expect((await callPost(tasks.byRole, "no-json", tokens.trabajador)).status).toBe(400)
    expect((await callPost(tasks.byRole, { status: "hecha", notes: 123 }, tokens.trabajador)).status).toBe(400)

    const foreign = await db.sql<{ status: string }[]>`SELECT status FROM obra_tasks WHERE id = ${tasks.foreign}`
    expect(foreign[0].status).toBe("pendiente")

    // El supervisor (tasks.complete_any) sí puede cerrar la de su rol.
    const ok = await callPost(tasks.other, { status: "en_progreso" }, tokens.supervisor)
    expect(ok.status).toBe(200)
  })

  it("GET sin project_id: pending_suggestions es 0 para roles sin ai.review y real para quien revisa", async () => {
    const { GET } = await import("@/app/api/mobile/obra/tasks/route")
    const sg = await db.sql<{ id: number }[]>`
      INSERT INTO obra_ai_suggestions (project_id, kind, status, title, severity, payload)
      VALUES (${db.projectId}, 'create_task', 'pending', 'Pendiente para revisar', 'high', '{"title":"x"}'::jsonb)
      RETURNING id`
    await db.sql`INSERT INTO sessions (user_id, token, expires_at)
                 VALUES (${db.users.prevencionista}, 'tok-prevencionista', CURRENT_TIMESTAMP + interval '1 day')`
    try {
      for (const token of [tokens.trabajador, tokens.supervisor]) {
        const body = (await (await GET(get("", token))).json()) as { projects: ObraProjectSummary[] }
        const p = body.projects.find((x) => x.project_id === db.projectId)
        expect(p?.pending_suggestions).toBe(0)
      }
      const prev = (await (await GET(get("", "tok-prevencionista"))).json()) as { projects: ObraProjectSummary[] }
      expect(prev.projects.find((x) => x.project_id === db.projectId)).toMatchObject({ role: "prevencionista", pending_suggestions: 1 })
    } finally {
      await db.sql`DELETE FROM obra_ai_suggestions WHERE id = ${sg[0].id}`
      await db.sql`DELETE FROM sessions WHERE token = 'tok-prevencionista'`
    }
  })
})
