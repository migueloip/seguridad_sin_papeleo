/**
 * Equipo de obra (miembros y roles). Solo servidor; sin "use server": cada
 * función recibe el actorUserId explícito y autoriza con
 * requireProjectPermissionForUser.
 *
 * Reglas:
 * - El dueño del proyecto (projects.user_id) es gerente implícito: no está en
 *   obra_members y no se puede agregar, cambiar ni quitar.
 * - Las personas entran al equipo SOLO aceptando una invitación
 *   (lib/obra/server/invitations.ts): nadie queda agregado sin aceptar y quien
 *   crea la cuenta elige su contraseña. El enlace es un token al portador (no
 *   se verifica el correo): ver el comentario de invitations.ts.
 * - Asignar un rol exige canAssignRole (solo un gerente nombra gerentes).
 * - Solo un gerente puede cambiar o quitar a un miembro gerente.
 * - Nadie se cambia el rol ni se quita a sí mismo.
 * - Al quitar a alguien, sus tareas abiertas quedan sin persona asignada (pero
 *   con su rol, para que la cuadrilla las siga viendo) y se revocan las
 *   invitaciones abiertas que envió. Al bajarle el rol se revocan las que ya
 *   no podría enviar (revokeInvitationsSentBy).
 */
import { sql } from "@/lib/db"
import { ObraAccessError, ObraValidationError, requireProjectPermissionForUser, writeAudit } from "../access"
import { canAssignRole, permissionsFor, ROLE_RANK } from "../permissions"
import { OBRA_ROLE_LABELS, OBRA_ROLES, type ObraMember, type ObraRole, type ProjectAccess } from "../types"
import {
  asSql,
  mapMember,
  memberSelect,
  requireEnum,
  textLength,
  toPositiveInt,
  type MemberRow,
  type Queryable,
} from "./mappers"

// El listado de "mis obras" vive en dashboard.ts; se reexporta aquí por contrato (docs §6.1).
export { listMyProjects } from "./dashboard"

const MEMBER_NOT_FOUND = "Integrante no encontrado."

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

/**
 * Verifica que un trabajador se pueda vincular a un integrante con este acceso
 * (misma regla que listLinkableWorkers): del dueño del proyecto y, si quien
 * gestiona no es el dueño, de ESTA obra o sin obra asignada.
 */
export async function assertLinkableWorker(q: Queryable, access: ProjectAccess, workerId: number): Promise<void> {
  const s = asSql(q)
  const w = await s<{ id: number }[]>`
    SELECT id FROM workers
    WHERE id = ${workerId} AND user_id = ${access.owner_user_id}
      ${access.is_owner ? s`` : s`AND (project_id = ${access.project_id} OR project_id IS NULL)`}
    LIMIT 1
  `
  if (!w[0]) throw new ObraValidationError("El trabajador indicado no pertenece a esta obra.")
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/** Error 403 de "tu rol no puede asignar este rol" (también lo usan las invitaciones). */
export function roleDenied(role: ObraRole): ObraAccessError {
  return new ObraAccessError(403, `Tu rol no puede asignar el rol «${OBRA_ROLE_LABELS[role]}».`)
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

/**
 * Revoca, en la transacción de quien llama, las invitaciones abiertas que
 * envió `inviterUserId` en el proyecto y cuyo rol ya no puede otorgar con
 * `newRole` (null = salió del equipo: todas). Audita cada una con `reason`.
 * La usan removeMember y updateMemberRole.
 */
export async function revokeInvitationsSentBy(
  q: Queryable,
  args: {
    project_id: number
    inviter_user_id: number
    new_role: ObraRole | null
    actor_user_id: number
    reason: "inviter_removed" | "inviter_role_changed"
  },
): Promise<number[]> {
  const s = asSql(q)
  const keep = args.new_role ? OBRA_ROLES.filter((r) => canAssignRole(args.new_role, r)) : []
  const rows = await s<{ id: number; email: string; role: string }[]>`
    UPDATE obra_invitations SET revoked_at = LOCALTIMESTAMP
    WHERE project_id = ${args.project_id} AND invited_by = ${args.inviter_user_id}
      AND accepted_at IS NULL AND revoked_at IS NULL
      ${keep.length > 0 ? s`AND role NOT IN ${s(keep)}` : s``}
    RETURNING id, email, role
  `
  for (const r of rows) {
    await writeAudit(
      {
        project_id: args.project_id,
        actor_user_id: args.actor_user_id,
        action: "invitation.revoked",
        entity_type: "invitation",
        entity_id: Number(r.id),
        details: { email: String(r.email), role: r.role, invited_by: args.inviter_user_id, reason: args.reason },
      },
      q,
    )
  }
  return rows.map((r) => Number(r.id))
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
      // Sus invitaciones abiertas con un rol que el rol nuevo ya no puede otorgar dejan de servir.
      const revoked = await revokeInvitationsSentBy(s, {
        project_id: access.project_id,
        inviter_user_id: target,
        new_role: newRole,
        actor_user_id: userId,
        reason: "inviter_role_changed",
      })
      await writeAudit(
        {
          project_id: access.project_id,
          actor_user_id: userId,
          action: "member.role_changed",
          entity_type: "member",
          entity_id: Number(cur.id),
          details: {
            user_id: target,
            email: cur.email,
            from: cur.role,
            to: newRole,
            ...(revoked.length > 0 ? { revoked_invitations: revoked.length, revoked_invitation_ids: revoked.slice(0, 100) } : {}),
          },
        },
        tx,
      )
    }
    const rows = await s<MemberRow[]>`${memberSelect(s)} WHERE m.id = ${cur.id}`
    return mapMember(rows[0])
  })) as ObraMember
}

/**
 * Quita a un integrante del equipo (members.manage). En la misma transacción:
 * - sus tareas abiertas (pendiente / en progreso) del proyecto quedan sin
 *   persona asignada: conservan el rol asignado (o toman el que tenía el
 *   integrante) para que su cuadrilla las siga viendo;
 * - las hechas y canceladas conservan a la persona (registro histórico) y
 *   reciben su rol si no tenían: si alguien las reabre, setTaskStatus las deja
 *   sin persona y siguen visibles para ese rol;
 * - se revocan las invitaciones abiertas que envió.
 */
export async function removeMember(userId: number, projectId: number, memberUserId: number): Promise<null> {
  const access = await requireProjectPermissionForUser(userId, projectId, "members.manage")
  const target = toPositiveInt(memberUserId)
  if (target == null) throw new ObraAccessError(404, MEMBER_NOT_FOUND)

  await sql.begin(async (tx) => {
    const s = asSql(tx)
    const cur = await lockTargetMember(s, access, userId, target, "No puedes quitarte a ti mismo del equipo.")
    await s`DELETE FROM obra_members WHERE id = ${cur.id}`
    const unassigned = await s<{ id: number }[]>`
      UPDATE obra_tasks
      SET assigned_user_id = NULL,
          assigned_role = COALESCE(assigned_role, ${cur.role}),
          updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ${access.project_id}
        AND assigned_user_id = ${target}
        AND status IN ('pendiente', 'en_progreso')
      RETURNING id
    `
    await s`
      UPDATE obra_tasks
      SET assigned_role = ${cur.role}, updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ${access.project_id}
        AND assigned_user_id = ${target}
        AND assigned_role IS NULL
        AND status IN ('hecha', 'cancelada')
    `
    const revoked = await revokeInvitationsSentBy(s, {
      project_id: access.project_id,
      inviter_user_id: target,
      new_role: null,
      actor_user_id: userId,
      reason: "inviter_removed",
    })
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "member.removed",
        entity_type: "member",
        entity_id: Number(cur.id),
        details: {
          user_id: target,
          email: cur.email,
          role: cur.role,
          unassigned_tasks: unassigned.length,
          unassigned_task_ids: unassigned.slice(0, 100).map((t) => Number(t.id)),
          ...(revoked.length > 0 ? { revoked_invitations: revoked.length, revoked_invitation_ids: revoked.slice(0, 100) } : {}),
        },
      },
      tx,
    )
  })
  return null
}
