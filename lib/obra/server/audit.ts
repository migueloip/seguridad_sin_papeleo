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

// ---------------------------------------------------------------------------
// Límite de uso de IA (protege la API key y la cuota del dueño del proyecto)
// ---------------------------------------------------------------------------

export type AiQuotaKind = "finding_analysis" | "layer_extraction"

/**
 * Máximos de llamadas a IA, contadas en la bitácora (las acciones que la IA
 * respondió y quedaron registradas): por persona y hora, y por obra y día.
 */
export const AI_QUOTA: Record<AiQuotaKind, { action: string; perUserHour: number; perProjectDay: number; noun: string }> = {
  finding_analysis: { action: "finding.analyzed", perUserHour: 20, perProjectDay: 200, noun: "análisis de hallazgos con IA" },
  layer_extraction: { action: "layer.extraction_requested", perUserHour: 10, perProjectDay: 60, noun: "detecciones con IA en láminas" },
}

/**
 * Lanza ObraValidationError si la persona o la obra superaron el límite de
 * llamadas a IA. Cada llamada usa la configuración (y la API key) del dueño
 * del proyecto, así que sin este tope un integrante con ai.request podría
 * generarle un costo arbitrario. Es un límite blando: dos pedidos simultáneos
 * pueden pasar a la vez, pero no un bucle.
 */
export async function assertAiQuota(
  access: { project_id: number; user_id: number },
  kind: AiQuotaKind,
): Promise<void> {
  const q = AI_QUOTA[kind]
  const rows = await sql<{ user_hour: number; project_day: number }[]>`
    SELECT
      COUNT(*) FILTER (
        WHERE a.actor_user_id = ${access.user_id} AND a.created_at > LOCALTIMESTAMP - interval '1 hour'
      )::int AS user_hour,
      COUNT(*)::int AS project_day
    FROM obra_audit_log a
    WHERE a.project_id = ${access.project_id}
      AND a.action = ${q.action}
      AND a.created_at > LOCALTIMESTAMP - interval '1 day'
      ${kind === "finding_analysis" ? sql`AND (a.details->>'use_ai') = 'true'` : sql``}
  `
  const r = rows[0]
  if (Number(r?.user_hour ?? 0) >= q.perUserHour) {
    throw new ObraValidationError(
      `Alcanzaste el máximo de ${q.perUserHour} ${q.noun} por hora en esta obra. Intenta de nuevo más tarde.`,
    )
  }
  if (Number(r?.project_day ?? 0) >= q.perProjectDay) {
    throw new ObraValidationError(
      `Esta obra alcanzó el máximo diario de ${q.perProjectDay} ${q.noun}. Intenta de nuevo mañana.`,
    )
  }
}
