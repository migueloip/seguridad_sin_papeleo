/**
 * Tablero por rol y listado de obras del usuario (hub /obra). Solo servidor;
 * sin "use server": cada función recibe el actorUserId explícito.
 *
 * Conteos de tareas: respetan la visibilidad del rol (sin tasks.view_all solo
 * cuentan las propias). Hallazgos, sugerencias y planos son agregados del
 * proyecto. El índice de riesgo siempre se calcula con datos de todo el
 * proyecto, para que sea el mismo para todos los roles.
 */
import { sql } from "@/lib/db"
import { listProjectAccessForUser, requireProjectPermissionForUser } from "../access"
import { projectRiskIndex, todayISO } from "../metrics"
import { can, permissionsFor } from "../permissions"
import {
  SEVERITIES,
  TASK_STATUSES,
  type AiSuggestion,
  type AuditEntry,
  type ObraDashboard,
  type ObraInspection,
  type ObraProjectSummary,
  type ProjectAccess,
  type Severity,
  type TaskStatus,
} from "../types"
import { isOwnTask, mineCondition } from "./tasks"
import {
  auditSelect,
  inspectionSelect,
  mapAudit,
  mapInspection,
  mapSuggestion,
  mapTask,
  suggestionSelect,
  taskOrderBy,
  taskSelect,
  toDateOnly,
  toNum,
  type AuditRow,
  type InspectionRow,
  type SuggestionRow,
  type TaskRow,
} from "./mappers"

function normalizeSeverity(v: unknown): Severity {
  const s = typeof v === "string" ? v.trim().toLowerCase() : ""
  return (SEVERITIES as readonly string[]).includes(s) ? (s as Severity) : "medium"
}

/**
 * Próxima revisión del proyecto: la que está en curso; si no, la programada
 * más próxima desde hoy; si no, la programada atrasada más antigua.
 */
async function getNextInspection(projectId: number, today: string): Promise<ObraInspection | null> {
  const rows = await sql<InspectionRow[]>`
    ${inspectionSelect(sql)}
    WHERE i.project_id = ${projectId} AND i.status <> 'cerrada'
    ORDER BY
      CASE WHEN i.status = 'en_curso' THEN 0 WHEN i.scheduled_for >= ${today}::date THEN 1 ELSE 2 END,
      i.scheduled_for ASC,
      i.id ASC
    LIMIT 1
  `
  return rows[0] ? mapInspection(rows[0]) : null
}

/** Tablero completo de una obra según el rol del usuario (project.view). */
export async function getDashboard(userId: number, projectId: number): Promise<ObraDashboard> {
  const access = await requireProjectPermissionForUser(userId, projectId, "project.view")
  const pid = access.project_id
  const today = todayISO()
  const scoped = !can(access.role, "tasks.view_all")
  const scope = () => (scoped ? sql`AND ${mineCondition(sql, access)}` : sql``)
  const canReview = can(access.role, "ai.review")
  const canAudit = can(access.role, "audit.view")

  const [countRows, statusRows, severityRows, nextInspection, myTaskRows, suggestionRows, auditRows] = await Promise.all([
    sql<
      {
        open_tasks: number
        overdue_tasks: number
        overdue_all: number
        my_open_tasks: number
        pending_suggestions: number
        pending_critical_suggestions: number
        pinned_findings: number
        layers: number
        elements: number
        members: number
      }[]
    >`
      SELECT
        (SELECT COUNT(*) FROM obra_tasks t
          WHERE t.project_id = ${pid} AND t.status IN ('pendiente', 'en_progreso') ${scope()})::int AS open_tasks,
        (SELECT COUNT(*) FROM obra_tasks t
          WHERE t.project_id = ${pid} AND t.status IN ('pendiente', 'en_progreso')
            AND t.due_date < ${today}::date ${scope()})::int AS overdue_tasks,
        (SELECT COUNT(*) FROM obra_tasks t
          WHERE t.project_id = ${pid} AND t.status IN ('pendiente', 'en_progreso')
            AND t.due_date < ${today}::date)::int AS overdue_all,
        (SELECT COUNT(*) FROM obra_tasks t
          WHERE t.project_id = ${pid} AND t.status IN ('pendiente', 'en_progreso')
            AND ${mineCondition(sql, access)})::int AS my_open_tasks,
        (SELECT COUNT(*) FROM obra_ai_suggestions s
          WHERE s.project_id = ${pid} AND s.status = 'pending')::int AS pending_suggestions,
        (SELECT COUNT(*) FROM obra_ai_suggestions s
          WHERE s.project_id = ${pid} AND s.status = 'pending' AND s.severity = 'critical')::int AS pending_critical_suggestions,
        (SELECT COUNT(*) FROM obra_finding_pins p WHERE p.project_id = ${pid})::int AS pinned_findings,
        (SELECT COUNT(*) FROM obra_plan_layers l WHERE l.project_id = ${pid} AND l.deleted_at IS NULL)::int AS layers,
        (SELECT COUNT(*) FROM obra_plan_elements e
          JOIN obra_plan_layers l ON l.id = e.layer_id AND l.deleted_at IS NULL
          WHERE e.project_id = ${pid})::int AS elements,
        ((SELECT COUNT(*) FROM obra_members m WHERE m.project_id = ${pid}) + 1)::int AS members
    `,
    sql<{ status: string; n: number }[]>`
      SELECT t.status, COUNT(*)::int AS n
      FROM obra_tasks t
      WHERE t.project_id = ${pid} ${scope()}
      GROUP BY t.status
    `,
    sql<{ severity: string | null; n: number }[]>`
      SELECT f.severity, COUNT(*)::int AS n
      FROM findings f
      WHERE f.project_id = ${pid} AND f.status IN ('open', 'in_progress')
      GROUP BY f.severity
    `,
    getNextInspection(pid, today),
    sql<TaskRow[]>`
      ${taskSelect(sql)}
      WHERE t.project_id = ${pid} AND t.status IN ('pendiente', 'en_progreso') AND ${mineCondition(sql, access)}
      ${taskOrderBy(sql)}
      LIMIT 8
    `,
    canReview
      ? sql<SuggestionRow[]>`
          ${suggestionSelect(sql)}
          WHERE s.project_id = ${pid} AND s.status = 'pending'
          ORDER BY
            CASE s.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            s.created_at DESC,
            s.id DESC
          LIMIT 5
        `
      : Promise.resolve([] as SuggestionRow[]),
    canAudit
      ? sql<AuditRow[]>`
          ${auditSelect(sql)}
          WHERE a.project_id = ${pid}
          ORDER BY a.id DESC
          LIMIT 10
        `
      : Promise.resolve([] as AuditRow[]),
  ])

  const c = countRows[0]
  const findingsBySeverity: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 }
  let openFindings = 0
  for (const r of severityRows) {
    const n = toNum(r.n)
    findingsBySeverity[normalizeSeverity(r.severity)] += n
    openFindings += n
  }
  const tasksByStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>
  for (const r of statusRows) {
    if ((TASK_STATUSES as readonly string[]).includes(r.status)) tasksByStatus[r.status as TaskStatus] += toNum(r.n)
  }
  const pendingCritical = toNum(c?.pending_critical_suggestions)

  const pendingSuggestions: AiSuggestion[] = suggestionRows.map(mapSuggestion)
  const recentActivity: AuditEntry[] = auditRows.map(mapAudit)

  return {
    access: { ...access, permissions: permissionsFor(access.role) },
    counts: {
      open_tasks: toNum(c?.open_tasks),
      overdue_tasks: toNum(c?.overdue_tasks),
      my_open_tasks: toNum(c?.my_open_tasks),
      pending_suggestions: toNum(c?.pending_suggestions),
      pending_critical_suggestions: pendingCritical,
      open_findings: openFindings,
      pinned_findings: toNum(c?.pinned_findings),
      layers: toNum(c?.layers),
      elements: toNum(c?.elements),
      members: toNum(c?.members),
    },
    findings_by_severity: findingsBySeverity,
    tasks_by_status: tasksByStatus,
    next_inspection: nextInspection,
    my_tasks: myTaskRows.map(mapTask),
    pending_suggestions: pendingSuggestions,
    recent_activity: recentActivity,
    risk: projectRiskIndex({
      open_findings_by_severity: findingsBySeverity,
      overdue_tasks: toNum(c?.overdue_all),
      pending_critical_suggestions: pendingCritical,
    }),
  }
}

/**
 * Obras donde el usuario es dueño o integrante, con agregados para el hub.
 * Usa un número fijo de consultas agrupadas (no N+1).
 */
export async function listMyProjects(userId: number): Promise<ObraProjectSummary[]> {
  const accesses = await listProjectAccessForUser(userId)
  if (accesses.length === 0) return []
  const ids = accesses.map((a) => a.project_id)
  const today = todayISO()

  const [taskRows, suggestionRows, findingRows, inspectionRows] = await Promise.all([
    sql<
      {
        project_id: number
        assigned_role: string | null
        assigned_user_id: number | null
        open_count: number
        overdue_count: number
      }[]
    >`
      SELECT t.project_id, t.assigned_role,
             CASE WHEN t.assigned_user_id = ${userId} THEN t.assigned_user_id
                  WHEN t.assigned_user_id IS NULL THEN NULL
                  ELSE 0 END AS assigned_user_id,
             COUNT(*)::int AS open_count,
             COUNT(*) FILTER (WHERE t.due_date < ${today}::date)::int AS overdue_count
      FROM obra_tasks t
      WHERE t.project_id IN ${sql(ids)} AND t.status IN ('pendiente', 'en_progreso')
      GROUP BY 1, 2, 3
    `,
    sql<{ project_id: number; n: number }[]>`
      SELECT s.project_id, COUNT(*)::int AS n
      FROM obra_ai_suggestions s
      WHERE s.project_id IN ${sql(ids)} AND s.status = 'pending'
      GROUP BY s.project_id
    `,
    sql<{ project_id: number; open_n: number; critical_n: number }[]>`
      SELECT f.project_id,
             COUNT(*)::int AS open_n,
             COUNT(*) FILTER (WHERE lower(f.severity) = 'critical')::int AS critical_n
      FROM findings f
      WHERE f.project_id IN ${sql(ids)} AND f.status IN ('open', 'in_progress')
      GROUP BY f.project_id
    `,
    sql<{ project_id: number; scheduled_for: string | null }[]>`
      SELECT DISTINCT ON (i.project_id) i.project_id, to_char(i.scheduled_for, 'YYYY-MM-DD') AS scheduled_for
      FROM obra_inspections i
      WHERE i.project_id IN ${sql(ids)} AND i.status <> 'cerrada'
      ORDER BY
        i.project_id,
        CASE WHEN i.status = 'en_curso' THEN 0 WHEN i.scheduled_for >= ${today}::date THEN 1 ELSE 2 END,
        i.scheduled_for ASC,
        i.id ASC
    `,
  ])

  const byProject = new Map<number, ObraProjectSummary>()
  for (const a of accesses) {
    byProject.set(a.project_id, {
      ...a,
      open_tasks: 0,
      my_open_tasks: 0,
      overdue_tasks: 0,
      pending_suggestions: 0,
      open_findings: 0,
      critical_findings: 0,
      next_inspection_date: null,
    })
  }
  const accessById = new Map<number, ProjectAccess>(accesses.map((a) => [a.project_id, a]))

  for (const r of taskRows) {
    const pid = Number(r.project_id)
    const a = accessById.get(pid)
    const sum = byProject.get(pid)
    if (!a || !sum) continue
    const mine = isOwnTask({ assigned_user_id: r.assigned_user_id == null ? null : Number(r.assigned_user_id), assigned_role: r.assigned_role }, a)
    const visible = mine || can(a.role, "tasks.view_all")
    if (mine) sum.my_open_tasks += toNum(r.open_count)
    if (visible) {
      sum.open_tasks += toNum(r.open_count)
      sum.overdue_tasks += toNum(r.overdue_count)
    }
  }
  for (const r of suggestionRows) {
    const sum = byProject.get(Number(r.project_id))
    if (sum) sum.pending_suggestions = toNum(r.n)
  }
  for (const r of findingRows) {
    const sum = byProject.get(Number(r.project_id))
    if (!sum) continue
    sum.open_findings = toNum(r.open_n)
    sum.critical_findings = toNum(r.critical_n)
  }
  for (const r of inspectionRows) {
    const sum = byProject.get(Number(r.project_id))
    if (sum) sum.next_inspection_date = toDateOnly(r.scheduled_for)
  }
  return accesses.map((a) => byProject.get(a.project_id) as ObraProjectSummary)
}
