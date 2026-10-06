"use client"

/**
 * "Editar y aprobar" una sugerencia de IA:
 * - create_task: título, descripción, prioridad, rol responsable, plazo en
 *   días y checklist de la tarea que se anotará en la próxima revisión.
 * - update_finding_severity: severidad destino y motivo.
 * (Las sugerencias plan_elements se revisan en extraction-review.tsx.)
 *
 * El servidor vuelve a validar el payload editado, conserva el original en la
 * evidencia y registra la decisión en la auditoría.
 */
import { useId, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { CheckCircle2, ListChecks, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react"
import { approveObraSuggestion } from "@/app/actions/obra/suggestions"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { addDaysISO, todayISO } from "@/lib/obra/metrics"
import { can } from "@/lib/obra/permissions"
import {
  OBRA_ROLE_LABELS,
  OBRA_ROLES,
  PRIORITIES,
  PRIORITY_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  type AiSuggestion,
  type ObraRole,
  type Priority,
  type Severity,
} from "@/lib/obra/types"
import type { ApproveSuggestionResult } from "./extraction-review"
import { callAction, formatDateCL } from "./task-card"

/** Límites (espejo de SUGGESTION_LIMITS en lib/obra/suggestions.ts). */
const LIMITS = {
  titleMin: 3,
  titleMax: 200,
  description: 4000,
  checklistItems: 20,
  checklistItem: 300,
  reason: 1000,
  notes: 1000,
  maxDueInDays: 365,
} as const

const NONE = "none"

export type SuggestionEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  suggestion: AiSuggestion
  role: ObraRole
  onApproved?: (result: ApproveSuggestionResult) => void
}

export function SuggestionEditDialog(props: SuggestionEditDialogProps) {
  const { open, onOpenChange, suggestion } = props
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Editar y aprobar</DialogTitle>
          <DialogDescription>
            {suggestion.kind === "create_task"
              ? "Ajusta la tarea antes de anotarla en la próxima revisión. Tu versión y la original quedan registradas en la auditoría."
              : "Ajusta el cambio antes de aplicarlo. Tu versión y la original quedan registradas en la auditoría."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          suggestion.kind === "create_task" ? (
            <TaskSuggestionForm {...props} onSavingChange={setSaving} />
          ) : suggestion.kind === "update_finding_severity" ? (
            <SeveritySuggestionForm {...props} onSavingChange={setSaving} />
          ) : (
            <p className="text-sm text-muted-foreground">Este tipo de sugerencia se revisa desde la vista de elementos.</p>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

type FormProps = SuggestionEditDialogProps & { onSavingChange: (saving: boolean) => void }

type Row = { key: number; text: string }

function TaskSuggestionForm({ suggestion, role, onOpenChange, onApproved, onSavingChange }: FormProps) {
  const formId = useId()
  const data = suggestion.payload.kind === "create_task" ? suggestion.payload.data : null
  const [title, setTitle] = useState(data?.title ?? suggestion.title ?? "")
  const [description, setDescription] = useState(data?.description ?? "")
  const [priority, setPriority] = useState<Priority>(data?.priority ?? "media")
  const [assignedRole, setAssignedRole] = useState<string>(data?.assigned_role ?? NONE)
  const [dueDays, setDueDays] = useState(String(data?.due_in_days ?? 7))
  const [rows, setRows] = useState<Row[]>(() => (data?.checklist ?? []).map((text, i) => ({ key: i, text })))
  const [nextKey, setNextKey] = useState((data?.checklist ?? []).length)
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const due = Number(dueDays)
  const dueValid = dueDays.trim() !== "" && Number.isInteger(due) && due >= 0 && due <= LIMITS.maxDueInDays
  const dueDate = dueValid ? formatDateCL(addDaysISO(todayISO(), due)) : null
  const criticalBlocked = priority === "critica" && !can(role, "ai.review_critical")

  function addRow() {
    if (rows.length >= LIMITS.checklistItems) return
    setRows((r) => [...r, { key: nextKey, text: "" }])
    setNextKey((k) => k + 1)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!data) {
      setError("La sugerencia no tiene datos de tarea válidos.")
      return
    }
    const t = title.trim()
    if (t.length < LIMITS.titleMin) return setError(`El título debe tener al menos ${LIMITS.titleMin} caracteres.`)
    if (t.length > LIMITS.titleMax) return setError(`El título admite como máximo ${LIMITS.titleMax} caracteres.`)
    if (!dueValid) return setError(`El plazo debe ser un número entero de días entre 0 y ${LIMITS.maxDueInDays}.`)
    if (criticalBlocked) return setError("Tu rol no puede aprobar tareas de prioridad crítica.")
    const checklist = rows.map((r) => r.text.trim()).filter(Boolean)
    if (checklist.some((c) => c.length > LIMITS.checklistItem)) {
      return setError(`Cada ítem del checklist admite como máximo ${LIMITS.checklistItem} caracteres.`)
    }
    setError(null)
    setSaving(true)
    onSavingChange(true)
    const res = await callAction(() =>
      approveObraSuggestion(suggestion.id, {
        edited_payload: {
          ...data,
          title: t,
          description: description.trim(),
          priority,
          assigned_role: assignedRole === NONE ? null : (assignedRole as ObraRole),
          due_in_days: due,
          checklist,
        },
        notes: notes.trim() || undefined,
      }),
    )
    setSaving(false)
    onSavingChange(false)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    onApproved?.(res.data)
    onOpenChange(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-title`}>Título de la tarea</Label>
        <Input
          id={`${formId}-title`}
          value={title}
          maxLength={LIMITS.titleMax}
          onChange={(e) => setTitle(e.target.value)}
          className="h-10"
          required
          aria-invalid={Boolean(error) && title.trim().length < LIMITS.titleMin}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-desc`}>Descripción</Label>
        <Textarea
          id={`${formId}-desc`}
          value={description}
          maxLength={LIMITS.description}
          rows={5}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-priority`}>Prioridad</Label>
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger id={`${formId}-priority`} className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...PRIORITIES].reverse().map((p) => (
                <SelectItem key={p} value={p} className="min-h-10">
                  {PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${formId}-role`}>Responsable (rol)</Label>
          <Select value={assignedRole} onValueChange={setAssignedRole}>
            <SelectTrigger id={`${formId}-role`} className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} className="min-h-10">
                Sin responsable definido
              </SelectItem>
              {OBRA_ROLES.filter((r) => r !== "visita").map((r) => (
                <SelectItem key={r} value={r} className="min-h-10">
                  {OBRA_ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-due`}>Plazo (días desde hoy)</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id={`${formId}-due`}
            type="number"
            inputMode="numeric"
            min={0}
            max={LIMITS.maxDueInDays}
            step={1}
            value={dueDays}
            onChange={(e) => setDueDays(e.target.value)}
            className="h-10 w-28"
            aria-describedby={`${formId}-due-hint`}
          />
          <span id={`${formId}-due-hint`} className="text-sm text-muted-foreground">
            {dueDate ? (due === 0 ? `Vence hoy (${dueDate})` : `Vencerá el ${dueDate}`) : "Indica un número de días válido."}
          </span>
        </div>
      </div>

      <fieldset className="min-w-0 space-y-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          <ListChecks className="h-4 w-4" aria-hidden />
          Checklist ({rows.length}/{LIMITS.checklistItems})
        </legend>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Sin ítems. Puedes agregar pasos a verificar.</p> : null}
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-2">
              <Input
                value={r.text}
                maxLength={LIMITS.checklistItem}
                onChange={(e) => setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, text: e.target.value } : x)))}
                className="h-10"
                aria-label={`Ítem ${i + 1} del checklist`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0"
                onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                aria-label={`Quitar ítem ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={addRow}
          disabled={rows.length >= LIMITS.checklistItems}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Agregar ítem
        </Button>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-notes`}>Nota para la auditoría (opcional)</Label>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          maxLength={LIMITS.notes}
          rows={2}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej.: Se acorta el plazo porque llueve el fin de semana."
        />
      </div>

      {criticalBlocked ? (
        <p className="flex items-start gap-2 rounded-[10px] bg-danger-tint px-3 py-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Las tareas de prioridad crítica solo las aprueba un perfil autorizado para sugerencias críticas.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" disabled={saving} onClick={() => onOpenChange(false)}>
          Volver
        </Button>
        <Button type="submit" className="h-10" disabled={saving || criticalBlocked}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          Aprobar y anotar en la próxima revisión
        </Button>
      </DialogFooter>
    </form>
  )
}

function SeveritySuggestionForm({ suggestion, role, onOpenChange, onApproved, onSavingChange }: FormProps) {
  const formId = useId()
  const data = suggestion.payload.kind === "update_finding_severity" ? suggestion.payload.data : null
  const from: Severity = data?.from ?? "medium"
  const options = SEVERITIES.filter((s) => s !== from)
  const [to, setTo] = useState<Severity>(data?.to && data.to !== from ? data.to : options[options.length - 1])
  const [reason, setReason] = useState(data?.reason ?? "")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const criticalBlocked = to === "critical" && !can(role, "ai.review_critical")

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!data) return setError("La sugerencia no tiene datos válidos.")
    const r = reason.trim()
    if (!r) return setError("Indica el motivo del cambio de severidad.")
    if (r.length > LIMITS.reason) return setError(`El motivo admite como máximo ${LIMITS.reason} caracteres.`)
    if (criticalBlocked) return setError("Tu rol no puede aprobar cambios a severidad crítica.")
    setError(null)
    setSaving(true)
    onSavingChange(true)
    const res = await callAction(() =>
      approveObraSuggestion(suggestion.id, {
        edited_payload: { ...data, to, reason: r },
        notes: notes.trim() || undefined,
      }),
    )
    setSaving(false)
    onSavingChange(false)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    onApproved?.(res.data)
    onOpenChange(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm">
        Severidad actual: <span className="font-semibold">{SEVERITY_LABELS[from]}</span>
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-to`}>Nueva severidad</Label>
        <Select value={to} onValueChange={(v) => setTo(v as Severity)}>
          <SelectTrigger id={`${formId}-to`} className="h-10 w-full sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((s) => (
              <SelectItem key={s} value={s} className="min-h-10">
                {SEVERITY_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-reason`}>Motivo</Label>
        <Textarea
          id={`${formId}-reason`}
          value={reason}
          maxLength={LIMITS.reason}
          rows={4}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-notes`}>Nota para la auditoría (opcional)</Label>
        <Textarea id={`${formId}-notes`} value={notes} maxLength={LIMITS.notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {criticalBlocked ? (
        <p className="flex items-start gap-2 rounded-[10px] bg-danger-tint px-3 py-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Subir a severidad crítica solo lo aprueba un perfil autorizado para sugerencias críticas.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" disabled={saving} onClick={() => onOpenChange(false)}>
          Volver
        </Button>
        <Button type="submit" className="h-10" disabled={saving || criticalBlocked}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          Aprobar cambio de severidad
        </Button>
      </DialogFooter>
    </form>
  )
}
