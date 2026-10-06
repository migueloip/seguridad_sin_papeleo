/**
 * Equipo de obra (miembros y roles). Solo servidor; sin "use server": cada
 * función recibe el actorUserId explícito y autoriza con
 * requireProjectPermissionForUser.
 *
 * Reglas:
 * - El dueño del proyecto (projects.user_id) es gerente implícito: no está en
 *   obra_members y no se puede agregar, cambiar ni quitar.
 * - Asignar un rol exige canAssignRole (solo un gerente nombra gerentes).
 * - Solo un gerente puede cambiar o quitar a un miembro gerente.
 * - Nadie se cambia el rol ni se quita a sí mismo.
 */
import crypto from "node:crypto"
import bcrypt from "bcryptjs"
import { sql } from "@/lib/db"
import { ObraAccessError, ObraValidationError, requireProjectPermissionForUser, writeAudit } from "../access"
import { canAssignRole, permissionsFor, ROLE_RANK } from "../permissions"
import { OBRA_ROLE_LABELS, OBRA_ROLES, type ObraMember, type ObraRole, type ProjectAccess } from "../types"
import {
  asSql,
  mapMember,
  memberSelect,
  optionalRefId,
  requireEnum,
  requireLine,
  requireObject,
  textLength,
  toPositiveInt,
  type MemberRow,
} from "./mappers"

// El listado de "mis obras" vive en dashboard.ts; se reexporta aquí por contrato (docs §6.1).
export { listMyProjects } from "./dashboard"

const MEMBER_NOT_FOUND = "Integrante no encontrado."

/** Caracteres de la contraseña temporal: sin 0/O/o, 1/l/I para dictarla sin errores. */
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

/** Contraseña temporal aleatoria (crypto) de 12 caracteres legibles, con mayúscula, minúscula y dígito. */
export function generateTemporaryPassword(length = 12): string {
  for (;;) {
    let out = ""
    for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)]
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /[2-9]/.test(out)) return out
  }
}

/** Email en minúsculas y con formato válido (o ObraValidationError). */
export function normalizeEmail(v: unknown): string {
  const email = typeof v === "string" ? v.trim().toLowerCase() : ""
  if (!email || textLength(email) > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ObraValidationError("Ingresa un correo electrónico válido.")
  }
  return email
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Acceso del usuario al proyecto con su lista de permisos (project.view). */
export async function getAccessInfo(userId: number, projectId: number): Promise<ProjectAccess & { permissions: string[] }> {
  const access = await requireProjectPermissionForUser(userId, projectId, "project.view")
  return { ...access, permissions: permissionsFor(access.role) }
}

/** Equipo del proyecto: el dueño primero (is_owner), luego por jerarquía de rol y nombre. */
export async function listMembers(userId: number, projectId: number): Promise<ObraMember[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "project.view")
  const [ownerRows, memberRows] = await Promise.all([
    sql<MemberRow[]>`
      SELECT NULL::int AS id, p.id AS project_id, u.id AS user_id, u.email, u.name, 'gerente' AS role,
             NULL::int AS worker_id, NULL::text AS worker_name, true AS is_owner, NULL::timestamp AS created_at
      FROM projects p
      JOIN users u ON u.id = p.user_id
      WHERE p.id = ${access.project_id}
    `,
    sql<MemberRow[]>`
      ${memberSelect(sql)}
      WHERE m.project_id = ${access.project_id}
    `,
  ])
  const members = memberRows.map(mapMember)
  members.sort((a, b) => {
    const r = ROLE_RANK[b.role] - ROLE_RANK[a.role]
    if (r !== 0) return r
    return (a.name || a.email).localeCompare(b.name || b.email, "es")
  })
  return [...ownerRows.map(mapMember), ...members]
}

/**
 * RUT abreviado (últimos 3 dígitos y dígito verificador: "•••678-9"): basta
 * para distinguir a dos personas con el mismo nombre sin exponer el RUT
 * completo a quien no es dueño de los datos.
 */
export function maskRut(rut: string | null | undefined): string | null {
  if (!rut) return null
  const clean = String(rut).replace(/[^0-9kK]/g, "")
  if (clean.length < 2) return "•••"
  return `•••${clean.slice(0, -1).slice(-3)}-${clean.slice(-1).toUpperCase()}`
}

/**
 * Trabajadores que se pueden vincular a un integrante (members.manage). El
 * dueño ve todo su personal con el RUT completo. Un gestor que no es dueño
 * (jefe de obra, otro gerente) solo ve el personal de ESTA obra o sin obra
 * asignada, con el RUT abreviado: no ve los datos personales de las demás
 * obras del dueño.
 */
export async function listLinkableWorkers(
  userId: number,
  projectId: number,
): Promise<{ id: number; name: string; rut: string | null }[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "members.manage")
  const rows = await sql<{ id: number; name: string | null; rut: string | null }[]>`
    SELECT id, NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '') AS name, rut
    FROM workers
    WHERE user_id = ${access.owner_user_id}
      ${access.is_owner ? sql`` : sql`AND (project_id = ${access.project_id} OR project_id IS NULL)`}
    ORDER BY CASE WHEN project_id = ${access.project_id} THEN 0 ELSE 1 END, first_name, last_name, id
    LIMIT 2000
  `
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name ?? `Trabajador ${r.id}`,
    rut: access.is_owner ? (r.rut ?? null) : maskRut(r.rut),
  }))
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

function roleDenied(role: ObraRole): ObraAccessError {
  return new ObraAccessError(403, `Tu rol no puede asignar el rol «${OBRA_ROLE_LABELS[role]}».`)
}

/**
 * Agrega un integrante por email (members.manage + canAssignRole). Si el
 * usuario no existe se crea con una contraseña temporal que se devuelve UNA
 * sola vez; si ya existe se reutiliza (temporary_password null).
 */
export async function addMember(
  userId: number,
  projectId: number,
  input: { email: string; name?: string | null; role: ObraRole; worker_id?: number | null },
): Promise<{ member: ObraMember; temporary_password: string | null }> {
  const access = await requireProjectPermissionForUser(userId, projectId, "members.manage")
  const o = requireObject(input, "Datos del integrante no válidos.")
  const email = normalizeEmail(o.email)
  const name = o.name === undefined || o.name === null || o.name === "" ? null : requireLine(o.name, "El nombre", 2, 120)
  const role = requireEnum(o.role, OBRA_ROLES, "Rol no válido.")
  if (!canAssignRole(access.role, role)) throw roleDenied(role)
  const workerId = optionalRefId(o.worker_id, "El trabajador")

  // bcrypt es lento: el hash se calcula fuera de la transacción y solo si hace falta.
  const existing = await sql<{ id: number }[]>`SELECT id FROM users WHERE lower(email) = ${email} ORDER BY id LIMIT 1`
  let tempPassword: string | null = null
  let passwordHash: string | null = null
  if (!existing[0]) {
    tempPassword = generateTemporaryPassword()
    passwordHash = await bcrypt.hash(tempPassword, 10)
  }

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    if (workerId != null) {
      const w = await s<{ id: number }[]>`
        SELECT id FROM workers
        WHERE id = ${workerId} AND user_id = ${access.owner_user_id}
          ${access.is_owner ? s`` : s`AND (project_id = ${access.project_id} OR project_id IS NULL)`}
        LIMIT 1
      `
      if (!w[0]) throw new ObraValidationError("El trabajador indicado no pertenece a esta obra.")
    }

    let memberUserId: number
    let created = false
    const found = await s<{ id: number }[]>`SELECT id FROM users WHERE lower(email) = ${email} ORDER BY id LIMIT 1`
    if (found[0]) {
      memberUserId = Number(found[0].id)
    } else {
      if (!passwordHash) {
        tempPassword = generateTemporaryPassword()
        passwordHash = await bcrypt.hash(tempPassword, 10)
      }
      const ins = await s<{ id: number }[]>`
        INSERT INTO users (email, name, password_hash, role)
        VALUES (${email}, ${name}, ${passwordHash}, 'user')
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `
      if (ins[0]) {
        memberUserId = Number(ins[0].id)
        created = true
      } else {
        const again = await s<{ id: number }[]>`SELECT id FROM users WHERE lower(email) = ${email} ORDER BY id LIMIT 1`
        if (!again[0]) throw new Error("No se pudo resolver el usuario por email")
        memberUserId = Number(again[0].id)
      }
    }

    if (memberUserId === access.owner_user_id) {
      throw new ObraValidationError("El dueño del proyecto ya es parte del equipo como gerente.")
    }

    const m = await s<{ id: number }[]>`
      INSERT INTO obra_members (project_id, user_id, role, worker_id, invited_by)
      VALUES (${access.project_id}, ${memberUserId}, ${role}, ${workerId}, ${userId})
      ON CONFLICT (project_id, user_id) DO NOTHING
      RETURNING id
    `
    if (!m[0]) throw new ObraValidationError("Esta persona ya es parte del equipo de la obra.")
    const memberId = Number(m[0].id)

    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "member.added",
        entity_type: "member",
        entity_id: memberId,
        details: { user_id: memberUserId, email, role, worker_id: workerId, new_user: created },
      },
      tx,
    )
    const rows = await s<MemberRow[]>`${memberSelect(s)} WHERE m.id = ${memberId}`
    return { member: mapMember(rows[0]), temporary_password: created ? tempPassword : null }
  })) as { member: ObraMember; temporary_password: string | null }
}

type LockedMember = { id: number; role: string; email: string }

/** Validaciones comunes de cambiar/quitar y bloqueo de la fila del integrante. */
async function lockTargetMember(
  s: ReturnType<typeof asSql>,
  access: ProjectAccess,
  actorUserId: number,
  targetUserId: number,
  selfMessage: string,
): Promise<LockedMember> {
  if (targetUserId === access.owner_user_id) throw new ObraValidationError("No se puede modificar al dueño del proyecto.")
  if (targetUserId === actorUserId) throw new ObraValidationError(selfMessage)
  const rows = await s<LockedMember[]>`
    SELECT m.id, m.role, u.email
    FROM obra_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ${access.project_id} AND m.user_id = ${targetUserId}
    FOR UPDATE OF m
  `
  const cur = rows[0]
  if (!cur) throw new ObraAccessError(404, MEMBER_NOT_FOUND)
  if (cur.role === "gerente" && access.role !== "gerente") {
    throw new ObraAccessError(403, "Solo un gerente puede modificar a otro gerente.")
  }
  return cur
}

/** Cambia el rol de un integrante (members.manage + canAssignRole). */
export async function updateMemberRole(
  userId: number,
  projectId: number,
  memberUserId: number,
  role: ObraRole,
): Promise<ObraMember> {
  const access = await requireProjectPermissionForUser(userId, projectId, "members.manage")
  const target = toPositiveInt(memberUserId)
  if (target == null) throw new ObraAccessError(404, MEMBER_NOT_FOUND)
  const newRole = requireEnum(role, OBRA_ROLES, "Rol no válido.")

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const cur = await lockTargetMember(s, access, userId, target, "No puedes cambiar tu propio rol.")
    if (!canAssignRole(access.role, newRole)) throw roleDenied(newRole)
    if (cur.role !== newRole) {
      await s`UPDATE obra_members SET role = ${newRole}, updated_at = CURRENT_TIMESTAMP WHERE id = ${cur.id}`
      await writeAudit(
        {
          project_id: access.project_id,
          actor_user_id: userId,
          action: "member.role_changed",
          entity_type: "member",
          entity_id: Number(cur.id),
          details: { user_id: target, email: cur.email, from: cur.role, to: newRole },
        },
        tx,
      )
    }
    const rows = await s<MemberRow[]>`${memberSelect(s)} WHERE m.id = ${cur.id}`
    return mapMember(rows[0])
  })) as ObraMember
}

/** Quita a un integrante del equipo (members.manage). */
export async function removeMember(userId: number, projectId: number, memberUserId: number): Promise<null> {
  const access = await requireProjectPermissionForUser(userId, projectId, "members.manage")
  const target = toPositiveInt(memberUserId)
  if (target == null) throw new ObraAccessError(404, MEMBER_NOT_FOUND)

  await sql.begin(async (tx) => {
    const s = asSql(tx)
    const cur = await lockTargetMember(s, access, userId, target, "No puedes quitarte a ti mismo del equipo.")
    await s`DELETE FROM obra_members WHERE id = ${cur.id}`
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "member.removed",
        entity_type: "member",
        entity_id: Number(cur.id),
        details: { user_id: target, email: cur.email, role: cur.role },
      },
      tx,
    )
  })
  return null
}
