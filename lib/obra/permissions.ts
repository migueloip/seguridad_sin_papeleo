/**
 * Matriz de permisos por rol de obra. Puro (sin BD): se usa en servidor para
 * autorizar y en cliente para mostrar/ocultar acciones. La autorización real
 * SIEMPRE se hace en servidor (lib/obra/access.ts).
 */
import type { ObraRole, Severity } from "./types"

export const PERMISSIONS = [
  "project.view",
  "members.manage",
  "plans.view",
  "plans.manage",
  "findings.view",
  "findings.report",
  "tasks.view_all",
  "tasks.manage",
  "tasks.complete_own",
  "tasks.complete_any",
  "ai.request",
  "ai.review",
  "ai.review_critical",
  "inspections.manage",
  "audit.view",
] as const
export type Permission = (typeof PERMISSIONS)[number]

const ALL: readonly Permission[] = PERMISSIONS

const MATRIX: Record<ObraRole, readonly Permission[]> = {
  gerente: ALL,
  jefe_obra: ALL,
  prevencionista: ALL.filter((p) => p !== "members.manage"),
  supervisor: [
    "project.view",
    "plans.view",
    "findings.view",
    "findings.report",
    "tasks.view_all",
    "tasks.complete_own",
    "tasks.complete_any",
    "ai.request",
  ],
  trabajador: ["project.view", "plans.view", "findings.report", "tasks.complete_own"],
  visita: ["project.view", "plans.view", "findings.view", "tasks.view_all", "audit.view"],
}

export function can(role: ObraRole | null | undefined, permission: Permission): boolean {
  if (!role) return false
  return MATRIX[role]?.includes(permission) ?? false
}

export function permissionsFor(role: ObraRole): Permission[] {
  return [...MATRIX[role]]
}

/**
 * ¿Puede este rol aprobar/rechazar una sugerencia de IA de esta severidad?
 * Las críticas exigen además "ai.review_critical".
 */
export function canReviewSuggestion(role: ObraRole | null | undefined, severity: Severity): boolean {
  if (!can(role, "ai.review")) return false
  if (severity === "critical") return can(role, "ai.review_critical")
  return true
}

/**
 * ¿Puede `actorRole` asignar el rol `target` a otro miembro?
 * Solo un gerente puede nombrar a otro gerente; nadie gestiona miembros sin "members.manage".
 */
export function canAssignRole(actorRole: ObraRole | null | undefined, target: ObraRole): boolean {
  if (!can(actorRole, "members.manage")) return false
  if (target === "gerente") return actorRole === "gerente"
  return true
}

/** Jerarquía (mayor = más autoridad). Útil para ordenar y para reglas de UI. */
export const ROLE_RANK: Record<ObraRole, number> = {
  gerente: 50,
  jefe_obra: 40,
  prevencionista: 35,
  supervisor: 20,
  trabajador: 10,
  visita: 5,
}
