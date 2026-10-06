"use client"

/**
 * Tarjeta de tarea de obra (tablero, resumen, revisiones y panel del plano).
 *
 * Muestra título, prioridad, estado, origen (IA / hallazgo), persona o rol
 * asignado, vencimiento, checklist con progreso y enlace al plano. Ofrece las
 * acciones de estado que el rol puede hacer (espejo de setTaskStatus en el
 * servidor; la autorización real siempre está en el servidor).
 *
 * También exporta utilidades de formato y permisos que reutilizan las demás
 * pantallas de Obra (fechas dd-mm-aaaa, vencimientos, "mis tareas").
 */
import Link from "next/link"
import { useId, useState, useTransition } from "react"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  PlayCircle,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  UserRound,
  XCircle,
} from "lucide-react"
import { setObraTaskStatus, toggleObraTaskChecklist } from "@/app/actions/obra/tasks"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { isOverdue, todayISO } from "@/lib/obra/metrics"
import { can } from "@/lib/obra/permissions"
import {
  OBRA_ROLE_LABELS,
  TASK_STATUSES,
  type ActionResult,
  type ObraRole,
  type ObraTask,
  type TaskStatus,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { PriorityBadge, TaskStatusBadge } from "./badges"

// ---------------------------------------------------------------------------
// Llamadas a acciones de servidor
// ---------------------------------------------------------------------------

export const NETWORK_ERROR = "No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo."

/**
 * Ejecuta una acción de servidor y convierte una falla de red (la promesa
 * rechazada) en { ok: false }, para que la pantalla muestre un aviso en vez
 * de romperse.
 */
export async function callAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn()
  } catch {
    return { ok: false, error: NETWORK_ERROR }
  }
}

// ---------------------------------------------------------------------------
// Fechas (formato chileno)
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" (o un ISO que empiece así) → "dd-mm-aaaa". */
export function formatDateCL(value: string | null | undefined): string {
  if (!value) return ""
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return value
}

/**
 * Zona horaria fija para mostrar timestamps: así el servidor y el navegador
 * producen el mismo texto (sin desajustes de hidratación) y la hora es la de
 * la obra.
 */
export const OBRA_TIME_ZONE = "America/Santiago"

let chileFormatter: Intl.DateTimeFormat | null = null

function chileParts(d: Date): Record<string, string> {
  chileFormatter ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: OBRA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const out: Record<string, string> = {}
  for (const p of chileFormatter.formatToParts(d)) out[p.type] = p.value
  return out
}

/** Día "YYYY-MM-DD" de un timestamp en la hora de Chile. */
export function chileDayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const p = chileParts(d)
  return `${p.year}-${p.month}-${p.day}`
}

/** Timestamp ISO → "dd-mm-aaaa hh:mm" en la hora de Chile. */
export function formatDateTimeCL(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = chileParts(d)
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`
}

/** Timestamp ISO → "hace 5 minutos". */
export function formatRelativeCL(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return formatDistanceToNow(d, { addSuffix: true, locale: es })
}

/** Fecha relativa con la fecha exacta como tooltip (sin advertencias de hidratación). */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} title={formatDateTimeCL(iso)} className={className} suppressHydrationWarning>
      {formatRelativeCL(iso)}
    </time>
  )
}

function dayNumber(dateISO: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateISO)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000
}

/** Días desde `fromISO` hasta `toISO` (ambos "YYYY-MM-DD"). */
export function daysBetweenISO(fromISO: string, toISO: string): number | null {
  const a = dayNumber(fromISO)
  const b = dayNumber(toISO)
  if (a == null || b == null) return null
  return Math.round(b - a)
}

// ---------------------------------------------------------------------------
// Tareas: estado, vencimiento y permisos (espejo del servidor)
// ---------------------------------------------------------------------------

export function isTaskOpen(task: Pick<ObraTask, "status">): boolean {
  return task.status === "pendiente" || task.status === "en_progreso"
}

export function isTaskOverdue(task: Pick<ObraTask, "status" | "due_date">, today: string = todayISO()): boolean {
  return isTaskOpen(task) && isOverdue(task.due_date, today)
}

/** Texto del vencimiento: "Vence hoy", "Venció hace 3 días", "Vence el 12-10-2026"... */
export function dueText(task: Pick<ObraTask, "status" | "due_date">, today: string = todayISO()): string | null {
  if (!task.due_date) return null
  const date = formatDateCL(task.due_date)
  if (!isTaskOpen(task)) return `Vencimiento: ${date}`
  const diff = daysBetweenISO(today, task.due_date)
  if (diff == null) return `Vence el ${date}`
  if (diff < 0) return diff === -1 ? `Venció ayer (${date})` : `Venció hace ${-diff} días (${date})`
  if (diff === 0) return "Vence hoy"
  if (diff === 1) return "Vence mañana"
  return `Vence el ${date}`
}

/** ¿Es "mi tarea"? Asignada a mí, o sin persona y con mi rol. */
export function isOwnTaskFor(
  task: Pick<ObraTask, "assigned_user_id" | "assigned_role">,
  userId: number,
  role: ObraRole,
): boolean {
  if (task.assigned_user_id != null) return Number(task.assigned_user_id) === userId
  return task.assigned_role === role
}

/** ¿Puede cambiar el estado o el checklist de la tarea? */
export function canWorkOnTaskFor(
  task: Pick<ObraTask, "assigned_user_id" | "assigned_role">,
  userId: number,
  role: ObraRole,
): boolean {
  if (can(role, "tasks.manage") || can(role, "tasks.complete_any")) return true
  return can(role, "tasks.complete_own") && isOwnTaskFor(task, userId, role)
}

/**
 * Estados a los que el rol puede mover la tarea. Cancelar o reabrir una
 * cancelada exige "tasks.manage" (igual que en el servidor).
 */
export function allowedStatusTargets(task: ObraTask, userId: number, role: ObraRole): TaskStatus[] {
  if (!canWorkOnTaskFor(task, userId, role)) return []
  const manage = can(role, "tasks.manage")
  return TASK_STATUSES.filter((st) => {
    if (st === task.status) return false
    if ((st === "cancelada" || task.status === "cancelada") && !manage) return false
    return true
  })
}

/** Persona o rol responsable, en texto. */
export function assigneeLabel(task: Pick<ObraTask, "assigned_user_id" | "assigned_user_name" | "assigned_role">): string {
  if (task.assigned_user_id != null) {
    const name = task.assigned_user_name || "Integrante del equipo"
    return task.assigned_role ? `${name} · ${OBRA_ROLE_LABELS[task.assigned_role]}` : name
  }
  if (task.assigned_role) return `Rol: ${OBRA_ROLE_LABELS[task.assigned_role]}`
  return "Sin responsable asignado"
}

/** Enlace al plano: el hallazgo de origen o, si tiene ubicación propia, la tarea. */
export function taskPlanHref(task: Pick<ObraTask, "id" | "project_id" | "finding_id" | "layer_id" | "x" | "y">): string | null {
  if (task.finding_id != null) return `/obra/${task.project_id}/planos?finding=${task.finding_id}`
  if (task.layer_id != null && task.x != null && task.y != null) return `/obra/${task.project_id}/planos?task=${task.id}`
  return null
}

const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"

/** Chip de origen de la tarea (IA aprobada por una persona, o nacida de un hallazgo). */
export function TaskOriginChip({ task, className }: { task: Pick<ObraTask, "origin" | "created_by_name">; className?: string }) {
  if (task.origin === "ia") {
    return (
      <span className={cn(chip, "border border-border bg-card text-muted-foreground", className)}>
        <Sparkles className="h-3 w-3 text-brand" aria-hidden />
        Sugerida por IA · aprobada por {task.created_by_name || "un revisor"}
      </span>
    )
  }
  if (task.origin === "hallazgo") {
    return (
      <span className={cn(chip, "border border-border bg-card text-muted-foreground", className)}>
        <MapPin className="h-3 w-3" aria-hidden />
        Nace de un hallazgo
      </span>
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// Tarjeta
// ---------------------------------------------------------------------------

export type TaskCardProps = {
  task: ObraTask
  role: ObraRole
  currentUserId: number
  /** Versión resumida: descripción recortada y checklist plegado. */
  compact?: boolean
  /** Fecha de hoy "YYYY-MM-DD" (idealmente la del servidor, para no desalinear la hidratación). */
  today?: string
  /** Título de la revisión a la que pertenece, si se quiere mostrar. */
  inspectionTitle?: string | null
  /** Se llama con la tarea actualizada tras cada cambio exitoso. */
  onChanged?: (task: ObraTask) => void
  /** Si se entrega y el rol gestiona tareas, aparece "Editar". */
  onEdit?: (task: ObraTask) => void
  /** Oculta el enlace "Ver en plano" (p.ej. cuando ya se está en el plano). */
  hidePlanLink?: boolean
  className?: string
}

export function TaskCard({
  task,
  role,
  currentUserId,
  compact = false,
  today: todayProp,
  inspectionTitle,
  onChanged,
  onEdit,
  hidePlanLink = false,
  className,
}: TaskCardProps) {
  const today = todayProp ?? todayISO()
  const baseId = useId()
  const [prevTask, setPrevTask] = useState(task)
  const [current, setCurrent] = useState(task)
  if (task !== prevTask) {
    setPrevTask(task)
    setCurrent(task)
  }

  const [showChecklist, setShowChecklist] = useState(!compact)
  const [doneOpen, setDoneOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const t = current
  const canWork = canWorkOnTaskFor(t, currentUserId, role)
  const targets = allowedStatusTargets(t, currentUserId, role)
  const canManage = can(role, "tasks.manage")
  const overdue = isTaskOverdue(t, today)
  const due = dueText(t, today)
  const planHref = hidePlanLink ? null : taskPlanHref(t)
  const total = t.checklist.length
  const doneCount = t.checklist.filter((it) => it.done).length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0
  const mine = isOwnTaskFor(t, currentUserId, role)
  const working = isPending || busy !== null

  function applyUpdate(updated: ObraTask) {
    setCurrent(updated)
    onChanged?.(updated)
  }

  function changeStatus(status: TaskStatus, opts?: { notes?: string; success?: string }) {
    setBusy(status)
    startTransition(async () => {
      const res = await callAction(() => setObraTaskStatus(t.id, status, opts?.notes))
      setBusy(null)
      if (res.ok === false) {
        toast.error(res.error)
        return
      }
      applyUpdate(res.data)
      setDoneOpen(false)
      setCancelOpen(false)
      setNotes("")
      toast.success(opts?.success ?? "Tarea actualizada.")
    })
  }

  function toggleItem(index: number, done: boolean) {
    const before = current
    // Actualización optimista: se revierte si el servidor rechaza el cambio.
    setCurrent({
      ...before,
      checklist: before.checklist.map((it, i) => (i === index ? { ...it, done } : it)),
    })
    setBusy(`item-${index}`)
    startTransition(async () => {
      const res = await callAction(() => toggleObraTaskChecklist(before.id, index, done))
      setBusy(null)
      if (res.ok === false) {
        setCurrent(before)
        toast.error(res.error)
        return
      }
      applyUpdate(res.data)
    })
  }

  const canStart = targets.includes("en_progreso") && t.status === "pendiente"
  const canFinish = targets.includes("hecha") && isTaskOpen(t)
  const canReopen = targets.includes("pendiente") && (t.status === "hecha" || t.status === "cancelada")
  const canBackToPending = targets.includes("pendiente") && t.status === "en_progreso"
  const canCancel = targets.includes("cancelada")
  const showEdit = Boolean(onEdit) && canManage
  const hasMenu = showEdit || canBackToPending || canCancel

  const spinner = <Loader2 className="h-4 w-4 animate-spin" aria-hidden />

  return (
    <article
      className={cn(
        "rounded-[14px] border bg-card p-3.5 transition-colors",
        overdue ? "border-danger/40" : "border-border",
        t.status === "cancelada" && "opacity-75",
        className,
      )}
      aria-labelledby={`${baseId}-title`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={t.priority} />
        <TaskStatusBadge status={t.status} />
        {overdue ? (
          <span className={cn(chip, "bg-danger-tint text-danger")}>
            <TriangleAlert className="h-3 w-3" aria-hidden />
            Vencida
          </span>
        ) : null}
        {mine ? <span className={cn(chip, "bg-brand/15 text-foreground")}>Para ti</span> : null}
      </div>

      <h3 id={`${baseId}-title`} className="mt-2 break-words font-display text-[15px] font-semibold leading-snug">
        {t.title}
      </h3>

      <TaskOriginChip task={t} className="mt-1.5" />

      {t.description ? (
        <p
          className={cn(
            "mt-1.5 whitespace-pre-line break-words text-[13px] text-muted-foreground",
            compact && "line-clamp-2",
          )}
        >
          {t.description}
        </p>
      ) : null}

      <ul className="mt-2.5 space-y-1 text-[12.5px] text-muted-foreground">
        <li className="flex items-start gap-1.5">
          <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{assigneeLabel(t)}</span>
        </li>
        {due ? (
          <li className={cn("flex items-start gap-1.5", overdue && "font-semibold text-danger")}>
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{due}</span>
          </li>
        ) : null}
        {inspectionTitle ? (
          <li className="flex items-start gap-1.5">
            <CalendarCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">Revisión: {inspectionTitle}</span>
          </li>
        ) : null}
        {t.status === "hecha" && t.completed_at ? (
          <li className="flex items-start gap-1.5 text-success">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Hecha <TimeAgo iso={t.completed_at} />
            </span>
          </li>
        ) : null}
      </ul>

      {t.status === "hecha" && t.completion_notes ? (
        <p className="mt-2 whitespace-pre-line break-words rounded-[10px] bg-success-tint px-2.5 py-2 text-[12.5px] text-foreground">
          <span className="font-semibold">Notas de cierre: </span>
          {t.completion_notes}
        </p>
      ) : null}

      {total > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowChecklist((v) => !v)}
            aria-expanded={showChecklist}
            aria-controls={`${baseId}-checklist`}
            className="flex min-h-10 w-full items-center gap-2 rounded-[10px] px-1 text-left text-[13px] font-semibold outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span>Checklist</span>
            <span className="font-normal text-muted-foreground">
              {doneCount} de {total}
            </span>
            <ChevronDown
              className={cn("ml-auto h-4 w-4 text-muted-foreground transition-transform", showChecklist && "rotate-180")}
              aria-hidden
            />
          </button>
          <Progress value={pct} className="h-1.5 bg-secondary" aria-label={`Checklist: ${doneCount} de ${total} ítems hechos`} />
          {showChecklist ? (
            <ul id={`${baseId}-checklist`} className="mt-1.5 space-y-0.5">
              {t.checklist.map((it, i) => {
                const itemId = `${baseId}-item-${i}`
                return (
                  <li key={`${i}-${it.text}`} className="flex min-h-10 items-center gap-2.5 rounded-[10px] px-1">
                    <Checkbox
                      id={itemId}
                      checked={it.done}
                      disabled={!canWork || working}
                      onCheckedChange={(v) => toggleItem(i, v === true)}
                      className="size-5"
                    />
                    <label
                      htmlFor={itemId}
                      className={cn(
                        "min-w-0 flex-1 cursor-pointer break-words py-1.5 text-[13px]",
                        it.done && "text-muted-foreground line-through",
                        !canWork && "cursor-default",
                      )}
                    >
                      {it.text}
                    </label>
                    {busy === `item-${i}` ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {planHref || canStart || canFinish || canReopen || hasMenu ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {canStart ? (
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-[10px]"
              disabled={working}
              onClick={() => changeStatus("en_progreso", { success: "Tarea en progreso." })}
            >
              {busy === "en_progreso" ? spinner : <PlayCircle className="h-4 w-4" aria-hidden />}
              Empezar
            </Button>
          ) : null}
          {canFinish ? (
            <Button
              type="button"
              className="h-10 rounded-[10px] bg-success text-white hover:bg-success/90"
              disabled={working}
              onClick={() => setDoneOpen(true)}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Marcar hecha
            </Button>
          ) : null}
          {canReopen ? (
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-[10px]"
              disabled={working}
              onClick={() => changeStatus("pendiente", { success: "Tarea reabierta." })}
            >
              {busy === "pendiente" ? spinner : <RotateCcw className="h-4 w-4" aria-hidden />}
              Reabrir
            </Button>
          ) : null}
          {planHref ? (
            <Link
              href={planHref}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-semibold text-[#b8841a] outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <MapPin className="h-4 w-4" aria-hidden />
              Ver en plano
            </Link>
          ) : null}
          {hasMenu ? (
            // modal={false}: evita que el menú deje bloqueada la página al abrir el diálogo de cancelar.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-10 rounded-[10px]"
                  aria-label={`Más acciones para «${t.title}»`}
                  disabled={working}
                >
                  {busy === "pendiente" && canBackToPending ? spinner : <MoreHorizontal className="h-4 w-4" aria-hidden />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[200px]">
                {showEdit ? (
                  <DropdownMenuItem className="min-h-10" onSelect={() => onEdit?.(t)}>
                    <Pencil className="h-4 w-4" aria-hidden />
                    Editar tarea
                  </DropdownMenuItem>
                ) : null}
                {canBackToPending ? (
                  <DropdownMenuItem
                    className="min-h-10"
                    onSelect={() => changeStatus("pendiente", { success: "La tarea volvió a pendiente." })}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    Volver a pendiente
                  </DropdownMenuItem>
                ) : null}
                {canCancel ? (
                  <>
                    {showEdit || canBackToPending ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem className="min-h-10 text-danger focus:text-danger" onSelect={() => setCancelOpen(true)}>
                      <XCircle className="h-4 w-4" aria-hidden />
                      Cancelar tarea
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

      {/* Marcar como hecha: notas opcionales */}
      <Dialog open={doneOpen} onOpenChange={(o) => !working && setDoneOpen(o)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Marcar como hecha</DialogTitle>
            <DialogDescription className="break-words">«{t.title}»</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${baseId}-notes`}>¿Qué se hizo? (opcional)</Label>
            <Textarea
              id={`${baseId}-notes`}
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej.: Se reparó la filtración y se selló la grieta."
              rows={4}
            />
            {total > 0 && doneCount < total ? (
              <p className="text-xs text-warning">
                Atención: quedan {total - doneCount} ítem{total - doneCount === 1 ? "" : "s"} del checklist sin marcar.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-10" disabled={working} onClick={() => setDoneOpen(false)}>
              Volver
            </Button>
            <Button
              type="button"
              className="h-10 bg-success text-white hover:bg-success/90"
              disabled={working}
              onClick={() => changeStatus("hecha", { notes: notes.trim() || undefined, success: "¡Tarea marcada como hecha!" })}
            >
              {busy === "hecha" ? spinner : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              Marcar como hecha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancelar: confirmación */}
      <Dialog open={cancelOpen} onOpenChange={(o) => !working && setCancelOpen(o)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>¿Cancelar esta tarea?</DialogTitle>
            <DialogDescription className="break-words">
              «{t.title}» dejará de aparecer como pendiente. Quien gestiona tareas puede reabrirla después.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-10" disabled={working} onClick={() => setCancelOpen(false)}>
              No, volver
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-10"
              disabled={working}
              onClick={() => changeStatus("cancelada", { success: "Tarea cancelada." })}
            >
              {busy === "cancelada" ? spinner : <XCircle className="h-4 w-4" aria-hidden />}
              Sí, cancelar tarea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}
