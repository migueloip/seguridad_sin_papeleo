"use client"

/**
 * Panel de contexto de un hallazgo ubicado en el plano (getObraFindingContext):
 * - encabezado (título, severidad, categoría, estado, ubicación);
 * - "Contexto en planos": correlaciones deterministas con los elementos de
 *   las capas cercanas (describeCorrelation + hipótesis), con el color de su
 *   especialidad;
 * - sugerencias pendientes (SuggestionCard) con el botón "Anotar en tareas de
 *   la próxima revisión";
 * - "Analizar con IA" (ai.request): la IA solo propone, una persona aprueba;
 * - tareas ya creadas para el hallazgo e historial de sugerencias.
 *
 * Exporta también useFindingContext, que carga el contexto para que el
 * espacio de planos comparta las correlaciones con el lienzo.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"
import { ClipboardList, Crosshair, History, Layers, Loader2, RotateCw, Sparkles, TriangleAlert, Upload, X } from "lucide-react"
import { analyzeObraFinding, getObraFindingContext } from "@/app/actions/obra/pins"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { describeCorrelation } from "@/lib/obra/correlation"
import { can } from "@/lib/obra/permissions"
import {
  DISCIPLINE_COLORS,
  DISCIPLINE_LABELS,
  FINDING_CATEGORY_LABELS,
  type AiSuggestion,
  type Correlation,
  type FindingPin,
  type ObraRole,
  type ObraTask,
  type PlanLayer,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { PriorityBadge, SeverityBadge } from "./badges"
import { levelLabel } from "./plan-canvas"
import { RELATION_LABELS, SuggestionCard } from "./suggestion-card"
import { callAction, TaskCard, TimeAgo } from "./task-card"

export type FindingContextData = {
  pin: FindingPin
  correlations: Correlation[]
  suggestions: AiSuggestion[]
  tasks: ObraTask[]
  /** Posiciones de las fotos del hallazgo (se sirven con control de acceso en /api/obra/findings/[id]/photo). */
  photo_indexes?: number[]
}

export type FindingContextState = {
  findingId: number | null
  data: FindingContextData | null
  loading: boolean
  error: string | null
  reload: () => void
  /** Actualiza localmente los datos cargados (p.ej. tras aprobar una sugerencia). */
  update: (fn: (d: FindingContextData) => FindingContextData) => void
}

export const FINDING_STATUS_LABELS: Record<FindingPin["status"], string> = {
  open: "Abierto",
  in_progress: "En proceso",
  resolved: "Resuelto",
  closed: "Cerrado",
}

/** Carga (y recarga) el contexto del hallazgo seleccionado. */
export function useFindingContext(findingId: number | null): FindingContextState {
  const [state, setState] = useState<{
    id: number | null
    data: FindingContextData | null
    loading: boolean
    error: string | null
  }>({ id: null, data: null, loading: false, error: null })
  const reqRef = useRef(0)

  const load = useCallback(async (id: number) => {
    const req = ++reqRef.current
    setState((s) => ({ id, data: s.id === id ? s.data : null, loading: true, error: null }))
    const res = await callAction(() => getObraFindingContext(id))
    if (req !== reqRef.current) return
    if (res.ok === false) setState({ id, data: null, loading: false, error: res.error })
    else setState({ id, data: res.data, loading: false, error: null })
  }, [])

  useEffect(() => {
    if (findingId == null) {
      reqRef.current++
      setState({ id: null, data: null, loading: false, error: null })
      return
    }
    void load(findingId)
  }, [findingId, load])

  const reload = useCallback(() => {
    if (findingId != null) void load(findingId)
  }, [findingId, load])

  const update = useCallback((fn: (d: FindingContextData) => FindingContextData) => {
    setState((s) => (s.data ? { ...s, data: fn(s.data) } : s))
  }, [])

  const current = state.id === findingId
  return {
    findingId,
    data: current ? state.data : null,
    loading: current ? state.loading : findingId != null,
    error: current ? state.error : null,
    reload,
    update,
  }
}

export type FindingContextPanelProps = {
  projectId: number
  role: ObraRole
  currentUserId: number
  today?: string
  context: FindingContextState
  /** Capas de la obra (nombre, especialidad y nivel para mostrar la ubicación). */
  layers: PlanLayer[]
  onClose?: () => void
  /** Algo cambió fuera del panel (severidad del hallazgo, sugerencias): recargar pines. */
  onDataChanged?: () => void
  /** Abrir la subida de capas (solo si el rol gestiona planos). */
  onRequestUpload?: () => void
  /** Centrar el plano en el hallazgo. */
  onShowOnPlan?: () => void
  className?: string
}

export function FindingContextPanel({
  projectId,
  role,
  currentUserId,
  today,
  context,
  layers,
  onClose,
  onDataChanged,
  onRequestUpload,
  onShowOnPlan,
  className,
}: FindingContextPanelProps) {
  const baseId = useId()
  const [analyzing, setAnalyzing] = useState(false)
  const { data, loading, error } = context

  if (!data) {
    return (
      <div className={cn("space-y-3", className)}>
        <PanelHeaderBar onClose={onClose} title="Hallazgo" />
        {error ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>No se pudo cargar el hallazgo</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <Button type="button" variant="outline" className="mt-2 h-10" onClick={context.reload}>
                <RotateCw className="h-4 w-4" aria-hidden />
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 py-8 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Cargando el contexto del hallazgo…
          </div>
        )}
      </div>
    )
  }

  const { pin, correlations, suggestions, tasks } = data
  const layer = layers.find((l) => l.id === pin.layer_id) ?? null
  const layersById = new Map(layers.map((l) => [l.id, l]))
  const pending = suggestions.filter((s) => s.status === "pending")
  const history = suggestions.filter((s) => s.status !== "pending")
  const canAi = can(role, "ai.request")
  const canManagePlans = can(role, "plans.manage")

  function replaceSuggestion(updated: AiSuggestion, applied: boolean) {
    context.update((d) => ({ ...d, suggestions: d.suggestions.map((s) => (s.id === updated.id ? updated : s)) }))
    if (applied) {
      // Puede haber una tarea nueva o una severidad distinta: se recarga todo.
      context.reload()
      onDataChanged?.()
    }
  }

  async function analyzeWithAi() {
    setAnalyzing(true)
    const res = await callAction(() => analyzeObraFinding(pin.finding_id, { use_ai: true }))
    setAnalyzing(false)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    const n = res.data.suggestions.length
    const note = res.data.suggestions.flatMap((s) => (Array.isArray(s.evidence?.notes) ? s.evidence.notes : []))[0]
    if (n === 0) {
      toast.info(
        res.data.correlations.length > 0
          ? "No hay sugerencias nuevas: lo relacionado ya tiene tareas abiertas o solo es contexto (se muestra en este panel)."
          : "El análisis no encontró elementos relacionados: no se crearon sugerencias.",
      )
    } else {
      toast.success(
        `Listo: ${n} sugerencia${n === 1 ? "" : "s"} nueva${n === 1 ? "" : "s"}, pendiente${n === 1 ? "" : "s"} de aprobación.`,
        note ? { description: note } : undefined,
      )
    }
    context.reload()
    onDataChanged?.()
  }

  return (
    <div className={cn("space-y-4", className)} aria-busy={loading}>
      {/* Encabezado */}
      <section aria-labelledby={`${baseId}-title`} className="rounded-[14px] border border-border bg-card p-3.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              Hallazgo n.º {pin.finding_id}
              {loading ? <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" aria-label="Actualizando" /> : null}
            </p>
            <h2 id={`${baseId}-title`} className="mt-0.5 break-words font-display text-lg font-semibold leading-snug">
              {pin.title}
            </h2>
          </div>
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 shrink-0"
              onClick={onClose}
              aria-label="Cerrar el detalle del hallazgo"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={pin.severity} />
          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold">
            {FINDING_CATEGORY_LABELS[pin.category] ?? pin.category}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
              pin.status === "resolved" || pin.status === "closed"
                ? "bg-success-tint text-success"
                : "border border-border text-muted-foreground",
            )}
          >
            {FINDING_STATUS_LABELS[pin.status] ?? pin.status}
          </span>
        </div>
        {pin.description ? (
          <p className="mt-2 whitespace-pre-line break-words text-[13px] text-muted-foreground">{pin.description}</p>
        ) : null}
        {data.photo_indexes && data.photo_indexes.length > 0 ? (
          <ul className="mt-2.5 flex flex-wrap gap-2" aria-label="Fotos del hallazgo">
            {data.photo_indexes.map((photoIndex, i) => {
              const src = `/api/obra/findings/${pin.finding_id}/photo?index=${photoIndex}`
              return (
                <li key={photoIndex}>
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-[10px] border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Abrir la foto ${i + 1} del hallazgo en otra pestaña`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- imagen privada servida con sesión */}
                    <img src={src} alt={`Foto ${i + 1} del hallazgo`} className="h-24 w-32 object-cover" loading="lazy" />
                  </a>
                </li>
              )
            })}
          </ul>
        ) : null}
        <p className="mt-2 text-[12px] text-muted-foreground">
          Reportado <TimeAgo iso={pin.created_at} />
          {layer ? ` · ${levelLabel(layers, pin.level)} · capa «${layer.name}»` : ` · ${levelLabel(layers, pin.level)}`}
        </p>
        {onShowOnPlan ? (
          <Button type="button" variant="outline" className="mt-2.5 h-10 rounded-[10px]" onClick={onShowOnPlan}>
            <Crosshair className="h-4 w-4" aria-hidden />
            Centrar en el plano
          </Button>
        ) : null}
      </section>

      {/* Contexto en planos */}
      <section aria-labelledby={`${baseId}-ctx`} className="space-y-2">
        <h3 id={`${baseId}-ctx`} className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
          <Layers className="h-4 w-4" aria-hidden />
          Contexto en planos
        </h3>
        {correlations.length > 0 ? (
          <ul className="space-y-2">
            {correlations.map((c) => {
              const color = DISCIPLINE_COLORS[c.discipline] ?? DISCIPLINE_COLORS.otro
              const heading = describeCorrelation(c)
              // La hipótesis de las reglas parte con la misma frase del encabezado: no repetirla.
              const hypothesis = c.hypothesis?.startsWith(heading)
                ? c.hypothesis.slice(heading.length).trim()
                : c.hypothesis
              return (
                <li
                  key={`${c.element_id}-${c.rule_id}`}
                  className="rounded-[12px] border border-border border-l-4 bg-card px-3 py-2.5"
                  style={{ borderLeftColor: color }}
                >
                  <p className="break-words text-[13px] font-medium">{heading}</p>
                  {hypothesis ? (
                    <p className="mt-1 break-words text-[12.5px] text-muted-foreground">{hypothesis}</p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-semibold">
                      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
                      {DISCIPLINE_LABELS[c.discipline] ?? c.discipline}
                    </span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold">
                      {RELATION_LABELS[c.relation] ?? c.relation}
                    </span>
                    <PriorityBadge priority={c.priority} />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="rounded-[12px] border border-dashed border-border bg-card px-3 py-3 text-[13px] text-muted-foreground">
            <p>
              No hay redes ni elementos cargados cerca de este punto (ni en este nivel ni en los de arriba o abajo). Para
              que el sistema pueda cruzar el hallazgo con alcantarillado, agua, electricidad o gas, hay que subir esas
              capas con sus elementos.
            </p>
            {canManagePlans && onRequestUpload ? (
              <Button type="button" variant="outline" className="mt-2.5 h-10 rounded-[10px]" onClick={onRequestUpload}>
                <Upload className="h-4 w-4" aria-hidden />
                Subir capas de especialidades
              </Button>
            ) : null}
          </div>
        )}
      </section>

      {/* Sugerencias pendientes */}
      <section aria-labelledby={`${baseId}-sug`} className="space-y-2">
        <h3 id={`${baseId}-sug`} className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
          <Sparkles className="h-4 w-4" aria-hidden />
          Sugerencias pendientes
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{pending.length}</span>
        </h3>
        {pending.length > 0 ? (
          <div className="space-y-2.5">
            {pending.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                role={role}
                projectId={projectId}
                layer={s.layer_id != null ? layersById.get(s.layer_id) ?? null : null}
                compact
                onChanged={(updated, result) => replaceSuggestion(updated, Boolean(result))}
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No hay sugerencias pendientes para este hallazgo.</p>
        )}

        {canAi ? (
          <div className="rounded-[12px] border border-border bg-secondary/50 p-3">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full rounded-[10px] bg-card"
              disabled={analyzing || correlations.length === 0}
              onClick={analyzeWithAi}
            >
              {analyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4 text-brand" aria-hidden />
              )}
              {analyzing ? "Analizando…" : "Analizar con IA"}
            </Button>
            <p className="mt-2 text-[12px] text-muted-foreground">
              La IA solo propone; una persona autorizada debe aprobar.{" "}
              {correlations.length === 0
                ? "Sin elementos cercanos en los planos no hay nada que analizar."
                : "Un nuevo análisis reemplaza las sugerencias pendientes de este hallazgo."}
            </p>
          </div>
        ) : null}
      </section>

      {/* Tareas */}
      <section aria-labelledby={`${baseId}-tasks`} className="space-y-2">
        <h3 id={`${baseId}-tasks`} className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
          <ClipboardList className="h-4 w-4" aria-hidden />
          Tareas de este hallazgo
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{tasks.length}</span>
        </h3>
        {tasks.length > 0 ? (
          <div className="space-y-2.5">
            {tasks.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                role={role}
                currentUserId={currentUserId}
                today={today}
                compact
                hidePlanLink
                onChanged={(updated) =>
                  context.update((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === updated.id ? updated : x)) }))
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Aún no hay tareas para este hallazgo.
            {pending.some((s) => s.kind === "create_task") && can(role, "ai.review")
              ? " Aprueba una sugerencia para anotarla en la próxima revisión."
              : ""}
          </p>
        )}
      </section>

      {/* Historial */}
      {history.length > 0 ? (
        <details className="group rounded-[14px] border border-border bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-[14px] px-3.5 text-sm font-semibold outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <History className="h-4 w-4" aria-hidden />
            Historial de sugerencias
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{history.length}</span>
            <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">Ver</span>
          </summary>
          <div className="space-y-2.5 p-3 pt-0">
            {history.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                role={role}
                projectId={projectId}
                layer={s.layer_id != null ? layersById.get(s.layer_id) ?? null : null}
                compact
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function PanelHeaderBar({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="font-display text-[15px] font-semibold">{title}</p>
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10"
          onClick={onClose}
          aria-label="Cerrar el detalle del hallazgo"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}
