/**
 * Control de acceso del módulo Obra Integral (solo servidor).
 *
 * Modelo:
 * - El dueño del proyecto (projects.user_id) es el "tenant": tiene rol
 *   implícito `gerente` y los datos heredados (findings, workers...) se guardan
 *   con su user_id para que sigan apareciendo en los módulos existentes.
 * - El resto del equipo entra por `obra_members` (project_id, user_id, role).
 * - TODA lectura/escritura de datos de obra pasa por requireProjectPermission
 *   (o su variante ForUser para la API móvil con Bearer). Las acciones que
 *   reciben el id de una entidad (tarea, sugerencia, capa...) deben resolver
 *   primero su project_id desde la BD y autorizar contra ESE proyecto, nunca
 *   contra un projectId enviado por el cliente.
 */
import type { Sql, TransactionSql } from "postgres"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { can, type Permission } from "./permissions"
import { applyObraSchema } from "./schema"
import { OBRA_ROLES, type ObraRole, type ProjectAccess } from "./types"

export class ObraAccessError extends Error {
  readonly status: 401 | 403 | 404
  constructor(status: 401 | 403 | 404, message: string) {
    super(message)
    this.name = "ObraAccessError"
    this.status = status
  }
}

/** Error de validación de entrada (mensaje mostrable al usuario). */
export class ObraValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ObraValidationError"
  }
}

let schemaReady: Promise<void> | null = null

/**
 * Aplica la migración 006 una vez por proceso (idempotente y con advisory
 * lock). Desactivable con OBRA_AUTO_MIGRATE=0 si se prefiere migrar a mano.
 */
export function ensureObraSchema(): Promise<void> {
  if (process.env.OBRA_AUTO_MIGRATE === "0") return Promise.resolve()
  if (!schemaReady) {
    schemaReady = applyObraSchema(sql as unknown as Sql).catch((e) => {
      schemaReady = null
      throw e
    })
  }
  return schemaReady
}

function isObraRole(v: unknown): v is ObraRole {
  return typeof v === "string" && (OBRA_ROLES as readonly string[]).includes(v)
}

/** Resuelve el acceso de un usuario concreto a un proyecto (o null si no tiene). */
export async function getProjectAccessForUser(userId: number, projectId: number): Promise<ProjectAccess | null> {
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(projectId) || projectId <= 0) return null
  await ensureObraSchema()
  const rows = await sql<{ id: number; name: string; owner_user_id: number | null; member_role: string | null }[]>`
    SELECT p.id, p.name, p.user_id AS owner_user_id, m.role AS member_role
    FROM projects p
    LEFT JOIN obra_members m ON m.project_id = p.id AND m.user_id = ${userId}
    WHERE p.id = ${projectId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row || row.owner_user_id == null) return null
  const ownerId = Number(row.owner_user_id)
  const isOwner = ownerId === userId
  let role: ObraRole | null = null
  if (isOwner) role = "gerente"
  else if (isObraRole(row.member_role)) role = row.member_role
  if (!role) return null
  return {
    project_id: Number(row.id),
    project_name: String(row.name),
    owner_user_id: ownerId,
    user_id: userId,
    role,
    is_owner: isOwner,
  }
}

/** Acceso del usuario de la sesión web (cookie). */
export async function getProjectAccess(projectId: number): Promise<ProjectAccess | null> {
  const session = await getSession()
  if (!session) return null
  return getProjectAccessForUser(Number(session.user_id), projectId)
}

/** Lanza ObraAccessError si el usuario de la sesión no tiene el permiso en el proyecto. */
export async function requireProjectPermission(projectId: number, permission: Permission): Promise<ProjectAccess> {
  const session = await getSession()
  if (!session) throw new ObraAccessError(401, "Sesión no válida. Vuelve a iniciar sesión.")
  return requireProjectPermissionForUser(Number(session.user_id), projectId, permission)
}

/** Variante con userId explícito (API móvil con token Bearer). */
export async function requireProjectPermissionForUser(
  userId: number,
  projectId: number,
  permission: Permission,
): Promise<ProjectAccess> {
  const access = await getProjectAccessForUser(userId, projectId)
  // 404 y no 403 cuando no hay acceso: no revelar que el proyecto existe.
  if (!access) throw new ObraAccessError(404, "Proyecto no encontrado.")
  if (!can(access.role, permission)) {
    throw new ObraAccessError(403, "Tu rol en esta obra no permite esta acción.")
  }
  return access
}

/** Usuario de la sesión web o error 401. */
export async function requireSessionUserId(): Promise<number> {
  const session = await getSession()
  if (!session) throw new ObraAccessError(401, "Sesión no válida. Vuelve a iniciar sesión.")
  return Number(session.user_id)
}

/** Proyectos donde el usuario es dueño o miembro, con su rol. */
export async function listProjectAccessForUser(userId: number): Promise<ProjectAccess[]> {
  await ensureObraSchema()
  const rows = await sql<{ id: number; name: string; owner_user_id: number; member_role: string | null }[]>`
    SELECT p.id, p.name, p.user_id AS owner_user_id, m.role AS member_role
    FROM projects p
    LEFT JOIN obra_members m ON m.project_id = p.id AND m.user_id = ${userId}
    WHERE p.user_id = ${userId} OR m.user_id IS NOT NULL
    ORDER BY p.name ASC
  `
  const out: ProjectAccess[] = []
  for (const r of rows) {
    const isOwner = Number(r.owner_user_id) === userId
    const role: ObraRole | null = isOwner ? "gerente" : isObraRole(r.member_role) ? r.member_role : null
    if (!role) continue
    out.push({
      project_id: Number(r.id),
      project_name: String(r.name),
      owner_user_id: Number(r.owner_user_id),
      user_id: userId,
      role,
      is_owner: isOwner,
    })
  }
  return out
}

type Queryable = Sql | TransactionSql

/** Registra una entrada de auditoría. Usar `tx` dentro de transacciones. */
export async function writeAudit(
  entry: {
    project_id: number
    actor_user_id: number | null
    action: string
    entity_type: string
    entity_id?: number | null
    details?: Record<string, unknown>
  },
  tx?: Queryable,
): Promise<void> {
  const q = (tx ?? sql) as Sql
  await q`
    INSERT INTO obra_audit_log (project_id, actor_user_id, action, entity_type, entity_id, details)
    VALUES (
      ${entry.project_id},
      ${entry.actor_user_id},
      ${entry.action},
      ${entry.entity_type},
      ${entry.entity_id ?? null},
      ${q.json((entry.details ?? {}) as Parameters<Sql["json"]>[0])}
    )
  `
}

/**
 * Convierte cualquier error en un mensaje apto para el usuario. Los errores de
 * acceso y de validación (Error con mensaje en español) se muestran tal cual;
 * los errores inesperados se registran y se devuelven genéricos.
 */
export function toActionError(e: unknown): { ok: false; error: string } {
  if (e instanceof ObraAccessError) return { ok: false, error: e.message }
  if (e instanceof ObraValidationError) return { ok: false, error: e.message }
  console.error("[obra]", e)
  return { ok: false, error: "Ocurrió un error inesperado. Intenta de nuevo." }
}
