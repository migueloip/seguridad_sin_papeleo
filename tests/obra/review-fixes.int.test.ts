// @vitest-environment node
/**
 * Correcciones de la revisión de seguridad y flujos (Postgres real + servidor
 * falso de Supabase Storage):
 *
 * - Una ruta "obra-storage:" que llega del cliente (createFinding, API móvil)
 *   se descarta, y /api/findings/photo y la foto de obra solo sirven fotos de
 *   hallazgos del MISMO proyecto (y de un proyecto propio): conocer la ruta de
 *   una lámina (viaja en la URL firmada) no da acceso a ella.
 * - Las invitaciones dejan de servir si quien las envió sale del equipo o ya
 *   no puede otorgar ese rol (revocación al quitar/cambiar rol y revalidación
 *   al aceptar), y la vista previa de una invitación cerrada no trae datos.
 * - updateProfile no deja tomar un correo con invitación pendiente ni uno de
 *   ADMIN_EMAILS.
 * - Reabrir una tarea de alguien que salió del equipo la deja sin persona,
 *   visible para su rol.
 * - Subida directa: permiso propio obligatorio, cuota, limpieza de subidas
 *   abandonadas, descarte al fallar la validación y copia reducida para la IA.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActionResult, InvitationLink, LayerUploadTicket } from "@/lib/obra/types"
import { startFakeStorage, type FakeStorage } from "./fake-supabase-storage"
import { actAs, HAS_TEST_DB, setupObraTestDb, type TestDb } from "./helpers"

vi.mock("@/lib/auth", async () => (await import("./helpers")).authMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({}),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}))
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateObject: vi.fn() }))

const SERVICE_KEY = "service-key-revision"
const BUCKET = "obra-planos"
const MB = 1024 * 1024

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

/** PNG con cabecera IHDR real, rellenado hasta `total` bytes (el servidor solo mira la cabecera). */
function pngBytes(width: number, height: number, total = 64): Buffer {
  const b = Buffer.alloc(Math.max(total, 45))
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write("IHDR", 12, "ascii")
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  b[24] = 8
  b[25] = 2
  for (let i = 45; i < b.length; i += 4096) b[i] = i & 0xff
  return b
}

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`

function putSigned(url: string, body: Buffer, contentType = "image/png") {
  return fetch(url, { method: "PUT", headers: { "Content-Type": contentType, "x-upsert": "false" }, body: new Uint8Array(body) })
}

const UPLOAD_NOT_FOUND = /No se encontró la imagen subida/
const INVITER_LOST = /ya no es válida: quien la envió ya no puede/

describe.skipIf(!HAS_TEST_DB)("correcciones de la revisión (BD real + Storage falso)", () => {
  let db: TestDb
  let fake: FakeStorage

  async function mkUser(key: string): Promise<number> {
    const r = await db.sql<{ id: number }[]>`
      INSERT INTO users (email, name, password_hash, role) VALUES (${`${key}@test.cl`}, ${key}, 'x', 'user') RETURNING id`
    return Number(r[0].id)
  }

  async function addMember(userId: number, role: string) {
    await db.sql`INSERT INTO obra_members (project_id, user_id, role, invited_by) VALUES (${db.projectId}, ${userId}, ${role}, ${db.users.gerente})`
  }

  async function newTicket(mime = "image/png", size = 1000, projectId = db.projectId) {
    const { createObraLayerUploadTicket } = await import("@/app/actions/obra/layers")
    return createObraLayerUploadTicket(projectId, { mime, size_bytes: size })
  }

  async function layerFromUpload(
    path: string,
    opts: { name?: string; discipline?: string; width?: number; height?: number; analysis?: string } = {},
  ) {
    const { createObraLayer } = await import("@/app/actions/obra/layers")
    return createObraLayer(db.projectId, {
      name: opts.name ?? "Lámina subida",
      discipline: (opts.discipline ?? "arquitectura") as never,
      level: 3,
      image_upload: {
        path,
        width_px: opts.width ?? 100,
        height_px: opts.height ?? 50,
        ...(opts.analysis ? { analysis_data_url: opts.analysis } : {}),
      },
    })
  }

  /** Permiso + PUT real al bucket. */
  async function uploaded(body: Buffer): Promise<LayerUploadTicket> {
    const t = unwrap(await newTicket("image/png", body.length))
    expect((await putSigned(t.upload_url, body)).status).toBe(200)
    return t
  }

  async function ticketRow(path: string) {
    const r = await db.sql<{ used_at: Date | null; discarded_at: Date | null; layer_id: number | null; user_id: number }[]>`
      SELECT used_at, discarded_at, layer_id, user_id FROM obra_layer_uploads WHERE path = ${path}`
    return r[0]
  }

  beforeAll(async () => {
    fake = await startFakeStorage({ serviceKey: SERVICE_KEY })
    process.env.SUPABASE_URL = fake.url
    process.env.SUPABASE_SERVICE_KEY = SERVICE_KEY
    process.env.APP_URL = "https://easysecure.test"
    db = await setupObraTestDb("review_fixes_int")
  })
  afterAll(async () => {
    delete process.env.ADMIN_EMAILS
    await db?.close()
    await fake?.stop()
  })

  // -------------------------------------------------------------------------
  // Fotos y rutas del bucket
  // -------------------------------------------------------------------------

  describe("rutas del bucket: conocerlas no da acceso", () => {
    let leakedPath = ""
    let legitRef = ""
    let obraFindingId = 0

    beforeAll(async () => {
      // Una lámina subida directo; la visita recibe su URL firmada (con la ruta).
      actAs(db.users.prevencionista)
      const t = await uploaded(pngBytes(800, 600, 4000))
      const layer = unwrap(await layerFromUpload(t.path, { name: "Lámina con ruta visible" }))
      const { GET } = await import("@/app/api/obra/layers/[id]/image/route")
      actAs(db.users.visita)
      const res = await GET(new Request(`http://localhost/api/obra/layers/${layer.id}/image`), {
        params: Promise.resolve({ id: String(layer.id) }),
      })
      expect(res.status).toBe(302)
      expect(res.headers.get("cache-control")).toBe("private, max-age=60")
      leakedPath = new URL(res.headers.get("location")!).pathname.split(`/object/sign/${BUCKET}/`)[1]
      expect(leakedPath).toBe(t.path)

      // Una foto de hallazgo legítima (la sube el trabajador; el hallazgo queda a nombre del dueño).
      const { reportObraFinding } = await import("@/app/actions/obra/pins")
      actAs(db.users.trabajador)
      const r = unwrap(
        await reportObraFinding(db.projectId, {
          layer_id: layer.id,
          x: 0.4,
          y: 0.4,
          title: "Andamio sin rodapié",
          severity: "high",
          photo_data_url: dataUrl("image/png", pngBytes(40, 30, 500)),
        }),
      )
      obraFindingId = r.finding_id
      const rows = await db.sql<{ photos: unknown }[]>`SELECT photos FROM findings WHERE id = ${obraFindingId}`
      const photos = (typeof rows[0].photos === "string" ? JSON.parse(rows[0].photos) : rows[0].photos) as string[]
      legitRef = photos[0]
      expect(legitRef).toMatch(new RegExp(`^obra-storage:obra/${db.projectId}/hallazgos/[0-9a-f]{24}\\.png$`))
    })

    async function legacyPhoto(findingId: number, index = 0) {
      const { GET } = await import("@/app/api/findings/photo/route")
      return GET(new Request(`http://localhost/api/findings/photo?id=${findingId}&index=${index}`))
    }

    it("createFinding descarta las referencias obra-storage: que manda el cliente", async () => {
      const { createFinding } = await import("@/app/actions/findings")
      actAs(db.users.visita)
      const f = await createFinding({
        title: "Intento con ruta ajena",
        severity: "low",
        photos: [`obra-storage:${leakedPath}`, legitRef, "https://ejemplo.cl/foto.png"],
      })
      const rows = await db.sql<{ photos: unknown }[]>`SELECT photos FROM findings WHERE id = ${Number(f.id)}`
      const photos = (typeof rows[0].photos === "string" ? JSON.parse(rows[0].photos) : rows[0].photos) as string[]
      expect(photos).toEqual(["https://ejemplo.cl/foto.png"])
      expect((await legacyPhoto(Number(f.id))).status).toBe(415)
    })

    it("/api/findings/photo no sirve láminas, subidas ni fotos de obras ajenas aunque estén en photos (404)", async () => {
      // Hallazgos heredados propios de la visita con rutas inyectadas directo en la BD (datos antiguos).
      const mk = async (photos: string[], projectId: number | null = db.projectId) => {
        const r = await db.sql<{ id: number }[]>`
          INSERT INTO findings (user_id, project_id, title, severity, status, photos)
          VALUES (${db.users.visita}, ${projectId}, 'Inyectado', 'low', 'open', ${db.sql.json(photos)})
          RETURNING id`
        return Number(r[0].id)
      }
      actAs(db.users.visita)
      const reads = fake.requests.length
      for (const ref of [`obra-storage:${leakedPath}`, legitRef]) {
        expect((await legacyPhoto(await mk([ref]))).status).toBe(404)
        expect((await legacyPhoto(await mk([ref], null))).status).toBe(404)
      }
      // Ninguna de esas llamadas llegó a leer el bucket.
      expect(fake.requests.slice(reads).some((r) => r.path.startsWith("/object/authenticated/"))).toBe(false)
    })

    it("el dueño sigue viendo la foto de un hallazgo de su obra en /api/findings/photo (y solo fotos de hallazgos)", async () => {
      actAs(db.users.gerente)
      const res = await legacyPhoto(obraFindingId)
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("image/png")
      // Aunque la lámina sea de su obra, por esta ruta solo se sirven fotos de hallazgos del mismo proyecto.
      const own = await db.sql<{ id: number }[]>`
        INSERT INTO findings (user_id, project_id, title, severity, status, photos)
        VALUES (${db.users.gerente}, ${db.projectId}, 'Con lámina', 'low', 'open',
                ${db.sql.json([`obra-storage:${leakedPath}`, legitRef])})
        RETURNING id`
      expect((await legacyPhoto(Number(own[0].id), 0)).status).toBe(404)
      expect((await legacyPhoto(Number(own[0].id), 1)).status).toBe(200)
      const sinObra = await db.sql<{ id: number }[]>`
        INSERT INTO findings (user_id, project_id, title, severity, status, photos)
        VALUES (${db.users.gerente}, NULL, 'Sin obra', 'low', 'open', ${db.sql.json([legitRef])})
        RETURNING id`
      expect((await legacyPhoto(Number(sinObra[0].id))).status).toBe(404)
      actAs(db.users.visita)
      expect((await legacyPhoto(obraFindingId)).status).toBe(404)
    })

    it("la foto de obra no sirve una referencia de otro proyecto o de una lámina metida en photos", async () => {
      const { GET } = await import("@/app/api/obra/findings/[id]/photo/route")
      const photo = (index: number) =>
        GET(new Request(`http://localhost/api/obra/findings/${obraFindingId}/photo?index=${index}`), {
          params: Promise.resolve({ id: String(obraFindingId) }),
        })
      const foreign = `obra-storage:obra/${db.otherProjectId}/hallazgos/0123456789abcdef01234567.png`
      await db.sql`UPDATE findings SET photos = ${db.sql.json([legitRef, `obra-storage:${leakedPath}`, foreign])} WHERE id = ${obraFindingId}`
      actAs(db.users.visita)
      expect((await photo(0)).status).toBe(200)
      expect((await photo(1)).status).toBe(404)
      expect((await photo(2)).status).toBe(404)
      // Y el panel solo ofrece la foto válida.
      const { getObraFindingContext } = await import("@/app/actions/obra/pins")
      const ctx = unwrap(await getObraFindingContext(obraFindingId))
      expect(ctx.photo_indexes).toEqual([0])
    })

    it("la API móvil descarta las referencias obra-storage: nuevas y conserva las que el hallazgo ya tenía", async () => {
      const token = "tok-revision-visita"
      await db.sql`INSERT INTO sessions (user_id, token, expires_at) VALUES (${db.users.visita}, ${token}, CURRENT_TIMESTAMP + interval '1 day')`
      const { POST } = await import("@/app/api/mobile/sync/route")
      const sync = (outbox: unknown[]) =>
        POST(
          new Request("http://localhost/api/mobile/sync", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ lastSync: null, outbox }),
          }),
        )
      const created = await sync([
        {
          id: 1,
          entity: "findings",
          op: "create",
          local_id: "l-1",
          remote_id: null,
          payload: JSON.stringify({ title: "Desde el celular", severity: "low", photos: [`obra-storage:${leakedPath}`, "data:image/png;base64,aGVsbG8="] }),
          created_at: new Date().toISOString(),
        },
      ])
      const body = (await created.json()) as { idMap?: { remote_id: number }[]; id_map?: { remote_id: number }[] }
      const remoteId = (body.idMap ?? body.id_map ?? [])[0]?.remote_id
      expect(remoteId).toBeGreaterThan(0)
      const read = async () => {
        const r = await db.sql<{ photos: unknown }[]>`SELECT photos FROM findings WHERE id = ${remoteId}`
        return (typeof r[0].photos === "string" ? JSON.parse(r[0].photos) : r[0].photos) as string[]
      }
      expect(await read()).toEqual(["data:image/png;base64,aGVsbG8="])

      // Una referencia que el hallazgo YA tenía sobrevive a una edición que reenvía la lista.
      const kept = `obra-storage:obra/${db.projectId}/hallazgos/abcdefabcdefabcdefabcdef.png`
      await db.sql`UPDATE findings SET photos = ${db.sql.json([kept])}, updated_at = CURRENT_TIMESTAMP - interval '1 hour' WHERE id = ${remoteId}`
      await sync([
        {
          id: 2,
          entity: "findings",
          op: "update",
          local_id: "l-1",
          remote_id: remoteId,
          payload: JSON.stringify({ title: "Editado", severity: "low", photos: [kept, `obra-storage:${leakedPath}`] }),
          created_at: new Date().toISOString(),
        },
      ])
      expect(await read()).toEqual([kept])
    })
  })

  // -------------------------------------------------------------------------
  // Invitaciones
  // -------------------------------------------------------------------------

  describe("invitaciones ligadas a quien las envió", () => {
    async function invite(as: number, email: string, role: string) {
      const { createObraInvitation } = await import("@/app/actions/obra/invitations")
      actAs(as)
      return unwrap(await createObraInvitation(db.projectId, { email, role: role as never }))
    }

    async function statusOf(link: InvitationLink) {
      const { getInvitationPreview } = await import("@/lib/obra/server/invitations")
      return getInvitationPreview(tokenOf(link))
    }

    it("quitar a un jefe de obra revoca sus invitaciones abiertas: la de su correo alterno ya no sirve", async () => {
      const jefe = await mkUser("jefe_temporal")
      await addMember(jefe, "jefe_obra")
      const link = await invite(jefe, "jefe.alterno@test.cl", "jefe_obra")
      const ajena = await invite(db.users.gerente, "otra.persona@test.cl", "supervisor")

      const { removeObraMember } = await import("@/app/actions/obra/members")
      actAs(db.users.gerente)
      unwrap(await removeObraMember(db.projectId, jefe))

      expect(await statusOf(link)).toEqual({ status: "revocada" })
      expect((await statusOf(ajena))?.status).toBe("pendiente")
      const audit = await db.sql<{ actor_user_id: number; details: Record<string, unknown> }[]>`
        SELECT actor_user_id, details FROM obra_audit_log
        WHERE action = 'invitation.revoked' AND entity_id = ${link.invitation.id}`
      expect(audit[0]).toMatchObject({ actor_user_id: db.users.gerente, details: { reason: "inviter_removed", role: "jefe_obra" } })
      const removed = await db.sql<{ details: Record<string, unknown> }[]>`
        SELECT details FROM obra_audit_log WHERE action = 'member.removed' AND (details->>'user_id')::int = ${jefe}`
      expect(removed[0].details).toMatchObject({ revoked_invitations: 1, revoked_invitation_ids: [link.invitation.id] })

      const { acceptObraInvitationWithNewAccount } = await import("@/app/actions/obra/invitations")
      actAs(null)
      expectError(await acceptObraInvitationWithNewAccount(tokenOf(link), { name: "Alterno", password: "clave-segura-1" }), /revocada/)
      const u = await db.sql`SELECT 1 FROM users WHERE email = 'jefe.alterno@test.cl'`
      expect(u).toHaveLength(0)
    })

    it("bajar el rol revoca solo las invitaciones que el rol nuevo ya no puede otorgar", async () => {
      const x = await mkUser("gerente_miembro")
      await addMember(x, "gerente")
      const asGerente = await invite(x, "nuevo.gerente@test.cl", "gerente")
      const asSupervisor = await invite(x, "nuevo.supervisor@test.cl", "supervisor")
      const { updateObraMemberRole } = await import("@/app/actions/obra/members")
      actAs(db.users.gerente)
      unwrap(await updateObraMemberRole(db.projectId, x, "jefe_obra"))
      expect(await statusOf(asGerente)).toEqual({ status: "revocada" })
      expect((await statusOf(asSupervisor))?.status).toBe("pendiente")
      unwrap(await updateObraMemberRole(db.projectId, x, "visita"))
      expect(await statusOf(asSupervisor)).toEqual({ status: "revocada" })
      const changes = await db.sql<{ details: Record<string, unknown> }[]>`
        SELECT details FROM obra_audit_log WHERE action = 'member.role_changed' AND (details->>'user_id')::int = ${x} ORDER BY id`
      expect(changes.map((c) => c.details.revoked_invitations)).toEqual([1, 1])
      const reasons = await db.sql<{ reason: string }[]>`
        SELECT details->>'reason' AS reason FROM obra_audit_log
        WHERE action = 'invitation.revoked' AND entity_id IN (${asGerente.invitation.id}, ${asSupervisor.invitation.id})`
      expect(reasons.map((r) => r.reason)).toEqual(["inviter_role_changed", "inviter_role_changed"])
    })

    it("al aceptar se revalida a quien invitó (aunque haya salido sin pasar por removeMember): se anula y no entra nadie", async () => {
      const w = await mkUser("jefe_saliente")
      await addMember(w, "jefe_obra")
      const nueva = await invite(w, "persona.nueva@test.cl", "prevencionista")
      const existente = await mkUser("persona_existente")
      const conSesion = await invite(w, "persona_existente@test.cl", "supervisor")
      // Salida "por fuera" (p.ej. datos antiguos): sin la revocación de removeMember.
      await db.sql`DELETE FROM obra_members WHERE project_id = ${db.projectId} AND user_id = ${w}`

      const inv = await import("@/app/actions/obra/invitations")
      actAs(null)
      expectError(await inv.acceptObraInvitationWithNewAccount(tokenOf(nueva), { name: "Nueva", password: "clave-segura-1" }), INVITER_LOST)
      expect(await db.sql`SELECT 1 FROM users WHERE email = 'persona.nueva@test.cl'`).toHaveLength(0)
      expect(await statusOf(nueva)).toEqual({ status: "revocada" })

      actAs(existente)
      expectError(await inv.acceptObraInvitation(tokenOf(conSesion)), INVITER_LOST)
      expect(await db.sql`SELECT 1 FROM obra_members WHERE project_id = ${db.projectId} AND user_id = ${existente}`).toHaveLength(0)
      expect(await statusOf(conSesion)).toEqual({ status: "revocada" })
      const audit = await db.sql<{ actor_user_id: number | null; reason: string }[]>`
        SELECT actor_user_id, details->>'reason' AS reason FROM obra_audit_log
        WHERE action = 'invitation.revoked' AND entity_id = ${nueva.invitation.id}`
      expect(audit[0]).toEqual({ actor_user_id: null, reason: "inviter_lost_permission" })

      // Un integrante que sigue con members.manage, pero cuyo rol ya no puede otorgar el invitado.
      const y = await mkUser("ex_gerente")
      await addMember(y, "gerente")
      const alto = await invite(y, "gerente.nuevo2@test.cl", "gerente")
      await db.sql`UPDATE obra_members SET role = 'jefe_obra' WHERE project_id = ${db.projectId} AND user_id = ${y}`
      actAs(null)
      expectError(await inv.acceptObraInvitationWithNewAccount(tokenOf(alto), { name: "Alto", password: "clave-segura-1" }), INVITER_LOST)
    })

    it("la vista previa de una invitación aceptada, revocada o vencida no trae correo, nombre, obra ni quién invitó", async () => {
      const pend = await invite(db.users.gerente, "vista.previa@test.cl", "trabajador")
      expect(await statusOf(pend)).toMatchObject({ status: "pendiente", email: "vista.previa@test.cl", project_name: "Edificio Los Aromos" })
      const { revokeObraInvitation } = await import("@/app/actions/obra/invitations")
      actAs(db.users.gerente)
      unwrap(await revokeObraInvitation(pend.invitation.id))
      expect(await statusOf(pend)).toEqual({ status: "revocada" })

      const venc = await invite(db.users.gerente, "vencida.previa@test.cl", "trabajador")
      await db.sql`UPDATE obra_invitations SET expires_at = LOCALTIMESTAMP - interval '1 minute' WHERE id = ${venc.invitation.id}`
      expect(await statusOf(venc)).toEqual({ status: "vencida" })

      const acc = await invite(db.users.gerente, "aceptada.previa@test.cl", "trabajador")
      const { acceptObraInvitationWithNewAccount } = await import("@/app/actions/obra/invitations")
      actAs(null)
      unwrap(await acceptObraInvitationWithNewAccount(tokenOf(acc), { name: "Aceptada", password: "clave-segura-1" }))
      expect(await statusOf(acc)).toEqual({ status: "aceptada" })
    })

    it("updateProfile no deja ponerse el correo de una invitación pendiente (el control de correo sirve)", async () => {
      const link = await invite(db.users.gerente, "destinatario@test.cl", "prevencionista")
      const { updateProfile } = await import("@/app/actions/profile")
      const inv = await import("@/app/actions/obra/invitations")
      actAs(db.users.extrano)
      expectError(await inv.acceptObraInvitation(tokenOf(link)), /para otro correo/)
      await expect(updateProfile({ name: "Extraño", email: "destinatario@test.cl" })).rejects.toThrow(/invitación pendiente/)
      await expect(updateProfile({ name: "Extraño", email: "DESTINATARIO@test.cl" })).rejects.toThrow(/invitación pendiente/)
      expectError(await inv.acceptObraInvitation(tokenOf(link)), /para otro correo/)
      expect(await db.sql`SELECT 1 FROM obra_members WHERE project_id = ${db.projectId} AND user_id = ${db.users.extrano}`).toHaveLength(0)
      // Un correo libre sí se puede usar, y el propio se puede reenviar sin cambios.
      await updateProfile({ name: "Extraño", email: "extrano.nuevo@test.cl" })
      await updateProfile({ name: "Extraño", email: "extrano@test.cl" })
      const u = await db.sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${db.users.extrano}`
      expect(u[0].email).toBe("extrano@test.cl")
    })

    it("updateProfile no deja ponerse un correo de ADMIN_EMAILS (salvo a quien ya es admin)", async () => {
      process.env.ADMIN_EMAILS = "otra@empresa.cl, Jefa.TI@empresa.cl"
      try {
        const { updateProfile } = await import("@/app/actions/profile")
        actAs(db.users.trabajador)
        await expect(updateProfile({ name: "Trabajador", email: "jefa.ti@empresa.cl" })).rejects.toThrow(/reservado para la administración/)
        const u = await db.sql<{ email: string; role: string }[]>`SELECT email, role FROM users WHERE id = ${db.users.trabajador}`
        expect(u[0]).toEqual({ email: "trabajador@test.cl", role: "user" })
        const admin = await mkUser("admin_actual")
        await db.sql`UPDATE users SET role = 'admin' WHERE id = ${admin}`
        actAs(admin)
        await updateProfile({ name: "Admin", email: "jefa.ti@empresa.cl" })
        expect((await db.sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${admin}`)[0].email).toBe("jefa.ti@empresa.cl")
      } finally {
        delete process.env.ADMIN_EMAILS
      }
    })
  })

  // -------------------------------------------------------------------------
  // Tareas
  // -------------------------------------------------------------------------

  it("reabrir una tarea hecha de alguien que salió del equipo la deja sin persona y visible para su rol", async () => {
    const t1 = await mkUser("trabajador_saliente")
    const t2 = await mkUser("trabajador_que_queda")
    await addMember(t1, "trabajador")
    await addMember(t2, "trabajador")
    const tasks = await import("@/app/actions/obra/tasks")
    const { removeObraMember } = await import("@/app/actions/obra/members")
    actAs(db.users.jefe_obra)
    const task = unwrap(await tasks.createObraTask(db.projectId, { title: "Retirar escombros", assigned_user_id: t1 }))
    unwrap(await tasks.setObraTaskStatus(task.id, "hecha"))
    unwrap(await removeObraMember(db.projectId, t1))
    const stamped = await db.sql<{ assigned_user_id: number | null; assigned_role: string | null }[]>`
      SELECT assigned_user_id, assigned_role FROM obra_tasks WHERE id = ${task.id}`
    expect(stamped[0]).toEqual({ assigned_user_id: t1, assigned_role: "trabajador" })

    unwrap(await tasks.setObraTaskStatus(task.id, "pendiente"))
    const reopened = await db.sql<{ assigned_user_id: number | null; assigned_role: string | null; status: string }[]>`
      SELECT assigned_user_id, assigned_role, status FROM obra_tasks WHERE id = ${task.id}`
    expect(reopened[0]).toEqual({ assigned_user_id: null, assigned_role: "trabajador", status: "pendiente" })
    const audit = await db.sql<{ details: Record<string, unknown> }[]>`
      SELECT details FROM obra_audit_log WHERE action = 'task.status_changed' AND entity_id = ${task.id} ORDER BY id DESC LIMIT 1`
    expect(audit[0].details).toMatchObject({ from: "hecha", to: "pendiente", unassigned_user_id: t1 })

    actAs(t2)
    const mine = unwrap(await tasks.listObraTasks(db.projectId, { mine: true }))
    expect(mine.map((t) => t.id)).toContain(task.id)

    // Una tarea de alguien que sigue en el equipo conserva su persona al reabrirse.
    actAs(db.users.jefe_obra)
    const other = unwrap(await tasks.createObraTask(db.projectId, { title: "Ordenar bodega", assigned_user_id: t2 }))
    unwrap(await tasks.setObraTaskStatus(other.id, "hecha"))
    unwrap(await tasks.setObraTaskStatus(other.id, "en_progreso"))
    const still = await db.sql<{ assigned_user_id: number | null }[]>`SELECT assigned_user_id FROM obra_tasks WHERE id = ${other.id}`
    expect(still[0].assigned_user_id).toBe(t2)
  })

  // -------------------------------------------------------------------------
  // Subida directa
  // -------------------------------------------------------------------------

  describe("subida directa: permisos propios, cuota, limpieza y copia para la IA", () => {
    it("la ruta del permiso de otra persona no sirve (y su objeto no se toca)", async () => {
      actAs(db.users.gerente)
      const t = await uploaded(pngBytes(300, 200, 2000))
      actAs(db.users.jefe_obra)
      expectError(await layerFromUpload(t.path, { name: "Con permiso ajeno" }), UPLOAD_NOT_FOUND)
      expect(fake.objects.has(`${BUCKET}/${t.path}`)).toBe(true)
      expect(await ticketRow(t.path)).toMatchObject({ used_at: null, discarded_at: null })
      actAs(db.users.gerente)
      const layer = unwrap(await layerFromUpload(t.path, { name: "Con permiso propio" }))
      expect(await ticketRow(t.path)).toMatchObject({ layer_id: layer.id, discarded_at: null })
      expect((await ticketRow(t.path)).used_at).not.toBeNull()
    })

    it("una lámina demasiado angosta da un mensaje claro y su objeto se borra (declarada o real)", async () => {
      actAs(db.users.gerente)
      const a = await uploaded(pngBytes(10, 2000, 500))
      expectError(await layerFromUpload(a.path, { width: 10, height: 2000 }), /demasiado angosta: su alto no puede superar 100 veces/)
      expect(fake.objects.has(`${BUCKET}/${a.path}`)).toBe(false)
      expect((await ticketRow(a.path)).discarded_at).not.toBeNull()
      // Declara 100 × 50, pero el archivo real mide 10 × 2000.
      const b = await uploaded(pngBytes(10, 2000, 500))
      expectError(await layerFromUpload(b.path), /demasiado angosta/)
      expect(fake.objects.has(`${BUCKET}/${b.path}`)).toBe(false)
      expect((await ticketRow(b.path)).discarded_at).not.toBeNull()
      // Reintentar con la misma ruta ya no sirve.
      expectError(await layerFromUpload(b.path), UPLOAD_NOT_FOUND)
      const n = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_plan_layers WHERE image_path IN (${a.path}, ${b.path})`
      expect(n[0].n).toBe(0)
    })

    it("los objetos de permisos vencidos que no llegaron a una capa se borran al pedir otro permiso", async () => {
      actAs(db.users.gerente)
      const abandoned = await uploaded(pngBytes(100, 100, 300))
      const used = await uploaded(pngBytes(100, 100, 300))
      unwrap(await layerFromUpload(used.path, { name: "Usada antes de vencer" }))
      await db.sql`UPDATE obra_layer_uploads SET created_at = LOCALTIMESTAMP - interval '4 hours', expires_at = LOCALTIMESTAMP - interval '2 hours'
                   WHERE path IN (${abandoned.path}, ${used.path})`
      // Un permiso vencido hace menos de una hora todavía no se toca.
      const recent = await uploaded(pngBytes(100, 100, 300))
      await db.sql`UPDATE obra_layer_uploads SET expires_at = LOCALTIMESTAMP - interval '10 minutes' WHERE path = ${recent.path}`

      unwrap(await newTicket())
      expect(fake.objects.has(`${BUCKET}/${abandoned.path}`)).toBe(false)
      expect((await ticketRow(abandoned.path)).discarded_at).not.toBeNull()
      expect(fake.objects.has(`${BUCKET}/${used.path}`)).toBe(true)
      expect((await ticketRow(used.path)).discarded_at).toBeNull()
      expect(fake.objects.has(`${BUCKET}/${recent.path}`)).toBe(true)
      expectError(await layerFromUpload(abandoned.path), UPLOAD_NOT_FOUND)
    })

    it("cuota de permisos por persona y hora, y por obra y día", async () => {
      const u = await mkUser("sube_mucho")
      await addMember(u, "jefe_obra")
      await db.sql`
        INSERT INTO obra_layer_uploads (project_id, user_id, path, mime_type, size_bytes, expires_at)
        SELECT ${db.otherProjectId}, ${u}, 'obra/' || ${db.otherProjectId}::text || '/uploads/cuota-' || g::text || '.png', 'image/png', 1000,
               LOCALTIMESTAMP + interval '2 hours'
        FROM generate_series(1, 30) g`
      actAs(u)
      expectError(await newTicket(), /máximo de 30 subidas de láminas grandes por hora/)
      await db.sql`DELETE FROM obra_layer_uploads WHERE user_id = ${u}`
      expect(unwrap(await newTicket()).path).toMatch(/uploads\//)

      const before = await db.sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM obra_layer_uploads WHERE project_id = ${db.projectId} AND created_at > LOCALTIMESTAMP - interval '1 day'`
      await db.sql`
        INSERT INTO obra_layer_uploads (project_id, user_id, path, mime_type, size_bytes, expires_at, created_at)
        SELECT ${db.projectId}, ${db.users.prevencionista}, 'obra/' || ${db.projectId}::text || '/uploads/dia-' || g::text || '.png',
               'image/png', 1000, LOCALTIMESTAMP + interval '2 hours', LOCALTIMESTAMP - interval '3 hours'
        FROM generate_series(1, ${150 - before[0].n}) g`
      expectError(await newTicket(), /máximo diario de 150 subidas/)
      await db.sql`DELETE FROM obra_layer_uploads WHERE path LIKE ${`obra/${db.projectId}/uploads/dia-%`}`
    })

    it("la lámina grande guarda una copia reducida y la detección con IA usa esa copia (no los 25 MB)", async () => {
      const ai = await import("ai")
      const gen = vi.mocked(ai.generateObject)
      gen.mockReset()
      await db.sql`INSERT INTO settings (user_id, key, value) VALUES (${db.users.gerente}, 'ai_api_key', 'clave-de-prueba')`
      gen.mockResolvedValue({
        object: {
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
          ],
        },
      } as never)

      actAs(db.users.prevencionista)
      const big = pngBytes(6000, 4000, 8 * MB)
      const copy = pngBytes(3000, 2000, 200_000)
      const t = await uploaded(big)
      const layer = unwrap(
        await layerFromUpload(t.path, { name: "Alcantarillado grande", discipline: "alcantarillado", analysis: dataUrl("image/png", copy) }),
      )
      const row = await db.sql<{ image_path: string; analysis_image_path: string | null }[]>`
        SELECT image_path, analysis_image_path FROM obra_plan_layers WHERE id = ${layer.id}`
      expect(row[0].image_path).toBe(t.path)
      expect(row[0].analysis_image_path).toMatch(new RegExp(`^obra/${db.projectId}/${layer.id}-[0-9a-f]{24}-ia\\.png$`))
      expect(fake.objects.get(`${BUCKET}/${row[0].analysis_image_path}`)?.bytes.equals(copy)).toBe(true)

      const { requestObraLayerExtraction } = await import("@/app/actions/obra/elements")
      unwrap(await requestObraLayerExtraction(layer.id))
      expect(gen).toHaveBeenCalledTimes(1)
      const call = gen.mock.calls[0][0] as unknown as { messages: Array<{ content: Array<{ type: string; image?: Uint8Array }> }> }
      const sent = call.messages[0].content.find((p) => p.type === "image")?.image
      expect(sent && Buffer.from(sent).equals(copy)).toBe(true)

      // Sin copia reducida y con la lámina sobre el límite: mensaje claro, sin llamar al proveedor ni descargarla.
      gen.mockClear()
      const t2 = await uploaded(big)
      const sinCopia = unwrap(await layerFromUpload(t2.path, { name: "Sin copia", discipline: "alcantarillado" }))
      const downloads = fake.requests.length
      expectError(await requestObraLayerExtraction(sinCopia.id), /la detección con IA acepta imágenes de hasta 3,7 MB/)
      expect(gen).not.toHaveBeenCalled()
      expect(fake.requests.slice(downloads).some((r) => r.method === "GET" && r.path.endsWith(t2.path))).toBe(false)

      // Una copia que no es imagen, o demasiado pesada, se rechaza sin crear la capa.
      const t3 = await uploaded(pngBytes(800, 600, 3000))
      expectError(
        await layerFromUpload(t3.path, { analysis: dataUrl("image/svg+xml", Buffer.from("<svg onload='x'/>")) }),
        /copia reducida de la lámina/,
      )
      expectError(await layerFromUpload(t3.path, { analysis: dataUrl("image/png", pngBytes(10, 10, 4 * MB)) }), /copia reducida de la lámina supera/)
      await db.sql`DELETE FROM settings WHERE user_id = ${db.users.gerente} AND key = 'ai_api_key'`
    })
  })
})
