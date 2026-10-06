// @vitest-environment node
import crypto from "node:crypto"
import bcrypt from "bcryptjs"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult, InvitationLink } from "@/lib/obra/types"
import { actAs, HAS_TEST_DB, setupObraTestDb, type TestDb } from "./helpers"

const createSessionMock = vi.hoisted(() => vi.fn(async (userId: number) => void userId))
const headerState = vi.hoisted(() => ({ values: {} as Record<string, string> }))

vi.mock("@/lib/auth", async () => ({ ...(await import("./helpers")).authMock, createSession: createSessionMock }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("next/headers", () => ({
  headers: async () => new Headers(headerState.values),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}))

function unwrap<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`Se esperaba ok y llegó error: ${(r as { error?: string }).error}`)
  return r.data
}

function expectError<T>(r: ActionResult<T>, pattern: RegExp) {
  expect(r.ok).toBe(false)
  expect((r as { error?: string }).error).toMatch(pattern)
}

function tokenOf(link: InvitationLink): string {
  const m = /\/invitacion\/([A-Za-z0-9_-]{43})$/.exec(link.url)
  if (!m) throw new Error(`URL de invitación inesperada: ${link.url}`)
  return m[1]
}

const DENIED = /no permite esta acción/
const NOT_FOUND_PROJECT = /Proyecto no encontrado/
const NOT_FOUND_INV = /Invitación no encontrada/
const PENDING = /Ya hay una invitación pendiente para ese correo/
const IN_TEAM = /Esa persona ya es parte del equipo/
const BASE = "https://easysecure.test"

describe.skipIf(!HAS_TEST_DB)("invitaciones al equipo de obra (BD real)", () => {
  let db: TestDb

  async function mkUser(key: string, password = "x"): Promise<number> {
    const r = await db.sql<{ id: number }[]>`
      INSERT INTO users (email, name, password_hash, role) VALUES (${`${key}@test.cl`}, ${key}, ${password}, 'user') RETURNING id`
    return Number(r[0].id)
  }

  async function invite(email: string, role = "trabajador", as = db.users.gerente): Promise<InvitationLink> {
    const { createObraInvitation } = await import("@/app/actions/obra/invitations")
    actAs(as)
    return unwrap(await createObraInvitation(db.projectId, { email, role: role as never }))
  }

  async function memberRows(userId: number, projectId = db.projectId) {
    return db.sql<{ id: number; role: string; worker_id: number | null; invited_by: number | null }[]>`
      SELECT id, role, worker_id, invited_by FROM obra_members WHERE project_id = ${projectId} AND user_id = ${userId}`
  }

  beforeAll(async () => {
    db = await setupObraTestDb("invitations_int_test")
  })
  beforeEach(() => {
    process.env.APP_URL = BASE
    delete process.env.URL
    headerState.values = {}
  })
  afterAll(async () => {
    await db?.close()
  })

  it("solo gerente y jefe de obra invitan; el jefe no invita gerentes; un extraño no ve la obra", async () => {
    const { createObraInvitation } = await import("@/app/actions/obra/invitations")
    for (const role of ["prevencionista", "supervisor", "trabajador", "visita"] as const) {
      actAs(db.users[role])
      expectError(await createObraInvitation(db.projectId, { email: `x-${role}@test.cl`, role: "trabajador" }), DENIED)
    }
    actAs(db.users.extrano)
    expectError(await createObraInvitation(db.projectId, { email: "x-extrano@test.cl", role: "trabajador" }), NOT_FOUND_PROJECT)
    actAs(null)
    expectError(await createObraInvitation(db.projectId, { email: "x-anon@test.cl", role: "trabajador" }), /Sesión no válida/)

    actAs(db.users.jefe_obra)
    expectError(await createObraInvitation(db.projectId, { email: "x-gerente@test.cl", role: "gerente" }), /no puede asignar el rol/)
    const j = unwrap(await createObraInvitation(db.projectId, { email: "  Jefe.Invita@Test.CL ", role: "supervisor" }))
    expect(j.invitation).toMatchObject({
      project_id: db.projectId,
      email: "jefe.invita@test.cl",
      role: "supervisor",
      status: "pendiente",
      invited_by: db.users.jefe_obra,
      accepted_at: null,
    })
    expect(j.url).toMatch(/^https:\/\/easysecure\.test\/invitacion\/[A-Za-z0-9_-]{43}$/)

    actAs(db.users.gerente)
    const g = unwrap(await createObraInvitation(db.projectId, { email: "segundo.gerente@test.cl", role: "gerente", name: "Ana Gerente" }))
    expect(g.invitation).toMatchObject({ role: "gerente", name: "Ana Gerente", invited_by_name: "gerente" })

    expectError(await createObraInvitation(db.projectId, { email: "no-es-correo", role: "supervisor" }), /correo electrónico válido/)
    expectError(await createObraInvitation(db.projectId, { email: "rol@test.cl", role: "admin" as never }), /Rol no válido/)
    expectError(await createObraInvitation(db.projectId, { email: "nombre@test.cl", role: "visita", name: "x" }), /El nombre/)
  })

  it("guarda solo el hash del token (32 bytes aleatorios) y nunca el token en la auditoría", async () => {
    const link = await invite("hash.check@test.cl")
    const token = tokenOf(link)
    expect(Buffer.from(token, "base64url")).toHaveLength(32)
    const rows = await db.sql<{ token_hash: string; expires_in_days: number }[]>`
      SELECT token_hash, EXTRACT(EPOCH FROM (expires_at - created_at)) / 86400 AS expires_in_days
      FROM obra_invitations WHERE id = ${link.invitation.id}`
    expect(rows[0].token_hash).toBe(crypto.createHash("sha256").update(token).digest("hex"))
    expect(Math.round(Number(rows[0].expires_in_days))).toBe(7)

    const dump = await db.sql<{ t: string }[]>`
      SELECT string_agg(details::text, ' ') AS t FROM obra_audit_log WHERE project_id = ${db.projectId}`
    expect(dump[0].t).not.toContain(token)
    expect(dump[0].t).not.toContain(rows[0].token_hash)
    const created = await db.sql<{ details: Record<string, unknown> }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'invitation.created' AND entity_id = ${link.invitation.id}`
    expect(created[0].details).toMatchObject({ email: "hash.check@test.cl", role: "trabajador" })
  })

  it("no revela si el correo ya tiene cuenta: misma respuesta y misma auditoría", async () => {
    await mkUser("con.cuenta", "hash-secreto")
    await db.sql`UPDATE users SET name = 'Nombre Secreto' WHERE email = 'con.cuenta@test.cl'`
    const a = await invite("con.cuenta@test.cl")
    const b = await invite("sin.cuenta@test.cl")
    const shape = (l: InvitationLink) => ({
      ...l.invitation,
      id: 0,
      email: "",
      created_at: "",
      expires_at: "",
      url: l.url.replace(/[A-Za-z0-9_-]{43}$/, "<token>"),
    })
    expect(shape(a)).toEqual(shape(b))
    expect(JSON.stringify(a)).not.toContain("Nombre Secreto")

    const audit = await db.sql<{ entity_id: number; details: Record<string, unknown> }[]>`
      SELECT entity_id, details FROM obra_audit_log
      WHERE action = 'invitation.created' AND entity_id IN (${a.invitation.id}, ${b.invitation.id}) ORDER BY entity_id`
    expect(Object.keys(audit[0].details).sort()).toEqual(Object.keys(audit[1].details).sort())

    // Aún no es miembro: crear la invitación no lo agrega.
    const u = await db.sql<{ id: number }[]>`SELECT id FROM users WHERE email = 'con.cuenta@test.cl'`
    expect(await memberRows(Number(u[0].id))).toHaveLength(0)
  })

  it("no invita a quien ya es parte del equipo (dueño o integrante), sin importar mayúsculas", async () => {
    const { createObraInvitation } = await import("@/app/actions/obra/invitations")
    actAs(db.users.gerente)
    expectError(await createObraInvitation(db.projectId, { email: "GERENTE@test.cl", role: "visita" }), IN_TEAM)
    expectError(await createObraInvitation(db.projectId, { email: "Supervisor@Test.cl", role: "visita" }), IN_TEAM)
  })

  it("no duplica una invitación abierta (ni en paralelo); una vencida se reemplaza", async () => {
    const { createObraInvitation, listObraInvitations, regenerateObraInvitationLink } = await import(
      "@/app/actions/obra/invitations"
    )
    const first = await invite("duplicada@test.cl")
    actAs(db.users.gerente)
    expectError(await createObraInvitation(db.projectId, { email: "DUPLICADA@test.cl", role: "visita" }), PENDING)

    // Dos creaciones simultáneas para el mismo correo → una sola invitación.
    const both = await Promise.all([
      createObraInvitation(db.projectId, { email: "paralelo@test.cl", role: "visita" }),
      createObraInvitation(db.projectId, { email: "paralelo@test.cl", role: "visita" }),
    ])
    expect(both.filter((r) => r.ok)).toHaveLength(1)
    expectError(both.find((r) => !r.ok) as ActionResult<InvitationLink>, PENDING)
    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_invitations WHERE email = 'paralelo@test.cl'`
    expect(n[0].n).toBe(1)

    // Vence → se puede crear otra; la anterior queda cerrada y se ve "vencida".
    await db.sql`UPDATE obra_invitations SET expires_at = LOCALTIMESTAMP - interval '1 hour' WHERE id = ${first.invitation.id}`
    const second = unwrap(await createObraInvitation(db.projectId, { email: "duplicada@test.cl", role: "supervisor" }))
    expect(second.invitation.id).not.toBe(first.invitation.id)
    const list = unwrap(await listObraInvitations(db.projectId))
    expect(list.find((i) => i.id === first.invitation.id)?.status).toBe("vencida")
    expect(list.find((i) => i.id === second.invitation.id)?.status).toBe("pendiente")
    expect(list.findIndex((i) => i.id === second.invitation.id)).toBeLessThan(list.findIndex((i) => i.id === first.invitation.id))
    const replaced = await db.sql<{ revoked_at: Date | null }[]>`SELECT revoked_at FROM obra_invitations WHERE id = ${first.invitation.id}`
    expect(replaced[0].revoked_at).not.toBeNull()
    const audit = await db.sql<{ details: { replaced_invitation_id: number | null } }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'invitation.created' AND entity_id = ${second.invitation.id}`
    expect(audit[0].details.replaced_invitation_id).toBe(first.invitation.id)

    // La reemplazada ya no se puede regenerar; su token tampoco sirve.
    expectError(await regenerateObraInvitationLink(first.invitation.id), /reemplazó/)
    const { getInvitationPreview } = await import("@/lib/obra/server/invitations")
    expect((await getInvitationPreview(tokenOf(first)))?.status).toBe("vencida")
  })

  it("regenerar cambia el token (el anterior deja de servir) y renueva una vencida", async () => {
    const { regenerateObraInvitationLink, acceptObraInvitation } = await import("@/app/actions/obra/invitations")
    const { getInvitationPreview } = await import("@/lib/obra/server/invitations")
    const link = await invite("regenerar@test.cl", "prevencionista")
    const oldToken = tokenOf(link)
    await db.sql`UPDATE obra_invitations SET expires_at = LOCALTIMESTAMP - interval '1 minute' WHERE id = ${link.invitation.id}`
    expect((await getInvitationPreview(oldToken))?.status).toBe("vencida")

    actAs(db.users.jefe_obra)
    const again = unwrap(await regenerateObraInvitationLink(link.invitation.id))
    const newToken = tokenOf(again)
    expect(newToken).not.toBe(oldToken)
    expect(again.invitation).toMatchObject({ id: link.invitation.id, status: "pendiente" })
    expect(await getInvitationPreview(oldToken)).toBeNull()
    expect((await getInvitationPreview(newToken))?.status).toBe("pendiente")

    const user = await mkUser("regenerar")
    actAs(user)
    expectError(await acceptObraInvitation(oldToken), NOT_FOUND_INV)
    expect((await memberRows(user)).length).toBe(0)

    const audit = await db.sql<{ actor_user_id: number; details: { was_expired: boolean } }[]>`
      SELECT actor_user_id, details FROM obra_audit_log WHERE action = 'invitation.regenerated' AND entity_id = ${link.invitation.id}`
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor_user_id: db.users.jefe_obra, details: { was_expired: true } })
  })

  it("revocar deja el enlace sin efecto y solo se revocan pendientes", async () => {
    const { revokeObraInvitation, regenerateObraInvitationLink, acceptObraInvitation } = await import(
      "@/app/actions/obra/invitations"
    )
    const { getInvitationPreview } = await import("@/lib/obra/server/invitations")
    const link = await invite("revocar@test.cl", "visita")
    actAs(db.users.gerente)
    const r = unwrap(await revokeObraInvitation(link.invitation.id))
    expect(r).toMatchObject({ id: link.invitation.id, status: "revocada" })
    expect((await getInvitationPreview(tokenOf(link)))?.status).toBe("revocada")
    expectError(await revokeObraInvitation(link.invitation.id), /ya estaba revocada/)
    expectError(await regenerateObraInvitationLink(link.invitation.id), /fue revocada/)

    const user = await mkUser("revocar")
    actAs(user)
    expectError(await acceptObraInvitation(tokenOf(link)), /fue revocada/)
    expect((await memberRows(user)).length).toBe(0)

    // Una vencida no se "revoca" (ya no sirve).
    const expired = await invite("revocar.vencida@test.cl")
    await db.sql`UPDATE obra_invitations SET expires_at = LOCALTIMESTAMP - interval '1 minute' WHERE id = ${expired.invitation.id}`
    actAs(db.users.gerente)
    expectError(await revokeObraInvitation(expired.invitation.id), /ya venció/)

    // El jefe de obra no revoca ni regenera la invitación de un gerente.
    const gerenteInv = await invite("otro.gerente.inv@test.cl", "gerente")
    actAs(db.users.jefe_obra)
    expectError(await revokeObraInvitation(gerenteInv.invitation.id), /no puede asignar el rol/)
    expectError(await regenerateObraInvitationLink(gerenteInv.invitation.id), /no puede asignar el rol/)

    const audit = await db.sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM obra_audit_log WHERE action = 'invitation.revoked' AND entity_id = ${link.invitation.id}`
    expect(audit[0].n).toBe(1)
  })

  it("vista previa pública: datos para la página, sin ids; null para tokens inválidos o desconocidos", async () => {
    const { getInvitationPreview } = await import("@/lib/obra/server/invitations")
    const { createObraInvitation } = await import("@/app/actions/obra/invitations")
    actAs(db.users.jefe_obra)
    const link = unwrap(await createObraInvitation(db.projectId, { email: "preview@test.cl", role: "supervisor", name: "Pía Preview" }))
    actAs(null)
    const p = await getInvitationPreview(tokenOf(link))
    expect(p).toEqual({
      project_name: "Edificio Los Aromos",
      role: "supervisor",
      email: "preview@test.cl",
      name: "Pía Preview",
      inviter_name: "jefe_obra",
      status: "pendiente",
      expires_at: link.invitation.expires_at,
    })
    expect(Object.keys(p ?? {})).not.toEqual(expect.arrayContaining(["id"]))
    expect(await getInvitationPreview("corto")).toBeNull()
    expect(await getInvitationPreview("x".repeat(43) + "'")).toBeNull()
    expect(await getInvitationPreview(crypto.randomBytes(32).toString("base64url"))).toBeNull()
  })

  it("acepta con sesión si el correo coincide; si no, explica con qué correo entrar", async () => {
    const { acceptObraInvitation } = await import("@/app/actions/obra/invitations")
    const worker = await db.sql<{ id: number }[]>`
      INSERT INTO workers (rut, first_name, last_name, user_id, project_id)
      VALUES ('15.555.555-5', 'Luis', 'Terreno', ${db.users.gerente}, ${db.projectId}) RETURNING id`
    const { createObraInvitation } = await import("@/app/actions/obra/invitations")
    actAs(db.users.gerente)
    const link = unwrap(
      await createObraInvitation(db.projectId, { email: "Luis.Terreno@test.cl", role: "trabajador", worker_id: Number(worker[0].id) }),
    )
    const token = tokenOf(link)

    const otro = await mkUser("otra.persona")
    actAs(otro)
    expectError(await acceptObraInvitation(token), /Esta invitación es para otro correo\. Cierra sesión e ingresa con luis\.terreno@test\.cl\./)
    expect(await memberRows(otro)).toHaveLength(0)

    actAs(null)
    expectError(await acceptObraInvitation(token), /Sesión no válida/)

    const r = await db.sql<{ id: number }[]>`
      INSERT INTO users (email, name, password_hash, role) VALUES ('LUIS.terreno@test.cl', 'Luis', 'x', 'user') RETURNING id`
    const luis = Number(r[0].id)
    actAs(luis)
    expect(unwrap(await acceptObraInvitation(token))).toEqual({ project_id: db.projectId })
    const m = await memberRows(luis)
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ role: "trabajador", worker_id: Number(worker[0].id), invited_by: db.users.gerente })

    // Repetir (doble clic) devuelve el mismo proyecto sin duplicar.
    expect(unwrap(await acceptObraInvitation(token))).toEqual({ project_id: db.projectId })
    expect(await memberRows(luis)).toHaveLength(1)

    const inv = await db.sql<{ accepted_user_id: number; accepted_at: Date | null }[]>`
      SELECT accepted_user_id, accepted_at FROM obra_invitations WHERE id = ${link.invitation.id}`
    expect(inv[0].accepted_user_id).toBe(luis)
    expect(inv[0].accepted_at).not.toBeNull()
    const audit = await db.sql<{ action: string; actor_user_id: number; entity_type: string }[]>`
      SELECT action, actor_user_id, entity_type FROM obra_audit_log
      WHERE project_id = ${db.projectId} AND action IN ('invitation.accepted', 'member.added') AND actor_user_id = ${luis}
      ORDER BY id`
    expect(audit).toEqual([
      { action: "invitation.accepted", actor_user_id: luis, entity_type: "invitation" },
      { action: "member.added", actor_user_id: luis, entity_type: "member" },
    ])

    // Otra persona no puede usar el enlace ya aceptado.
    actAs(otro)
    expectError(await acceptObraInvitation(token), /ya fue aceptada/)
  })

  it("si ya era integrante, aceptar solo marca la invitación (sin duplicar ni cambiar su rol)", async () => {
    const { acceptObraInvitation } = await import("@/app/actions/obra/invitations")
    const u = await mkUser("ya.miembro")
    const link = await invite("ya.miembro@test.cl", "visita")
    await db.sql`INSERT INTO obra_members (project_id, user_id, role) VALUES (${db.projectId}, ${u}, 'supervisor')`
    actAs(u)
    expect(unwrap(await acceptObraInvitation(tokenOf(link)))).toEqual({ project_id: db.projectId })
    const m = await memberRows(u)
    expect(m).toHaveLength(1)
    expect(m[0].role).toBe("supervisor")
    const audit = await db.sql<{ details: { already_in_team: boolean } }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'invitation.accepted' AND entity_id = ${link.invitation.id}`
    expect(audit[0].details.already_in_team).toBe(true)
  })

  it("acepta creando la cuenta (con SU contraseña) y abre la sesión", async () => {
    const { acceptObraInvitationWithNewAccount } = await import("@/app/actions/obra/invitations")
    const { createObraInvitation } = await import("@/app/actions/obra/invitations")
    actAs(db.users.gerente)
    const link = unwrap(await createObraInvitation(db.projectId, { email: "Nueva.Cuenta@Test.cl", role: "supervisor" }))
    const token = tokenOf(link)
    actAs(null)

    expectError(await acceptObraInvitationWithNewAccount(token, { name: "Nueva", password: "corta" }), /al menos 8 caracteres/)
    expectError(await acceptObraInvitationWithNewAccount(token, { name: "N", password: "suficiente123" }), /El nombre/)
    expectError(await acceptObraInvitationWithNewAccount("no-es-token", { name: "Nueva", password: "suficiente123" }), NOT_FOUND_INV)

    createSessionMock.mockClear()
    const res = unwrap(await acceptObraInvitationWithNewAccount(token, { name: "  Nueva   Cuenta ", password: "suficiente123" }))
    expect(res).toEqual({ project_id: db.projectId })
    const u = await db.sql<{ id: number; email: string; name: string; password_hash: string; role: string }[]>`
      SELECT id, email, name, password_hash, role FROM users WHERE lower(email) = 'nueva.cuenta@test.cl'`
    expect(u).toHaveLength(1)
    expect(u[0]).toMatchObject({ email: "nueva.cuenta@test.cl", name: "Nueva Cuenta", role: "user" })
    expect(await bcrypt.compare("suficiente123", u[0].password_hash)).toBe(true)
    expect(createSessionMock).toHaveBeenCalledTimes(1)
    expect(createSessionMock).toHaveBeenCalledWith(Number(u[0].id))
    const m = await memberRows(Number(u[0].id))
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ role: "supervisor", invited_by: db.users.gerente })

    // El enlace ya no sirve para otra cuenta.
    expectError(await acceptObraInvitationWithNewAccount(token, { name: "Otra", password: "suficiente123" }), /ya fue aceptada/)
    // Ni el registro normal duplica el correo.
    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM users WHERE lower(email) = 'nueva.cuenta@test.cl'`
    expect(n[0].n).toBe(1)
  })

  it("no crea cuenta si el correo ya tiene una (pide iniciar sesión) ni con enlaces vencidos", async () => {
    const { acceptObraInvitationWithNewAccount } = await import("@/app/actions/obra/invitations")
    await mkUser("ya.registrada", "hash-original")
    const link = await invite("ya.registrada@test.cl", "visita")
    actAs(null)
    createSessionMock.mockClear()
    expectError(
      await acceptObraInvitationWithNewAccount(tokenOf(link), { name: "Impostor", password: "otraclave123" }),
      /Ya existe una cuenta con este correo: inicia sesión para aceptar la invitación\./,
    )
    const u = await db.sql<{ password_hash: string; name: string }[]>`SELECT password_hash, name FROM users WHERE email = 'ya.registrada@test.cl'`
    expect(u[0]).toEqual({ password_hash: "hash-original", name: "ya.registrada" })
    const inv = await db.sql<{ accepted_at: Date | null }[]>`SELECT accepted_at FROM obra_invitations WHERE id = ${link.invitation.id}`
    expect(inv[0].accepted_at).toBeNull()
    expect(createSessionMock).not.toHaveBeenCalled()

    const vencida = await invite("vencida.nueva@test.cl")
    await db.sql`UPDATE obra_invitations SET expires_at = LOCALTIMESTAMP - interval '1 minute' WHERE id = ${vencida.invitation.id}`
    actAs(null)
    expectError(await acceptObraInvitationWithNewAccount(tokenOf(vencida), { name: "Tarde", password: "suficiente123" }), /venció/)
    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM users WHERE email = 'vencida.nueva@test.cl'`
    expect(n[0].n).toBe(0)
  })

  it("carreras: dos aceptaciones simultáneas dejan una sola cuenta y una sola membresía", async () => {
    const { acceptObraInvitationWithNewAccount, acceptObraInvitation } = await import("@/app/actions/obra/invitations")
    const link = await invite("carrera@test.cl", "trabajador")
    actAs(null)
    const results = await Promise.all([
      acceptObraInvitationWithNewAccount(tokenOf(link), { name: "Carrera Uno", password: "suficiente123" }),
      acceptObraInvitationWithNewAccount(tokenOf(link), { name: "Carrera Dos", password: "suficiente123" }),
      acceptObraInvitationWithNewAccount(tokenOf(link), { name: "Carrera Tres", password: "suficiente123" }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    for (const r of results.filter((x) => !x.ok)) expectError(r, /ya fue aceptada|Ya existe una cuenta/)
    const users = await db.sql<{ id: number }[]>`SELECT id FROM users WHERE lower(email) = 'carrera@test.cl'`
    expect(users).toHaveLength(1)
    expect(await memberRows(Number(users[0].id))).toHaveLength(1)

    // Con sesión, en paralelo: una membresía y un solo member.added.
    const u = await mkUser("carrera.sesion")
    const link2 = await invite("carrera.sesion@test.cl", "visita")
    actAs(u)
    const both = await Promise.all([acceptObraInvitation(tokenOf(link2)), acceptObraInvitation(tokenOf(link2))])
    expect(both.every((r) => r.ok)).toBe(true)
    expect(await memberRows(u)).toHaveLength(1)
    const added = await db.sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM obra_audit_log WHERE action = 'member.added' AND actor_user_id = ${u}`
    expect(added[0].n).toBe(1)
  })

  it("una invitación de otra obra solo da acceso a ESA obra", async () => {
    const { createObraInvitation, acceptObraInvitation } = await import("@/app/actions/obra/invitations")
    actAs(db.users.extrano)
    const foreign = unwrap(await createObraInvitation(db.otherProjectId, { email: "cruzada@test.cl", role: "jefe_obra" }))
    expect(foreign.invitation.project_id).toBe(db.otherProjectId)
    const u = await mkUser("cruzada")
    actAs(u)
    expect(unwrap(await acceptObraInvitation(tokenOf(foreign)))).toEqual({ project_id: db.otherProjectId })
    expect(await memberRows(u, db.otherProjectId)).toHaveLength(1)
    expect(await memberRows(u, db.projectId)).toHaveLength(0)

    // Siendo jefe de la otra obra, no gestiona invitaciones de esta.
    const { listObraInvitations } = await import("@/app/actions/obra/invitations")
    expectError(await listObraInvitations(db.projectId), NOT_FOUND_PROJECT)
  })

  it("IDOR: un extraño no lista, regenera ni revoca invitaciones de esta obra; un integrante sin permiso tampoco", async () => {
    const { listObraInvitations, regenerateObraInvitationLink, revokeObraInvitation } = await import(
      "@/app/actions/obra/invitations"
    )
    const link = await invite("idor@test.cl")
    actAs(db.users.extrano)
    expectError(await listObraInvitations(db.projectId), NOT_FOUND_PROJECT)
    expectError(await regenerateObraInvitationLink(link.invitation.id), NOT_FOUND_INV)
    expectError(await revokeObraInvitation(link.invitation.id), NOT_FOUND_INV)
    expectError(await revokeObraInvitation(999999), NOT_FOUND_INV)
    expectError(await revokeObraInvitation(-1), NOT_FOUND_INV)

    for (const role of ["prevencionista", "supervisor", "trabajador", "visita"] as const) {
      actAs(db.users[role])
      expectError(await listObraInvitations(db.projectId), DENIED)
      expectError(await regenerateObraInvitationLink(link.invitation.id), DENIED)
      expectError(await revokeObraInvitation(link.invitation.id), DENIED)
    }
    const still = await db.sql<{ revoked_at: Date | null }[]>`SELECT revoked_at FROM obra_invitations WHERE id = ${link.invitation.id}`
    expect(still[0].revoked_at).toBeNull()

    // La lista (members.manage) no expone el token ni su hash.
    actAs(db.users.jefe_obra)
    const list = unwrap(await listObraInvitations(db.projectId))
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((i) => i.project_id === db.projectId)).toBe(true)
    expect(JSON.stringify(list)).not.toMatch(/token|[0-9a-f]{64}/)
  })

  it("arma el enlace con APP_URL, URL (Netlify) o el host de la petición; siempre http(s)", async () => {
    delete process.env.APP_URL
    process.env.URL = "https://sitio.netlify.app/"
    expect((await invite("url1@test.cl")).url).toMatch(/^https:\/\/sitio\.netlify\.app\/invitacion\//)

    delete process.env.URL
    headerState.values = { "x-forwarded-host": "obra.example.cl", "x-forwarded-proto": "https", host: "interno:3000" }
    expect((await invite("url2@test.cl")).url).toMatch(/^https:\/\/obra\.example\.cl\/invitacion\//)

    process.env.APP_URL = "javascript:alert(1)"
    headerState.values = { host: "localhost:3000" }
    expect((await invite("url3@test.cl")).url).toMatch(/^http:\/\/localhost:3000\/invitacion\//)

    delete process.env.APP_URL
    headerState.values = { host: "evil.com/ruta" }
    const { createObraInvitation } = await import("@/app/actions/obra/invitations")
    actAs(db.users.gerente)
    expectError(await createObraInvitation(db.projectId, { email: "url4@test.cl", role: "visita" }), /error inesperado/)
    const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_invitations WHERE email = 'url4@test.cl'`
    expect(n[0].n).toBe(0)
  })

  it("flujo completo: invitar → aceptar → asignar tarea → quitar deja la tarea para su rol", async () => {
    const { acceptObraInvitation } = await import("@/app/actions/obra/invitations")
    const { removeObraMember } = await import("@/app/actions/obra/members")
    const { createObraTask } = await import("@/app/actions/obra/tasks")
    const u = await mkUser("flujo.completo")
    const link = await invite("flujo.completo@test.cl", "supervisor", db.users.jefe_obra)
    actAs(u)
    unwrap(await acceptObraInvitation(tokenOf(link)))

    actAs(db.users.jefe_obra)
    const task = unwrap(await createObraTask(db.projectId, { title: "Revisar andamio", assigned_user_id: u }))
    expect(task.assigned_user_id).toBe(u)
    unwrap(await removeObraMember(db.projectId, u))
    const t = await db.sql<{ assigned_user_id: number | null; assigned_role: string | null }[]>`
      SELECT assigned_user_id, assigned_role FROM obra_tasks WHERE id = ${task.id}`
    expect(t[0]).toEqual({ assigned_user_id: null, assigned_role: "supervisor" })

    // Su enlace ya aceptado no lo vuelve a sumar.
    actAs(u)
    expectError(await acceptObraInvitation(tokenOf(link)), /ya fue aceptada/)
    expect(await memberRows(u)).toHaveLength(0)
  })
})
