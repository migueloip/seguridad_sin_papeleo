/**
 * Revisiones (inspecciones programadas) del módulo Obra Integral. Solo
 * servidor; sin "use server": cada función recibe el actorUserId explícito y
 * autoriza con requireProjectPermissionForUser.
 */
import { sql } from "@/lib/db"
import {
  getProjectAccessForUser,
  ObraAccessError,
  ObraValidationError,
  requireProjectPermissionForUser,
  writeAudit,
} from "../access"
import { addDaysISO, todayISO } from "../metrics"
import { can, type Permission } from "../permissions"
import { INSPECTION_STATUSES, type InspectionStatus, type ObraInspection, type ProjectAccess } from "../types"
import {
  asSql,
  hasKey,
  inspectionSelect,
  mapInspection,
  optionalRefId,
  optionalText,
  requireDateISO,
  requireLine,
  requireObject,
  toPositiveInt,
  type InspectionRow,
  type Queryable,
} from "./mappers"

const LIMITS = { titleMin: 3, titleMax: 200, notes: 4000, summary: 4000 } as const

/** Espacio de claves del advisory lock (pg_advisory_xact_lock(int, int)) para crear la próxima revisión. */
export const NEXT_INSPECTION_LOCK_NS = 7262007

/** Título de la revisión que se crea automáticamente cuando no hay una próxima. */
export const AUTO_INSPECTION_TITLE = "Revisión semanal"

const NOT_FOUND = "Revisión no encontrada."

// ---------------------------------------------------------------------------
// Utilidades compartidas
// ---------------------------------------------------------------------------

/**
 * Verifica que `userId` sea el dueño o un miembro del proyecto (para
 * asignaciones: responsable de revisión, persona asignada a una tarea...).
 */
export async function assertProjectUser(q: Queryable, projectId: number, userId: number, label: string): Promise<void> {
  const s = asSql(q)
  const rows = await s<{ ok: number }[]>`
    SELECT 1 AS ok FROM projects WHERE id = ${projectId} AND user_id = ${userId}
    UNION ALL
    SELECT 1 AS ok FROM obra_members WHERE project_id = ${projectId} AND user_id = ${userId}
    LIMIT 1
  `
  if (!rows[0]) throw new ObraValidationError(`${label} no pertenece al equipo de esta obra.`)
}

/** Lee una revisión con sus conteos (o null si no existe en ese proyecto). */
export async function getInspectionById(q: Queryable, projectId: number, inspectionId: number): Promise<ObraInspection | null> {
  const s = asSql(q)
  const rows = await s<InspectionRow[]>`
    ${inspectionSelect(s)}
    WHERE i.id = ${inspectionId} AND i.project_id = ${projectId}
    LIMIT 1
  `
  return rows[0] ? mapInspection(rows[0]) : null
}

/**
 * Resuelve el proyecto de una revisión desde la BD y autoriza contra ESE
 * proyecto. Si no existe o el usuario no tiene acceso → 404.
 */
async function authorizeInspection(
  userId: number,
  inspectionId: unknown,
  permission: Permission,
): Promise<{ access: ProjectAccess; inspectionId: number }> {
  const id = toPositiveInt(inspectionId)
  if (id == null) throw new ObraAccessError(404, NOT_FOUND)
  const rows = await sql<{ project_id: number }[]>`SELECT project_id FROM obra_inspections WHERE id = ${id}`
  if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
  const access = await getProjectAccessForUser(userId, Number(rows[0].project_id))
  if (!access) throw new ObraAccessError(404, NOT_FOUND)
  if (!can(access.role, permission)) throw new ObraAccessError(403, "Tu rol en esta obra no permite esta acción.")
  return { access, inspectionId: id }
}

function isTransaction(q: Queryable): boolean {
  return typeof (q as { savepoint?: unknown }).savepoint === "function"
}

// ---------------------------------------------------------------------------
// Próxima revisión (interna: se usa al aprobar sugerencias y al trasladar tareas)
// ---------------------------------------------------------------------------

/**
 * Devuelve la revisión 'programada' más próxima con fecha >= hoy; si no hay,
 * crea "Revisión semanal" para hoy + 7 días y la audita (inspection.created,
 * auto). Serializa por proyecto con pg_advisory_xact_lock para que dos
 * llamadas simultáneas no creen dos revisiones.
 *
 * Debe llamarse dentro de una transacción (sql.begin); si recibe el cliente
 * global, abre una transacción propia para que el lock tenga efecto.
 * No verifica permisos: el llamador ya autorizó.
 */
export async function getOrCreateNextInspection(
  tx: Queryable,
  projectId: number,
  actorUserId: number,
  opts?: { excludeId?: number | null },
): Promise<ObraInspection> {
  if (!isTransaction(tx)) {
    return asSql(tx).begin((t) => getOrCreateNextInspection(t, projectId, actorUserId, opts)) as Promise<ObraInspection>
  }
  const s = asSql(tx)
  await s`SELECT pg_advisory_xact_lock(${NEXT_INSPECTION_LOCK_NS}::int, ${projectId}::int)`
  const today = todayISO()
  const excludeId = opts?.excludeId ?? null
  const found = await s<InspectionRow[]>`
    ${inspectionSelect(s)}
    WHERE i.project_id = ${projectId}
      AND i.status = 'programada'
      AND i.scheduled_for >= ${today}::date
      ${excludeId != null ? s`AND i.id <> ${excludeId}` : s``}
    ORDER BY i.scheduled_for ASC, i.id ASC
    LIMIT 1
  `
  if (found[0]) return mapInspection(found[0])

  const scheduledFor = addDaysISO(today, 7)
  const ins = await s<{ id: number }[]>`
    INSERT INTO obra_inspections (project_id, title, scheduled_for, status, created_by)
    VALUES (${projectId}, ${AUTO_INSPECTION_TITLE}, ${scheduledFor}::date, 'programada', ${actorUserId})
    RETURNING id
  `
  const id = Number(ins[0].id)
  await writeAudit(
    {
      project_id: projectId,
      actor_user_id: actorUserId,
      action: "inspection.created",
      entity_type: "inspection",
      entity_id: id,
      details: { auto: true, title: AUTO_INSPECTION_TITLE, scheduled_for: scheduledFor },
    },
    tx,
  )
  const created = await getInspectionById(s, projectId, id)
  if (!created) throw new Error("No se pudo leer la revisión recién creada")
  return created
}

// ---------------------------------------------------------------------------
// API pública (lib/obra/server)
// ---------------------------------------------------------------------------

/** Revisiones del proyecto: abiertas primero (por fecha ascendente), luego cerradas (más recientes primero). */
export async function listInspections(userId: number, projectId: number): Promise<ObraInspection[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "project.view")
  const rows = await sql<InspectionRow[]>`
    ${inspectionSelect(sql)}
    WHERE i.project_id = ${access.project_id}
    ORDER BY
      CASE WHEN i.status = 'cerrada' THEN 1 ELSE 0 END,
      CASE WHEN i.status = 'cerrada' THEN NULL ELSE i.scheduled_for END ASC,
      i.scheduled_for DESC,
      i.id DESC
    LIMIT 500
  `
  return rows.map(mapInspection)
}

export type InspectionInput = {
  title: string
  scheduled_for: string
  lead_user_id?: number | null
  notes?: string | null
}

export async function createInspection(userId: number, projectId: number, input: InspectionInput): Promise<ObraInspection> {
  const access = await requireProjectPermissionForUser(userId, projectId, "inspections.manage")
  const o = requireObject(input, "Datos de la revisión no válidos.")
  const title = requireLine(o.title, "El título", LIMITS.titleMin, LIMITS.titleMax)
  const scheduledFor = requireDateISO(o.scheduled_for, "La fecha de la revisión")
  const leadUserId = optionalRefId(o.lead_user_id, "El responsable")
  const notes = optionalText(o.notes, "Las notas", LIMITS.notes)

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    if (leadUserId != null) await assertProjectUser(s, access.project_id, leadUserId, "El responsable")
    const ins = await s<{ id: number }[]>`
      INSERT INTO obra_inspections (project_id, title, scheduled_for, status, lead_user_id, notes, created_by)
      VALUES (${access.project_id}, ${title}, ${scheduledFor}::date, 'programada', ${leadUserId}, ${notes}, ${userId})
      RETURNING id
    `
    const id = Number(ins[0].id)
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "inspection.created",
        entity_type: "inspection",
        entity_id: id,
        details: { title, scheduled_for: scheduledFor, lead_user_id: leadUserId },
      },
      tx,
    )
    const created = await getInspectionById(s, access.project_id, id)
    if (!created) throw new Error("No se pudo leer la revisión recién creada")
    return created
  })) as ObraInspection
}

export type InspectionPatch = {
  title?: string
  scheduled_for?: string
  lead_user_id?: number | null
  notes?: string | null
  status?: InspectionStatus
}

/**
 * Edita una revisión. El estado solo puede pasar a 'programada' o 'en_curso'
 * (para cerrar se usa closeInspection, que registra el resumen); reabrir una
 * revisión cerrada limpia closed_at y conserva el resumen.
 */
export async function updateInspection(userId: number, inspectionId: number, patch: InspectionPatch): Promise<ObraInspection> {
  const { access, inspectionId: id } = await authorizeInspection(userId, inspectionId, "inspections.manage")
  const o = requireObject(patch, "Datos de la revisión no válidos.")

  const title = hasKey(o, "title") ? requireLine(o.title, "El título", LIMITS.titleMin, LIMITS.titleMax) : undefined
  const scheduledFor = hasKey(o, "scheduled_for") ? requireDateISO(o.scheduled_for, "La fecha de la revisión") : undefined
  // hasKey es true también para null (null = quitar el valor).
  const leadUserId = hasKey(o, "lead_user_id") ? optionalRefId(o.lead_user_id, "El responsable") : undefined
  const notes = hasKey(o, "notes") ? optionalText(o.notes, "Las notas", LIMITS.notes) : undefined
  let status: InspectionStatus | undefined
  if (hasKey(o, "status")) {
    if (typeof o.status !== "string" || !(INSPECTION_STATUSES as readonly string[]).includes(o.status)) {
      throw new ObraValidationError("Estado de revisión no válido.")
    }
    if (o.status === "cerrada") {
      throw new ObraValidationError("Para cerrar una revisión usa «Cerrar revisión», que registra el resumen.")
    }
    status = o.status as InspectionStatus
  }

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const cur = await s<{ title: string; scheduled_for: string; status: string; lead_user_id: number | null; notes: string | null }[]>`
      SELECT title, to_char(scheduled_for, 'YYYY-MM-DD') AS scheduled_for, status, lead_user_id, notes
      FROM obra_inspections
      WHERE id = ${id} AND project_id = ${access.project_id}
      FOR UPDATE
    `
    const c = cur[0]
    if (!c) throw new ObraAccessError(404, NOT_FOUND)
    if (leadUserId != null && leadUserId !== c.lead_user_id) {
      await assertProjectUser(s, access.project_id, leadUserId, "El responsable")
    }
    const next = {
      title: title ?? c.title,
      scheduled_for: scheduledFor ?? c.scheduled_for,
      status: status ?? c.status,
      lead_user_id: leadUserId !== undefined ? leadUserId : c.lead_user_id,
      notes: notes !== undefined ? notes : c.notes,
    }
    const changes: string[] = []
    if (next.title !== c.title) changes.push("title")
    if (next.scheduled_for !== c.scheduled_for) changes.push("scheduled_for")
    if (next.status !== c.status) changes.push("status")
    if ((next.lead_user_id ?? null) !== (c.lead_user_id ?? null)) changes.push("lead_user_id")
    if ((next.notes ?? null) !== (c.notes ?? null)) changes.push("notes")
    if (changes.length > 0) {
      const reopening = c.status === "cerrada" && next.status !== "cerrada"
      await s`
        UPDATE obra_inspections
        SET title = ${next.title},
            scheduled_for = ${next.scheduled_for}::date,
            status = ${next.status},
            lead_user_id = ${next.lead_user_id},
            notes = ${next.notes},
            closed_at = ${reopening ? null : s`closed_at`},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
      `
      await writeAudit(
        {
          project_id: access.project_id,
          actor_user_id: userId,
          action: "inspection.updated",
          entity_type: "inspection",
          entity_id: id,
          details: { changes, from_status: c.status, to_status: next.status },
        },
        tx,
      )
    }
    const out = await getInspectionById(s, access.project_id, id)
    if (!out) throw new ObraAccessError(404, NOT_FOUND)
    return out
  })) as ObraInspection
}

/**
 * Cierra una revisión con su resumen. Si carry_over_open_tasks, las tareas
 * abiertas (pendiente / en_progreso) pasan a la próxima revisión programada
 * (se crea si no existe), excluyendo la que se cierra.
 */
export async function closeInspection(
  userId: number,
  inspectionId: number,
  input: { summary: string; carry_over_open_tasks: boolean },
): Promise<ObraInspection> {
  const { access, inspectionId: id } = await authorizeInspection(userId, inspectionId, "inspections.manage")
  const o = requireObject(input, "Datos del cierre no válidos.")
  const summary = optionalText(o.summary, "El resumen", LIMITS.summary)
  if (o.carry_over_open_tasks !== undefined && typeof o.carry_over_open_tasks !== "boolean") {
    throw new ObraValidationError("Indica si las tareas abiertas pasan a la próxima revisión.")
  }
  const carryOver = o.carry_over_open_tasks === true

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const cur = await s<{ status: string }[]>`
      SELECT status FROM obra_inspections
      WHERE id = ${id} AND project_id = ${access.project_id}
      FOR UPDATE
    `
    if (!cur[0]) throw new ObraAccessError(404, NOT_FOUND)
    if (cur[0].status === "cerrada") throw new ObraValidationError("La revisión ya está cerrada.")

    await s`
      UPDATE obra_inspections
      SET status = 'cerrada', summary = ${summary}, closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `
    let carried = 0
    let nextId: number | null = null
    if (carryOver) {
      const open = await s<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM obra_tasks
        WHERE inspection_id = ${id} AND status IN ('pendiente', 'en_progreso')
      `
      if (Number(open[0]?.n ?? 0) > 0) {
        const next = await getOrCreateNextInspection(tx, access.project_id, userId, { excludeId: id })
        nextId = next.id
        const moved = await s<{ id: number }[]>`
          UPDATE obra_tasks
          SET inspection_id = ${next.id}, updated_at = CURRENT_TIMESTAMP
          WHERE inspection_id = ${id} AND project_id = ${access.project_id}
            AND status IN ('pendiente', 'en_progreso')
          RETURNING id
        `
        carried = moved.length
      }
    }
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "inspection.closed",
        entity_type: "inspection",
        entity_id: id,
        details: { carry_over_open_tasks: carryOver, carried_over: carried, next_inspection_id: nextId },
      },
      tx,
    )
    const out = await getInspectionById(s, access.project_id, id)
    if (!out) throw new ObraAccessError(404, NOT_FOUND)
    return out
  })) as ObraInspection
}
