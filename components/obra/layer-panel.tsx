"use client"

/**
 * Panel de capas del nivel seleccionado: capa activa (donde se reportan
 * hallazgos y se dibujan elementos), visibilidad por capa y por especialidad,
 * opacidad (solo en esta pantalla), y —según el rol— subir, alinear, detectar
 * elementos con IA (crea una sugerencia pendiente) y eliminar capas.
 */
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useState } from "react"
import { toast } from "sonner"
import {
  Eye,
  EyeOff,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  Move,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react"
import { requestObraLayerExtraction } from "@/app/actions/obra/elements"
import { deleteObraLayer } from "@/app/actions/obra/layers"
import { Button } from "@/components/ui/button"
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
import { Switch } from "@/components/ui/switch"
import { can } from "@/lib/obra/permissions"
import { DISCIPLINE_COLORS, DISCIPLINE_LABELS, DISCIPLINES, type Discipline, type ObraRole, type PlanLayer } from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { levelLabel } from "./plan-canvas"
import { callAction } from "./task-card"

export type LayerPanelProps = {
  projectId: number
  role: ObraRole
  /** Todas las capas de la obra. */
  layers: PlanLayer[]
  level: number | null
  activeLayerId: number | null
  onActiveLayerChange: (layerId: number) => void
  hiddenLayerIds: number[]
  onToggleLayer: (layerId: number) => void
  hiddenDisciplines: Discipline[]
  onToggleDiscipline: (d: Discipline) => void
  /** Opacidad elegida en pantalla por capa (0..1); si no, la guardada. */
  opacity: Record<number, number>
  onOpacityChange: (layerId: number, value: number) => void
  showPins: boolean
  onShowPinsChange: (v: boolean) => void
  showLabels: boolean
  onShowLabelsChange: (v: boolean) => void
  onUpload?: () => void
  onAlign?: (layer: PlanLayer) => void
  onDeleted?: (layer: PlanLayer) => void
  className?: string
}

export function LayerPanel({
  projectId,
  role,
  layers,
  level,
  activeLayerId,
  onActiveLayerChange,
  hiddenLayerIds,
  onToggleLayer,
  hiddenDisciplines,
  onToggleDiscipline,
  opacity,
  onOpacityChange,
  showPins,
  onShowPinsChange,
  showLabels,
  onShowLabelsChange,
  onUpload,
  onAlign,
  onDeleted,
  className,
}: LayerPanelProps) {
  const baseId = useId()
  const router = useRouter()
  const canManage = can(role, "plans.manage")
  const canAi = can(role, "ai.request")
  const [extractingId, setExtractingId] = useState<number | null>(null)
  const [lastExtraction, setLastExtraction] = useState<{ layerName: string; count: number } | null>(null)
  const [toDelete, setToDelete] = useState<PlanLayer | null>(null)
  const [deleting, setDeleting] = useState(false)

  const levelLayers = layers
    .filter((l) => l.level === level)
    .sort(
      (a, b) =>
        DISCIPLINES.indexOf(a.discipline) - DISCIPLINES.indexOf(b.discipline) || a.name.localeCompare(b.name, "es"),
    )
  const disciplines = DISCIPLINES.filter((d) => levelLayers.some((l) => l.discipline === d))

  async function extract(layer: PlanLayer) {
    setExtractingId(layer.id)
    const res = await callAction(() => requestObraLayerExtraction(layer.id))
    setExtractingId(null)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    const n = res.data.element_count
    setLastExtraction({ layerName: layer.name, count: n })
    toast.success(`Se creó una sugerencia pendiente de aprobación con ${n} elemento${n === 1 ? "" : "s"}.`, {
      description: "Nada se incorpora al plano hasta que una persona autorizada lo apruebe.",
      action: { label: "Ir a aprobaciones", onClick: () => router.push(`/obra/${projectId}/aprobaciones`) },
    })
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    const res = await callAction(() => deleteObraLayer(toDelete.id))
    setDeleting(false)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    toast.success(`Capa «${toDelete.name}» eliminada.`)
    onDeleted?.(toDelete)
    setToDelete(null)
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">
          Capas · {level != null ? levelLabel(layers, level) : "sin nivel"}
        </h2>
        {canManage && onUpload ? (
          <Button type="button" className="h-10 rounded-[10px]" onClick={onUpload}>
            <Plus className="h-4 w-4" aria-hidden />
            Subir capa
          </Button>
        ) : null}
      </div>

      {/* Qué se muestra */}
      <div className="space-y-1 rounded-[12px] border border-border bg-card px-3 py-1.5">
        <div className="flex min-h-10 items-center justify-between gap-3">
          <label htmlFor={`${baseId}-pins`} className="text-[13px]">
            Hallazgos en el plano
          </label>
          <Switch id={`${baseId}-pins`} checked={showPins} onCheckedChange={onShowPinsChange} />
        </div>
        <div className="flex min-h-10 items-center justify-between gap-3">
          <label htmlFor={`${baseId}-labels`} className="text-[13px]">
            Etiquetas de elementos (Ø, nombre)
          </label>
          <Switch id={`${baseId}-labels`} checked={showLabels} onCheckedChange={onShowLabelsChange} />
        </div>
      </div>

      {/* Especialidades */}
      {disciplines.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Especialidades</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mostrar u ocultar especialidades">
            {disciplines.map((d) => {
              const visible = !hiddenDisciplines.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={visible}
                  onClick={() => onToggleDiscipline(d)}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    visible ? "border-border bg-card" : "border-dashed border-border bg-transparent text-muted-foreground line-through",
                  )}
                  title={visible ? "Ocultar especialidad" : "Mostrar especialidad"}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: DISCIPLINE_COLORS[d], opacity: visible ? 1 : 0.4 }}
                    aria-hidden
                  />
                  {DISCIPLINE_LABELS[d].split(" (")[0]}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* Capas */}
      {levelLayers.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
          No hay capas en este nivel.
        </p>
      ) : (
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Capas del nivel · elige la activa
          </legend>
          <ul className="space-y-2">
            {levelLayers.map((l) => {
              const active = l.id === activeLayerId
              const layerHidden = hiddenLayerIds.includes(l.id)
              const disciplineHidden = hiddenDisciplines.includes(l.discipline)
              const value = Math.round((opacity[l.id] ?? l.opacity) * 100)
              const radioId = `${baseId}-active-${l.id}`
              const opacityId = `${baseId}-op-${l.id}`
              const extracting = extractingId === l.id
              const showMenu = canManage || (canAi && l.has_image)
              return (
                <li
                  key={l.id}
                  className={cn(
                    "rounded-[12px] border bg-card p-2.5 transition-colors",
                    active ? "border-brand ring-1 ring-brand/40" : "border-border",
                    (layerHidden || disciplineHidden) && "opacity-70",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <input
                      id={radioId}
                      type="radio"
                      name={`${baseId}-active`}
                      checked={active}
                      onChange={() => onActiveLayerChange(l.id)}
                      className="size-5 shrink-0 cursor-pointer accent-[#f3a40a]"
                    />
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: DISCIPLINE_COLORS[l.discipline] }}
                      aria-hidden
                    />
                    <label htmlFor={radioId} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block truncate text-[13.5px] font-medium">
                        {l.name}
                        {active ? <span className="sr-only"> (capa activa)</span> : null}
                      </span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">
                        {DISCIPLINE_LABELS[l.discipline].split(" (")[0]} · {l.element_count} elemento
                        {l.element_count === 1 ? "" : "s"}
                        {l.has_image ? " · con lámina" : " · sin lámina"}
                        {disciplineHidden ? " · especialidad oculta" : ""}
                      </span>
                    </label>
                    {l.has_image ? <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-10 shrink-0"
                      aria-pressed={!layerHidden}
                      aria-label={`${layerHidden ? "Mostrar" : "Ocultar"} la capa «${l.name}»`}
                      onClick={() => onToggleLayer(l.id)}
                    >
                      {layerHidden ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                    </Button>
                    {showMenu ? (
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 shrink-0"
                            aria-label={`Más acciones para la capa «${l.name}»`}
                            disabled={extracting}
                          >
                            {extracting ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" aria-hidden />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[230px]">
                          {canManage && onAlign ? (
                            <DropdownMenuItem className="min-h-10" onSelect={() => onAlign(l)}>
                              <Move className="h-4 w-4" aria-hidden />
                              Alinear y editar
                            </DropdownMenuItem>
                          ) : null}
                          {canAi && l.has_image ? (
                            <DropdownMenuItem className="min-h-10" onSelect={() => void extract(l)} disabled={extractingId !== null}>
                              <Sparkles className="h-4 w-4" aria-hidden />
                              Detectar elementos con IA
                            </DropdownMenuItem>
                          ) : null}
                          {canManage ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="min-h-10 text-danger focus:text-danger"
                                onSelect={() => setToDelete(l)}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                                Eliminar capa
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2 pl-7">
                    <label htmlFor={opacityId} className="w-16 shrink-0 text-[11.5px] text-muted-foreground">
                      Opacidad
                    </label>
                    <input
                      id={opacityId}
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={value}
                      onChange={(e) => onOpacityChange(l.id, Number(e.target.value) / 100)}
                      aria-valuetext={`${value} %`}
                      className="h-10 min-w-0 flex-1 cursor-pointer accent-[#f3a40a]"
                    />
                    <span className="w-10 shrink-0 text-right text-[11.5px] tabular-nums text-muted-foreground" aria-hidden>
                      {value} %
                    </span>
                  </div>
                  {extracting ? (
                    <p className="mt-1 flex items-center gap-1.5 pl-7 text-[12px] text-muted-foreground" role="status">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      Analizando la lámina con IA… puede tardar un poco.
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </fieldset>
      )}

      {lastExtraction ? (
        <p className="flex items-start gap-1.5 rounded-[10px] bg-warning-tint px-3 py-2 text-[12.5px]" role="status">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>
            La IA propuso {lastExtraction.count} elementos para «{lastExtraction.layerName}». Quedan pendientes hasta que
            alguien los apruebe.{" "}
            <Link href={`/obra/${projectId}/aprobaciones`} className="font-semibold text-[#b8841a] hover:underline">
              Revisar en Aprobaciones IA
            </Link>
          </span>
        </p>
      ) : null}

      {canManage ? (
        <p className="text-[12px] text-muted-foreground">
          La opacidad de esta lista solo cambia tu vista. Para guardarla para todos, usa «Alinear y editar».
        </p>
      ) : null}

      <Dialog open={toDelete != null} onOpenChange={(o) => !deleting && !o && setToDelete(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>¿Eliminar la capa «{toDelete?.name}»?</DialogTitle>
            <DialogDescription>
              Se quitará del plano junto con sus {toDelete?.element_count ?? 0} elementos, y los hallazgos ubicados en ella
              dejarán de verse en el plano. La acción queda registrada en la auditoría.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-10" disabled={deleting} onClick={() => setToDelete(null)}>
              No, volver
            </Button>
            <Button type="button" variant="destructive" className="h-10" disabled={deleting} onClick={confirmDelete}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              Sí, eliminar capa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
