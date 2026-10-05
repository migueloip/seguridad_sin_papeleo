/**
 * Métricas puras del módulo Obra (sin BD): índice de riesgo y utilidades de
 * fecha en formato "YYYY-MM-DD" (sin zona horaria, para columnas DATE).
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

/** Fecha local de hoy como "YYYY-MM-DD". */
export function todayISO(now: Date = new Date()): string {
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

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
  critico: "Crítico",
}
