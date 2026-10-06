"use client"

/**
 * Lienzo del plano de obra (SVG, sin Konva).
 *
 * Dibuja en METROS DEL NIVEL: cada capa visible se coloca con su LayerFrame
 * con el mismo transform que toLevelMeters (lib/obra/geometry.ts):
 *   translate(offset_x_m, offset_y_m) rotate(rotation_deg) y lámina de
 *   width_m × width_m·aspect.
 * Encima van, en coordenadas de pantalla (tamaño constante al hacer zoom), los
 * pines de hallazgos, las etiquetas de elementos, las líneas de correlación
 * (pin → punto más cercano del elemento, con la distancia) y el borrador del
 * elemento que se está dibujando.
 *
 * Interacción: arrastrar = mover; rueda, pellizco o botones = zoom; tocar =
 * seleccionar (modo navegar) o entregar la coordenada normalizada de la capa
 * activa (modos reportar y dibujar, vía fromLevelMeters).
 */
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { Maximize, Minus, Plus } from "lucide-react"
import { formatDistanceCl } from "@/lib/obra/correlation"
import {
  fromLevelMeters,
  geometryToMeters,
  pointInPolygon,
  sanitizeFrame,
  toLevelMeters,
  type MetricGeometry,
} from "@/lib/obra/geometry"
import {
  DISCIPLINE_COLORS,
  DISCIPLINE_LABELS,
  DISCIPLINES,
  ELEMENT_TYPE_DISCIPLINE,
  ELEMENT_TYPE_LABELS,
  SEVERITY_LABELS,
  type Correlation,
  type Discipline,
  type ElementGeometry,
  type FindingPin,
  type LayerFrame,
  type NormPoint,
  type PlanElement,
  type PlanLayer,
  type Severity,
  type Vec2,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type PlanMode = "navegar" | "reportar" | "dibujar"
export type GeometryKind = ElementGeometry["type"]

/** Resultado de tocar el plano (modos reportar y dibujar, o toque en vacío). */
export type PlanClickInfo = {
  /** Punto tocado en metros del nivel. */
  meters: Vec2
  /** Coordenada normalizada en la capa activa (sin recortar) o null si no hay capa activa. */
  norm: NormPoint | null
  /** ¿El punto cae dentro de la lámina de la capa activa? */
  inside: boolean
  layerId: number | null
}

/** Elemento que se está dibujando (coordenadas normalizadas de su capa). */
export type PlanDraft = { layerId: number; type: GeometryKind; points: NormPoint[]; color?: string }

/** Marca temporal: punto a reportar o ubicación de una tarea. */
export type PlanMarker = { layerId: number; x: number; y: number; kind: "report" | "task"; label?: string }

/** Pedido de centrar la vista en un punto (metros del nivel). Cambia `nonce` para repetirlo. */
export type PlanFocus = { x: number; y: number; nonce: number; span_m?: number }

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

// ---------------------------------------------------------------------------
// Utilidades compartidas (puras, usables desde otros componentes cliente)
// ---------------------------------------------------------------------------

/** Colores CSS de severidad (tokens de app/globals.css). */
export const SEVERITY_COLOR_VARS: Record<Severity, string> = {
  critical: "var(--sev-critical)",
  high: "var(--sev-high)",
  medium: "var(--sev-medium)",
  low: "var(--sev-low)",
}

/** Número con coma decimal y punto de miles (formato chileno), sin depender de Intl. */
export function formatNumberCL(n: number, decimals = 1): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return ""
  const f = 10 ** decimals
  const r = Math.round(n * f) / f
  const [int, dec] = String(Math.abs(r)).split(".")
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${r < 0 ? "-" : ""}${intFmt}${dec ? `,${dec}` : ""}`
}

/** Niveles con capas, de arriba hacia abajo. */
export function levelsOf(layers: Pick<PlanLayer, "level">[]): number[] {
  return [...new Set(layers.map((l) => l.level))].sort((a, b) => b - a)
}

/** Etiqueta visible de un nivel: la level_label de alguna de sus capas o "Nivel n". */
export function levelLabel(layers: Pick<PlanLayer, "level" | "level_label">[], level: number): string {
  const withLabel = layers.find((l) => l.level === level && typeof l.level_label === "string" && l.level_label.trim())
  return withLabel?.level_label?.trim() || `Nivel ${level}`
}

/** Disciplina con la que se colorea un elemento: la de su tipo o, si es genérico, la de su capa. */
export function elementDiscipline(
  el: Pick<PlanElement, "element_type">,
  layer?: Pick<PlanLayer, "discipline"> | null,
): Discipline {
  const d = ELEMENT_TYPE_DISCIPLINE[el.element_type] ?? "otro"
  if (d === "otro" && layer) return layer.discipline
  return d
}

export function elementColor(el: Pick<PlanElement, "element_type">, layer?: Pick<PlanLayer, "discipline"> | null): string {
  return DISCIPLINE_COLORS[elementDiscipline(el, layer)] ?? DISCIPLINE_COLORS.otro
}

function numAttr(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Ø legible ("Ø160 mm") o null. */
export function diameterText(attributes: PlanElement["attributes"] | null | undefined): string | null {
  const d = numAttr(attributes?.diameter_mm)
  return d == null ? null : `Ø${formatNumberCL(d, 0)} mm`
}

/** Detalles técnicos de un elemento como líneas legibles (Ø, profundidad, material, capa...). */
export function elementDetails(
  el: Pick<PlanElement, "attributes">,
  layer?: Pick<PlanLayer, "name" | "discipline"> | null,
): string[] {
  const a = el.attributes ?? {}
  const out: string[] = []
  const d = diameterText(a)
  if (d) out.push(d)
  const depth = numAttr(a.depth_m)
  if (depth != null) out.push(`Profundidad ${formatNumberCL(depth, 2)} m`)
  if (typeof a.material === "string" && a.material.trim()) out.push(`Material: ${a.material.trim()}`)
  const volts = numAttr(a.voltage_v)
  if (volts != null) out.push(`Tensión ${formatNumberCL(volts, 0)} V`)
  if (typeof a.pressure === "string" && a.pressure.trim()) out.push(`Presión: ${a.pressure.trim()}`)
  if (typeof a.notes === "string" && a.notes.trim()) out.push(a.notes.trim())
  if (layer) out.push(`Capa: ${layer.name} (${DISCIPLINE_LABELS[layer.discipline] ?? layer.discipline})`)
  return out
}

/** Marco efectivo de una capa (con alineación en edición si la hay). */
export function layerFrameOf(layer: Pick<PlanLayer, "id" | "frame">, overrides?: Record<number, LayerFrame> | null): LayerFrame {
  return sanitizeFrame(overrides?.[layer.id] ?? layer.frame)
}

const CORNERS: NormPoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

/** Rectángulo que envuelve las láminas de las capas (en metros del nivel). */
export function boundsOfLayers(
  layers: Pick<PlanLayer, "id" | "frame">[],
  overrides?: Record<number, LayerFrame> | null,
): Bounds | null {
  let b: Bounds | null = null
  for (const l of layers) {
    const f = layerFrameOf(l, overrides)
    for (const c of CORNERS) {
      const p = toLevelMeters(c, f)
      if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
      else {
        if (p.x < b.minX) b.minX = p.x
        if (p.y < b.minY) b.minY = p.y
        if (p.x > b.maxX) b.maxX = p.x
        if (p.y > b.maxY) b.maxY = p.y
      }
    }
  }
  return b
}

/** Punto de la geometría (en metros) más cercano a `p`; dentro de un polígono, el mismo `p`. */
export function nearestPointOnGeometry(p: Vec2, g: MetricGeometry): Vec2 | null {
  const pts = g?.points ?? []
  if (pts.length === 0) return null
  if (g.type === "point" || pts.length === 1) return pts[0]
  const closed = g.type === "polygon" && pts.length >= 3
  if (closed && pointInPolygon(p, pts)) return p
  let best: Vec2 = pts[0]
  let bestD = Infinity
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const q = { x: a.x + t * dx, y: a.y + t * dy }
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d < bestD) {
      bestD = d
      best = q
    }
  }
  return best
}

const DISCIPLINE_ORDER = new Map<string, number>(DISCIPLINES.map((d, i) => [d, i]))

/** Orden de dibujo: primero las láminas con imagen (fondo), luego por especialidad. */
export function sortLayersForDrawing<T extends Pick<PlanLayer, "id" | "has_image" | "discipline">>(layers: T[]): T[] {
  return [...layers].sort(
    (a, b) =>
      Number(b.has_image) - Number(a.has_image) ||
      (DISCIPLINE_ORDER.get(a.discipline) ?? 99) - (DISCIPLINE_ORDER.get(b.discipline) ?? 99) ||
      a.id - b.id,
  )
}

/** Punto donde se ancla la etiqueta de una geometría en metros. */
function anchorOf(g: MetricGeometry): Vec2 | null {
  const pts = g.points
  if (pts.length === 0) return null
  if (g.type === "point" || pts.length === 1) return pts[0]
  if (g.type === "polygon") {
    let sx = 0
    let sy = 0
    for (const p of pts) {
      sx += p.x
      sy += p.y
    }
    return { x: sx / pts.length, y: sy / pts.length }
  }
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
  let rest = total / 2
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    if (seg >= rest && seg > 0) {
      const t = rest / seg
      return { x: pts[i].x + t * (pts[i + 1].x - pts[i].x), y: pts[i].y + t * (pts[i + 1].y - pts[i].y) }
    }
    rest -= seg
  }
  return pts[Math.floor(pts.length / 2)]
}

function r3(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

/** Path de una geometría normalizada escalada a (w, h) (metros locales de la lámina). */
function localPath(g: ElementGeometry, w: number, h: number): string {
  const pts = g?.points ?? []
  if (pts.length === 0) return ""
  if (g.type === "point") return `M${r3(pts[0].x * w)} ${r3(pts[0].y * h)}l0.001 0`
  let d = ""
  for (let i = 0; i < pts.length; i++) d += `${i === 0 ? "M" : "L"}${r3(pts[i].x * w)} ${r3(pts[i].y * h)}`
  return g.type === "polygon" ? `${d}Z` : d
}

function screenPath(points: Vec2[], closed: boolean): string {
  if (points.length === 0) return ""
  let d = ""
  for (let i = 0; i < points.length; i++) d += `${i === 0 ? "M" : "L"}${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`
  return closed ? `${d}Z` : d
}

function labelTextOf(el: PlanElement): string | null {
  const label = typeof el.label === "string" ? el.label.trim() : ""
  const d = numAttr(el.attributes?.diameter_mm)
  const dia = d == null ? "" : `Ø${formatNumberCL(d, 0)}`
  const text = [label, dia].filter(Boolean).join(" ")
  return text ? (text.length > 40 ? `${text.slice(0, 39)}…` : text) : null
}

const RELATION_SHORT: Record<Correlation["relation"], string> = {
  mismo_nivel: "",
  nivel_inferior: "nivel inferior",
  nivel_superior: "nivel superior",
}

// ---------------------------------------------------------------------------
// Capa (memoizada: no se vuelve a renderizar al mover o hacer zoom)
// ---------------------------------------------------------------------------

const EMPTY_ELEMENTS: PlanElement[] = []

type LayerGroupProps = {
  layer: PlanLayer
  frame: LayerFrame
  opacity: number
  elements: PlanElement[]
  active: boolean
  selectable: boolean
}

const LayerGroup = memo(function LayerGroup({ layer, frame, opacity, elements, active, selectable }: LayerGroupProps) {
  const w = frame.width_m
  const h = frame.width_m * frame.aspect
  const sheetColor = DISCIPLINE_COLORS[layer.discipline] ?? DISCIPLINE_COLORS.otro
  const paths = useMemo(
    () =>
      elements.map((el) => ({
        id: el.id,
        kind: el.geometry?.type ?? "polyline",
        d: localPath(el.geometry, w, h),
        color: elementColor(el, layer),
      })),
    [elements, w, h, layer],
  )
  const elementOpacity = 0.35 + 0.65 * Math.min(1, Math.max(0, opacity))

  return (
    <g transform={`translate(${frame.offset_x_m} ${frame.offset_y_m}) rotate(${frame.rotation_deg})`}>
      {layer.has_image ? (
        <image
          href={`/api/obra/layers/${layer.id}/image`}
          x={0}
          y={0}
          width={w}
          height={h}
          preserveAspectRatio="none"
          opacity={opacity}
        />
      ) : (
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          fill={sheetColor}
          fillOpacity={0.05}
          stroke={sheetColor}
          strokeOpacity={0.45}
          strokeWidth={1}
          strokeDasharray="6 5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {active ? (
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          fill="none"
          stroke="#f3a40a"
          strokeWidth={2}
          strokeDasharray="10 6"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}
      <g opacity={elementOpacity} pointerEvents="none">
        {paths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            stroke={p.color}
            strokeWidth={p.kind === "point" ? 9 : p.kind === "polygon" ? 1.75 : 2.5}
            fill={p.kind === "polygon" ? p.color : "none"}
            fillOpacity={p.kind === "polygon" ? 0.12 : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      {selectable ? (
        <g>
          {paths.map((p) => (
            <path
              key={p.id}
              d={p.d}
              data-element-id={p.id}
              stroke="transparent"
              strokeWidth={p.kind === "point" ? 24 : 14}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents="stroke"
            />
          ))}
        </g>
      ) : null}
    </g>
  )
})

// ---------------------------------------------------------------------------
// Lienzo
// ---------------------------------------------------------------------------

type View = { scale: number; tx: number; ty: number }

const MIN_SCALE = 0.005
const MAX_SCALE = 20_000
const TAP_SLOP = 6
const MAX_LABELS = 180
const SCALE_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

function clampScale(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

function fitView(b: Bounds | null, w: number, h: number): View {
  const bb = b ?? { minX: 0, minY: 0, maxX: 50, maxY: 35 }
  const bw = Math.max(bb.maxX - bb.minX, 0.5)
  const bh = Math.max(bb.maxY - bb.minY, 0.5)
  const pad = Math.min(36, Math.min(w, h) * 0.08)
  const scale = clampScale(Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh))
  return { scale, tx: (w - bw * scale) / 2 - bb.minX * scale, ty: (h - bh * scale) / 2 - bb.minY * scale }
}

function attrFrom(target: EventTarget | null, attr: string, stop: Element | null): number | null {
  let el = target instanceof Element ? target : null
  while (el && el !== stop) {
    const v = el.getAttribute(attr)
    if (v != null && v !== "") {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    el = el.parentElement
  }
  return null
}

type Gesture =
  | { kind: "pan"; id: number; start: Vec2; startView: View; moved: boolean; target: EventTarget | null }
  | { kind: "pinch"; startDist: number; startMid: Vec2; startView: View }

export type PlanCanvasProps = {
  /** Capas a dibujar (ya filtradas: visibles y del nivel). */
  layers: PlanLayer[]
  /** Elementos de esas capas (los de otras capas se ignoran). */
  elements?: PlanElement[]
  /** Todas las capas conocidas (para ubicar pines, borradores y correlaciones de otras capas). */
  frameLayers?: PlanLayer[]
  /** Marcos en edición (alineación en vivo). */
  frameOverrides?: Record<number, LayerFrame> | null
  /** Opacidad por capa (si no, la guardada en la capa). */
  layerOpacity?: Record<number, number> | null
  activeLayerId?: number | null
  pins?: FindingPin[]
  selectedFindingId?: number | null
  /** Correlaciones del hallazgo seleccionado (se dibujan como líneas punteadas). */
  correlations?: Correlation[] | null
  /** Índice de elementos cargados (incluye niveles adyacentes) para dibujar correlaciones. */
  elementIndex?: Map<number, PlanElement> | null
  selectedElementId?: number | null
  draft?: PlanDraft | null
  marker?: PlanMarker | null
  mode?: PlanMode
  focus?: PlanFocus | null
  /** Cuando cambia, la vista se vuelve a encajar. */
  fitKey?: string | number
  showLabels?: boolean
  showPins?: boolean
  /** false = solo vista (sin seleccionar elementos ni pines). */
  selectable?: boolean
  /** Marca el contorno de la capa activa (por defecto solo en los modos reportar y dibujar). */
  outlineActive?: boolean
  ariaLabel?: string
  className?: string
  onPlanClick?: (info: PlanClickInfo) => void
  onPlanDoubleClick?: (info: PlanClickInfo) => void
  onSelectFinding?: (findingId: number) => void
  onSelectElement?: (elementId: number | null) => void
  /** Contenido superpuesto (tarjetas, botones) dentro del contenedor del lienzo. */
  children?: ReactNode
}

export function PlanCanvas({
  layers,
  elements = EMPTY_ELEMENTS,
  frameLayers,
  frameOverrides,
  layerOpacity,
  activeLayerId = null,
  pins,
  selectedFindingId = null,
  correlations,
  elementIndex,
  selectedElementId = null,
  draft,
  marker,
  mode = "navegar",
  focus,
  fitKey,
  showLabels = true,
  showPins = true,
  selectable = true,
  outlineActive,
  ariaLabel = "Plano de la obra",
  className,
  onPlanClick,
  onPlanDoubleClick,
  onSelectFinding,
  onSelectElement,
  children,
}: PlanCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const viewRef = useRef<View | null>(null)
  const [view, setViewState] = useState<View | null>(null)
  const [panning, setPanning] = useState(false)
  const [hover, setHover] = useState<{ elementId: number | null; x: number; y: number } | null>(null)
  const pointersRef = useRef(new Map<number, Vec2>())
  const gestureRef = useRef<Gesture | null>(null)
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const lastFitKeyRef = useRef<unknown>(undefined)
  const appliedFocusRef = useRef<number | null>(null)
  // true mientras la vista sea un encaje automático (nadie ha movido ni acercado el plano):
  // si el contenedor cambia de tamaño (p.ej. al aparecer el menú lateral) se vuelve a encajar.
  const autoFitRef = useRef(false)
  const fitSizeRef = useRef({ w: 0, h: 0 })
  const hintId = `${useId()}-ayuda`

  const commitView = useCallback((v: View) => {
    viewRef.current = v
    autoFitRef.current = false
    setViewState(v)
  }, [])

  const commitFit = useCallback(
    (w: number, h: number) => {
      commitView(fitView(boundsRef.current, w, h))
      autoFitRef.current = true
      fitSizeRef.current = { w, h }
    },
    [commitView],
  )

  // --- Datos derivados -------------------------------------------------------

  const layerById = useMemo(() => {
    const m = new Map<number, PlanLayer>()
    for (const l of frameLayers ?? []) m.set(l.id, l)
    for (const l of layers) m.set(l.id, l)
    return m
  }, [layers, frameLayers])

  const frameOf = useCallback(
    (layerId: number): LayerFrame | null => {
      const l = layerById.get(layerId)
      return l ? layerFrameOf(l, frameOverrides) : null
    },
    [layerById, frameOverrides],
  )

  const drawLayers = useMemo(() => sortLayersForDrawing(layers), [layers])
  // Marcos memoizados: así las capas (memo) no se vuelven a renderizar al mover o hacer zoom.
  const drawFrames = useMemo(() => {
    const m = new Map<number, LayerFrame>()
    for (const l of layers) m.set(l.id, layerFrameOf(l, frameOverrides))
    return m
  }, [layers, frameOverrides])
  const bounds = useMemo(() => boundsOfLayers(layers, frameOverrides), [layers, frameOverrides])
  const boundsRef = useRef(bounds)
  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])

  const elementsByLayer = useMemo(() => {
    const m = new Map<number, PlanElement[]>()
    for (const el of elements) {
      const list = m.get(el.layer_id)
      if (list) list.push(el)
      else m.set(el.layer_id, [el])
    }
    return m
  }, [elements])

  const elementMap = useMemo(() => {
    const m = new Map<number, PlanElement>()
    for (const el of elements) m.set(el.id, el)
    return m
  }, [elements])

  const drawnLayerIds = useMemo(() => new Set(layers.map((l) => l.id)), [layers])

  const labelAnchors = useMemo(() => {
    if (!showLabels) return []
    const out: { id: number; text: string; m: Vec2; color: string }[] = []
    for (const el of elements) {
      if (!drawnLayerIds.has(el.layer_id)) continue
      const text = labelTextOf(el)
      if (!text) continue
      const f = frameOf(el.layer_id)
      if (!f) continue
      const a = anchorOf(geometryToMeters(el.geometry, f))
      if (a) out.push({ id: el.id, text, m: a, color: elementColor(el, layerById.get(el.layer_id)) })
    }
    return out
  }, [elements, showLabels, frameOf, drawnLayerIds, layerById])

  const pinItems = useMemo(() => {
    if (!showPins || !pins) return []
    const out: { pin: FindingPin; m: Vec2 }[] = []
    for (const pin of pins) {
      const f = frameOf(pin.layer_id)
      if (!f) continue
      out.push({ pin, m: toLevelMeters({ x: pin.x, y: pin.y }, f) })
    }
    // El seleccionado se dibuja al final (encima de los demás).
    out.sort((a, b) => Number(a.pin.finding_id === selectedFindingId) - Number(b.pin.finding_id === selectedFindingId))
    return out
  }, [pins, showPins, frameOf, selectedFindingId])

  const selectedPin = useMemo(
    () => (selectedFindingId == null ? null : (pins ?? []).find((p) => p.finding_id === selectedFindingId) ?? null),
    [pins, selectedFindingId],
  )

  const correlationItems = useMemo(() => {
    if (!selectedPin || !correlations || correlations.length === 0) return []
    const pf = frameOf(selectedPin.layer_id)
    if (!pf) return []
    const pinM = toLevelMeters({ x: selectedPin.x, y: selectedPin.y }, pf)
    const out: { c: Correlation; pinM: Vec2; near: Vec2; metric: MetricGeometry; color: string; ghost: boolean }[] = []
    for (const c of correlations) {
      const el = elementIndex?.get(c.element_id) ?? elementMap.get(c.element_id)
      if (!el) continue
      const f = frameOf(el.layer_id)
      if (!f) continue
      const metric = geometryToMeters(el.geometry, f)
      // Muros y redes como polígono se miden a su contorno (lib/obra/correlation.ts): si el motor
      // informa distancia > 0, la línea va al borde y no al propio pin.
      const target: MetricGeometry =
        c.distance_m > 0 && metric.type === "polygon" && metric.points.length >= 3
          ? { type: "polyline", points: [...metric.points, metric.points[0]] }
          : metric
      const near = nearestPointOnGeometry(pinM, target)
      if (!near) continue
      out.push({
        c,
        pinM,
        near,
        metric,
        color: DISCIPLINE_COLORS[c.discipline] ?? elementColor(el, layerById.get(el.layer_id)),
        ghost: c.relation !== "mismo_nivel" || !drawnLayerIds.has(el.layer_id),
      })
    }
    return out
  }, [selectedPin, correlations, elementIndex, elementMap, frameOf, layerById, drawnLayerIds])

  const selectedElement = useMemo(() => {
    if (selectedElementId == null) return null
    const el = elementMap.get(selectedElementId) ?? elementIndex?.get(selectedElementId) ?? null
    if (!el) return null
    const f = frameOf(el.layer_id)
    return f ? { el, metric: geometryToMeters(el.geometry, f) } : null
  }, [selectedElementId, elementMap, elementIndex, frameOf])

  // --- Tamaño y vista ----------------------------------------------------------

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Encaje inicial y cada vez que cambia fitKey (p.ej. otro nivel).
  useEffect(() => {
    if (size.w < 10 || size.h < 10) return
    const key = fitKey ?? "__default__"
    const resized = fitSizeRef.current.w !== size.w || fitSizeRef.current.h !== size.h
    if (viewRef.current && lastFitKeyRef.current === key && !(autoFitRef.current && resized)) return
    lastFitKeyRef.current = key
    commitFit(size.w, size.h)
  }, [fitKey, size.w, size.h, bounds, commitFit])

  // Centrar en un punto pedido desde fuera (hallazgo o tarea seleccionada).
  useEffect(() => {
    if (!focus || size.w < 10 || size.h < 10) return
    if (appliedFocusRef.current === focus.nonce) return
    appliedFocusRef.current = focus.nonce
    const base = viewRef.current ?? fitView(boundsRef.current, size.w, size.h)
    const scale = clampScale(Math.max(base.scale, Math.min(size.w, size.h) / (focus.span_m ?? 30)))
    commitView({ scale, tx: size.w / 2 - focus.x * scale, ty: size.h / 2 - focus.y * scale })
  }, [focus, size.w, size.h, commitView])

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const v = viewRef.current
      if (!v) return
      const scale = clampScale(v.scale * factor)
      const k = scale / v.scale
      commitView({ scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k })
    },
    [commitView],
  )

  const fitNow = useCallback(() => {
    if (size.w < 10 || size.h < 10) return
    commitFit(size.w, size.h)
  }, [size.w, size.h, commitFit])

  // Rueda: listener nativo no pasivo para poder evitar el scroll de la página.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const factor = Math.exp(-e.deltaY * unit * 0.0015)
      zoomAt(Math.min(4, Math.max(0.25, factor)), e.clientX - r.left, e.clientY - r.top)
    }
    svg.addEventListener("wheel", onWheel, { passive: false })
    return () => svg.removeEventListener("wheel", onWheel)
  }, [zoomAt])

  // --- Punteros ------------------------------------------------------------------

  function localPoint(e: { clientX: number; clientY: number }): Vec2 {
    const r = svgRef.current?.getBoundingClientRect()
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 }
  }

  function handleTap(p: Vec2, target: EventTarget | null) {
    const v = viewRef.current
    if (!v) return
    const meters = { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale }
    const now = typeof performance !== "undefined" ? performance.now() : 0
    const last = lastTapRef.current
    const isDouble = Boolean(last && now - last.t < 350 && Math.hypot(p.x - last.x, p.y - last.y) < 14)
    lastTapRef.current = isDouble ? null : { t: now, x: p.x, y: p.y }
    const active = activeLayerId != null ? layerById.get(activeLayerId) : undefined
    const norm = active ? fromLevelMeters(meters, layerFrameOf(active, frameOverrides)) : null
    const inside = Boolean(norm && norm.x >= 0 && norm.x <= 1 && norm.y >= 0 && norm.y <= 1)
    const info: PlanClickInfo = { meters, norm, inside, layerId: active?.id ?? null }

    if (mode === "navegar") {
      if (!selectable) return
      const findingId = attrFrom(target, "data-finding-id", svgRef.current)
      if (findingId != null) {
        onSelectFinding?.(findingId)
        return
      }
      const elementId = attrFrom(target, "data-element-id", svgRef.current)
      onSelectElement?.(elementId)
      return
    }
    onPlanClick?.(info)
    if (isDouble) onPlanDoubleClick?.(info)
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return
    const v = viewRef.current
    if (!v) return
    const p = localPoint(e)
    pointersRef.current.set(e.pointerId, p)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Algunos navegadores no permiten capturar punteros sintéticos.
    }
    if (pointersRef.current.size === 1) {
      gestureRef.current = { kind: "pan", id: e.pointerId, start: p, startView: v, moved: false, target: e.target }
    } else if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      gestureRef.current = {
        kind: "pinch",
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        startView: v,
      }
      setPanning(true)
    }
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const p = localPoint(e)
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, p)
      const g = gestureRef.current
      if (g?.kind === "pan" && g.id === e.pointerId) {
        const dx = p.x - g.start.x
        const dy = p.y - g.start.y
        if (!g.moved && Math.hypot(dx, dy) > TAP_SLOP) {
          g.moved = true
          setPanning(true)
          setHover(null)
        }
        if (g.moved) commitView({ ...g.startView, tx: g.startView.tx + dx, ty: g.startView.ty + dy })
      } else if (g?.kind === "pinch" && pointersRef.current.size >= 2) {
        const [a, b] = [...pointersRef.current.values()]
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const scale = clampScale((g.startView.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.startDist)
        const wx = (g.startMid.x - g.startView.tx) / g.startView.scale
        const wy = (g.startMid.y - g.startView.ty) / g.startView.scale
        commitView({ scale, tx: mid.x - wx * scale, ty: mid.y - wy * scale })
      }
      return
    }
    if (e.pointerType === "mouse") {
      const id = attrFrom(e.target, "data-element-id", svgRef.current)
      setHover((h) => (h && h.elementId === id && h.x === p.x && h.y === p.y ? h : { elementId: id, x: p.x, y: p.y }))
    }
  }

  function endPointer(e: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) {
    if (!pointersRef.current.delete(e.pointerId)) return
    const g = gestureRef.current
    if (g?.kind === "pan" && g.id === e.pointerId) {
      if (!g.moved && !cancelled) handleTap(localPoint(e), g.target)
      gestureRef.current = null
      setPanning(false)
      return
    }
    if (g?.kind === "pinch") {
      const rest = [...pointersRef.current.entries()]
      if (rest.length === 1 && viewRef.current) {
        // Tras pellizcar se sigue moviendo con el dedo que queda (sin contar como toque).
        gestureRef.current = { kind: "pan", id: rest[0][0], start: rest[0][1], startView: viewRef.current, moved: true, target: null }
      } else if (rest.length === 0) {
        gestureRef.current = null
        setPanning(false)
      }
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return
    const cx = size.w / 2
    const cy = size.h / 2
    const v = viewRef.current
    if (e.key === "+" || e.key === "=") zoomAt(1.4, cx, cy)
    else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.4, cx, cy)
    else if (e.key === "0") fitNow()
    else if (v && e.key === "ArrowLeft") commitView({ ...v, tx: v.tx + 60 })
    else if (v && e.key === "ArrowRight") commitView({ ...v, tx: v.tx - 60 })
    else if (v && e.key === "ArrowUp") commitView({ ...v, ty: v.ty + 60 })
    else if (v && e.key === "ArrowDown") commitView({ ...v, ty: v.ty - 60 })
    else return
    e.preventDefault()
  }

  // --- Render ------------------------------------------------------------------

  const v = view
  const toScreen = (m: Vec2): Vec2 => (v ? { x: m.x * v.scale + v.tx, y: m.y * v.scale + v.ty } : { x: 0, y: 0 })

  const visibleLabels: { id: number; text: string; x: number; y: number; color: string }[] = []
  if (v && labelAnchors.length > 0) {
    const cells = new Set<string>()
    for (const it of labelAnchors) {
      if (visibleLabels.length >= MAX_LABELS) break
      const x = it.m.x * v.scale + v.tx
      const y = it.m.y * v.scale + v.ty
      if (x < -40 || x > size.w + 40 || y < -12 || y > size.h + 12) continue
      const key = `${Math.floor(x / 96)}:${Math.floor(y / 22)}`
      if (cells.has(key)) continue
      cells.add(key)
      visibleLabels.push({ id: it.id, text: it.text, x, y, color: it.color })
    }
  }

  let scaleBar: { px: number; text: string } | null = null
  if (v) {
    const target = 110 / v.scale
    let best = SCALE_STEPS[0]
    for (const s of SCALE_STEPS) if (s <= target) best = s
    const px = best * v.scale
    scaleBar = { px, text: best < 1 ? `${formatNumberCL(best * 100, 0)} cm` : `${formatNumberCL(best, 0)} m` }
  }

  const hoverElement = hover?.elementId != null && !panning ? elementMap.get(hover.elementId) ?? null : null
  const hoverLayer = hoverElement ? layerById.get(hoverElement.layer_id) ?? null : null

  // Borrador (dibujo de elemento)
  let draftShape: { pts: Vec2[]; closed: boolean; color: string; rubber: Vec2 | null } | null = null
  if (v && draft && draft.points.length > 0) {
    const f = frameOf(draft.layerId)
    if (f) {
      const pts = draft.points.map((p) => toScreen(toLevelMeters(p, f)))
      const rubber =
        mode === "dibujar" && draft.type !== "point" && hover && !panning ? { x: hover.x, y: hover.y } : null
      draftShape = { pts, closed: draft.type === "polygon" && pts.length >= 3, color: draft.color ?? "#f3a40a", rubber }
    }
  }

  let markerPos: Vec2 | null = null
  if (v && marker) {
    const f = frameOf(marker.layerId)
    if (f) markerPos = toScreen(toLevelMeters({ x: marker.x, y: marker.y }, f))
  }

  const cursor = mode === "navegar" ? (panning ? "grabbing" : "grab") : "crosshair"

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full overflow-hidden rounded-[14px] border border-border bg-[#fbfaf6] dark:bg-[#1a160f]",
        className,
      )}
    >
      <p id={hintId} className="sr-only">
        Arrastra para mover el plano. Usa la rueda del mouse, el gesto de pellizcar o los botones para acercar y alejar.
        Con el teclado: flechas para mover, más y menos para el zoom, cero para encajar.
      </p>
      <svg
        ref={svgRef}
        role="application"
        aria-label={ariaLabel}
        aria-describedby={hintId}
        tabIndex={0}
        className="absolute inset-0 h-full w-full touch-none select-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHover(null)
        }}
        onKeyDown={onKeyDown}
      >
        {v ? (
          <>
            <g transform={`translate(${v.tx} ${v.ty}) scale(${v.scale})`}>
              {drawLayers.map((l) => (
                <LayerGroup
                  key={l.id}
                  layer={l}
                  frame={drawFrames.get(l.id) ?? layerFrameOf(l, frameOverrides)}
                  opacity={layerOpacity?.[l.id] ?? l.opacity}
                  elements={elementsByLayer.get(l.id) ?? EMPTY_ELEMENTS}
                  active={l.id === activeLayerId && (outlineActive ?? mode !== "navegar")}
                  selectable={selectable && mode === "navegar"}
                />
              ))}
            </g>

            {/* Correlaciones del hallazgo seleccionado: elemento resaltado + línea con distancia */}
            {correlationItems.map((it) => {
              const pts = it.metric.points.length <= 3000 ? it.metric.points.map(toScreen) : []
              const d = screenPath(pts, it.metric.type === "polygon")
              return (
                <g key={`hl-${it.c.element_id}`} pointerEvents="none">
                  {d ? (
                    it.ghost ? (
                      <path
                        d={it.metric.type === "point" ? `${d}l0.1 0` : d}
                        fill="none"
                        stroke={it.color}
                        strokeWidth={it.metric.type === "point" ? 10 : 2.5}
                        strokeDasharray={it.metric.type === "point" ? undefined : "3 5"}
                        strokeLinecap="round"
                        opacity={0.85}
                      />
                    ) : (
                      <path
                        d={it.metric.type === "point" ? `${d}l0.1 0` : d}
                        fill="none"
                        stroke={it.color}
                        strokeWidth={it.metric.type === "point" ? 18 : 8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.28}
                      />
                    )
                  ) : null}
                </g>
              )
            })}
            {correlationItems.map((it) => {
              const a = toScreen(it.pinM)
              const b = toScreen(it.near)
              const mx = (a.x + b.x) / 2
              const my = (a.y + b.y) / 2
              const rel = RELATION_SHORT[it.c.relation]
              const text = `${formatDistanceCl(it.c.distance_m)}${rel ? ` · ${rel}` : ""}`
              const wText = text.length * 6.4 + 14
              return (
                <g key={`ln-${it.c.element_id}`} pointerEvents="none">
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeWidth={4} strokeLinecap="round" opacity={0.7} />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={it.color}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    strokeLinecap="round"
                  />
                  <circle cx={b.x} cy={b.y} r={4.5} fill={it.color} stroke="#ffffff" strokeWidth={1.5} />
                  <g transform={`translate(${mx} ${my})`}>
                    <rect x={-wText / 2} y={-10} width={wText} height={20} rx={10} fill={it.color} />
                    <text
                      x={0}
                      y={4}
                      textAnchor="middle"
                      fontSize={11.5}
                      fontWeight={600}
                      fill="#ffffff"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {text}
                    </text>
                  </g>
                </g>
              )
            })}

            {/* Elemento seleccionado */}
            {selectedElement ? (
              <g pointerEvents="none">
                <path
                  d={(() => {
                    const d = screenPath(selectedElement.metric.points.map(toScreen), selectedElement.metric.type === "polygon")
                    return selectedElement.metric.type === "point" ? `${d}l0.1 0` : d
                  })()}
                  fill="none"
                  stroke="#f3a40a"
                  strokeWidth={selectedElement.metric.type === "point" ? 20 : 9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.45}
                />
              </g>
            ) : null}

            {/* Etiquetas de elementos */}
            {visibleLabels.length > 0 ? (
              <g pointerEvents="none" style={{ fontFamily: "var(--font-sans)" }}>
                {visibleLabels.map((l) => (
                  <text
                    key={`lb-${l.id}`}
                    x={l.x}
                    y={l.y - 7}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill={l.color}
                    stroke="var(--card)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                  >
                    {l.text}
                  </text>
                ))}
              </g>
            ) : null}

            {/* Borrador del elemento en dibujo */}
            {draftShape ? (
              <g pointerEvents="none">
                {draftShape.pts.length > 1 || draftShape.rubber ? (
                  <path
                    d={
                      screenPath(draftShape.pts, draftShape.closed) +
                      (draftShape.rubber && !draftShape.closed
                        ? `L${draftShape.rubber.x.toFixed(1)} ${draftShape.rubber.y.toFixed(1)}`
                        : "")
                    }
                    fill={draftShape.closed ? draftShape.color : "none"}
                    fillOpacity={draftShape.closed ? 0.15 : undefined}
                    stroke={draftShape.color}
                    strokeWidth={3}
                    strokeDasharray="8 5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
                {draftShape.pts.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={i === 0 ? 6.5 : 5}
                    fill="#ffffff"
                    stroke={draftShape.color}
                    strokeWidth={2.5}
                  />
                ))}
              </g>
            ) : null}

            {/* Pines de hallazgos (tamaño constante en pantalla) */}
            {pinItems.map(({ pin, m }) => {
              const s = toScreen(m)
              if (s.x < -40 || s.x > size.w + 40 || s.y < -40 || s.y > size.h + 60) return null
              const selected = pin.finding_id === selectedFindingId
              const closed = pin.status === "resolved" || pin.status === "closed"
              const color = SEVERITY_COLOR_VARS[pin.severity] ?? SEVERITY_COLOR_VARS.medium
              return (
                <g
                  key={`pin-${pin.finding_id}`}
                  transform={`translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) scale(${selected ? 1.35 : 1})`}
                  data-finding-id={pin.finding_id}
                  role={selectable ? "button" : undefined}
                  tabIndex={selectable ? 0 : undefined}
                  aria-label={`Hallazgo «${pin.title}», severidad ${(SEVERITY_LABELS[pin.severity] ?? pin.severity).toLowerCase()}${selected ? " (seleccionado)" : ""}`}
                  aria-pressed={selectable ? selected : undefined}
                  className="group cursor-pointer outline-none"
                  opacity={closed && !selected ? 0.55 : 1}
                  onKeyDown={(e) => {
                    if (!selectable) return
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      e.stopPropagation()
                      onSelectFinding?.(pin.finding_id)
                    }
                  }}
                >
                  <title>{pin.title}</title>
                  <circle cx={0} cy={-14} r={20} fill="transparent" />
                  {selected ? <circle cx={0} cy={-16} r={16} style={{ fill: color }} opacity={0.22} /> : null}
                  <circle
                    cx={0}
                    cy={-16}
                    r={14}
                    fill="none"
                    stroke="#f3a40a"
                    strokeWidth={3}
                    className="opacity-0 group-focus-visible:opacity-100"
                  />
                  <path
                    d="M0 0 C-3 -6 -9 -9.5 -9 -16 A9 9 0 1 1 9 -16 C9 -9.5 3 -6 0 0 Z"
                    style={{ fill: color }}
                    stroke="#ffffff"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  <circle cx={0} cy={-16} r={3.5} fill="#ffffff" />
                </g>
              )
            })}

            {/* Marca temporal (punto a reportar o tarea) */}
            {markerPos ? (
              <g transform={`translate(${markerPos.x.toFixed(1)} ${markerPos.y.toFixed(1)})`} pointerEvents="none">
                {marker?.kind === "task" ? (
                  <>
                    <rect x={-9} y={-9} width={18} height={18} transform="rotate(45)" fill="#f3a40a" stroke="#16130e" strokeWidth={2} />
                    {marker.label ? (
                      <text
                        y={-16}
                        textAnchor="middle"
                        fontSize={11.5}
                        fontWeight={600}
                        fill="#16130e"
                        stroke="#ffffff"
                        strokeWidth={3}
                        paintOrder="stroke"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        {marker.label.length > 40 ? `${marker.label.slice(0, 39)}…` : marker.label}
                      </text>
                    ) : null}
                  </>
                ) : (
                  <>
                    <circle r={18} fill="#f3a40a" fillOpacity={0.2} stroke="#f3a40a" strokeWidth={2} />
                    <circle r={5} fill="#f3a40a" stroke="#16130e" strokeWidth={2} />
                  </>
                )}
              </g>
            ) : null}
          </>
        ) : null}
      </svg>

      {/* Tooltip del elemento bajo el mouse */}
      {hoverElement && hover ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] shadow-md"
          style={{
            left: Math.min(hover.x + 14, Math.max(8, size.w - 270)),
            top: Math.min(hover.y + 14, Math.max(8, size.h - 120)),
          }}
        >
          <p className="flex items-center gap-1.5 font-semibold">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: elementColor(hoverElement, hoverLayer) }}
              aria-hidden
            />
            {ELEMENT_TYPE_LABELS[hoverElement.element_type] ?? hoverElement.element_type}
          </p>
          {hoverElement.label ? <p className="mt-0.5 break-words">«{hoverElement.label}»</p> : null}
          {elementDetails(hoverElement, hoverLayer).map((line) => (
            <p key={line} className="break-words text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {/* Escala */}
      {scaleBar ? (
        <div
          className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-card/90 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm"
          aria-hidden
        >
          <div className="h-1.5 border-x-2 border-b-2 border-foreground/70" style={{ width: Math.round(scaleBar.px) }} />
          <span>{scaleBar.text}</span>
        </div>
      ) : null}

      {/* Zoom */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col overflow-hidden rounded-[10px] border border-border bg-card shadow-sm">
        <button
          type="button"
          onClick={() => zoomAt(1.5, size.w / 2, size.h / 2)}
          aria-label="Acercar"
          title="Acercar"
          className="flex size-10 items-center justify-center outline-none hover:bg-secondary focus-visible:bg-secondary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => zoomAt(1 / 1.5, size.w / 2, size.h / 2)}
          aria-label="Alejar"
          title="Alejar"
          className="flex size-10 items-center justify-center border-t border-border outline-none hover:bg-secondary focus-visible:bg-secondary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={fitNow}
          aria-label="Encajar el plano en la pantalla"
          title="Encajar"
          className="flex size-10 items-center justify-center border-t border-border outline-none hover:bg-secondary focus-visible:bg-secondary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <Maximize className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {children}
    </div>
  )
}
