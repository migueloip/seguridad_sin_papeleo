"use client"

/**
 * Diálogo para crear o editar una tarea manual de obra (permiso tasks.manage).
 *
 * Campos: título, descripción, prioridad, responsable (un rol o una persona del
 * equipo), vencimiento, revisión (incluida "Próxima revisión", que el servidor
 * crea si no existe) y checklist dinámica. La validación definitiva la hace el
 * servidor; aquí solo se adelantan los errores más comunes.
 *
 * Reutilizable desde el plano: `defaults` permite fijar finding_id, layer_id,
 * level, x e y de una tarea nueva.
 */
import { useId, useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import { ListChecks, Loader2, MapPin, Plus, Trash2 } from "lucide-react"
import { createObraTask, updateObraTask } from "@/app/actions/obra/tasks"
import { Button } from "@/components/ui/button"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  OBRA_ROLE_LABELS,
  OBRA_ROLES,
  PRIORITIES,
  PRIORITY_LABELS,
  type ObraInspection,
  type ObraMember,
  type ObraRole,
  type ObraTask,
  type Priority,
  type TaskInput,
} from "@/lib/obra/types"
import { callAction, formatDateCL } from "./task-card"

/** Límites (espejo de TASK_LIMITS en lib/obra/server/tasks.ts). */
export const TASK_FORM_LIMITS = {
  titleMin: 3,
  titleMax: 200,
  description: 4000,
  checklistItems: 20,
  checklistItem: 300,
} as const

export type TaskFormDialogProps = {
  projectId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tarea a editar. Si no se entrega, el diálogo crea una tarea nueva. */
  task?: ObraTask | null
  /** Equipo de la obra (para asignar a una persona). */
  members: ObraMember[]
  /** Revisiones de la obra (se ofrecen las que no están cerradas). */
  inspections: ObraInspection[]
  /** Valores iniciales de una tarea nueva (p.ej. desde el plano: finding_id, layer_id, level, x, y). */
  defaults?: Partial<TaskInput>
  /** Se llama con la tarea creada o actualizada. */
  onSaved?: (task: ObraTask) => void
}

export function TaskFormDialog(props: TaskFormDialogProps) {
  const { open, onOpenChange, task } = props
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>{task ? "Editar tarea" : "Nueva tarea"}</DialogTitle>
          <DialogDescription>
            {task
              ? "Los cambios quedan registrados en la auditoría de la obra."
              : "Describe qué hay que hacer, quién lo hace y para cuándo."}
          </DialogDescription>
        </DialogHeader>
        {/* El formulario se monta al abrir: su estado parte de cero cada vez. */}
        {open ? <TaskForm {...props} onSavingChange={setSaving} /> : null}
      </DialogContent>
    </Dialog>
  )
}

type ChecklistRow = { key: number; text: string }

const NONE = "none"
const NEXT = "next"

function assigneeKeyOf(task: ObraTask | null | undefined, defaults?: Partial<TaskInput>): string {
  const userId = task ? task.assigned_user_id : defaults?.assigned_user_id
  const role = task ? task.assigned_role : defaults?.assigned_role
  if (userId != null) return `user:${userId}`
  if (role) return `role:${role}`
  return NONE
}

function TaskForm({
  projectId,
  task,
  members,
  inspections,
  defaults,
  onSaved,
  onOpenChange,
  onSavingChange,
}: TaskFormDialogProps & { onSavingChange: (saving: boolean) => void }) {
  const formId = useId()
  const openInspections = inspections.filter((i) => i.status !== "cerrada")
  const currentInspection =
    task?.inspection_id != null ? inspections.find((i) => i.id === task.inspection_id) ?? null : null

  const initialInspection = (() => {
    if (task) return task.inspection_id != null ? String(task.inspection_id) : NONE
    const d = defaults?.inspection_id
    if (d === "next") return NEXT
    if (typeof d === "number") return String(d)
    if (d === null) return NONE
    return openInspections.length > 0 ? NEXT : NONE
  })()

  const [title, setTitle] = useState(task?.title ?? defaults?.title ?? "")
  const [description, setDescription] = useState(task?.description ?? defaults?.description ?? "")
  const [priority, setPriority] = useState<Priority>(task?.priority ?? defaults?.priority ?? "media")
  const [assignee, setAssignee] = useState(assigneeKeyOf(task, defaults))
  const [dueDate, setDueDate] = useState(task?.due_date ?? defaults?.due_date ?? "")
  const [inspection, setInspection] = useState(initialInspection)
  const [rows, setRows] = useState<ChecklistRow[]>(() =>
    (task ? task.checklist.map((it) => it.text) : defaults?.checklist ?? []).map((text, i) => ({ key: i, text })),
  )
  const [nextKey, setNextKey] = useState(() => rows.length)
  const [focusKey, setFocusKey] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const hasLocation =
    (task ? task.finding_id ?? task.layer_id : defaults?.finding_id ?? defaults?.layer_id) != null

  // Persona asignada que ya no está en el equipo (se conserva como opción para no perderla al editar).
  const orphanUser =
    task?.assigned_user_id != null && !members.some((m) => m.user_id === task.assigned_user_id)
      ? { id: task.assigned_user_id, name: task.assigned_user_name || "Persona sin acceso" }
      : null

  function addRow(afterIndex?: number) {
    if (rows.length >= TASK_FORM_LIMITS.checklistItems) return
    const key = nextKey
    setNextKey(key + 1)
    setFocusKey(key)
    setRows((prev) => {
      const copy = [...prev]
      const at = afterIndex == null ? copy.length : afterIndex + 1
      copy.splice(at, 0, { key, text: "" })
      return copy
    })
  }

  function validate(): string | null {
    const tt = title.trim()
    if (tt.length < TASK_FORM_LIMITS.titleMin) return `El título debe tener al menos ${TASK_FORM_LIMITS.titleMin} caracteres.`
    if (tt.length > TASK_FORM_LIMITS.titleMax) return `El título admite como máximo ${TASK_FORM_LIMITS.titleMax} caracteres.`
    if (description.length > TASK_FORM_LIMITS.description) {
      return `La descripción admite como máximo ${TASK_FORM_LIMITS.description} caracteres.`
    }
    const items = rows.map((r) => r.text.trim()).filter(Boolean)
    if (items.length > TASK_FORM_LIMITS.checklistItems) {
      return `El checklist admite como máximo ${TASK_FORM_LIMITS.checklistItems} ítems.`
    }
    if (items.some((it) => it.length > TASK_FORM_LIMITS.checklistItem)) {
      return `Cada ítem del checklist admite como máximo ${TASK_FORM_LIMITS.checklistItem} caracteres.`
    }
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return "La fecha de vencimiento no es válida."
    return null
  }

  function buildInput(): TaskInput {
    let assignedRole: ObraRole | null = null
    let assignedUserId: number | null = null
    if (task && assignee === assigneeKeyOf(task)) {
      // Sin cambios de responsable: se conserva tal cual (no genera cambios en la auditoría).
      assignedRole = task.assigned_role
      assignedUserId = task.assigned_user_id
    } else if (assignee.startsWith("role:")) {
      assignedRole = assignee.slice(5) as ObraRole
    } else if (assignee.startsWith("user:")) {
      assignedUserId = Number(assignee.slice(5))
      const member = members.find((m) => m.user_id === assignedUserId)
      assignedRole = member?.role ?? task?.assigned_role ?? null
    }
    const inspectionRef: TaskInput["inspection_id"] =
      inspection === NEXT ? "next" : inspection === NONE ? null : Number(inspection)
    return {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      assigned_role: assignedRole,
      assigned_user_id: assignedUserId,
      due_date: dueDate || null,
      inspection_id: inspectionRef,
      checklist: rows.map((r) => r.text.trim()).filter(Boolean),
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    const input = buildInput()
    onSavingChange(true)
    startTransition(async () => {
      const res = await callAction(() =>
        task
          ? updateObraTask(task.id, input)
          : createObraTask(projectId, {
              ...input,
              finding_id: defaults?.finding_id ?? null,
              layer_id: defaults?.layer_id ?? null,
              level: defaults?.level ?? null,
              x: defaults?.x ?? null,
              y: defaults?.y ?? null,
            }),
      )
      onSavingChange(false)
      if (res.ok === false) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      toast.success(task ? "Tarea actualizada." : "Tarea creada.")
      onSaved?.(res.data)
      onOpenChange(false)
    })
  }

  const ids = {
    title: `${formId}-title`,
    description: `${formId}-description`,
    priority: `${formId}-priority`,
    assignee: `${formId}-assignee`,
    due: `${formId}-due`,
    inspection: `${formId}-inspection`,
    error: `${formId}-error`,
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={error ? ids.error : undefined} noValidate>
      {hasLocation ? (
        <p className="flex items-center gap-2 rounded-[10px] bg-secondary px-3 py-2 text-[13px] text-muted-foreground">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden />
          Esta tarea queda ubicada en el plano.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={ids.title}>Título</Label>
        <Input
          id={ids.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TASK_FORM_LIMITS.titleMax}
          placeholder="Ej.: Revisar baranda del tercer piso"
          className="h-10"
          required
          aria-required
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.description}>Descripción (opcional)</Label>
        <Textarea
          id={ids.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={TASK_FORM_LIMITS.description}
          rows={3}
          placeholder="Qué hay que revisar o corregir, y cómo saber que quedó bien."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={ids.priority}>Prioridad</Label>
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger id={ids.priority} className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p} className="min-h-10">
                  {PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={ids.due}>Vencimiento (opcional)</Label>
          <Input id={ids.due} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-10" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.assignee}>Responsable</Label>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger id={ids.assignee} className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="min-h-10">
              Sin responsable
            </SelectItem>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Un rol (cualquiera con ese rol)</SelectLabel>
              {OBRA_ROLES.filter((r) => r !== "visita").map((r) => (
                <SelectItem key={r} value={`role:${r}`} className="min-h-10">
                  {OBRA_ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectGroup>
            {members.length > 0 || orphanUser ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Una persona del equipo</SelectLabel>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={`user:${m.user_id}`} className="min-h-10">
                      {m.name || m.email} · {OBRA_ROLE_LABELS[m.role]}
                    </SelectItem>
                  ))}
                  {orphanUser ? (
                    <SelectItem value={`user:${orphanUser.id}`} className="min-h-10">
                      {orphanUser.name} (ya no está en el equipo)
                    </SelectItem>
                  ) : null}
                </SelectGroup>
              </>
            ) : null}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Si eliges un rol, la tarea le aparece a todas las personas con ese rol.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.inspection}>Revisión</Label>
        <Select value={inspection} onValueChange={setInspection}>
          <SelectTrigger id={ids.inspection} className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEXT} className="min-h-10">
              Próxima revisión
            </SelectItem>
            <SelectItem value={NONE} className="min-h-10">
              Sin revisión
            </SelectItem>
            {openInspections.length > 0 || currentInspection ? <SelectSeparator /> : null}
            {openInspections.map((i) => (
              <SelectItem key={i.id} value={String(i.id)} className="min-h-10">
                {i.title} · {formatDateCL(i.scheduled_for)}
                {i.status === "en_curso" ? " (en curso)" : ""}
              </SelectItem>
            ))}
            {currentInspection && currentInspection.status === "cerrada" ? (
              <SelectItem value={String(currentInspection.id)} className="min-h-10">
                {currentInspection.title} · {formatDateCL(currentInspection.scheduled_for)} (cerrada)
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        {inspection === NEXT ? (
          <p className="text-xs text-muted-foreground">
            Se anota en la próxima revisión (la que está en curso o la siguiente programada). Si no hay ninguna, se crea
            una «Revisión semanal» en 7 días; si la tarea vence antes, una «Revisión prioritaria» para su vencimiento.
          </p>
        ) : null}
      </div>

      <fieldset className="min-w-0 space-y-2">
        <legend className="flex items-center gap-2 text-sm font-medium">
          <ListChecks className="h-4 w-4" aria-hidden />
          Checklist (opcional)
        </legend>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Agrega los pasos que se deben verificar en terreno.</p>
        ) : null}
        <ol className="space-y-2">
          {rows.map((row, idx) => (
            <li key={row.key} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground" aria-hidden>
                {idx + 1}.
              </span>
              <Input
                value={row.text}
                aria-label={`Ítem ${idx + 1} del checklist`}
                maxLength={TASK_FORM_LIMITS.checklistItem}
                autoFocus={focusKey === row.key}
                onChange={(e) => {
                  const text = e.target.value
                  setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, text } : r)))
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addRow(idx)
                  }
                }}
                placeholder="Ej.: Verificar que no haya agua en la cámara"
                className="h-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0"
                aria-label={`Quitar ítem ${idx + 1}`}
                onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={() => addRow()}
          disabled={rows.length >= TASK_FORM_LIMITS.checklistItems}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Agregar ítem
        </Button>
        {rows.length >= TASK_FORM_LIMITS.checklistItems ? (
          <p className="text-xs text-muted-foreground">Máximo {TASK_FORM_LIMITS.checklistItems} ítems.</p>
        ) : null}
      </fieldset>

      {error ? (
        <p id={ids.error} role="alert" className="rounded-[10px] bg-danger-tint px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" disabled={isPending} onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button type="submit" className="h-10" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {task ? "Guardar cambios" : "Crear tarea"}
        </Button>
      </DialogFooter>
    </form>
  )
}
