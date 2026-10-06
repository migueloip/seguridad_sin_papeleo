"use client"

/**
 * Revisiones de la obra: lista (la próxima destacada), programar y editar
 * revisiones, ver sus tareas y cerrarlas con un resumen (opcionalmente
 * pasando las tareas abiertas a la próxima revisión).
 */
import Link from "next/link"
import { useEffect, useId, useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import {
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Lock,
  Pencil,
  PlayCircle,
  RotateCcw,
  UserRound,
} from "lucide-react"
import {
  closeObraInspection,
  createObraInspection,
  listObraInspections,
  updateObraInspection,
} from "@/app/actions/obra/inspections"
import { listObraTasks } from "@/app/actions/obra/tasks"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { addDaysISO, pickNextInspection as pickNextInspectionShared, todayISO } from "@/lib/obra/metrics"
import { can } from "@/lib/obra/permissions"
import {
  INSPECTION_STATUS_LABELS,
  OBRA_ROLE_LABELS,
  type InspectionStatus,
  type ObraInspection,
  type ObraMember,
  type ObraRole,
  type ObraTask,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { callAction, daysBetweenISO, formatDateCL, formatDateTimeCL, TaskCard } from "./task-card"

// ---------------------------------------------------------------------------
// Utilidades compartidas (también las usa el resumen de la obra)
// ---------------------------------------------------------------------------

/** ¿Revisión programada cuya fecha ya pasó? */
export function isInspectionLate(i: Pick<ObraInspection, "status" | "scheduled_for">, today: string): boolean {
  return i.status === "programada" && i.scheduled_for.slice(0, 10) < today
}

/**
 * Próxima revisión: el criterio único del módulo (lib/obra/metrics.ts), el
 * mismo que usa el servidor al anotar una tarea aprobada en "la próxima
 * revisión".
 */
export function pickNextInspection(list: ObraInspection[], today: string): ObraInspection | null {
  return pickNextInspectionShared(list, today)
}

/** Texto corto de cuándo es la revisión: "hoy", "mañana", "en 5 días", "hace 2 días". */
export function inspectionWhen(scheduledFor: string, today: string): string {
  const diff = daysBetweenISO(today, scheduledFor)
  if (diff == null) return ""
  if (diff === 0) return "hoy"
  if (diff === 1) return "mañana"
  if (diff === -1) return "ayer"
  return diff > 0 ? `en ${diff} días` : `hace ${-diff} días`
}

const INSPECTION_STATUS_CLS: Record<InspectionStatus, string> = {
  programada: "bg-secondary text-foreground",
  en_curso: "bg-warning-tint text-warning",
  cerrada: "bg-success-tint text-success",
}

export function InspectionStatusBadge({
  inspection,
  today,
  className,
}: {
  inspection: Pick<ObraInspection, "status" | "scheduled_for">
  today: string
  className?: string
}) {
  const late = isInspectionLate(inspection, today)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
        late ? "bg-danger-tint text-danger" : INSPECTION_STATUS_CLS[inspection.status],
        className,
      )}
    >
      {late ? "Atrasada" : INSPECTION_STATUS_LABELS[inspection.status]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export function InspectionsContent({
  projectId,
  role,
  currentUserId,
  initialInspections,
  members,
  today: todayProp,
}: {
  projectId: number
  role: ObraRole
  currentUserId: number
  initialInspections: ObraInspection[]
  members: ObraMember[]
  today?: string
}) {
  const today = todayProp ?? todayISO()
  const canManage = can(role, "inspections.manage")

  const [prevInitial, setPrevInitial] = useState(initialInspections)
  const [inspections, setInspections] = useState(initialInspections)
  if (initialInspections !== prevInitial) {
    setPrevInitial(initialInspections)
    setInspections(initialInspections)
  }

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ObraInspection | null>(null)
  const [closing, setClosing] = useState<ObraInspection | null>(null)
  const [viewing, setViewing] = useState<ObraInspection | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  const next = pickNextInspection(inspections, today)
  const open = inspections.filter((i) => i.status !== "cerrada" && i.id !== next?.id)
  const closed = inspections.filter((i) => i.status === "cerrada")

  async function refresh() {
    const res = await callAction(() => listObraInspections(projectId))
    if (res.ok) setInspections(res.data)
  }

  function replace(updated: ObraInspection) {
    setInspections((prev) => {
      const idx = prev.findIndex((i) => i.id === updated.id)
      if (idx === -1) return [...prev, updated]
      const copy = [...prev]
      copy[idx] = updated
      return copy
    })
  }

  function setStatus(i: ObraInspection, status: InspectionStatus, success: string) {
    setBusyId(i.id)
    startTransition(async () => {
      const res = await callAction(() => updateObraInspection(i.id, { status }))
      setBusyId(null)
      if (res.ok === false) {
        toast.error(res.error)
        return
      }
      replace(res.data)
      toast.success(success)
    })
  }

  const rowProps = {
    today,
    canManage,
    busyId,
    onView: setViewing,
    onEdit: (i: ObraInspection) => {
      setEditing(i)
      setFormOpen(true)
    },
    onClose: setClosing,
    onSetStatus: setStatus,
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">Revisiones</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Una revisión agrupa las tareas que se verifican juntas en terreno. Al cerrarla queda el resumen y las tareas
            pendientes pueden pasar a la siguiente.
          </p>
        </div>
        {canManage ? (
          <Button
            type="button"
            className="h-10 rounded-[10px]"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <CalendarPlus className="h-4 w-4" aria-hidden />
            Programar revisión
          </Button>
        ) : null}
      </div>

      {inspections.length === 0 ? (
        <div className="flex flex-col items-center rounded-[14px] border border-dashed border-border bg-card px-5 py-12 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-[14px] bg-secondary">
            <CalendarCheck className="h-6 w-6 text-muted-foreground" aria-hidden />
          </span>
          <p className="font-display text-lg font-semibold">Aún no hay revisiones</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {canManage
              ? "Programa la primera revisión para agrupar las tareas que se verificarán en terreno. Si apruebas una sugerencia sin revisiones abiertas, se crea una automáticamente."
              : "Cuando el equipo programe una revisión, aparecerá aquí con sus tareas."}
          </p>
          {canManage ? (
            <Button
              type="button"
              className="mt-4 h-10"
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <CalendarPlus className="h-4 w-4" aria-hidden />
              Programar revisión
            </Button>
          ) : null}
        </div>
      ) : null}

      {next ? (
        <section aria-labelledby="next-inspection-title">
          <h3 id="next-inspection-title" className="mb-2 text-sm font-semibold text-muted-foreground">
            {next.status === "en_curso" ? "Revisión en curso" : "Próxima revisión"}
          </h3>
          <InspectionRow inspection={next} featured {...rowProps} />
        </section>
      ) : null}

      {open.length > 0 ? (
        <section aria-labelledby="open-inspections-title">
          <h3 id="open-inspections-title" className="mb-2 text-sm font-semibold text-muted-foreground">
            Otras revisiones abiertas
          </h3>
          <div className="space-y-2.5">
            {open.map((i) => (
              <InspectionRow key={i.id} inspection={i} {...rowProps} />
            ))}
          </div>
        </section>
      ) : null}

      {closed.length > 0 ? (
        <section aria-labelledby="closed-inspections-title">
          <h3 id="closed-inspections-title" className="mb-2 text-sm font-semibold text-muted-foreground">
            Revisiones cerradas
          </h3>
          <div className="space-y-2.5">
            {closed.map((i) => (
              <InspectionRow key={i.id} inspection={i} {...rowProps} />
            ))}
          </div>
        </section>
      ) : null}

      {canManage ? (
        <InspectionFormDialog
          projectId={projectId}
          open={formOpen}
          inspection={editing}
          members={members}
          today={today}
          onOpenChange={(o) => {
            setFormOpen(o)
            if (!o) setEditing(null)
          }}
          onSaved={(saved) => {
            replace(saved)
            void refresh()
          }}
        />
      ) : null}

      {canManage ? (
        <CloseInspectionDialog
          inspection={closing}
          onOpenChange={(o) => {
            if (!o) setClosing(null)
          }}
          onClosed={() => {
            setClosing(null)
            void refresh()
          }}
        />
      ) : null}

      <InspectionTasksDialog
        projectId={projectId}
        inspection={viewing}
        role={role}
        currentUserId={currentUserId}
        today={today}
        onOpenChange={(o) => {
          if (!o) setViewing(null)
        }}
        onTasksChanged={() => void refresh()}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fila / tarjeta de revisión
// ---------------------------------------------------------------------------

function InspectionRow({
  inspection: i,
  featured = false,
  today,
  canManage,
  busyId,
  onView,
  onEdit,
  onClose,
  onSetStatus,
}: {
  inspection: ObraInspection
  featured?: boolean
  today: string
  canManage: boolean
  busyId: number | null
  onView: (i: ObraInspection) => void
  onEdit: (i: ObraInspection) => void
  onClose: (i: ObraInspection) => void
  onSetStatus: (i: ObraInspection, status: InspectionStatus, success: string) => void
}) {
  const done = i.task_count - i.open_task_count
  const pct = i.task_count > 0 ? Math.round((done / i.task_count) * 100) : 0
  const busy = busyId === i.id
  const isClosed = i.status === "cerrada"
  const when = isClosed ? "" : inspectionWhen(i.scheduled_for, today)

  return (
    <article
      className={cn(
        "rounded-[14px] border bg-card p-4",
        featured ? "border-brand/60 shadow-[0_0_0_3px_rgba(243,164,10,0.12)]" : "border-border",
      )}
      aria-label={`Revisión ${i.title}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className={cn("break-words font-display font-semibold", featured ? "text-lg" : "text-[15px]")}>
              {i.title}
            </h4>
            <InspectionStatusBadge inspection={i} today={today} />
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {formatDateCL(i.scheduled_for)}
            {when ? ` · ${when}` : ""}
            {isClosed && i.closed_at ? ` · cerrada el ${formatDateTimeCL(i.closed_at)}` : ""}
          </p>
          {i.lead_user_name ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <UserRound className="h-3.5 w-3.5" aria-hidden />
              Responsable: {i.lead_user_name}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <div className="font-display text-xl font-bold">
            {i.open_task_count}
            <span className="text-sm font-medium text-muted-foreground"> / {i.task_count}</span>
          </div>
          <div className="text-xs text-muted-foreground">tareas abiertas</div>
        </div>
      </div>

      {i.task_count > 0 ? (
        <div className="mt-3">
          <Progress
            value={pct}
            className="h-1.5 bg-secondary"
            aria-label={`${done} de ${i.task_count} tareas cerradas`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {done} de {i.task_count} cerradas
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Sin tareas anotadas todavía.</p>
      )}

      {i.notes ? <p className="mt-3 whitespace-pre-line break-words text-[13px]">{i.notes}</p> : null}
      {isClosed && i.summary ? (
        <p className="mt-3 whitespace-pre-line break-words rounded-[10px] bg-success-tint px-3 py-2 text-[13px]">
          <span className="font-semibold">Resumen: </span>
          {i.summary}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" className="h-10 rounded-[10px]" onClick={() => onView(i)}>
          <ClipboardList className="h-4 w-4" aria-hidden />
          Ver tareas
        </Button>
        {canManage && i.status === "programada" ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-[10px]"
            disabled={busy}
            onClick={() => onSetStatus(i, "en_curso", "Revisión iniciada.")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlayCircle className="h-4 w-4" aria-hidden />}
            Iniciar
          </Button>
        ) : null}
        {canManage && !isClosed ? (
          <Button type="button" className="h-10 rounded-[10px]" disabled={busy} onClick={() => onClose(i)}>
            <Lock className="h-4 w-4" aria-hidden />
            Cerrar revisión
          </Button>
        ) : null}
        {canManage && i.status === "en_curso" ? (
          <Button
            type="button"
            variant="ghost"
            className="h-10 rounded-[10px]"
            disabled={busy}
            onClick={() => onSetStatus(i, "programada", "La revisión volvió a programada.")}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Volver a programada
          </Button>
        ) : null}
        {canManage && isClosed ? (
          <Button
            type="button"
            variant="ghost"
            className="h-10 rounded-[10px]"
            disabled={busy}
            onClick={() => onSetStatus(i, "programada", "Revisión reabierta.")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
            Reabrir
          </Button>
        ) : null}
        {canManage ? (
          <Button
            type="button"
            variant="ghost"
            className="h-10 rounded-[10px]"
            disabled={busy}
            onClick={() => onEdit(i)}
            aria-label={`Editar revisión «${i.title}»`}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            Editar
          </Button>
        ) : null}
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Programar / editar revisión
// ---------------------------------------------------------------------------

const NO_LEAD = "none"

function InspectionFormDialog({
  projectId,
  open,
  inspection,
  members,
  today,
  onOpenChange,
  onSaved,
}: {
  projectId: number
  open: boolean
  inspection: ObraInspection | null
  members: ObraMember[]
  today: string
  onOpenChange: (open: boolean) => void
  onSaved: (i: ObraInspection) => void
}) {
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{inspection ? "Editar revisión" : "Programar revisión"}</DialogTitle>
          <DialogDescription>
            {inspection ? "Ajusta la fecha, el responsable o las notas." : "Elige cuándo se hará y quién la dirige."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <InspectionForm
            projectId={projectId}
            inspection={inspection}
            members={members}
            today={today}
            onCancel={() => onOpenChange(false)}
            onSavingChange={setSaving}
            onSaved={(i) => {
              onSaved(i)
              onOpenChange(false)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function InspectionForm({
  projectId,
  inspection,
  members,
  today,
  onCancel,
  onSavingChange,
  onSaved,
}: {
  projectId: number
  inspection: ObraInspection | null
  members: ObraMember[]
  today: string
  onCancel: () => void
  onSavingChange: (saving: boolean) => void
  onSaved: (i: ObraInspection) => void
}) {
  const formId = useId()
  const [title, setTitle] = useState(inspection?.title ?? "")
  const [date, setDate] = useState(inspection?.scheduled_for ?? addDaysISO(today, 7))
  const [lead, setLead] = useState(inspection?.lead_user_id != null ? String(inspection.lead_user_id) : NO_LEAD)
  const [notes, setNotes] = useState(inspection?.notes ?? "")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const leadMissing =
    inspection?.lead_user_id != null && !members.some((m) => m.user_id === inspection.lead_user_id)

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = title.trim()
    if (t.length < 3) {
      setError("El título debe tener al menos 3 caracteres.")
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Indica la fecha de la revisión.")
      return
    }
    setError(null)
    const payload = {
      title: t,
      scheduled_for: date,
      lead_user_id: lead === NO_LEAD ? null : Number(lead),
      notes: notes.trim() || null,
    }
    onSavingChange(true)
    startTransition(async () => {
      const res = await callAction(() =>
        inspection ? updateObraInspection(inspection.id, payload) : createObraInspection(projectId, payload),
      )
      onSavingChange(false)
      if (res.ok === false) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      toast.success(inspection ? "Revisión actualizada." : "Revisión programada.")
      onSaved(res.data)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-title`}>Título</Label>
        <Input
          id={`${formId}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Ej.: Revisión semanal de terreno"
          className="h-10"
          autoFocus
          required
          aria-required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-date`}>Fecha</Label>
        <Input
          id={`${formId}-date`}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-10"
          required
          aria-required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-lead`}>Responsable (opcional)</Label>
        <Select value={lead} onValueChange={setLead}>
          <SelectTrigger id={`${formId}-lead`} className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_LEAD} className="min-h-10">
              Sin responsable
            </SelectItem>
            {members.length > 0 ? <SelectSeparator /> : null}
            {members.map((m) => (
              <SelectItem key={m.user_id} value={String(m.user_id)} className="min-h-10">
                {m.name || m.email} · {OBRA_ROLE_LABELS[m.role]}
              </SelectItem>
            ))}
            {leadMissing && inspection?.lead_user_id != null ? (
              <SelectItem value={String(inspection.lead_user_id)} className="min-h-10">
                {inspection.lead_user_name || "Persona"} (ya no está en el equipo)
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-notes`}>Notas (opcional)</Label>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={4000}
          rows={3}
          placeholder="Qué se revisará, sectores, a quién avisar…"
        />
      </div>
      {error ? (
        <p role="alert" className="rounded-[10px] bg-danger-tint px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" disabled={isPending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" className="h-10" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {inspection ? "Guardar cambios" : "Programar"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Cerrar revisión
// ---------------------------------------------------------------------------

function CloseInspectionDialog({
  inspection,
  onOpenChange,
  onClosed,
}: {
  inspection: ObraInspection | null
  onOpenChange: (open: boolean) => void
  onClosed: (i: ObraInspection) => void
}) {
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={inspection !== null} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Cerrar revisión</DialogTitle>
          <DialogDescription className="break-words">
            {inspection ? `«${inspection.title}» del ${formatDateCL(inspection.scheduled_for)}` : ""}
          </DialogDescription>
        </DialogHeader>
        {inspection ? (
          <CloseInspectionForm
            key={inspection.id}
            inspection={inspection}
            onCancel={() => onOpenChange(false)}
            onSavingChange={setSaving}
            onClosed={onClosed}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function CloseInspectionForm({
  inspection,
  onCancel,
  onSavingChange,
  onClosed,
}: {
  inspection: ObraInspection
  onCancel: () => void
  onSavingChange: (saving: boolean) => void
  onClosed: (i: ObraInspection) => void
}) {
  const formId = useId()
  const openTasks = inspection.open_task_count
  const [summary, setSummary] = useState("")
  const [carryOver, setCarryOver] = useState(openTasks > 0)
  const [isPending, startTransition] = useTransition()

  function submit(e: FormEvent) {
    e.preventDefault()
    onSavingChange(true)
    startTransition(async () => {
      const res = await callAction(() =>
        closeObraInspection(inspection.id, { summary: summary.trim(), carry_over_open_tasks: carryOver }),
      )
      onSavingChange(false)
      if (res.ok === false) {
        toast.error(res.error)
        return
      }
      toast.success(
        carryOver && openTasks > 0
          ? `Revisión cerrada. ${openTasks === 1 ? "La tarea abierta pasó" : `Las ${openTasks} tareas abiertas pasaron`} a la próxima revisión.`
          : "Revisión cerrada.",
      )
      onClosed(res.data)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-summary`}>Resumen de la revisión</Label>
        <Textarea
          id={`${formId}-summary`}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={4000}
          rows={5}
          placeholder="Qué se revisó, qué quedó resuelto y qué queda pendiente."
          autoFocus
        />
      </div>

      {openTasks > 0 ? (
        <div className="rounded-[12px] border border-border bg-secondary/60 p-3">
          <p className="text-[13px]">
            Esta revisión tiene <strong>{openTasks}</strong> tarea{openTasks === 1 ? "" : "s"} abierta
            {openTasks === 1 ? "" : "s"}.
          </p>
          <div className="mt-2 flex min-h-10 items-center gap-3">
            <Checkbox
              id={`${formId}-carry`}
              checked={carryOver}
              onCheckedChange={(v) => setCarryOver(v === true)}
              className="size-5"
            />
            <Label htmlFor={`${formId}-carry`} className="cursor-pointer text-[13px] font-medium leading-snug">
              Pasar tareas abiertas a la próxima revisión
            </Label>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {carryOver
              ? "Pasan a la próxima revisión abierta. Si no hay ninguna, se crea una «Revisión semanal» en 7 días."
              : "Las tareas abiertas quedarán asociadas a esta revisión cerrada."}
          </p>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Todas las tareas de esta revisión están cerradas.
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" disabled={isPending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" className="h-10" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
          Cerrar revisión
        </Button>
      </DialogFooter>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Tareas de una revisión
// ---------------------------------------------------------------------------

function InspectionTasksDialog({
  projectId,
  inspection,
  role,
  currentUserId,
  today,
  onOpenChange,
  onTasksChanged,
}: {
  projectId: number
  inspection: ObraInspection | null
  role: ObraRole
  currentUserId: number
  today: string
  onOpenChange: (open: boolean) => void
  onTasksChanged: () => void
}) {
  return (
    <Dialog open={inspection !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="break-words">{inspection ? inspection.title : "Tareas"}</DialogTitle>
          <DialogDescription>
            {inspection ? `Tareas de la revisión del ${formatDateCL(inspection.scheduled_for)}.` : ""}
          </DialogDescription>
        </DialogHeader>
        {inspection ? (
          <InspectionTasks
            key={inspection.id}
            projectId={projectId}
            inspection={inspection}
            role={role}
            currentUserId={currentUserId}
            today={today}
            onTasksChanged={onTasksChanged}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function InspectionTasks({
  projectId,
  inspection,
  role,
  currentUserId,
  today,
  onTasksChanged,
}: {
  projectId: number
  inspection: ObraInspection
  role: ObraRole
  currentUserId: number
  today: string
  onTasksChanged: () => void
}) {
  const [tasks, setTasks] = useState<ObraTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Carga al montar (el componente se monta cada vez que se abre el diálogo).
  useEffect(() => {
    let active = true
    void callAction(() => listObraTasks(projectId, { inspection_id: inspection.id })).then((res) => {
      if (!active) return
      if (res.ok === false) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      setTasks(res.data)
    })
    return () => {
      active = false
    }
  }, [projectId, inspection.id])

  const viewAll = can(role, "tasks.view_all")

  return (
    <div className="space-y-3">
      {!viewAll ? (
        <p className="text-xs text-muted-foreground">Solo ves las tareas asignadas a ti o a tu rol.</p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-[10px] bg-danger-tint px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : tasks === null ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando tareas…
        </p>
      ) : tasks.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          Esta revisión no tiene tareas{viewAll ? "" : " para ti"}. Se anotan desde el tablero de tareas o al aprobar
          sugerencias de IA.
        </p>
      ) : (
        <div className="space-y-2.5">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              role={role}
              currentUserId={currentUserId}
              today={today}
              compact
              onChanged={(updated) => {
                setTasks((prev) => (prev ? prev.map((x) => (x.id === updated.id ? updated : x)) : prev))
                onTasksChanged()
              }}
            />
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Link
          href={`/obra/${projectId}/tareas?revision=${inspection.id}`}
          className="inline-flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-[#b8841a] outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ClipboardList className="h-4 w-4" aria-hidden />
          Abrir en el tablero de tareas
        </Link>
      </div>
    </div>
  )
}
