"use client"

/**
 * Mapa de calor de hallazgos sobre el plano: el cálculo (lib/obra/heatmap.ts)
 * convertido en una imagen para el visor 2D, y la tarjeta con la leyenda y los
 * filtros (estado, período, categoría) que comparten las vistas 2D y 3D.
 */
import { useId, useMemo, useState } from "react"
import { ChevronDown, Flame } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  computeHeatGrid,
  countHeatFindings,
  heatColor,
  heatGridToRgba,
  heatPointsFor,
  heatScaleMax,
  type HeatFilter,
  type HeatPeriod,
} from "@/lib/obra/heatmap"
import { FINDING_CATEGORIES, FINDING_CATEGORY_LABELS, type FindingCategory, type FindingPin, type PlanLayer } from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { boundsOfLayers, layerFrameOf } from "./plan-canvas"

/** Imagen del mapa ubicada en metros del nivel (para un <image> del SVG del plano). */
export type HeatOverlay = { href: string; x: number; y: number; width: number; height: number }

/** Gradiente CSS de la leyenda, con los mismos colores del mapa. */
export const HEAT_LEGEND_GRADIENT = (() => {
  const stops = [0.06, 0.25, 0.5, 0.75, 1].map((t) => {
    const [r, g, b, a] = heatColor(t)
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0.35, a / 255).toFixed(2)}) ${Math.round(t * 100)}%`
  })
  return `linear-gradient(to right, ${stops.join(", ")})`
})()

/**
 * Imagen del mapa de calor de un nivel (data URL de un canvas, una celda por píxel: el
 * navegador la suaviza al escalarla). null si está apagado, sin capas o sin hallazgos que entren.
 */
export function useHeatOverlay({
  enabled,
  pins,
  layers,
  level,
  filter,
  today,
}: {
  enabled: boolean
  pins: FindingPin[]
  layers: PlanLayer[]
  level: number | null
  filter: HeatFilter
  today: string
}): { overlay: HeatOverlay | null; count: number } {
  const count = useMemo(
    () => (enabled && level != null ? countHeatFindings(pins, filter, today, level) : 0),
    [enabled, pins, filter, today, level],
  )
  const grid = useMemo(() => {
    if (!enabled || level == null || count === 0) return null
    const levelLayers = layers.filter((l) => l.level === level)
    const bounds = boundsOfLayers(levelLayers)
    if (!bounds) return null
    const byId = new Map(layers.map((l) => [l.id, l]))
    const frameOf = (id: number) => {
      const l = byId.get(id)
      return l ? layerFrameOf(l) : null
    }
    const points = heatPointsFor(pins, frameOf, filter, today, level)
    return points.length > 0 ? computeHeatGrid(points, bounds) : null
  }, [enabled, count, pins, layers, level, filter, today])

  const overlay = useMemo((): HeatOverlay | null => {
    if (!grid || typeof document === "undefined") return null
    const canvas = document.createElement("canvas")
    canvas.width = grid.cols
    canvas.height = grid.rows
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    const img = ctx.createImageData(grid.cols, grid.rows)
    img.data.set(heatGridToRgba(grid, heatScaleMax(grid)))
    ctx.putImageData(img, 0, 0)
    return {
      href: canvas.toDataURL("image/png"),
      x: grid.minX,
      y: grid.minY,
      width: grid.cols * grid.cell,
      height: grid.rows * grid.cell,
    }
  }, [grid])

  return { overlay, count }
}

const PERIOD_OPTIONS: { value: string; label: string; days: HeatPeriod }[] = [
  { value: "todo", label: "Desde el inicio", days: null },
  { value: "30", label: "Últimos 30 días", days: 30 },
  { value: "90", label: "Últimos 90 días", days: 90 },
  { value: "365", label: "Últimos 12 meses", days: 365 },
]

export type HeatmapCardProps = {
  filter: HeatFilter
  onFilterChange: (f: HeatFilter) => void
  /** Hallazgos que entran en el mapa (del nivel o de los niveles mostrados). */
  count: number
  /** Texto de dónde se cuentan ("en este nivel", "en los niveles mostrados"). */
  scopeText: string
  /** Hallazgos disponibles (para ofrecer solo las categorías que existen). */
  pins: FindingPin[]
  defaultOpen?: boolean
  className?: string
}

/** Tarjeta sobre el plano: leyenda del mapa de calor y sus filtros (plegable). */
export function HeatmapCard({ filter, onFilterChange, count, scopeText, pins, defaultOpen = false, className }: HeatmapCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const categories = useMemo(() => {
    const present = new Set<FindingCategory>(pins.map((p) => p.category))
    for (const c of filter.categories ?? []) present.add(c)
    return FINDING_CATEGORIES.filter((c) => present.has(c))
  }, [pins, filter.categories])
  const category = filter.categories && filter.categories.length === 1 ? filter.categories[0] : "todas"
  const period = PERIOD_OPTIONS.find((o) => o.days === filter.period_days)?.value ?? "todo"
  const bodyId = `${useId()}-filtros`

  return (
    <section
      aria-label="Mapa de calor de hallazgos"
      className={cn("rounded-[12px] border border-border bg-card/95 text-[12px] shadow-sm backdrop-blur", className)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex min-h-10 w-full items-center gap-2 rounded-[12px] px-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Flame className="h-4 w-4 shrink-0 text-[#dc2626]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">Mapa de calor</span>
          <span className="text-muted-foreground">
            {" "}
            · {count} hallazgo{count === 1 ? "" : "s"}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
        <span className="sr-only">{open ? "Ocultar filtros" : "Mostrar filtros"}</span>
      </button>
      <div className="px-3 pb-2.5">
        <div className="h-2 rounded-full border border-border/60" style={{ background: HEAT_LEGEND_GRADIENT }} aria-hidden />
        <p className="mt-1 flex justify-between text-[11px] text-muted-foreground" aria-hidden>
          <span>Menos</span>
          <span>Más hallazgos y más graves</span>
        </p>
        <p className="sr-only">
          El color va de amarillo a rojo oscuro según cuántos hallazgos hay cerca y su gravedad.
        </p>
      </div>
      <div id={bodyId} hidden={!open} className="space-y-2 border-t border-border px-3 pb-3 pt-2.5">
        <p className="text-muted-foreground">
          {count === 0
            ? `No hay hallazgos ubicados ${scopeText} con estos filtros.`
            : `${count} hallazgo${count === 1 ? "" : "s"} ${scopeText}. Pesan más los críticos y los de alta gravedad.`}
        </p>
        <div role="radiogroup" aria-label="Qué hallazgos incluir" className="flex rounded-[10px] bg-secondary p-0.5">
          {(
            [
              ["abiertos", "Abiertos"],
              ["todos", "Todos"],
            ] as const
          ).map(([value, label]) => {
            const on = filter.status === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onFilterChange({ ...filter, status: value })}
                className={cn(
                  "min-h-9 flex-1 rounded-[8px] px-2 font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  on ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
        {filter.status === "todos" ? (
          <p className="text-[11px] text-muted-foreground">Los resueltos y cerrados cuentan con menos peso.</p>
        ) : null}
        <Select
          value={period}
          onValueChange={(v) => onFilterChange({ ...filter, period_days: PERIOD_OPTIONS.find((o) => o.value === v)?.days ?? null })}
        >
          <SelectTrigger className="h-9 w-full bg-card text-[12px]" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="min-h-10">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {categories.length > 1 ? (
          <Select
            value={category}
            onValueChange={(v) =>
              onFilterChange({ ...filter, categories: v === "todas" ? null : [v as FindingCategory] })
            }
          >
            <SelectTrigger className="h-9 w-full bg-card text-[12px]" aria-label="Categoría">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas" className="min-h-10">
                Todas las categorías
              </SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c} className="min-h-10">
                  {FINDING_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </section>
  )
}
