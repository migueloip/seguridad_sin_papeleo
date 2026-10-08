/**
 * Mapa de calor de hallazgos (puro, usable en cliente y servidor).
 *
 * Cada hallazgo ubicado aporta calor alrededor de su punto, en metros del
 * nivel, con un núcleo gaussiano pesado por gravedad: crítica 8, alta 4,
 * media 2, baja 1; resuelto o cerrado ×0,25 (si el filtro los incluye). La
 * escala es absoluta hasta saturar: un solo hallazgo crítico (o dos altos
 * juntos) ya se ve rojo, uno bajo apenas amarillo; si una zona acumula más
 * que eso, la escala pasa a ser relativa a la zona más caliente.
 *
 * Lo usan el visor 2D (imagen sobre el plano) y el 3D (textura sobre el piso
 * de cada nivel, con una escala común a todos los niveles).
 */
import { addDaysISO, todayISO } from "./metrics"
import { toLevelMeters } from "./geometry"
import type { FindingCategory, FindingPin, LayerFrame, Severity } from "./types"

export const HEAT_SEVERITY_WEIGHT: Record<Severity, number> = { low: 1, medium: 2, high: 4, critical: 8 }
/** Factor de un hallazgo resuelto o cerrado (cuando el filtro los incluye). */
export const HEAT_RESOLVED_FACTOR = 0.25
/** Calor que se ve rojo pleno: un hallazgo crítico en su centro. */
export const HEAT_FULL_SCALE = HEAT_SEVERITY_WEIGHT.critical

export const HEAT_PERIODS = [30, 90, 365] as const
export type HeatPeriod = (typeof HEAT_PERIODS)[number] | null

export type HeatFilter = {
  /** "abiertos": abiertos y en curso; "todos": también resueltos y cerrados (con menos peso). */
  status: "abiertos" | "todos"
  /** Solo los reportados en los últimos N días (null = todos). */
  period_days: HeatPeriod
  /** Categorías incluidas (null o vacío = todas). */
  categories: FindingCategory[] | null
}

export const DEFAULT_HEAT_FILTER: HeatFilter = { status: "abiertos", period_days: null, categories: null }

export type HeatPoint = { x: number; y: number; weight: number }
export type HeatBounds = { minX: number; minY: number; maxX: number; maxY: number }

export type HeatGrid = {
  /** Esquina superior izquierda de la celda (0,0), en metros del nivel. */
  minX: number
  minY: number
  /** Lado de cada celda (m). */
  cell: number
  cols: number
  rows: number
  /** Calor por celda (fila por fila), medido en el centro de la celda. */
  values: Float32Array
  /** Calor máximo de la grilla. */
  max: number
}

export type HeatGridOptions = {
  /** Lado de celda deseado (m); crece si la grilla supera max_side celdas por lado. */
  cell_m?: number
  /** Radio de influencia de un hallazgo (m): a esa distancia aporta ~13 % de su peso. */
  radius_m?: number
  /** Máximo de celdas por lado (limita memoria y tiempo). */
  max_side?: number
}

export const HEAT_DEFAULTS = { cell_m: 0.25, radius_m: 2.5, max_side: 400 } as const

const OPEN_STATUSES: ReadonlySet<FindingPin["status"]> = new Set(["open", "in_progress"])

/** Día (YYYY-MM-DD, hora de Chile) de una fecha ISO; null si no se puede leer. */
function dayOf(iso: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const t = Date.parse(iso)
  return Number.isFinite(t) ? todayISO(new Date(t)) : null
}

/**
 * Peso de un hallazgo en el mapa con ese filtro (0 = no entra).
 * `today` es "YYYY-MM-DD" (día de Chile): el período cuenta hacia atrás desde él, incluido.
 */
export function findingHeatWeight(
  pin: Pick<FindingPin, "severity" | "status" | "category" | "created_at">,
  filter: HeatFilter,
  today: string = todayISO(),
): number {
  const open = OPEN_STATUSES.has(pin.status)
  if (!open && filter.status === "abiertos") return 0
  if (filter.categories && filter.categories.length > 0 && !filter.categories.includes(pin.category)) return 0
  if (filter.period_days != null) {
    const day = dayOf(pin.created_at)
    if (!day || day < addDaysISO(today, -(filter.period_days - 1))) return 0
  }
  const base = HEAT_SEVERITY_WEIGHT[pin.severity] ?? HEAT_SEVERITY_WEIGHT.medium
  return open ? base : base * HEAT_RESOLVED_FACTOR
}

/**
 * Puntos de calor (metros del nivel) de los hallazgos de un nivel. `frameOf` entrega el marco
 * de la capa de cada pin (null si la capa no se conoce: el pin se omite).
 */
export function heatPointsFor(
  pins: readonly FindingPin[],
  frameOf: (layerId: number) => LayerFrame | null,
  filter: HeatFilter,
  today: string = todayISO(),
  level?: number | null,
): HeatPoint[] {
  const out: HeatPoint[] = []
  for (const pin of pins) {
    if (level != null && pin.level !== level) continue
    const weight = findingHeatWeight(pin, filter, today)
    if (weight <= 0) continue
    const f = frameOf(pin.layer_id)
    if (!f) continue
    const m = toLevelMeters({ x: pin.x, y: pin.y }, f)
    if (Number.isFinite(m.x) && Number.isFinite(m.y)) out.push({ x: m.x, y: m.y, weight })
  }
  return out
}

/** Cantidad de hallazgos que entran en el mapa con ese filtro (todos los niveles o uno). */
export function countHeatFindings(
  pins: readonly FindingPin[],
  filter: HeatFilter,
  today: string = todayISO(),
  level?: number | null,
): number {
  let n = 0
  for (const p of pins) if ((level == null || p.level === level) && findingHeatWeight(p, filter, today) > 0) n += 1
  return n
}

/**
 * Grilla de calor sobre `bounds` (se amplía para que quepa el halo de cada punto).
 * Núcleo gaussiano con σ = radius_m / 2, recortado a 1,5 × radius_m.
 */
export function computeHeatGrid(points: readonly HeatPoint[], bounds: HeatBounds, opts: HeatGridOptions = {}): HeatGrid {
  const radius = Math.max(0.1, opts.radius_m ?? HEAT_DEFAULTS.radius_m)
  const maxSide = Math.max(8, Math.floor(opts.max_side ?? HEAT_DEFAULTS.max_side))
  const pad = radius * 1.5
  let minX = Math.min(bounds.minX, bounds.maxX)
  let minY = Math.min(bounds.minY, bounds.maxY)
  let maxX = Math.max(bounds.minX, bounds.maxX)
  let maxY = Math.max(bounds.minY, bounds.maxY)
  for (const p of points) {
    if (p.x - pad < minX) minX = p.x - pad
    if (p.y - pad < minY) minY = p.y - pad
    if (p.x + pad > maxX) maxX = p.x + pad
    if (p.y + pad > maxY) maxY = p.y + pad
  }
  const w = Math.max(maxX - minX, 0.01)
  const h = Math.max(maxY - minY, 0.01)
  const cell = Math.max(opts.cell_m ?? HEAT_DEFAULTS.cell_m, w / maxSide, h / maxSide, 0.01)
  const cols = Math.max(1, Math.ceil(w / cell))
  const rows = Math.max(1, Math.ceil(h / cell))
  const values = new Float32Array(cols * rows)

  const sigma = radius / 2
  const inv2s2 = 1 / (2 * sigma * sigma)
  const cutoff = radius * 1.5
  const cut2 = cutoff * cutoff
  for (const p of points) {
    if (!(p.weight > 0)) continue
    const c0 = Math.max(0, Math.floor((p.x - cutoff - minX) / cell))
    const c1 = Math.min(cols - 1, Math.floor((p.x + cutoff - minX) / cell))
    const r0 = Math.max(0, Math.floor((p.y - cutoff - minY) / cell))
    const r1 = Math.min(rows - 1, Math.floor((p.y + cutoff - minY) / cell))
    for (let r = r0; r <= r1; r++) {
      const dy = minY + (r + 0.5) * cell - p.y
      const dy2 = dy * dy
      if (dy2 > cut2) continue
      const row = r * cols
      for (let c = c0; c <= c1; c++) {
        const dx = minX + (c + 0.5) * cell - p.x
        const d2 = dx * dx + dy2
        if (d2 > cut2) continue
        values[row + c] += p.weight * Math.exp(-d2 * inv2s2)
      }
    }
  }
  let max = 0
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i]
  return { minX, minY, cell, cols, rows, values, max }
}

/** Valor que se pinta rojo pleno: el mayor entre la escala absoluta y el máximo de las grillas. */
export function heatScaleMax(...grids: (HeatGrid | null | undefined)[]): number {
  let m = HEAT_FULL_SCALE
  for (const g of grids) if (g && g.max > m) m = g.max
  return m
}

/** Bajo esta intensidad (0–1) la celda queda transparente. */
export const HEAT_MIN_INTENSITY = 0.03

// Rampa: transparente → amarillo → naranjo → rojo → rojo oscuro.
const RAMP: [number, number, number, number, number][] = [
  // t, r, g, b, a(0–1)
  [0, 250, 204, 21, 0],
  [0.12, 250, 204, 21, 0.35],
  [0.4, 249, 115, 22, 0.55],
  [0.75, 220, 38, 38, 0.68],
  [1, 127, 29, 29, 0.78],
]

/** Color (RGBA 0–255) de una intensidad 0–1 en la rampa del mapa. */
export function heatColor(t: number): [number, number, number, number] {
  if (!(t > HEAT_MIN_INTENSITY)) return [0, 0, 0, 0]
  const x = Math.min(1, t)
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, r1, g1, b1, a1] = RAMP[i]
    if (x <= t1) {
      const [t0, r0, g0, b0, a0] = RAMP[i - 1]
      const k = (x - t0) / (t1 - t0)
      return [
        Math.round(r0 + (r1 - r0) * k),
        Math.round(g0 + (g1 - g0) * k),
        Math.round(b0 + (b1 - b0) * k),
        Math.round((a0 + (a1 - a0) * k) * 255),
      ]
    }
  }
  const last = RAMP[RAMP.length - 1]
  return [last[1], last[2], last[3], Math.round(last[4] * 255)]
}

/** Píxeles RGBA (cols × rows, fila 0 arriba = minY) listos para un ImageData o una textura. */
export function heatGridToRgba(grid: HeatGrid, scaleMax: number = heatScaleMax(grid), alpha = 1): Uint8ClampedArray {
  const out = new Uint8ClampedArray(grid.cols * grid.rows * 4)
  const k = scaleMax > 0 ? 1 / scaleMax : 0
  const a = Math.max(0, Math.min(1, alpha))
  for (let i = 0; i < grid.values.length; i++) {
    const v = grid.values[i]
    if (v <= 0) continue
    const [r, g, b, al] = heatColor(v * k)
    const o = i * 4
    out[o] = r
    out[o + 1] = g
    out[o + 2] = b
    out[o + 3] = Math.round(al * a)
  }
  return out
}

/** Centro (metros del nivel) y valor de la celda más caliente; null si no hay calor. */
export function hottestCell(grid: HeatGrid): { x: number; y: number; value: number } | null {
  if (!(grid.max > 0)) return null
  for (let i = 0; i < grid.values.length; i++) {
    if (grid.values[i] === grid.max) {
      const c = i % grid.cols
      const r = Math.floor(i / grid.cols)
      return { x: grid.minX + (c + 0.5) * grid.cell, y: grid.minY + (r + 0.5) * grid.cell, value: grid.max }
    }
  }
  return null
}
