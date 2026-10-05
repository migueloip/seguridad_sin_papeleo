import { cn } from "@/lib/utils"
import {
  OBRA_ROLE_LABELS,
  PRIORITY_LABELS,
  SEVERITY_LABELS,
  SUGGESTION_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type ObraRole,
  type Priority,
  type Severity,
  type SuggestionGenerator,
  type SuggestionStatus,
  type TaskStatus,
} from "@/lib/obra/types"

const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"

const SEVERITY_CLS: Record<Severity, string> = {
  critical: "bg-sev-critical-tint text-sev-critical",
  high: "bg-sev-high-tint text-sev-high",
  medium: "bg-sev-medium-tint text-sev-medium",
  low: "bg-sev-low-tint text-sev-low",
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return <span className={cn(base, SEVERITY_CLS[severity] ?? SEVERITY_CLS.medium, className)}>{SEVERITY_LABELS[severity] ?? severity}</span>
}

const PRIORITY_CLS: Record<Priority, string> = {
  critica: SEVERITY_CLS.critical,
  alta: SEVERITY_CLS.high,
  media: SEVERITY_CLS.medium,
  baja: SEVERITY_CLS.low,
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span className={cn(base, PRIORITY_CLS[priority] ?? PRIORITY_CLS.media, className)}>
      Prioridad {PRIORITY_LABELS[priority]?.toLowerCase() ?? priority}
    </span>
  )
}

const TASK_STATUS_CLS: Record<TaskStatus, string> = {
  pendiente: "bg-secondary text-foreground",
  en_progreso: "bg-warning-tint text-warning",
  hecha: "bg-success-tint text-success",
  cancelada: "bg-muted text-muted-foreground line-through",
}

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return <span className={cn(base, TASK_STATUS_CLS[status], className)}>{TASK_STATUS_LABELS[status] ?? status}</span>
}

const SUGGESTION_STATUS_CLS: Record<SuggestionStatus, string> = {
  pending: "bg-warning-tint text-warning",
  approved: "bg-success-tint text-success",
  rejected: "bg-danger-tint text-danger",
  superseded: "bg-muted text-muted-foreground",
}

export function SuggestionStatusBadge({ status, className }: { status: SuggestionStatus; className?: string }) {
  return <span className={cn(base, SUGGESTION_STATUS_CLS[status], className)}>{SUGGESTION_STATUS_LABELS[status] ?? status}</span>
}

/** Indica si una sugerencia la redactó un modelo de IA o el motor de reglas. */
export function GeneratorBadge({ generator, className }: { generator: SuggestionGenerator; className?: string }) {
  return (
    <span className={cn(base, "border border-border bg-card text-muted-foreground", className)}>
      {generator === "ia" ? "Sugerido por IA" : "Sugerido por reglas"}
    </span>
  )
}

export function RoleBadge({ role, className }: { role: ObraRole; className?: string }) {
  return <span className={cn(base, "bg-brand/15 text-foreground", className)}>{OBRA_ROLE_LABELS[role] ?? role}</span>
}
