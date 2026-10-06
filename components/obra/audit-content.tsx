"use client"

/**
 * Auditoría de la obra: línea de tiempo de quién hizo qué y cuándo, con
 * paginación por cursor ("Cargar más" con before_id).
 *
 * Exporta describeAuditEntry y AuditItem para reutilizarlos en el resumen.
 */
import { useState, useTransition } from "react"
import { toast } from "sonner"
import type { LucideIcon } from "lucide-react"
import {
  CalendarCheck,
  ClipboardList,
  History,
  Layers,
  Loader2,
  MapPin,
  PenLine,
  ShieldCheck,
  UsersRound,
} from "lucide-react"
import { listObraAudit } from "@/app/actions/obra/audit"
import { Button } from "@/components/ui/button"
import {
  OBRA_ROLE_LABELS,
  OBRA_ROLES,
  SEVERITIES,
  SEVERITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type AuditEntry,
  type ObraRole,
  type Severity,
  type TaskStatus,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { callAction, chileDayKey, formatDateCL, TimeAgo } from "./task-card"

export const AUDIT_PAGE_SIZE = 50

/** Acciones conocidas → texto legible (en tercera persona, tras el nombre de quien la hizo). */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "task.created": "creó una tarea",
  "task.updated": "editó una tarea",
  "task.status_changed": "cambió el estado de una tarea",
  "task.checklist_toggled": "actualizó el checklist de una tarea",
  "inspection.created": "programó una revisión",
  "inspection.updated": "actualizó una revisión",
  "inspection.closed": "cerró una revisión",
  "member.added": "agregó a una persona al equipo",
  "member.role_changed": "cambió el rol de una persona",
  "member.removed": "quitó a una persona del equipo",
  "suggestion.created": "registró una sugerencia",
  "suggestion.approved": "aprobó una sugerencia de IA",
  "suggestion.rejected": "descartó una sugerencia de IA",
  "suggestion.superseded": "reemplazó sugerencias por un análisis más nuevo",
  "suggestions.generated": "generó sugerencias para un hallazgo",
  "layer.created": "subió una capa de plano",
  "layer.updated": "actualizó una capa de plano",
  "layer.deleted": "eliminó una capa de plano",
  "layer.extraction_requested": "pidió a la IA detectar elementos en un plano",
  "element.created": "agregó un elemento al plano",
  "elements.created": "agregó elementos al plano",
  "elements.imported": "importó elementos al plano",
  "element.updated": "editó un elemento del plano",
  "element.deleted": "eliminó un elemento del plano",
  "finding.reported": "reportó un hallazgo en el plano",
  "finding.pinned": "ubicó un hallazgo en el plano",
  "finding.analyzed": "analizó un hallazgo",
  "finding.analysis_requested": "pidió analizar un hallazgo",
  "finding.severity_changed": "cambió la severidad de un hallazgo",
  "finding.updated": "actualizó un hallazgo",
}

const STATUS_VERBS: Partial<Record<TaskStatus, string>> = {
  en_progreso: "empezó una tarea",
  hecha: "marcó una tarea como hecha",
  cancelada: "canceló una tarea",
}

const ENTITY_ICONS: Record<string, LucideIcon> = {
  task: ClipboardList,
  inspection: CalendarCheck,
  member: UsersRound,
  suggestion: ShieldCheck,
  layer: Layers,
  element: PenLine,
  finding: MapPin,
  pin: MapPin,
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function roleLabel(v: unknown): string | null {
  return typeof v === "string" && (OBRA_ROLES as readonly string[]).includes(v) ? OBRA_ROLE_LABELS[v as ObraRole] : null
}

function taskStatusLabel(v: unknown): string | null {
  return typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v) ? TASK_STATUS_LABELS[v as TaskStatus] : null
}

function severityLabel(v: unknown): string | null {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v) ? SEVERITY_LABELS[v as Severity] : null
}

/** Texto legible de una entrada de auditoría: acción y un detalle opcional. */
export function describeAuditEntry(e: AuditEntry): { text: string; detail: string | null } {
  const d = e.details ?? {}
  let text = AUDIT_ACTION_LABELS[e.action] ?? e.action
  const parts: string[] = []
  const title = str(d.title)

  switch (e.action) {
    case "task.created":
      if (d.origin === "ia") text = "anotó una tarea sugerida por IA"
      else if (d.origin === "hallazgo") text = "creó una tarea desde un hallazgo"
      if (title) parts.push(`«${title}»`)
      break
    case "task.status_changed": {
      const to = typeof d.to === "string" ? (d.to as TaskStatus) : null
      if (to && STATUS_VERBS[to]) text = STATUS_VERBS[to] as string
      else if (to === "pendiente") text = d.from === "en_progreso" ? "devolvió una tarea a pendiente" : "reabrió una tarea"
      const from = taskStatusLabel(d.from)
      const toLabel = taskStatusLabel(d.to)
      if (from && toLabel) parts.push(`${from} → ${toLabel}`)
      const notes = str(d.notes)
      if (notes) parts.push(`Notas: ${notes}`)
      break
    }
    case "task.checklist_toggled": {
      text = d.done === true ? "marcó un ítem del checklist" : d.done === false ? "desmarcó un ítem del checklist" : text
      const item = str(d.text)
      if (item) parts.push(`«${item}»`)
      break
    }
    case "task.updated":
      if (Array.isArray(d.changes) && d.changes.includes("completion_notes") && d.changes.length === 1) {
        text = "actualizó las notas de cierre de una tarea"
      }
      break
    case "inspection.created": {
      if (d.auto === true) text = "programó automáticamente una revisión"
      if (title) parts.push(`«${title}»`)
      const date = str(d.scheduled_for)
      if (date) parts.push(`para el ${formatDateCL(date)}`)
      break
    }
    case "inspection.updated":
      if (d.to_status === "en_curso" && d.from_status !== "en_curso") text = "inició una revisión"
      else if (d.from_status === "cerrada" && d.to_status !== "cerrada") text = "reabrió una revisión"
      break
    case "inspection.closed": {
      const carried = num(d.carried_over)
      if (carried && carried > 0) {
        parts.push(`${carried} tarea${carried === 1 ? "" : "s"} abierta${carried === 1 ? "" : "s"} pasaron a la próxima revisión`)
      }
      break
    }
    case "member.added": {
      const email = str(d.email)
      const role = roleLabel(d.role)
      if (email) parts.push(email)
      if (role) parts.push(`como ${role}`)
      if (d.new_user === true) parts.push("cuenta nueva")
      break
    }
    case "member.role_changed": {
      const email = str(d.email)
      const from = roleLabel(d.from)
      const to = roleLabel(d.to)
      if (email) parts.push(email)
      if (from && to) parts.push(`${from} → ${to}`)
      break
    }
    case "member.removed": {
      const email = str(d.email)
      if (email) parts.push(email)
      break
    }
    case "suggestion.rejected": {
      if (title) parts.push(`«${title}»`)
      const reason = str(d.reason) ?? str(d.notes)
      if (reason) parts.push(`Motivo: ${reason}`)
      break
    }
    case "finding.severity_changed": {
      const from = severityLabel(d.from)
      const to = severityLabel(d.to)
      if (title) parts.push(`«${title}»`)
      if (from && to) parts.push(`${from} → ${to}`)
      break
    }
    default: {
      if (title) parts.push(`«${title}»`)
      else {
        const name = str(d.name)
        if (name) parts.push(`«${name}»`)
      }
      if (e.action === "suggestion.approved" && d.edited === true) parts.push("con cambios")
      const count = num(d.count) ?? num(d.inserted)
      if (count != null && /element/.test(e.action)) parts.push(`${count} elemento${count === 1 ? "" : "s"}`)
    }
  }
  return { text, detail: parts.length > 0 ? parts.join(" · ") : null }
}

export function auditActorName(e: AuditEntry): string {
  if (e.actor_user_id == null) return "El sistema"
  return e.actor_name || "Una persona del equipo"
}

/** Una línea de la bitácora (icono, quién, qué, detalle y cuándo). */
export function AuditItem({ entry, className }: { entry: AuditEntry; className?: string }) {
  const Icon = ENTITY_ICONS[entry.entity_type] ?? History
  const { text, detail } = describeAuditEntry(entry)
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-secondary">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-[13.5px]">
          <span className="font-semibold">{auditActorName(entry)}</span> {text}
        </p>
        {detail ? <p className="break-words text-[12.5px] text-muted-foreground">{detail}</p> : null}
        <TimeAgo iso={entry.created_at} className="text-xs text-muted-foreground" />
      </div>
    </div>
  )
}

export function AuditContent({
  projectId,
  initialEntries,
  pageSize = AUDIT_PAGE_SIZE,
}: {
  projectId: number
  initialEntries: AuditEntry[]
  pageSize?: number
}) {
  const [entries, setEntries] = useState(initialEntries)
  const [hasMore, setHasMore] = useState(initialEntries.length >= pageSize)
  const [isPending, startTransition] = useTransition()

  function loadMore() {
    const last = entries[entries.length - 1]
    if (!last) return
    startTransition(async () => {
      const res = await callAction(() => listObraAudit(projectId, { limit: pageSize, before_id: last.id }))
      if (res.ok === false) {
        toast.error(res.error)
        return
      }
      setEntries((prev) => {
        const seen = new Set(prev.map((x) => x.id))
        return [...prev, ...res.data.filter((x) => !seen.has(x.id))]
      })
      setHasMore(res.data.length >= pageSize)
    })
  }

  // Agrupa por día (hora de Chile, igual en servidor y navegador).
  const groups: { day: string; items: AuditEntry[] }[] = []
  for (const e of entries) {
    const day = chileDayKey(e.created_at)
    const g = groups[groups.length - 1]
    if (g && g.day === day) g.items.push(e)
    else groups.push({ day, items: [e] })
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight">Auditoría</h2>
        <p className="text-sm text-muted-foreground">
          Quién hizo qué y cuándo: tareas, revisiones, equipo, planos y cada sugerencia de IA aprobada o descartada.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center rounded-[14px] border border-dashed border-border bg-card px-5 py-12 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-[14px] bg-secondary">
            <History className="h-6 w-6 text-muted-foreground" aria-hidden />
          </span>
          <p className="font-display text-lg font-semibold">Todavía no hay actividad registrada</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Aquí verás cuando alguien cree o cierre tareas, programe revisiones, cambie el equipo o apruebe sugerencias de
            IA.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.day} aria-label={`Actividad del ${formatDateCL(g.day)}`}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {formatDateCL(g.day)}
              </h3>
              <ol className="relative space-y-4 rounded-[14px] border border-border bg-card p-4">
                {g.items.map((e) => (
                  <li key={e.id}>
                    <AuditItem entry={e} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {hasMore && entries.length > 0 ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" className="h-10 min-w-[180px]" disabled={isPending} onClick={loadMore}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {isPending ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      ) : entries.length > 0 ? (
        <p className="text-center text-xs text-muted-foreground">No hay actividad más antigua.</p>
      ) : null}
    </div>
  )
}
