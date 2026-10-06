"use client"

/**
 * Herramientas de elementos de plano (permiso plans.manage):
 * - ElementDrawToolbar: dibujar un punto, una polilínea o un polígono sobre la
 *   capa activa (toques en el plano; doble toque, Enter o "Guardar elemento"
 *   para terminar; Escape cancela), con tipo, etiqueta y atributos (Ø mm,
 *   profundidad m, material). Se guarda con createObraElements(…, "manual").
 * - SelectedElementCard: ficha del elemento seleccionado con editar y
 *   eliminar (confirmación).
 * - ElementTypeSelectItems: opciones de tipo agrupadas por especialidad.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { CheckCircle2, Loader2, Pencil, Trash2, Undo2, X } from "lucide-react"
import { createObraElements, deleteObraElement, updateObraElement } from "@/app/actions/obra/elements"
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  DISCIPLINE_LABELS,
  DISCIPLINES,
  ELEMENT_TYPE_DISCIPLINE,
  ELEMENT_TYPE_LABELS,
  ELEMENT_TYPES,
  type Discipline,
  type ElementAttributes,
  type ElementGeometry,
  type ElementType,
  type NormPoint,
  type PlanElement,
  type PlanElementDraft,
  type PlanLayer,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { elementColor, elementDetails, formatNumberCL, type GeometryKind } from "./plan-canvas"
import { callAction } from "./task-card"

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export const GEOMETRY_LABELS: Record<GeometryKind, string> = {
  point: "Punto",
  polyline: "Línea",
  polygon: "Área",
}

const GEOMETRY_HINTS: Record<GeometryKind, string> = {
  point: "Toca el plano donde está el elemento (cámara, tablero, medidor, columna…).",
  polyline: "Toca cada vértice del recorrido (tubería, ducto, muro). Doble toque o «Guardar elemento» para terminar.",
  polygon: "Toca los vértices del contorno (mínimo 3). Doble toque o «Guardar elemento» para cerrar el área.",
}

const MIN_POINTS: Record<GeometryKind, number> = { point: 1, polyline: 2, polygon: 3 }

const SOURCE_LABELS: Record<PlanElement["source"], string> = {
  manual: "Dibujado a mano",
  dxf: "Importado de DXF",
  ia: "Detectado por IA y aprobado",
}

/** Límites (espejo de ELEMENT_LIMITS en lib/obra/server/elements.ts). */
const LIMITS = { label: 255, text: 500, diameterMax: 100_000, depthMax: 1_000 } as const

/** Tipo de elemento sugerido para una especialidad. */
export function defaultElementTypeFor(discipline: Discipline): ElementType {
  if (discipline === "otro") return "otro"
  return ELEMENT_TYPES.find((t) => ELEMENT_TYPE_DISCIPLINE[t] === discipline) ?? "otro"
}

const POINT_TYPES = new Set<ElementType>(["camara_inspeccion", "tablero_electrico", "medidor_gas", "columna"])
const AREA_TYPES = new Set<ElementType>(["losa", "fundacion", "excavacion"])

/** Geometría habitual de un tipo de elemento. */
export function defaultGeometryFor(type: ElementType): GeometryKind {
  if (POINT_TYPES.has(type)) return "point"
  if (AREA_TYPES.has(type)) return "polygon"
  return "polyline"
}

/** Estado del elemento que se está dibujando (coordenadas normalizadas de la capa). */
export type ElementDraftState = { layerId: number; type: GeometryKind; points: NormPoint[]; elementType: ElementType }

export function newElementDraft(layer: Pick<PlanLayer, "id" | "discipline">): ElementDraftState {
  const elementType = defaultElementTypeFor(layer.discipline)
  return { layerId: layer.id, type: defaultGeometryFor(elementType), points: [], elementType }
}

/** Quita vértices repetidos consecutivos (p.ej. por el doble toque) y el cierre duplicado de un polígono. */
export function cleanDraftPoints(points: NormPoint[], type: GeometryKind): NormPoint[] {
  const out: NormPoint[] = []
  for (const p of points) {
    const q = { x: Math.round(Math.min(1, Math.max(0, p.x)) * 1e6) / 1e6, y: Math.round(Math.min(1, Math.max(0, p.y)) * 1e6) / 1e6 }
    const last = out[out.length - 1]
    if (last && Math.hypot(last.x - q.x, last.y - q.y) < 0.0005) continue
    out.push(q)
  }
  if (type === "polygon" && out.length > 3) {
    const a = out[0]
    const b = out[out.length - 1]
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.0005) out.pop()
  }
  if (type === "point") return out.slice(-1)
  return out
}

export function draftReady(d: Pick<ElementDraftState, "type" | "points">): boolean {
  return cleanDraftPoints(d.points, d.type).length >= MIN_POINTS[d.type]
}

/** Número decimal escrito con coma o punto; null si vacío o inválido. */
function parseDecimal(s: string): number | null {
  const t = s.trim().replace(",", ".")
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

type AttrForm = { diameter: string; depth: string; material: string; notes: string }

function attrFormOf(a: ElementAttributes | null | undefined): AttrForm {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v).replace(".", ",") : "")
  return {
    diameter: num(a?.diameter_mm),
    depth: num(a?.depth_m),
    material: typeof a?.material === "string" ? a.material : "",
    notes: typeof a?.notes === "string" ? a.notes : "",
  }
}

/** Valida los atributos del formulario y los mezcla con los existentes (las claves vacías se quitan). */
function buildAttributes(f: AttrForm, base: ElementAttributes = {}): { attributes: ElementAttributes } | { error: string } {
  const out: ElementAttributes = { ...base }
  delete out.diameter_mm
  delete out.depth_m
  delete out.material
  delete out.notes
  const d = parseDecimal(f.diameter)
  if (d !== null) {
    if (!(d > 0 && d <= LIMITS.diameterMax)) return { error: "El diámetro debe ser un número mayor que 0 (en milímetros)." }
    out.diameter_mm = d
  }
  const depth = parseDecimal(f.depth)
  if (depth !== null) {
    if (!(depth > 0 && depth <= LIMITS.depthMax)) return { error: "La profundidad debe ser un número mayor que 0 (en metros)." }
    out.depth_m = depth
  }
  const material = f.material.trim()
  if (material) out.material = material.slice(0, LIMITS.text)
  const notes = f.notes.trim()
  if (notes) out.notes = notes.slice(0, LIMITS.text)
  return { attributes: out }
}

/** Opciones de tipo de elemento agrupadas por especialidad (para un SelectContent). */
export function ElementTypeSelectItems() {
  return (
    <>
      {DISCIPLINES.map((d) => {
        const types = ELEMENT_TYPES.filter((t) => ELEMENT_TYPE_DISCIPLINE[t] === d)
        if (types.length === 0) return null
        return (
          <SelectGroup key={d}>
            <SelectLabel>{DISCIPLINE_LABELS[d]}</SelectLabel>
            {types.map((t) => (
              <SelectItem key={t} value={t} className="min-h-10">
                {ELEMENT_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectGroup>
        )
      })}
    </>
  )
}

function AttributeFields({ idPrefix, value, onChange }: { idPrefix: string; value: AttrForm; onChange: (v: AttrForm) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-dia`}>Diámetro (mm)</Label>
        <Input
          id={`${idPrefix}-dia`}
          inputMode="decimal"
          value={value.diameter}
          onChange={(e) => onChange({ ...value, diameter: e.target.value })}
          placeholder="Ej.: 160"
          className="h-10"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-depth`}>Profundidad (m)</Label>
        <Input
          id={`${idPrefix}-depth`}
          inputMode="decimal"
          value={value.depth}
          onChange={(e) => onChange({ ...value, depth: e.target.value })}
          placeholder="Ej.: 1,2"
          className="h-10"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-mat`}>Material</Label>
        <Input
          id={`${idPrefix}-mat`}
          value={value.material}
          maxLength={LIMITS.text}
          onChange={(e) => onChange({ ...value, material: e.target.value })}
          placeholder="Ej.: PVC"
          className="h-10"
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barra de dibujo
// ---------------------------------------------------------------------------

export type ElementDrawToolbarProps = {
  layer: PlanLayer
  draft: ElementDraftState
  onDraftChange: (d: ElementDraftState) => void
  /** Salir del modo dibujo. */
  onCancel: () => void
  /** Se guardó el elemento (el llamador recarga los elementos). */
  onSaved: (layerId: number) => void
  /** Cambia (se incrementa) cuando hay doble toque en el plano: termina el elemento. */
  finishSignal: number
  className?: string
}

export function ElementDrawToolbar({
  layer,
  draft,
  onDraftChange,
  onCancel,
  onSaved,
  finishSignal,
  className,
}: ElementDrawToolbarProps) {
  const baseId = useId()
  const [label, setLabel] = useState("")
  const [attrs, setAttrs] = useState<AttrForm>({ diameter: "", depth: "", material: "", notes: "" })
  const [saving, setSaving] = useState(false)
  const points = cleanDraftPoints(draft.points, draft.type)
  const ready = points.length >= MIN_POINTS[draft.type]
  const color = elementColor({ element_type: draft.elementType }, layer)

  async function save() {
    if (saving) return
    const pts = cleanDraftPoints(draft.points, draft.type)
    if (pts.length < MIN_POINTS[draft.type]) {
      toast.error(
        draft.type === "point"
          ? "Toca el plano para ubicar el punto."
          : `Faltan vértices: ${draft.type === "polygon" ? "un área necesita al menos 3" : "una línea necesita al menos 2"}.`,
      )
      return
    }
    const built = buildAttributes(attrs)
    if ("error" in built) {
      toast.error(built.error)
      return
    }
    const geometry = (draft.type === "point" ? { type: "point", points: [pts[0]] } : { type: draft.type, points: pts }) as ElementGeometry
    const element: PlanElementDraft = {
      element_type: draft.elementType,
      label: label.trim().slice(0, LIMITS.label) || null,
      geometry,
      attributes: built.attributes,
    }
    setSaving(true)
    const res = await callAction(() => createObraElements(draft.layerId, [element], "manual"))
    setSaving(false)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    toast.success(`${ELEMENT_TYPE_LABELS[draft.elementType]} guardado en la capa «${layer.name}».`)
    setLabel("")
    onDraftChange({ ...draft, points: [] })
    onSaved(draft.layerId)
  }

  function undo() {
    if (draft.points.length > 0) onDraftChange({ ...draft, points: draft.points.slice(0, -1) })
  }

  // Referencias estables para los atajos de teclado y el doble toque.
  const saveRef = useRef(save)
  const undoRef = useRef(undo)
  const cancelRef = useRef(onCancel)
  useEffect(() => {
    saveRef.current = save
    undoRef.current = undo
    cancelRef.current = onCancel
  })

  const lastSignal = useRef(finishSignal)
  useEffect(() => {
    if (finishSignal === lastSignal.current) return
    lastSignal.current = finishSignal
    void saveRef.current()
  }, [finishSignal])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.("[role=dialog],[role=listbox],[role=menu]")) return
      const typing = Boolean(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
      if (e.key === "Escape") {
        cancelRef.current()
      } else if (!typing && (e.key === "Backspace" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z"))) {
        e.preventDefault()
        undoRef.current()
      } else if (!typing && e.key === "Enter") {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function changeElementType(t: ElementType) {
    onDraftChange({
      ...draft,
      elementType: t,
      type: draft.points.length === 0 ? defaultGeometryFor(t) : draft.type,
    })
  }

  function changeGeometry(g: GeometryKind) {
    onDraftChange({ ...draft, type: g, points: g === "point" ? draft.points.slice(-1) : draft.points })
  }

  return (
    <section
      aria-label="Dibujar elemento"
      className={cn("space-y-3 rounded-[14px] border border-brand/50 bg-card p-3", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">Dibujar elemento</span>{" "}
          <span className="text-muted-foreground">en la capa «{layer.name}»</span>
        </p>
        <div role="radiogroup" aria-label="Forma del elemento" className="flex rounded-[10px] bg-secondary p-1">
          {(["point", "polyline", "polygon"] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={draft.type === g}
              onClick={() => changeGeometry(g)}
              className={cn(
                "min-h-9 rounded-[8px] px-3 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                draft.type === g ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {GEOMETRY_LABELS[g]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${baseId}-type`}>Tipo de elemento</Label>
          <Select value={draft.elementType} onValueChange={(v) => changeElementType(v as ElementType)}>
            <SelectTrigger id={`${baseId}-type`} className="h-10 w-full">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <ElementTypeSelectItems />
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${baseId}-label`}>Etiqueta (opcional)</Label>
          <Input
            id={`${baseId}-label`}
            value={label}
            maxLength={LIMITS.label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ej.: C-3, colector eje B"
            className="h-10"
          />
        </div>
      </div>

      <details className="group">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-[8px] text-[13px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          Datos técnicos (opcional)
          <span className="font-normal text-muted-foreground">· diámetro, profundidad, material</span>
        </summary>
        <div className="pt-2">
          <AttributeFields idPrefix={baseId} value={attrs} onChange={setAttrs} />
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground" aria-live="polite">
          {GEOMETRY_HINTS[draft.type]}{" "}
          <span className="font-semibold text-foreground">
            {points.length} {points.length === 1 ? "vértice" : "vértices"}
          </span>
        </p>
        <Button
          type="button"
          variant="ghost"
          className="h-10"
          onClick={undo}
          disabled={saving || draft.points.length === 0}
          aria-label="Deshacer el último vértice"
        >
          <Undo2 className="h-4 w-4" aria-hidden />
          Deshacer
        </Button>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel} disabled={saving}>
          <X className="h-4 w-4" aria-hidden />
          Cancelar
        </Button>
        <Button type="button" className="h-10" onClick={() => void save()} disabled={saving || !ready}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          Guardar elemento
        </Button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Elemento seleccionado
// ---------------------------------------------------------------------------

export type SelectedElementCardProps = {
  element: PlanElement
  layer: PlanLayer | null
  canManage: boolean
  onClose: () => void
  onUpdated?: (element: PlanElement) => void
  onDeleted?: (elementId: number, layerId: number) => void
  className?: string
}

export function SelectedElementCard({
  element,
  layer,
  canManage,
  onClose,
  onUpdated,
  onDeleted,
  className,
}: SelectedElementCardProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const color = elementColor(element, layer)
  const typeLabel = ELEMENT_TYPE_LABELS[element.element_type] ?? element.element_type

  async function remove() {
    setDeleting(true)
    const res = await callAction(() => deleteObraElement(element.id))
    setDeleting(false)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    setDeleteOpen(false)
    toast.success("Elemento eliminado del plano.")
    onDeleted?.(element.id, element.layer_id)
  }

  return (
    <section
      aria-label={`Elemento seleccionado: ${typeLabel}`}
      className={cn("rounded-[14px] border border-border bg-card p-3 shadow-md", className)}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[14px] font-semibold leading-snug">{typeLabel}</p>
          {element.label ? <p className="break-words text-[13px]">«{element.label}»</p> : null}
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" onClick={onClose} aria-label="Cerrar la ficha del elemento">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <ul className="mt-1 space-y-0.5 text-[12.5px] text-muted-foreground">
        {elementDetails(element, layer).map((line) => (
          <li key={line} className="break-words">
            {line}
          </li>
        ))}
        <li>
          {SOURCE_LABELS[element.source] ?? element.source}
          {typeof element.confidence === "number" ? ` · confianza ${formatNumberCL(element.confidence * 100, 0)} %` : ""}
        </li>
      </ul>
      {canManage ? (
        <div className="mt-2.5 flex flex-wrap gap-2 border-t border-border pt-2.5">
          <Button type="button" variant="outline" className="h-10 rounded-[10px]" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" aria-hidden />
            Editar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-10 rounded-[10px] text-danger hover:text-danger"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Eliminar
          </Button>
        </div>
      ) : null}

      {canManage ? (
        <ElementEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          element={element}
          onSaved={(el) => onUpdated?.(el)}
        />
      ) : null}

      <Dialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>¿Eliminar este elemento?</DialogTitle>
            <DialogDescription className="break-words">
              {typeLabel}
              {element.label ? ` «${element.label}»` : ""} dejará de aparecer en el plano y ya no se usará para cruzar los
              hallazgos. Queda registrado en la auditoría.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-10" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              No, volver
            </Button>
            <Button type="button" variant="destructive" className="h-10" disabled={deleting} onClick={remove}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              Sí, eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Edición de un elemento
// ---------------------------------------------------------------------------

export type ElementEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  element: PlanElement
  onSaved?: (element: PlanElement) => void
}

export function ElementEditDialog({ open, onOpenChange, element, onSaved }: ElementEditDialogProps) {
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Editar elemento</DialogTitle>
          <DialogDescription>Los cambios se usan de inmediato para cruzar los hallazgos cercanos.</DialogDescription>
        </DialogHeader>
        {open ? (
          <ElementEditForm element={element} onOpenChange={onOpenChange} onSaved={onSaved} onSavingChange={setSaving} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ElementEditForm({
  element,
  onOpenChange,
  onSaved,
  onSavingChange,
}: Omit<ElementEditDialogProps, "open"> & { onSavingChange: (saving: boolean) => void }) {
  const baseId = useId()
  const [type, setType] = useState<ElementType>(element.element_type)
  const [label, setLabel] = useState(element.label ?? "")
  const [attrs, setAttrs] = useState<AttrForm>(() => attrFormOf(element.attributes))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const built = buildAttributes(attrs, element.attributes ?? {})
    if ("error" in built) {
      setError(built.error)
      return
    }
    setError(null)
    setSaving(true)
    onSavingChange(true)
    const res = await callAction(() =>
      updateObraElement(element.id, {
        element_type: type,
        label: label.trim().slice(0, LIMITS.label) || null,
        attributes: built.attributes,
      }),
    )
    setSaving(false)
    onSavingChange(false)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    toast.success("Elemento actualizado.")
    onSaved?.(res.data)
    onOpenChange(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${baseId}-type`}>Tipo de elemento</Label>
          <Select value={type} onValueChange={(v) => setType(v as ElementType)}>
            <SelectTrigger id={`${baseId}-type`} className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <ElementTypeSelectItems />
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${baseId}-label`}>Etiqueta</Label>
          <Input
            id={`${baseId}-label`}
            value={label}
            maxLength={LIMITS.label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-10"
          />
        </div>
      </div>
      <AttributeFields idPrefix={baseId} value={attrs} onChange={setAttrs} />
      <div className="space-y-1.5">
        <Label htmlFor={`${baseId}-notes`}>Notas</Label>
        <Textarea
          id={`${baseId}-notes`}
          value={attrs.notes}
          maxLength={LIMITS.text}
          rows={2}
          onChange={(e) => setAttrs({ ...attrs, notes: e.target.value })}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" disabled={saving} onClick={() => onOpenChange(false)}>
          Volver
        </Button>
        <Button type="submit" className="h-10" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          Guardar cambios
        </Button>
      </DialogFooter>
    </form>
  )
}
