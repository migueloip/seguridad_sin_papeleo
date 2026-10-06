/**
 * Invitaciones al equipo de obra. Solo servidor; sin "use server": cada
 * función recibe el actorUserId explícito (o ninguno, en las públicas).
 *
 * Reemplazan el alta directa con contraseña temporal, que tenía dos problemas:
 * (a) agregar por email revelaba si la persona ya tenía cuenta (y su nombre) y
 * la sumaba sin su consentimiento; (b) la clave temporal no vencía y quien
 * invitaba la conocía. Ahora:
 *
 * - Quien gestiona el equipo (members.manage + canAssignRole) crea una
 *   invitación para un correo y recibe un enlace /invitacion/<token>. La
 *   respuesta es idéntica tenga o no cuenta ese correo.
 * - El token son 32 bytes aleatorios en base64url. En la BD solo se guarda su
 *   SHA-256 (token_hash): el enlace se muestra una sola vez y se puede
 *   regenerar (invalida el anterior). Vence a los INVITATION_TTL_DAYS días.
 * - La persona invitada acepta explícitamente: con su sesión (el correo debe
 *   coincidir) o creando su cuenta con SU contraseña. La aceptación bloquea la
 *   fila (SELECT … FOR UPDATE): dos envíos simultáneos dejan una sola cuenta y
 *   una sola membresía.
 *
 * Estado (calculado en SQL contra la hora de la BD, invitationStatusSql):
 * aceptada → revocada (anulada a mano antes de vencer) → vencida (pasó
 * expires_at, o se reemplazó por otra después de vencer) → pendiente.
 */
import crypto from "node:crypto"
import bcrypt from "bcryptjs"
import { sql } from "@/lib/db"
import {
  ensureObraSchema,
  getProjectAccessForUser,
  ObraAccessError,
  ObraValidationError,
  requireProjectPermissionForUser,
  writeAudit,
} from "../access"
import { can, canAssignRole } from "../permissions"
import {
  INVITATION_STATUSES,
  INVITATION_TTL_DAYS,
  OBRA_ROLES,
  type InvitationLink,
  type InvitationPreview,
  type InvitationStatus,
  type ObraInvitation,
  type ObraRole,
  type ProjectAccess,
} from "../types"
import {
  asSql,
  cleanLine,
  mapInvitation,
  optionalRefId,
  requireEnum,
  requireLine,
  requireObject,
  toIso,
  toNum,
  toNumOrNull,
  toPositiveInt,
  type InvitationRow,
  type Queryable,
} from "./mappers"
import { assertLinkableWorker, normalizeEmail, roleDenied } from "./members"

export type InvitationInput = { email: string; name?: string | null; role: ObraRole; worker_id?: number | null }

export const INVITATION_LIST_LIMIT = 200
/** Rango de la contraseña de una cuenta nueva (mínimo igual que registerAction). */
export const INVITATION_PASSWORD_MIN = 8
export const INVITATION_PASSWORD_MAX = 256

const NOT_FOUND = "Invitación no encontrada."
const INVALID_LINK = "Invitación no encontrada: revisa que el enlace esté completo."
const ALREADY_IN_TEAM = "Esa persona ya es parte del equipo."
const PENDING_EXISTS = "Ya hay una invitación pendiente para ese correo: regenera el enlace desde la lista."
const ALREADY_ACCEPTED = "Esta invitación ya fue aceptada."
const REVOKED = "Esta invitación fue revocada. Pide a quien te invitó un enlace nuevo."
const EXPIRED = "Esta invitación venció. Pide a quien te invitó que genere un enlace nuevo."
const ACCOUNT_EXISTS = "Ya existe una cuenta con este correo: inicia sesión para aceptar la invitación."

// ---------------------------------------------------------------------------
// Token y enlace
// ---------------------------------------------------------------------------

/** 32 bytes en base64url sin relleno = 43 caracteres. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

/** ¿Tiene el formato de un token de invitación? (no consulta la BD). */
export function isInvitationToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN_RE.test(v)
}

/** SHA-256 hex del token: lo único que se guarda (obra_invitations.token_hash). */
export function hashInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex")
}

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url")
}

/** Origen http(s) de una URL base, o null. */
export function httpOrigin(baseUrl: unknown): string | null {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return null
  try {
    const u = new URL(baseUrl.trim())
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null
  } catch {
    return null
  }
}

/** URL absoluta /invitacion/<token> sobre el origen de la app (error interno si la base no es http(s)). */
export function invitationUrl(baseUrl: string, token: string): string {
  const origin = httpOrigin(baseUrl)
  if (!origin) throw new Error("URL base de la app no válida para el enlace de invitación")
  return `${origin}/invitacion/${token}`
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/** Estado derivado (alias i), contra la hora de la BD. Ver comentario del archivo. */
function invitationStatusSql(q: Queryable) {
  const s = asSql(q)
  return s`(CASE
    WHEN i.accepted_at IS NOT NULL THEN 'aceptada'
    WHEN i.revoked_at IS NOT NULL AND i.revoked_at < i.expires_at THEN 'revocada'
    WHEN i.revoked_at IS NOT NULL OR i.expires_at <= LOCALTIMESTAMP THEN 'vencida'
    ELSE 'pendiente'
  END)`
}

/** SELECT base de invitaciones (alias i) para mapInvitation. Nunca incluye token_hash. */
function invitationSelect(q: Queryable) {
  const s = asSql(q)
  return s`
    SELECT
      i.id, i.project_id, i.email, i.name, i.role, i.worker_id,
      NULLIF(TRIM(CONCAT_WS(' ', w.first_name, w.last_name)), '') AS worker_name,
      i.invited_by,
      COALESCE(NULLIF(iu.name, ''), iu.email) AS invited_by_name,
      ${invitationStatusSql(s)} AS status,
      i.created_at, i.expires_at, i.accepted_at
    FROM obra_invitations i
    LEFT JOIN workers w ON w.id = i.worker_id
    LEFT JOIN users iu ON iu.id = i.invited_by
  `
}

function expiresAtSql(q: Queryable) {
  const s = asSql(q)
  return s`LOCALTIMESTAMP + make_interval(days => ${INVITATION_TTL_DAYS}::int)`
}

type LockedInvitation = {
  id: number
  project_id: number
  owner_user_id: number
  email: string
  role: ObraRole
  worker_id: number | null
  invited_by: number | null
  accepted_user_id: number | null
  status: InvitationStatus
  /** Sin aceptar ni revocar (puede estar vencida). */
  is_open: boolean
}

type LockedRow = {
  id: number | string
  project_id: number | string
  owner_user_id: number | string
  email: string
  role: string
  worker_id: number | string | null
  invited_by: number | string | null
  accepted_user_id: number | string | null
  status: string
  is_open: boolean
}

function toLocked(r: LockedRow): LockedInvitation {
  return {
    id: toNum(r.id),
    project_id: toNum(r.project_id),
    owner_user_id: toNum(r.owner_user_id),
    email: String(r.email).toLowerCase(),
    role: requireEnum(r.role, OBRA_ROLES, "Rol no válido."),
    worker_id: toNumOrNull(r.worker_id),
    invited_by: toNumOrNull(r.invited_by),
    accepted_user_id: toNumOrNull(r.accepted_user_id),
    status: (INVITATION_STATUSES as readonly string[]).includes(r.status) ? (r.status as InvitationStatus) : "vencida",
    is_open: r.is_open === true,
  }
}

/** Invitación por id o por hash de token; `lock` = FOR UPDATE de la fila (solo dentro de sql.begin). */
async function loadInvitation(
  q: Queryable,
  by: { id: number } | { tokenHash: string },
  lock: boolean,
): Promise<LockedInvitation | null> {
  const s = asSql(q)
  const rows = await s<LockedRow[]>`
    SELECT i.id, i.project_id, p.user_id AS owner_user_id, i.email, i.role, i.worker_id, i.invited_by,
           i.accepted_user_id, ${invitationStatusSql(s)} AS status,
           (i.accepted_at IS NULL AND i.revoked_at IS NULL) AS is_open
    FROM obra_invitations i
    JOIN projects p ON p.id = i.project_id
    WHERE ${"id" in by ? s`i.id = ${by.id}` : s`i.token_hash = ${by.tokenHash}`}
    ${lock ? s`FOR UPDATE OF i` : s``}
  `
  return rows[0] ? toLocked(rows[0]) : null
}

async function readInvitation(q: Queryable, id: number): Promise<ObraInvitation> {
  const s = asSql(q)
  const rows = await s<InvitationRow[]>`${invitationSelect(s)} WHERE i.id = ${id}`
  if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
  return mapInvitation(rows[0])
}

/**
 * Resuelve el proyecto de una invitación desde la BD y autoriza contra ESE
 * proyecto (members.manage). Sin la invitación o sin acceso → 404.
 */
async function authorizeInvitation(userId: number, invitationId: unknown): Promise<{ access: ProjectAccess; id: number }> {
  const id = toPositiveInt(invitationId)
  if (id == null) throw new ObraAccessError(404, NOT_FOUND)
  await ensureObraSchema()
  const rows = await sql<{ project_id: number }[]>`SELECT project_id FROM obra_invitations WHERE id = ${id}`
  if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
  const access = await getProjectAccessForUser(userId, Number(rows[0].project_id))
  if (!access) throw new ObraAccessError(404, NOT_FOUND)
  if (!can(access.role, "members.manage")) throw new ObraAccessError(403, "Tu rol en esta obra no permite esta acción.")
  return { access, id }
}

function optionalName(v: unknown): string | null {
  if (v === undefined || v === null) return null
  if (typeof v === "string" && cleanLine(v) === "") return null
  return requireLine(v, "El nombre", 2, 120)
}

/** Error si la invitación ya no se puede aceptar (aceptada, revocada o vencida). */
function assertAcceptable(inv: LockedInvitation): void {
  if (inv.status === "aceptada") throw new ObraValidationError(ALREADY_ACCEPTED)
  if (inv.status === "revocada") throw new ObraValidationError(REVOKED)
  if (inv.status !== "pendiente") throw new ObraValidationError(EXPIRED)
}

async function isInTeam(q: Queryable, inv: LockedInvitation, userId: number): Promise<boolean> {
  if (userId === inv.owner_user_id) return true
  const s = asSql(q)
  const rows = await s<{ n: number }[]>`
    SELECT 1 AS n FROM obra_members WHERE project_id = ${inv.project_id} AND user_id = ${userId} LIMIT 1`
  return Boolean(rows[0])
}

/**
 * Suma a `userId` al equipo según la invitación (bloqueada) y la marca
 * aceptada. Si ya era dueño o integrante no duplica nada ni cambia su rol.
 * Audita invitation.accepted y member.added con el invitado como actor.
 */
async function joinTeam(q: Queryable, inv: LockedInvitation, userId: number): Promise<void> {
  const s = asSql(q)
  let memberId: number | null = null
  let workerId: number | null = null
  if (userId !== inv.owner_user_id) {
    if (inv.worker_id != null) {
      // El trabajador pudo cambiar de obra desde que se invitó: se revalida
      // con la regla de listLinkableWorkers para quien invitó.
      const w = await s<{ id: number }[]>`
        SELECT id FROM workers
        WHERE id = ${inv.worker_id} AND user_id = ${inv.owner_user_id}
          ${inv.invited_by === inv.owner_user_id ? s`` : s`AND (project_id = ${inv.project_id} OR project_id IS NULL)`}
        LIMIT 1
      `
      workerId = w[0] ? inv.worker_id : null
    }
    const m = await s<{ id: number }[]>`
      INSERT INTO obra_members (project_id, user_id, role, worker_id, invited_by)
      VALUES (${inv.project_id}, ${userId}, ${inv.role}, ${workerId}, ${inv.invited_by})
      ON CONFLICT (project_id, user_id) DO NOTHING
      RETURNING id
    `
    memberId = m[0] ? Number(m[0].id) : null
  }
  await s`
    UPDATE obra_invitations SET accepted_at = LOCALTIMESTAMP, accepted_user_id = ${userId}
    WHERE id = ${inv.id}
  `
  await writeAudit(
    {
      project_id: inv.project_id,
      actor_user_id: userId,
      action: "invitation.accepted",
      entity_type: "invitation",
      entity_id: inv.id,
      details: { email: inv.email, role: inv.role, member_id: memberId, already_in_team: memberId == null },
    },
    q,
  )
  if (memberId != null) {
    await writeAudit(
      {
        project_id: inv.project_id,
        actor_user_id: userId,
        action: "member.added",
        entity_type: "member",
        entity_id: memberId,
        details: {
          user_id: userId,
          email: inv.email,
          role: inv.role,
          worker_id: workerId,
          invitation_id: inv.id,
          invited_by: inv.invited_by,
        },
      },
      q,
    )
  }
}

// ---------------------------------------------------------------------------
// Gestión (members.manage)
// ---------------------------------------------------------------------------

/**
 * Crea una invitación (members.manage + canAssignRole) y devuelve el enlace,
 * que se muestra una sola vez. La respuesta no depende de si el correo ya
 * tiene cuenta. Una invitación vencida del mismo correo se reemplaza; una
 * vigente bloquea (hay que regenerar su enlace).
 */
export async function createInvitation(
  userId: number,
  projectId: number,
  input: InvitationInput,
  baseUrl: string,
): Promise<InvitationLink> {
  const access = await requireProjectPermissionForUser(userId, projectId, "members.manage")
  const o = requireObject(input, "Datos de la invitación no válidos.")
  const email = normalizeEmail(o.email)
  const name = optionalName(o.name)
  const role = requireEnum(o.role, OBRA_ROLES, "Rol no válido.")
  if (!canAssignRole(access.role, role)) throw roleDenied(role)
  const workerId = optionalRefId(o.worker_id, "El trabajador")
  const token = newToken()
  const url = invitationUrl(baseUrl, token)

  const invitation = (await sql.begin(async (tx) => {
    const s = asSql(tx)
    // Pertenencia al equipo (el gerente ya la ve); NUNCA si el correo tiene cuenta.
    const inTeam = await s<{ n: number }[]>`
      SELECT 1 AS n FROM users u
      WHERE lower(u.email) = ${email}
        AND (
          u.id = ${access.owner_user_id}
          OR EXISTS (SELECT 1 FROM obra_members m WHERE m.project_id = ${access.project_id} AND m.user_id = u.id)
        )
      LIMIT 1
    `
    if (inTeam[0]) throw new ObraValidationError(ALREADY_IN_TEAM)
    if (workerId != null) await assertLinkableWorker(s, access, workerId)

    const open = await s<{ id: number; status: string }[]>`
      SELECT i.id, ${invitationStatusSql(s)} AS status
      FROM obra_invitations i
      WHERE i.project_id = ${access.project_id} AND lower(i.email) = ${email}
        AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      FOR UPDATE
    `
    let replacedId: number | null = null
    if (open[0]) {
      if (open[0].status === "pendiente") throw new ObraValidationError(PENDING_EXISTS)
      // Vencida: se cierra (revoked_at posterior a expires_at → se sigue viendo como "vencida").
      replacedId = Number(open[0].id)
      await s`UPDATE obra_invitations SET revoked_at = LOCALTIMESTAMP WHERE id = ${replacedId}`
    }

    // El índice único parcial uq_obra_invitations_open resuelve la carrera de dos creaciones simultáneas.
    const ins = await s<{ id: number }[]>`
      INSERT INTO obra_invitations (project_id, email, name, role, worker_id, token_hash, invited_by, expires_at)
      VALUES (
        ${access.project_id}, ${email}, ${name}, ${role}, ${workerId}, ${hashInvitationToken(token)}, ${userId},
        ${expiresAtSql(s)}
      )
      ON CONFLICT (project_id, (lower(email))) WHERE accepted_at IS NULL AND revoked_at IS NULL DO NOTHING
      RETURNING id
    `
    if (!ins[0]) throw new ObraValidationError(PENDING_EXISTS)
    const id = Number(ins[0].id)
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "invitation.created",
        entity_type: "invitation",
        entity_id: id,
        details: { email, name, role, worker_id: workerId, replaced_invitation_id: replacedId },
      },
      tx,
    )
    return readInvitation(s, id)
  })) as ObraInvitation

  return { invitation, url }
}

/**
 * Genera un enlace nuevo para una invitación abierta (pendiente o vencida):
 * cambia el token (el anterior deja de servir) y renueva el vencimiento.
 */
export async function regenerateInvitationLink(
  userId: number,
  invitationId: number,
  baseUrl: string,
): Promise<InvitationLink> {
  const { access, id } = await authorizeInvitation(userId, invitationId)
  const token = newToken()
  const url = invitationUrl(baseUrl, token)

  const invitation = (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const cur = await loadInvitation(s, { id }, true)
    if (!cur || cur.project_id !== access.project_id) throw new ObraAccessError(404, NOT_FOUND)
    if (!canAssignRole(access.role, cur.role)) throw roleDenied(cur.role)
    if (cur.status === "aceptada") throw new ObraValidationError(ALREADY_ACCEPTED)
    if (cur.status === "revocada") {
      throw new ObraValidationError("Esta invitación fue revocada. Crea una nueva si aún quieres sumar a esa persona.")
    }
    if (!cur.is_open) throw new ObraValidationError("Esta invitación se reemplazó por una más nueva.")

    await s`
      UPDATE obra_invitations
      SET token_hash = ${hashInvitationToken(token)}, expires_at = ${expiresAtSql(s)}
      WHERE id = ${id}
    `
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "invitation.regenerated",
        entity_type: "invitation",
        entity_id: id,
        details: { email: cur.email, role: cur.role, was_expired: cur.status === "vencida" },
      },
      tx,
    )
    return readInvitation(s, id)
  })) as ObraInvitation

  return { invitation, url }
}

/** Revoca una invitación pendiente (members.manage + canAssignRole de su rol): su enlace deja de servir. */
export async function revokeInvitation(userId: number, invitationId: number): Promise<ObraInvitation> {
  const { access, id } = await authorizeInvitation(userId, invitationId)
  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const cur = await loadInvitation(s, { id }, true)
    if (!cur || cur.project_id !== access.project_id) throw new ObraAccessError(404, NOT_FOUND)
    if (!canAssignRole(access.role, cur.role)) throw roleDenied(cur.role)
    if (cur.status === "aceptada") {
      throw new ObraValidationError("Esta invitación ya fue aceptada: si corresponde, quita a la persona del equipo.")
    }
    if (cur.status === "revocada") throw new ObraValidationError("Esta invitación ya estaba revocada.")
    if (cur.status !== "pendiente") throw new ObraValidationError("Esta invitación ya venció: su enlace no sirve.")

    await s`UPDATE obra_invitations SET revoked_at = LOCALTIMESTAMP WHERE id = ${id}`
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "invitation.revoked",
        entity_type: "invitation",
        entity_id: id,
        details: { email: cur.email, role: cur.role },
      },
      tx,
    )
    return readInvitation(s, id)
  })) as ObraInvitation
}

/** Invitaciones del proyecto, más recientes primero (members.manage). */
export async function listInvitations(userId: number, projectId: number): Promise<ObraInvitation[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "members.manage")
  const rows = await sql<InvitationRow[]>`
    ${invitationSelect(sql)}
    WHERE i.project_id = ${access.project_id}
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT ${INVITATION_LIST_LIMIT}
  `
  return rows.map(mapInvitation)
}

// ---------------------------------------------------------------------------
// Público: vista previa y aceptación
// ---------------------------------------------------------------------------

/**
 * Vista pública de una invitación (sin sesión). null si el token no tiene
 * formato válido o no existe. Devuelve el estado aunque esté aceptada,
 * revocada o vencida (la página lo explica). Sin ids internos.
 */
export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  if (!isInvitationToken(token)) return null
  await ensureObraSchema()
  const rows = await sql<
    {
      project_name: string
      role: string
      email: string
      name: string | null
      inviter_name: string | null
      status: string
      expires_at: Date | string
    }[]
  >`
    SELECT p.name AS project_name, i.role, i.email, i.name,
           COALESCE(NULLIF(iu.name, ''), iu.email) AS inviter_name,
           ${invitationStatusSql(sql)} AS status,
           i.expires_at
    FROM obra_invitations i
    JOIN projects p ON p.id = i.project_id
    LEFT JOIN users iu ON iu.id = i.invited_by
    WHERE i.token_hash = ${hashInvitationToken(token)}
    LIMIT 1
  `
  const r = rows[0]
  if (!r) return null
  return {
    project_name: String(r.project_name),
    role: (OBRA_ROLES as readonly string[]).includes(r.role) ? (r.role as ObraRole) : "visita",
    email: String(r.email),
    name: r.name ?? null,
    inviter_name: r.inviter_name ?? null,
    status: (INVITATION_STATUSES as readonly string[]).includes(r.status) ? (r.status as InvitationStatus) : "vencida",
    expires_at: toIso(r.expires_at),
  }
}

/**
 * El usuario de la sesión acepta la invitación. Su correo (users.email) debe
 * coincidir con el invitado. Si ya era parte del equipo, solo la marca
 * aceptada. Repetir la aceptación (doble clic) devuelve el mismo proyecto.
 */
export async function acceptInvitationAsUser(userId: number, token: string): Promise<{ project_id: number }> {
  const uid = toPositiveInt(userId)
  if (uid == null) throw new ObraAccessError(401, "Sesión no válida. Vuelve a iniciar sesión.")
  if (!isInvitationToken(token)) throw new ObraAccessError(404, INVALID_LINK)
  await ensureObraSchema()
  const tokenHash = hashInvitationToken(token)

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const inv = await loadInvitation(s, { tokenHash }, true)
    if (!inv) throw new ObraAccessError(404, INVALID_LINK)
    if (inv.status === "aceptada" && inv.accepted_user_id === uid && (await isInTeam(s, inv, uid))) {
      return { project_id: inv.project_id }
    }
    assertAcceptable(inv)

    const u = await s<{ email: string }[]>`SELECT email FROM users WHERE id = ${uid}`
    if (!u[0]) throw new ObraAccessError(401, "Sesión no válida. Vuelve a iniciar sesión.")
    if (String(u[0].email).trim().toLowerCase() !== inv.email) {
      throw new ObraValidationError(`Esta invitación es para otro correo. Cierra sesión e ingresa con ${inv.email}.`)
    }
    await joinTeam(s, inv, uid)
    return { project_id: inv.project_id }
  })) as { project_id: number }
}

/**
 * Crea la cuenta del invitado (con el correo de la invitación y SU contraseña)
 * y acepta en la misma transacción. Si el correo ya tiene cuenta, pide
 * iniciar sesión (solo lo ve quien tiene el enlace vigente de ESE correo).
 */
export async function acceptInvitationWithNewAccount(
  token: string,
  input: { name: string; password: string },
): Promise<{ user_id: number; project_id: number }> {
  if (!isInvitationToken(token)) throw new ObraAccessError(404, INVALID_LINK)
  const o = requireObject(input, "Datos de la cuenta no válidos.")
  const name = requireLine(o.name, "El nombre", 2, 120)
  const password = typeof o.password === "string" ? o.password : ""
  if (password.length < INVITATION_PASSWORD_MIN) {
    throw new ObraValidationError(`La contraseña debe tener al menos ${INVITATION_PASSWORD_MIN} caracteres.`)
  }
  if (password.length > INVITATION_PASSWORD_MAX) {
    throw new ObraValidationError(`La contraseña admite como máximo ${INVITATION_PASSWORD_MAX} caracteres.`)
  }
  await ensureObraSchema()
  const tokenHash = hashInvitationToken(token)

  // Validación previa sin bloquear, para no calcular bcrypt (lento) en vano.
  const pre = await loadInvitation(sql, { tokenHash }, false)
  if (!pre) throw new ObraAccessError(404, INVALID_LINK)
  assertAcceptable(pre)
  const exists = await sql<{ n: number }[]>`SELECT 1 AS n FROM users WHERE lower(email) = ${pre.email} LIMIT 1`
  if (exists[0]) throw new ObraValidationError(ACCOUNT_EXISTS)
  const passwordHash = await bcrypt.hash(password, 10)

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    // Se revalida todo con la fila bloqueada: un segundo envío simultáneo espera aquí y ve "ya aceptada".
    const inv = await loadInvitation(s, { tokenHash }, true)
    if (!inv) throw new ObraAccessError(404, INVALID_LINK)
    assertAcceptable(inv)
    const again = await s<{ n: number }[]>`SELECT 1 AS n FROM users WHERE lower(email) = ${inv.email} LIMIT 1`
    if (again[0]) throw new ObraValidationError(ACCOUNT_EXISTS)
    const ins = await s<{ id: number }[]>`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (${inv.email}, ${name}, ${passwordHash}, 'user')
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `
    if (!ins[0]) throw new ObraValidationError(ACCOUNT_EXISTS)
    const newUserId = Number(ins[0].id)
    await joinTeam(s, inv, newUserId)
    return { user_id: newUserId, project_id: inv.project_id }
  })) as { user_id: number; project_id: number }
}
