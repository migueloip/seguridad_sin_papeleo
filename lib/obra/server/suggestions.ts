/**
 * Bandeja de sugerencias de IA con aprobación humana obligatoria. Solo
 * servidor; sin "use server".
 *
 * Garantías (docs/PLAN-OBRA-INTEGRAL.md §2.1):
 * - Aplicar exige ai.review, y ai.review_critical si la severidad es crítica
 *   (canReviewSuggestion).
 * - Se aplica en UNA transacción con SELECT … FOR UPDATE: una sugerencia se
 *   aprueba o rechaza una sola vez (las demás llamadas ven "ya fue revisada");
 *   además obra_tasks.suggestion_id es UNIQUE.
 * - El proyecto se resuelve desde la sugerencia (nunca desde el cliente) y
 *   todo payload, también el editado, se valida otra vez y sus referencias
 *   (hallazgo, capa) deben pertenecer al mismo proyecto.
 * - La tarea creada al aprobar un create_task queda con origin 'ia' si la
 *   sugerencia la redactó un modelo (generator = 'ia') y 'reglas' si salió del
 *   motor de reglas, aunque la persona la haya editado antes de aprobarla.
 */
import { sql } from "@/lib/db"
import { getProjectAccessForUser, ObraAccessError, ObraValidationError, requireProjectPermissionForUser, writeAudit } from "../access"
import { severityFromPriority } from "../correlation"
import { addDaysISO, todayISO } from "../metrics"
import { can, canReviewSuggestion } from "../permissions"
import { parseSuggestionPayload, SuggestionPayloadError } from "../suggestions"
import {
  SEVERITIES,
  SUGGESTION_KINDS,
  SUGGESTION_STATUSES,
  type AiSuggestion,
  type ProjectAccess,
  type Severity,
  type SuggestionKind,
  type SuggestionPayload,
  type SuggestionStatus,
  type TaskOrigin,
} from "../types"
import { insertElementsInTx, lockLayerForWrite, normalizeElementDraft } from "./elements"
import { getInspectionById } from "./inspections"
import {
  asSql,
  hasKey,
  livePendingSuggestionCondition,
  mapSuggestion,
  optionalText,
  orphanSuggestionCondition,
  payloadReferencesFinding,
  requireEnum,
  requireObject,
  suggestionSelect,
  toPositiveInt,
  type Queryable,
  type SuggestionRow,
} from "./mappers"
import { createTaskInTx } from "./tasks"

export const SUGGESTION_LIST_LIMITS = { default: 50, max: 200, notes: 1000 } as const

const NOT_FOUND = "Sugerencia no encontrada."
const ALREADY_REVIEWED = "Esta sugerencia ya fue revisada."
const SUPERSEDED = "Esta sugerencia quedó sin efecto (se reemplazó por un análisis más nuevo o se eliminó su capa)."
const CRITICAL_ONLY_APPROVE = "Solo un perfil autorizado puede aprobar sugerencias críticas."
const CRITICAL_ONLY_REJECT = "Solo un perfil autorizado puede rechazar sugerencias críticas."

export type SuggestionFilter = { status?: SuggestionStatus[]; finding_id?: number; limit?: number }

export type ApproveResult = {
  suggestion: AiSuggestion
  applied_entity_type: string | null
  applied_entity_id: number | null
  /** Revisión donde quedó anotada la tarea (solo create_task). */
  inspection: { id: number; title: string; scheduled_for: string } | null
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 }

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

function parsePayload(kind: SuggestionKind, data: unknown): SuggestionPayload {
  try {
    return parseSuggestionPayload(kind, data)
  } catch (e) {
    if (e instanceof SuggestionPayloadError) throw new ObraValidationError(e.message)
    throw e
  }
}

/** Lee una sugerencia del proyecto como DTO (o null). */
export async function getSuggestionById(q: Queryable, projectId: number, suggestionId: number): Promise<AiSuggestion | null> {
  const s = asSql(q)
  const rows = await s<SuggestionRow[]>`
    ${suggestionSelect(s)}
    WHERE s.id = ${suggestionId} AND s.project_id = ${projectId}
    LIMIT 1
  `
  return rows[0] ? mapSuggestion(rows[0]) : null
}

/**
 * Resuelve el proyecto de la sugerencia desde la BD y exige ai.review en ESE
 * proyecto: 404 si no existe o no hay acceso; 403 si el rol no revisa.
 */
async function authorizeReview(userId: number, suggestionId: unknown): Promise<{ access: ProjectAccess; suggestionId: number }> {
  const id = toPositiveInt(suggestionId)
  if (id == null) throw new ObraAccessError(404, NOT_FOUND)
  const rows = await sql<{ project_id: number }[]>`SELECT project_id FROM obra_ai_suggestions WHERE id = ${id}`
  if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
  const access = await getProjectAccessForUser(userId, Number(rows[0].project_id))
  if (!access) throw new ObraAccessError(404, NOT_FOUND)
  if (!can(access.role, "ai.review")) {
    throw new ObraAccessError(403, "Tu rol en esta obra no permite aprobar ni rechazar sugerencias de IA.")
  }
  return { access, suggestionId: id }
}

type LockedSuggestion = {
  id: number
  kind: string
  status: string
  severity: string
  generator: string
  payload: unknown
  finding_id: number | null
  layer_id: number | null
}

async function lockSuggestion(q: Queryable, projectId: number, suggestionId: number): Promise<LockedSuggestion> {
  const s = asSql(q)
  const rows = await s<LockedSuggestion[]>`
    SELECT id, kind, status, severity, generator, payload, finding_id, layer_id
    FROM obra_ai_suggestions
    WHERE id = ${suggestionId} AND project_id = ${projectId}
    FOR UPDATE
  `
  if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
  return rows[0]
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Sugerencias del proyecto (findings.view), más recientes primero. */
export async function listSuggestions(userId: number, projectId: number, filter?: SuggestionFilter): Promise<AiSuggestion[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "findings.view")
  const f = filter === undefined || filter === null ? {} : requireObject(filter, "Filtro de sugerencias no válido.")
  let status: SuggestionStatus[] = []
  if (hasKey(f, "status") && f.status !== null) {
    if (!Array.isArray(f.status)) throw new ObraValidationError("Filtro de estado no válido.")
    status = [...new Set(f.status.map((v) => requireEnum(v, SUGGESTION_STATUSES, "Estado de sugerencia no válido.")))]
  }
  let findingId: number | null = null
  if (hasKey(f, "finding_id") && f.finding_id !== null) {
    findingId = toPositiveInt(f.finding_id)
    if (findingId == null) throw new ObraValidationError("Hallazgo no válido.")
  }
  let limit: number = SUGGESTION_LIST_LIMITS.default
  if (hasKey(f, "limit") && f.limit !== null) {
    const n = f.limit
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > SUGGESTION_LIST_LIMITS.max) {
      throw new ObraValidationError(`El límite debe estar entre 1 y ${SUGGESTION_LIST_LIMITS.max}.`)
    }
    limit = n
  }
  const rows = await sql<SuggestionRow[]>`
    ${suggestionSelect(sql)}
    WHERE s.project_id = ${access.project_id}
      AND NOT (s.status = 'pending' AND ${orphanSuggestionCondition(sql)})
    ${status.length > 0 ? sql`AND s.status IN ${sql(status)}` : sql``}
    ${findingId != null ? sql`AND s.finding_id = ${findingId}` : sql``}
    ORDER BY s.created_at DESC, s.id ASC
    LIMIT ${limit}
  `
  return rows.map(mapSuggestion)
}

/**
 * Cantidad de sugerencias pendientes que el usuario puede decidir (para el
 * contador de la pestaña "Aprobaciones IA"). 0 si su rol no revisa: no tiene
 * sentido pedirle una acción que no puede hacer. Las huérfanas no cuentan.
 */
export async function countPendingSuggestions(userId: number, projectId: number): Promise<number> {
  const access = await requireProjectPermissionForUser(userId, projectId, "project.view")
  if (!can(access.role, "ai.review")) return 0
  const critical = can(access.role, "ai.review_critical")
  const rows = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM obra_ai_suggestions s
    WHERE s.project_id = ${access.project_id} AND ${livePendingSuggestionCondition(sql)}
    ${critical ? sql`` : sql`AND s.severity <> 'critical'`}
  `
  return Number(rows[0]?.n ?? 0)
}

/**
 * Aprueba y aplica una sugerencia pendiente. `edited_payload` ("Editar y
 * aprobar") debe ser del mismo tipo y se valida igual que el original; el
 * original queda en evidence.original_payload.
 */
export async function approveSuggestion(
  userId: number,
  suggestionId: number,
  opts?: { edited_payload?: unknown; notes?: string },
): Promise<ApproveResult> {
  const { access, suggestionId: id } = await authorizeReview(userId, suggestionId)
  const o = opts === undefined || opts === null ? {} : requireObject(opts, "Datos de la aprobación no válidos.")
  const notes = optionalText(o.notes, "Las notas", SUGGESTION_LIST_LIMITS.notes)
  const hasEdit = o.edited_payload !== undefined && o.edited_payload !== null

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const row = await lockSuggestion(s, access.project_id, id)
    if (row.status === "superseded") throw new ObraValidationError(SUPERSEDED)
    if (row.status !== "pending") throw new ObraValidationError(ALREADY_REVIEWED)
    const kind = requireEnum(row.kind, SUGGESTION_KINDS, "Tipo de sugerencia desconocido.")
    const storedSeverity = requireEnum(row.severity, SEVERITIES, "Severidad de la sugerencia no válida.")
    if (!canReviewSuggestion(access.role, storedSeverity)) throw new ObraAccessError(403, CRITICAL_ONLY_APPROVE)
    if ((kind === "create_task" || kind === "update_finding_severity") && row.finding_id == null && payloadReferencesFinding(row.payload)) {
      throw new ObraValidationError("El hallazgo de esta sugerencia fue eliminado: ya no se puede aplicar.")
    }

    // Payload guardado (validado otra vez). Si quedó inválido solo se puede aprobar editándolo.
    let stored: SuggestionPayload | null = null
    try {
      stored = parsePayload(kind, row.payload)
    } catch {
      if (!hasEdit) throw new ObraValidationError("La sugerencia tiene datos inválidos y no se puede aplicar.")
    }
    const final: SuggestionPayload = hasEdit ? parsePayload(kind, o.edited_payload) : stored
    const edited = hasEdit && JSON.stringify(final) !== JSON.stringify(stored)

    // La severidad efectiva considera lo editado (p.ej. subir la prioridad a crítica).
    let effective = storedSeverity
    if (final.kind === "create_task") effective = maxSeverity(effective, severityFromPriority(final.data.priority))
    if (final.kind === "update_finding_severity" && final.data.to === "critical") effective = "critical"
    if (!canReviewSuggestion(access.role, effective)) throw new ObraAccessError(403, CRITICAL_ONLY_APPROVE)

    let appliedType: string | null = null
    let appliedId: number | null = null
    let inspection: ApproveResult["inspection"] = null
    const applyDetails: Record<string, unknown> = {}

    if (final.kind === "create_task") {
      const d = final.data
      // Editar no puede mover la tarea a otro hallazgo ni desvincularla del revisado.
      if (row.finding_id != null && d.finding_id !== Number(row.finding_id)) {
        throw new ObraValidationError("No se puede cambiar el hallazgo de una tarea sugerida.")
      }
      // El origen distingue quién redactó la sugerencia aprobada: un modelo de IA o el motor de reglas.
      const origin: TaskOrigin = row.generator === "ia" ? "ia" : "reglas"
      const task = await createTaskInTx(
        s,
        access,
        {
          title: d.title,
          description: d.description || null,
          priority: d.priority,
          assigned_role: d.assigned_role,
          due_date: addDaysISO(todayISO(), d.due_in_days),
          inspection_id: "next",
          finding_id: d.finding_id,
          layer_id: d.layer_id,
          level: d.level,
          x: d.x,
          y: d.y,
          checklist: d.checklist,
        },
        { origin, suggestion_id: id },
      )
      appliedType = "task"
      appliedId = task.id
      applyDetails.task_origin = task.origin
      applyDetails.inspection_id = task.inspection_id
      applyDetails.due_date = task.due_date
      if (task.inspection_id != null) {
        const ins = await getInspectionById(s, access.project_id, task.inspection_id)
        if (ins) inspection = { id: ins.id, title: ins.title, scheduled_for: ins.scheduled_for }
      }
    } else if (final.kind === "plan_elements") {
      const d = final.data
      // Los elementos se detectaron en la lámina de UNA capa: no se pueden incorporar en otra.
      const reviewedLayerId =
        row.layer_id != null ? Number(row.layer_id) : stored && stored.kind === "plan_elements" ? stored.data.layer_id : null
      if (reviewedLayerId != null && d.layer_id !== reviewedLayerId) {
        throw new ObraValidationError("No se puede cambiar la capa de una sugerencia de elementos.")
      }
      const layer = await lockLayerForWrite(s, access.project_id, d.layer_id)
      const drafts = d.elements.map((e, i) => normalizeElementDraft(e, i))
      const inserted = await insertElementsInTx(s, access.project_id, layer.id, drafts, {
        source: "ia",
        created_by: userId,
        suggestion_id: id,
      })
      appliedType = "layer"
      appliedId = layer.id
      applyDetails.inserted = inserted
    } else {
      const d = final.data
      const storedFindingId = stored && stored.kind === "update_finding_severity" ? stored.data.finding_id : row.finding_id
      if (storedFindingId != null && d.finding_id !== Number(storedFindingId)) {
        throw new ObraValidationError("No se puede cambiar el hallazgo de una sugerencia de severidad.")
      }
      const f = await s<{ id: number; severity: string | null; status: string | null }[]>`
        SELECT id, severity, status FROM findings
        WHERE id = ${d.finding_id} AND project_id = ${access.project_id}
          AND (user_id = ${access.owner_user_id} OR user_id IS NULL)
        FOR UPDATE
      `
      if (!f[0]) throw new ObraValidationError("El hallazgo indicado no pertenece a esta obra.")
      // Se aprueba con datos frescos: si el hallazgo cambió desde que se generó la sugerencia
      // (otra severidad, o ya se resolvió), aplicarla pisaría una decisión posterior.
      const currentSeverity = String(f[0].severity ?? "").trim().toLowerCase()
      const currentStatus = String(f[0].status ?? "").trim().toLowerCase()
      const expectedFrom = stored && stored.kind === "update_finding_severity" ? stored.data.from : d.from
      if (currentStatus === "resolved" || currentStatus === "closed") {
        throw new ObraValidationError("El hallazgo ya está resuelto o cerrado: no corresponde cambiar su severidad.")
      }
      if (currentSeverity !== expectedFrom) {
        throw new ObraValidationError(
          "La severidad del hallazgo cambió desde que se generó la sugerencia. Vuelve a analizarlo antes de decidir.",
        )
      }
      await s`
        UPDATE findings SET severity = ${d.to}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${d.finding_id} AND project_id = ${access.project_id}
      `
      appliedType = "finding"
      appliedId = d.finding_id
      applyDetails.previous_severity = f[0].severity
      applyDetails.new_severity = d.to
    }

    const finalJson = s.json(final as unknown as Parameters<typeof s.json>[0])
    const originalJson = s.json({ original_payload: stored ?? row.payload } as unknown as Parameters<typeof s.json>[0])
    await s`
      UPDATE obra_ai_suggestions SET
        status = 'approved',
        reviewed_by = ${userId},
        reviewed_at = CURRENT_TIMESTAMP,
        review_notes = ${notes},
        payload = ${finalJson},
        evidence = ${edited ? s`evidence || ${originalJson}` : s`evidence`},
        applied_entity_type = ${appliedType},
        applied_entity_id = ${appliedId},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND project_id = ${access.project_id}
    `
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "suggestion.approved",
        entity_type: "suggestion",
        entity_id: id,
        details: {
          kind,
          severity: effective,
          generator: row.generator,
          edited,
          notes,
          finding_id: row.finding_id == null ? null : Number(row.finding_id),
          applied_entity_type: appliedType,
          applied_entity_id: appliedId,
          ...applyDetails,
        },
      },
      tx,
    )
    const suggestion = await getSuggestionById(s, access.project_id, id)
    if (!suggestion) throw new ObraAccessError(404, NOT_FOUND)
    return { suggestion, applied_entity_type: appliedType, applied_entity_id: appliedId, inspection }
  })) as ApproveResult
}

/** Rechaza una sugerencia pendiente con un motivo opcional (≤ 1000 caracteres). */
export async function rejectSuggestion(userId: number, suggestionId: number, reason?: string): Promise<AiSuggestion> {
  const { access, suggestionId: id } = await authorizeReview(userId, suggestionId)
  const why = optionalText(reason, "El motivo", SUGGESTION_LIST_LIMITS.notes)

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const row = await lockSuggestion(s, access.project_id, id)
    if (row.status === "superseded") throw new ObraValidationError(SUPERSEDED)
    if (row.status !== "pending") throw new ObraValidationError(ALREADY_REVIEWED)
    const severity = requireEnum(row.severity, SEVERITIES, "Severidad de la sugerencia no válida.")
    if (!canReviewSuggestion(access.role, severity)) throw new ObraAccessError(403, CRITICAL_ONLY_REJECT)
    await s`
      UPDATE obra_ai_suggestions SET
        status = 'rejected',
        reviewed_by = ${userId},
        reviewed_at = CURRENT_TIMESTAMP,
        review_notes = ${why},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND project_id = ${access.project_id}
    `
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "suggestion.rejected",
        entity_type: "suggestion",
        entity_id: id,
        details: {
          kind: row.kind,
          severity,
          generator: row.generator,
          reason: why,
          finding_id: row.finding_id == null ? null : Number(row.finding_id),
        },
      },
      tx,
    )
    const out = await getSuggestionById(s, access.project_id, id)
    if (!out) throw new ObraAccessError(404, NOT_FOUND)
    return out
  })) as AiSuggestion
}
