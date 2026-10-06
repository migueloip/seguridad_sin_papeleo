"use client"

/**
 * Revisión de una sugerencia `plan_elements` (elementos que la IA de visión
 * detectó en la lámina de una capa). El revisor ve la propuesta superpuesta a
 * la imagen de la capa, marca o desmarca cada elemento (o un tipo completo) y
 * aprueba solo los elegidos. Nada se incorpora al plano sin esta aprobación.
 *
 * También exporta ElementsPreviewSvg: vista previa simple (sin zoom) de
 * borradores de elementos en coordenadas normalizadas, que reutiliza la
 * importación DXF.
 */
import { useId, useMemo, useState } from "react"
import { toast } from "sonner"
import { CheckCircle2, ChevronDown, Layers, Loader2 } from "lucide-react"
import { approveObraSuggestion } from "@/app/actions/obra/suggestions"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  DISCIPLINE_LABELS,
  ELEMENT_TYPE_LABELS,
  type AiSuggestion,
  type Discipline,
  type ElementGeometry,
  type ElementType,
  type PlanElementDraft,
  type PlanLayer,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { elementColor, formatNumberCL } from "./plan-canvas"
import { callAction } from "./task-card"

export type ApproveSuggestionResult = {
  suggestion: AiSuggestion
  applied_entity_type: string | null
  applied_entity_id: number | null
  /** Revisión donde quedó anotada la tarea (solo tareas). */
  inspection?: { id: number; title: string; scheduled_for: string } | null
}

const PREVIEW_WIDTH = 1000

function previewPath(g: ElementGeometry, w: number, h: number): string {
  const pts = g?.points ?? []
  if (pts.length === 0) return ""
  const f = (n: number) => String(Math.round(n * 10) / 10)
  if (g.type === "point") return `M${f(pts[0].x * w)} ${f(pts[0].y * h)}l0.1 0`
  let d = ""
  for (let i = 0; i < pts.length; i++) d += `${i === 0 ? "M" : "L"}${f(pts[i].x * w)} ${f(pts[i].y * h)}`
  return g.type === "polygon" ? `${d}Z` : d
}

/**
 * Vista previa de borradores de elementos sobre la lámina (opcionalmente con
 * su imagen). Con `selected` muestra en gris los desmarcados; con `onToggle`
 * cada elemento se puede marcar o desmarcar tocándolo.
 */
export function ElementsPreviewSvg({
  elements,
  aspect,
  imageHref,
  discipline,
  selected,
  highlightIndex,
  onToggle,
  className,
  ariaLabel = "Vista previa de los elementos",
}: {
  elements: PlanElementDraft[]
  aspect: number
  imageHref?: string | null
  /** Disciplina de la capa (colorea los tipos genéricos). */
  discipline?: Discipline | null
  selected?: boolean[] | null
  highlightIndex?: number | null
  onToggle?: (index: number) => void
  className?: string
  ariaLabel?: string
}) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? Math.min(100, Math.max(0.01, aspect)) : 0.7
  const h = PREVIEW_WIDTH * safeAspect
  const paths = useMemo(
    () =>
      elements.map((el, i) => ({
        i,
        kind: el.geometry?.type ?? "polyline",
        d: previewPath(el.geometry, PREVIEW_WIDTH, h),
        color: elementColor(el, discipline ? { discipline } : null),
      })),
    [elements, h, discipline],
  )

  return (
    <svg
      viewBox={`0 0 ${PREVIEW_WIDTH} ${h}`}
      className={cn("h-auto w-full rounded-[10px] border border-border bg-[#fbfaf6] dark:bg-[#1a160f]", className)}
      role="img"
      aria-label={ariaLabel}
    >
      {imageHref ? (
        <image href={imageHref} x={0} y={0} width={PREVIEW_WIDTH} height={h} preserveAspectRatio="none" opacity={0.55} />
      ) : (
        <rect
          x={0}
          y={0}
          width={PREVIEW_WIDTH}
          height={h}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeDasharray="6 5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {paths.map((p) => {
        const on = !selected || selected[p.i] !== false
        const hl = highlightIndex === p.i
        return (
          <path
            key={p.i}
            d={p.d}
            fill={p.kind === "polygon" && on ? p.color : "none"}
            fillOpacity={p.kind === "polygon" ? 0.12 : undefined}
            stroke={on ? p.color : "#9ca3af"}
            strokeOpacity={on ? 1 : 0.55}
            strokeWidth={p.kind === "point" ? (hl ? 14 : 9) : hl ? 5 : 2.25}
            strokeDasharray={on || p.kind === "point" ? undefined : "4 4"}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )
      })}
      {onToggle
        ? paths.map((p) => (
            <path
              key={`hit-${p.i}`}
              d={p.d}
              fill="none"
              stroke="transparent"
              strokeWidth={p.kind === "point" ? 22 : 14}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents="stroke"
              className="cursor-pointer"
              onClick={() => onToggle(p.i)}
            />
          ))
        : null}
    </svg>
  )
}

/** Cantidad de elementos por tipo (mayor primero). */
export function countByType(elements: Pick<PlanElementDraft, "element_type">[]): { type: ElementType; count: number }[] {
  const m = new Map<ElementType, number>()
  for (const el of elements) m.set(el.element_type, (m.get(el.element_type) ?? 0) + 1)
  return [...m.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)
}

export type ExtractionReviewDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  suggestion: AiSuggestion
  /** Capa de la sugerencia (para su imagen y proporción); null si ya no existe. */
  layer?: PlanLayer | null
  /** true si el rol puede aprobar y la sugerencia está pendiente. */
  canReview: boolean
  onApproved?: (result: ApproveSuggestionResult) => void
}

export function ExtractionReviewDialog(props: ExtractionReviewDialogProps) {
  const { open, onOpenChange, suggestion, canReview } = props
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-[920px]">
        <DialogHeader>
          <DialogTitle>{canReview ? "Revisar elementos detectados" : "Elementos propuestos"}</DialogTitle>
          <DialogDescription className="break-words">
            {suggestion.title}
            {canReview
              ? ". Desmarca lo que no corresponda (también puedes tocar el elemento en la vista previa) y aprueba solo lo correcto."
              : "."}
          </DialogDescription>
        </DialogHeader>
        {open ? <ExtractionReviewBody {...props} onSavingChange={setSaving} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ExtractionReviewBody({
  suggestion,
  layer,
  canReview,
  onOpenChange,
  onApproved,
  onSavingChange,
}: ExtractionReviewDialogProps & { onSavingChange: (saving: boolean) => void }) {
  const baseId = useId()
  const data = suggestion.payload.kind === "plan_elements" ? suggestion.payload.data : null
  const drafts = useMemo<PlanElementDraft[]>(() => (Array.isArray(data?.elements) ? data.elements : []), [data])
  const layerId = data?.layer_id ?? suggestion.layer_id
  const [selected, setSelected] = useState<boolean[]>(() => drafts.map(() => true))
  const [expanded, setExpanded] = useState<ElementType | null>(null)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  const groups = useMemo(() => {
    const m = new Map<ElementType, number[]>()
    drafts.forEach((el, i) => {
      const list = m.get(el.element_type)
      if (list) list.push(i)
      else m.set(el.element_type, [i])
    })
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [drafts])

  const chosenCount = selected.filter(Boolean).length
  const aspect = layer?.frame.aspect ?? 0.7
  const imageHref = layer?.has_image ? `/api/obra/layers/${layer.id}/image` : null

  function toggle(i: number) {
    if (!canReview) return
    setSelected((prev) => prev.map((v, k) => (k === i ? !v : v)))
  }

  function setGroup(indices: number[], value: boolean) {
    const set = new Set(indices)
    setSelected((prev) => prev.map((v, k) => (set.has(k) ? value : v)))
  }

  async function approve() {
    if (!data || layerId == null) {
      toast.error("La sugerencia no tiene datos válidos para aprobar.")
      return
    }
    const chosen = drafts.filter((_, i) => selected[i])
    if (chosen.length === 0) {
      toast.error("Selecciona al menos un elemento o descarta la sugerencia.")
      return
    }
    setSaving(true)
    onSavingChange(true)
    const res = await callAction(() =>
      approveObraSuggestion(suggestion.id, {
        edited_payload: { layer_id: layerId, elements: chosen },
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

  if (drafts.length === 0) {
    return (
      <>
        <p className="rounded-[10px] border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Esta sugerencia no trae elementos para revisar.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-10" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-2">
          <ElementsPreviewSvg
            elements={drafts}
            aspect={aspect}
            imageHref={imageHref}
            discipline={layer?.discipline ?? null}
            selected={selected}
            highlightIndex={highlight}
            onToggle={canReview ? toggle : undefined}
            ariaLabel={`Vista previa: ${chosenCount} de ${drafts.length} elementos seleccionados`}
          />
          <p className="text-xs text-muted-foreground">
            {layer ? (
              <>
                <Layers className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                Capa «{layer.name}» · {DISCIPLINE_LABELS[layer.discipline]}
              </>
            ) : (
              "La capa de esta sugerencia ya no está disponible."
            )}
            {" · "}Las coordenadas son aproximadas: verifica que calcen con la lámina.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {canReview ? `${chosenCount} de ${drafts.length} seleccionados` : `${drafts.length} elementos`}
            </p>
            {canReview ? (
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setSelected(drafts.map(() => true))}
                >
                  Todos
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setSelected(drafts.map(() => false))}
                >
                  Ninguno
                </Button>
              </div>
            ) : null}
          </div>
          <ul className="max-h-[46dvh] space-y-1.5 overflow-y-auto pr-1">
            {groups.map(([type, indices]) => {
              const on = indices.filter((i) => selected[i]).length
              const groupId = `${baseId}-g-${type}`
              const open = expanded === type
              const color = elementColor({ element_type: type }, layer ?? null)
              return (
                <li key={type} className="rounded-[10px] border border-border bg-card">
                  <div className="flex min-h-11 items-center gap-2 px-2">
                    {canReview ? (
                      <Checkbox
                        id={groupId}
                        checked={on === indices.length ? true : on === 0 ? false : "indeterminate"}
                        onCheckedChange={(v) => setGroup(indices, v === true)}
                        className="size-5"
                        aria-label={`Seleccionar todos: ${ELEMENT_TYPE_LABELS[type]}`}
                      />
                    ) : null}
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                    <label htmlFor={canReview ? groupId : undefined} className="min-w-0 flex-1 text-[13px] font-medium">
                      {ELEMENT_TYPE_LABELS[type] ?? type}
                      <span className="ml-1 text-muted-foreground">
                        {canReview ? `${on} de ${indices.length}` : indices.length}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : type)}
                      aria-expanded={open}
                      aria-controls={`${groupId}-list`}
                      aria-label={`${open ? "Ocultar" : "Ver"} elementos: ${ELEMENT_TYPE_LABELS[type]}`}
                      className="flex size-10 items-center justify-center rounded-[10px] outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
                    </button>
                  </div>
                  {open ? (
                    <ul id={`${groupId}-list`} className="space-y-0.5 border-t border-border px-2 py-1.5">
                      {indices.map((i, k) => {
                        const el = drafts[i]
                        const rowId = `${baseId}-e-${i}`
                        return (
                          <li
                            key={i}
                            className="flex min-h-10 items-center gap-2 rounded-[8px] px-1 hover:bg-secondary"
                            onMouseEnter={() => setHighlight(i)}
                            onMouseLeave={() => setHighlight(null)}
                          >
                            {canReview ? (
                              <Checkbox
                                id={rowId}
                                checked={selected[i]}
                                onCheckedChange={() => toggle(i)}
                                onFocus={() => setHighlight(i)}
                                onBlur={() => setHighlight(null)}
                                className="size-5"
                              />
                            ) : null}
                            <label htmlFor={canReview ? rowId : undefined} className="min-w-0 flex-1 truncate text-[12.5px]">
                              {el.label ? `«${el.label}»` : `Elemento ${k + 1}`}
                              {typeof el.confidence === "number" ? (
                                <span className="ml-1 text-muted-foreground">
                                  · confianza {formatNumberCL(el.confidence * 100, 0)} %
                                </span>
                              ) : null}
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {canReview ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${baseId}-notes`}>Nota para la auditoría (opcional)</Label>
          <Textarea
            id={`${baseId}-notes`}
            value={notes}
            maxLength={1000}
            rows={2}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej.: Se descartaron líneas de cotas que la IA confundió con tuberías."
          />
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" disabled={saving} onClick={() => onOpenChange(false)}>
          {canReview ? "Volver" : "Cerrar"}
        </Button>
        {canReview ? (
          <Button type="button" className="h-10" disabled={saving || chosenCount === 0} onClick={approve}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
            Aprobar {chosenCount === drafts.length ? "todos" : `${chosenCount} seleccionados`}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}
