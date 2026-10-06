/**
 * Bitácora de auditoría del módulo Obra Integral (solo lectura). Solo
 * servidor; sin "use server": recibe el actorUserId explícito.
 */
import { sql } from "@/lib/db"
import { ObraValidationError, requireProjectPermissionForUser } from "../access"
import type { AuditEntry } from "../types"
import { auditSelect, mapAudit, type AuditRow } from "./mappers"

export const AUDIT_DEFAULT_LIMIT = 50
export const AUDIT_MAX_LIMIT = 100

/**
 * Entradas de auditoría del proyecto, más nuevas primero (audit.view).
 * Paginación por cursor: `before_id` devuelve las entradas con id menor.
 */
export async function listAudit(
  userId: number,
  projectId: number,
  opts?: { limit?: number; before_id?: number },
): Promise<AuditEntry[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "audit.view")
  const o = opts && typeof opts === "object" ? opts : {}

  let limit = AUDIT_DEFAULT_LIMIT
  if (o.limit !== undefined && o.limit !== null) {
    if (typeof o.limit !== "number" || !Number.isFinite(o.limit)) throw new ObraValidationError("Límite no válido.")
    limit = Math.min(AUDIT_MAX_LIMIT, Math.max(1, Math.floor(o.limit)))
  }
  let beforeId: number | null = null
  if (o.before_id !== undefined && o.before_id !== null) {
    if (typeof o.before_id !== "number" || !Number.isSafeInteger(o.before_id) || o.before_id <= 0) {
      throw new ObraValidationError("Cursor de paginación no válido.")
    }
    beforeId = o.before_id
  }

  const rows = await sql<AuditRow[]>`
    ${auditSelect(sql)}
    WHERE a.project_id = ${access.project_id}
    ${beforeId != null ? sql`AND a.id < ${beforeId}` : sql``}
    ORDER BY a.id DESC
    LIMIT ${limit}
  `
  return rows.map(mapAudit)
}
