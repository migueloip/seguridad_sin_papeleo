/**
 * Métricas puras del módulo Obra (sin BD): índice de riesgo, utilidades de
 * fecha en formato "YYYY-MM-DD" (días de la hora de Chile, para columnas DATE)
 * y el criterio de "próxima revisión".
 */
import type { RiskLevel, Severity } from "./types"

export type RiskInput = {
  open_findings_by_severity: Partial<Record<Severity, number>>
  overdue_tasks: number
  pending_critical_suggestions: number
}

const SEVERITY_WEIGHT: Record<Severity, number> = { low: 1, medium: 3, high: 8, critical: 20 }

/**
 * Índice de riesgo 0..100. Satura de forma suave (1 - e^-k) para que una obra
 * con muchos hallazgos leves no supere a una con pocos críticos.
 */
export function projectRiskIndex(input: RiskInput): { score: number; level: RiskLevel } {
  let raw = 0
  for (const sev of Object.keys(SEVERITY_WEIGHT) as Severity[]) {
    const n = Math.max(0, Number(input.open_findings_by_severity[sev] ?? 0) || 0)
    raw += n * SEVERITY_WEIGHT[sev]
  }
  raw += Math.max(0, input.overdue_tasks || 0) * 4
  raw += Math.max(0, input.pending_critical_suggestions || 0) * 10
  const score = Math.round(100 * (1 - Math.exp(-raw / 60)))
  const hasCritical = (input.open_findings_by_severity.critical ?? 0) > 0
  let level: RiskLevel = score >= 75 ? "critico" : score >= 45 ? "alto" : score >= 20 ? "medio" : "bajo"
  if (hasCritical && (level === "bajo" || level === "medio")) level = "alto"
  return { score, level }
}

/** Zona horaria de la obra: "hoy", vencimientos y revisiones se cuentan en la hora de Chile. */
export const OBRA_TIME_ZONE = "America/Santiago"

let dayFormatter: Intl.DateTimeFormat | null = null

/**
 * Día de hoy en la hora de Chile como "YYYY-MM-DD", sea cual sea la zona del
 * proceso (Netlify corre en UTC: entre las 20:00/21:00 y la medianoche de
 * Chile el servidor ya estaría en el día siguiente). Servidor y navegador
 * calculan el mismo día.
 */
export function todayISO(now: Date = new Date()): string {
  try {
    dayFormatter ??= new Intl.DateTimeFormat("en-CA", {
      timeZone: OBRA_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    const parts: Record<string, string> = {}
    for (const p of dayFormatter.formatToParts(now)) parts[p.type] = p.value
    if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`
  } catch {
    // Entorno sin datos de zonas horarias: se usa la hora local del proceso.
  }
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Suma días a una fecha "YYYY-MM-DD" (aritmética en UTC, sin saltos por horario de verano). */
export function addDaysISO(dateISO: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO)
  if (!m) throw new Error(`Fecha inválida: ${dateISO}`)
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + Math.round(days) * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** ¿La fecha (YYYY-MM-DD) ya pasó respecto de hoy? */
export function isOverdue(dueISO: string | null | undefined, today: string = todayISO()): boolean {
  return Boolean(dueISO) && String(dueISO).slice(0, 10) < today
}

/** Datos mínimos de una revisión para elegir la próxima. */
export type InspectionLike = { id: number; status: string; scheduled_for: string }

/**
 * Orden de "próxima revisión" (0 = primero): la que está en curso; luego las
 * programadas desde hoy; luego las programadas atrasadas. Las cerradas no
 * cuentan (null). Dentro de cada grupo, por fecha y luego por id.
 */
export function nextInspectionRank(i: InspectionLike, today: string): number | null {
  if (i.status === "cerrada") return null
  if (i.status === "en_curso") return 0
  return String(i.scheduled_for).slice(0, 10) >= today ? 1 : 2
}

/**
 * Próxima revisión abierta. Es el ÚNICO criterio del módulo: lo usan el
 * resumen, el hub, la página Revisiones y el servidor al anotar una tarea
 * aprobada ("Anotar en tareas de la próxima revisión"), para que la tarea
 * quede en la revisión que la pantalla muestra como próxima.
 */
export function pickNextInspection<T extends InspectionLike>(list: readonly T[], today: string): T | null {
  let best: { item: T; rank: number; date: string } | null = null
  for (const item of list) {
    const rank = nextInspectionRank(item, today)
    if (rank == null) continue
    const date = String(item.scheduled_for).slice(0, 10)
    const better =
      !best ||
      rank < best.rank ||
      (rank === best.rank && (date < best.date || (date === best.date && item.id < best.item.id)))
    if (better) best = { item, rank, date }
  }
  return best?.item ?? null
}

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
  critico: "Crítico",
}
