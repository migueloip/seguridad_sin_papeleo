"use client"

/**
 * Tablero de tareas de la obra: columnas por estado (Pendiente, En progreso,
 * Hecha; las canceladas van plegadas). En escritorio son columnas tipo kanban
 * y en el celular quedan como una lista agrupada por estado.
 *
 * Los filtros (mis tareas, prioridad, revisión) se aplican en el navegador
 * sobre las tareas que el servidor ya filtró según el rol.
 */
import { useMemo, useState } from "react"
import { ChevronDown, ClipboardList, Filter, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { todayISO } from "@/lib/obra/metrics"
import { can } from "@/lib/obra/permissions"
import {
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type ObraInspection,
  type ObraMember,
  type ObraRole,
  type ObraTask,
  type Priority,
  type TaskStatus,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { formatDateCL, isOwnTaskFor, isTaskOverdue, TaskCard } from "./task-card"
import { TaskFormDialog } from "./task-form-dialog"

const ALL = "all"
const NO_INSPECTION = "none"
const DONE_PAGE = 10

const COLUMNS: { status: TaskStatus; dot: string; empty: string }[] = [
  { status: "pendiente", dot: "bg-muted-foreground", empty: "No hay tareas pendientes." },
  { status: "en_progreso", dot: "bg-warning", empty: "Nadie está trabajando en una tarea ahora." },
  { status: "hecha", dot: "bg-success", empty: "Aún no se cierra ninguna tarea." },
]

export type TasksBoardFilter = {
  mine?: boolean
  priority?: Priority | null
  /** id de revisión, "none" = sin revisión. */
  inspection?: number | "none" | null
}

export function TasksBoard({
  projectId,
  role,
  currentUserId,
  initialTasks,
  members,
  inspections,
  initialFilter,
  today: todayProp,
}: {
  projectId: number
  role: ObraRole
  currentUserId: number
  initialTasks: ObraTask[]
  members: ObraMember[]
  inspections: ObraInspection[]
  initialFilter?: TasksBoardFilter
  /** Fecha de hoy "YYYY-MM-DD" calculada en el servidor. */
  today?: string
}) {
  const today = todayProp ?? todayISO()
  const canManage = can(role, "tasks.manage")
  const viewAll = can(role, "tasks.view_all")

  // Estado local sincronizado con las props: cuando el servidor revalida, manda la lista fresca.
  const [prevInitial, setPrevInitial] = useState(initialTasks)
  const [tasks, setTasks] = useState(initialTasks)
  if (initialTasks !== prevInitial) {
    setPrevInitial(initialTasks)
    setTasks(initialTasks)
  }

  const [mine, setMine] = useState(Boolean(initialFilter?.mine))
  const [priority, setPriority] = useState<string>(initialFilter?.priority ?? ALL)
  const [inspection, setInspection] = useState<string>(
    initialFilter?.inspection == null ? ALL : String(initialFilter.inspection),
  )
  const [showCancelled, setShowCancelled] = useState(false)
  const [showAllDone, setShowAllDone] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ObraTask | null>(null)

  const inspectionTitles = useMemo(() => new Map(inspections.map((i) => [i.id, i.title])), [inspections])

  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (mine && !isOwnTaskFor(t, currentUserId, role)) return false
        if (priority !== ALL && t.priority !== priority) return false
        if (inspection === NO_INSPECTION && t.inspection_id != null) return false
        if (inspection !== ALL && inspection !== NO_INSPECTION && t.inspection_id !== Number(inspection)) return false
        return true
      }),
    [tasks, mine, priority, inspection, currentUserId, role],
  )

  const byStatus = useMemo(() => {
    const groups: Record<TaskStatus, ObraTask[]> = { pendiente: [], en_progreso: [], hecha: [], cancelada: [] }
    for (const t of filtered) groups[t.status]?.push(t)
    // Hechas: las más recientes primero.
    groups.hecha.sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at))
    return groups
  }, [filtered])

  const openCount = byStatus.pendiente.length + byStatus.en_progreso.length
  const overdueCount = filtered.filter((t) => isTaskOverdue(t, today)).length
  const filtersActive = mine || priority !== ALL || inspection !== ALL

  function upsert(task: ObraTask) {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id)
      if (idx === -1) return [task, ...prev]
      const copy = [...prev]
      copy[idx] = task
      return copy
    })
  }

  function clearFilters() {
    setMine(false)
    setPriority(ALL)
    setInspection(ALL)
  }

  function openNew() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(task: ObraTask) {
    setEditing(task)
    setFormOpen(true)
  }

  const cardProps = {
    role,
    currentUserId,
    today,
    compact: true,
    onChanged: upsert,
    onEdit: canManage ? openEdit : undefined,
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">Tareas</h2>
          <p className="text-sm text-muted-foreground">
            {openCount} abierta{openCount === 1 ? "" : "s"}
            {overdueCount > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-danger">
                  {overdueCount} vencida{overdueCount === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
            {viewAll ? "" : " · ves las tareas asignadas a ti o a tu rol"}
          </p>
        </div>
        {canManage ? (
          <Button type="button" className="h-10 rounded-[10px]" onClick={openNew}>
            <Plus className="h-4 w-4" aria-hidden />
            Nueva tarea
          </Button>
        ) : null}
      </div>

      {/* Filtros */}
      <div
        role="group"
        aria-label="Filtros de tareas"
        className="flex flex-wrap items-end gap-3 rounded-[14px] border border-border bg-card p-3"
      >
        <Filter className="mb-3 hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
        {viewAll ? (
          <Button
            type="button"
            variant="outline"
            aria-pressed={mine}
            onClick={() => setMine((v) => !v)}
            className={cn("h-10 rounded-[10px]", mine && "border-brand bg-brand/15 hover:bg-brand/20")}
          >
            Mis tareas
          </Button>
        ) : null}
        <div className="min-w-[150px] flex-1 space-y-1 sm:flex-none">
          <Label htmlFor="tasks-filter-priority" className="text-xs text-muted-foreground">
            Prioridad
          </Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger id="tasks-filter-priority" className="h-10 w-full sm:w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="min-h-10">
                Todas
              </SelectItem>
              {[...PRIORITIES].reverse().map((p) => (
                <SelectItem key={p} value={p} className="min-h-10">
                  {PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[180px] flex-1 space-y-1 sm:max-w-[320px]">
          <Label htmlFor="tasks-filter-inspection" className="text-xs text-muted-foreground">
            Revisión
          </Label>
          <Select value={inspection} onValueChange={setInspection}>
            <SelectTrigger id="tasks-filter-inspection" className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="min-h-10">
                Todas las revisiones
              </SelectItem>
              <SelectItem value={NO_INSPECTION} className="min-h-10">
                Sin revisión
              </SelectItem>
              {inspections.length > 0 ? <SelectSeparator /> : null}
              {inspections.map((i) => (
                <SelectItem key={i.id} value={String(i.id)} className="min-h-10">
                  {i.title} · {formatDateCL(i.scheduled_for)}
                  {i.status === "cerrada" ? " (cerrada)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filtersActive ? (
          <Button type="button" variant="ghost" className="h-10 rounded-[10px]" onClick={clearFilters}>
            <X className="h-4 w-4" aria-hidden />
            Quitar filtros
          </Button>
        ) : null}
      </div>

      {tasks.length === 0 ? (
        <EmptyBoard canManage={canManage} onNew={openNew} />
      ) : filtered.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-border bg-card px-5 py-10 text-center">
          <p className="font-semibold">Ninguna tarea coincide con los filtros.</p>
          <p className="mt-1 text-sm text-muted-foreground">Prueba con otra prioridad o revisión.</p>
          <Button type="button" variant="outline" className="mt-4 h-10" onClick={clearFilters}>
            Quitar filtros
          </Button>
        </div>
      ) : (
        <>
          <div className="grid items-start gap-5 md:grid-cols-3 md:gap-4">
            {COLUMNS.map((col) => {
              const list = byStatus[col.status]
              const limited = col.status === "hecha" && !showAllDone ? list.slice(0, DONE_PAGE) : list
              const headingId = `tasks-col-${col.status}`
              return (
                <section
                  key={col.status}
                  aria-labelledby={headingId}
                  className="min-w-0 rounded-[14px] md:bg-secondary/60 md:p-2.5"
                >
                  <h3 id={headingId} className="mb-2.5 flex items-center gap-2 px-1 text-sm font-semibold">
                    <span className={cn("h-2 w-2 rounded-full", col.dot)} aria-hidden />
                    {TASK_STATUS_LABELS[col.status]}
                    <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                      {list.length}
                    </span>
                  </h3>
                  {list.length === 0 ? (
                    <p className="rounded-[12px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
                      {col.empty}
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {limited.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          inspectionTitle={t.inspection_id != null ? inspectionTitles.get(t.inspection_id) ?? null : null}
                          {...cardProps}
                        />
                      ))}
                      {list.length > limited.length ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-10 w-full"
                          onClick={() => setShowAllDone(true)}
                        >
                          Ver las {list.length} tareas hechas
                        </Button>
                      ) : null}
                    </div>
                  )}
                </section>
              )
            })}
          </div>

          {byStatus.cancelada.length > 0 ? (
            <section aria-label="Tareas canceladas" className="rounded-[14px] border border-border bg-card">
              <button
                type="button"
                onClick={() => setShowCancelled((v) => !v)}
                aria-expanded={showCancelled}
                aria-controls="tasks-cancelled"
                className="flex min-h-12 w-full items-center gap-2 rounded-[14px] px-4 text-left text-sm font-semibold outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Canceladas
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                  {byStatus.cancelada.length}
                </span>
                <ChevronDown
                  className={cn("ml-auto h-4 w-4 text-muted-foreground transition-transform", showCancelled && "rotate-180")}
                  aria-hidden
                />
              </button>
              {showCancelled ? (
                <div id="tasks-cancelled" className="grid gap-2.5 p-3 pt-0 md:grid-cols-3">
                  {byStatus.cancelada.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      inspectionTitle={t.inspection_id != null ? inspectionTitles.get(t.inspection_id) ?? null : null}
                      {...cardProps}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      {canManage ? (
        <TaskFormDialog
          projectId={projectId}
          open={formOpen}
          onOpenChange={(o) => {
            setFormOpen(o)
            if (!o) setEditing(null)
          }}
          task={editing}
          members={members}
          inspections={inspections}
          onSaved={upsert}
        />
      ) : null}
    </div>
  )
}

function EmptyBoard({ canManage, onNew }: { canManage: boolean; onNew: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-[14px] border border-dashed border-border bg-card px-5 py-12 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-[14px] bg-secondary">
        <ClipboardList className="h-6 w-6 text-muted-foreground" aria-hidden />
      </span>
      <p className="font-display text-lg font-semibold">Aún no hay tareas</p>
      {canManage ? (
        <>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Crea una tarea a mano o aprueba las sugerencias de IA de los hallazgos para anotarlas en la próxima revisión.
          </p>
          <Button type="button" className="mt-4 h-10" onClick={onNew}>
            <Plus className="h-4 w-4" aria-hidden />
            Crear la primera tarea
          </Button>
        </>
      ) : (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Cuando te asignen una tarea (a ti o a tu rol) aparecerá aquí.
        </p>
      )}
    </div>
  )
}
