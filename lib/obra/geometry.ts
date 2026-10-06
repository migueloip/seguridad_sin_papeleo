/**
 * Geometría pura del módulo Obra Integral (sin BD ni servidor; usable en cliente).
 *
 * Sistemas de coordenadas:
 * - Normalizadas (NormPoint): {x, y} en [0, 1] sobre la lámina de una capa,
 *   con (0, 0) en la esquina superior izquierda y el eje y hacia abajo.
 * - Metros del nivel (Vec2): marco común a todas las capas de un mismo nivel.
 *   Cada capa se lleva a ese marco con su LayerFrame:
 *     local = (x·width_m, y·width_m·aspect)
 *     mundo = rotar(local, rotation_deg) + (offset_x_m, offset_y_m)
 *   La rotación es en sentido horario visto en pantalla (eje y hacia abajo):
 *     x' = x·cosθ − y·sinθ,  y' = x·sinθ + y·cosθ
 *
 * Se asume que los marcos de niveles adyacentes están alineados en planta
 * (mismo origen y orientación), de modo que la distancia en planta entre un
 * punto de un nivel y un elemento del nivel de arriba o de abajo tiene sentido.
 */
import type { ElementGeometry, LayerFrame, NormPoint, Vec2 } from "./types"

/** Marco por defecto de una capa nueva (lámina de 50 m de ancho, proporción 0,7). */
export const DEFAULT_FRAME: LayerFrame = Object.freeze({
  width_m: 50,
  aspect: 0.7,
  offset_x_m: 0,
  offset_y_m: 0,
  rotation_deg: 0,
})

/** Máximo de puntos por geometría (protege la BD y el render). */
export const MAX_GEOMETRY_POINTS = 5000

const GEOMETRY_TYPES = ["point", "polyline", "polygon"] as const

/** Limita un número a [0, 1]. NaN se considera 0. */
export function clamp01(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Normaliza un marco que puede venir incompleto o con valores inválidos
 * (p.ej. leído de la BD o de un formulario): ancho y proporción deben ser
 * positivos; desplazamientos y rotación finitos (si no, se usa el valor por
 * defecto).
 */
export function sanitizeFrame(f: Partial<LayerFrame> | null | undefined): LayerFrame {
  const width = toFiniteNumber(f?.width_m)
  const aspect = toFiniteNumber(f?.aspect)
  return {
    width_m: width != null && width > 0 ? width : DEFAULT_FRAME.width_m,
    aspect: aspect != null && aspect > 0 ? aspect : DEFAULT_FRAME.aspect,
    offset_x_m: toFiniteNumber(f?.offset_x_m) ?? 0,
    offset_y_m: toFiniteNumber(f?.offset_y_m) ?? 0,
    rotation_deg: toFiniteNumber(f?.rotation_deg) ?? 0,
  }
}

/** cos y sin exactos para múltiplos de 90° (evita residuos como 6e-17). */
function cosSin(deg: number): [number, number] {
  const d = ((deg % 360) + 360) % 360
  if (d === 0) return [1, 0]
  if (d === 90) return [0, 1]
  if (d === 180) return [-1, 0]
  if (d === 270) return [0, -1]
  const t = (d * Math.PI) / 180
  return [Math.cos(t), Math.sin(t)]
}

type Transform = (p: NormPoint) => Vec2

function makeToLevelMeters(frame: LayerFrame): Transform {
  const f = sanitizeFrame(frame)
  const [c, s] = cosSin(f.rotation_deg)
  const sx = f.width_m
  const sy = f.width_m * f.aspect
  return (p) => {
    const lx = p.x * sx
    const ly = p.y * sy
    return { x: lx * c - ly * s + f.offset_x_m, y: lx * s + ly * c + f.offset_y_m }
  }
}

/** Convierte un punto normalizado de una capa a metros del nivel. */
export function toLevelMeters(p: NormPoint, f: LayerFrame): Vec2 {
  return makeToLevelMeters(f)(p)
}

/** Inversa exacta de toLevelMeters: metros del nivel → punto normalizado de la capa (sin recortar a [0, 1]). */
export function fromLevelMeters(p: Vec2, f: LayerFrame): NormPoint {
  const fr = sanitizeFrame(f)
  const [c, s] = cosSin(fr.rotation_deg)
  const dx = p.x - fr.offset_x_m
  const dy = p.y - fr.offset_y_m
  // Rotación inversa (transpuesta): local = Rᵀ · (mundo − offset)
  const lx = dx * c + dy * s
  const ly = -dx * s + dy * c
  return { x: lx / fr.width_m, y: ly / (fr.width_m * fr.aspect) }
}

/** Distancia euclídea de un punto a un segmento [a, b] (en las mismas unidades). */
export function distancePointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * ¿El punto está dentro del polígono? Regla par-impar (sirve para polígonos
 * cóncavos). El polígono puede venir cerrado o abierto (se cierra solo).
 */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  if (!Array.isArray(poly) || poly.length < 3) return false
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y) {
      const xCross = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      if (p.x < xCross) inside = !inside
    }
  }
  return inside
}

/** Área (valor absoluto, fórmula del área de Gauss) de un polígono; 0 si tiene menos de 3 puntos. */
export function polygonArea(poly: Vec2[]): number {
  if (!Array.isArray(poly) || poly.length < 3) return 0
  let twice = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    twice += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
  }
  return Math.abs(twice) / 2
}

/** Geometría ya convertida a metros del nivel. */
export type MetricGeometry = { type: ElementGeometry["type"]; points: Vec2[] }

/** Convierte todos los puntos de una geometría normalizada a metros del nivel. */
export function geometryToMeters(g: ElementGeometry, f: LayerFrame): MetricGeometry {
  const t = makeToLevelMeters(f)
  return { type: g.type, points: g.points.map((p) => t(p)) }
}

/**
 * Distancia (m) de un punto a una geometría en metros:
 * - point: distancia euclídea;
 * - polyline: mínima a sus segmentos;
 * - polygon: 0 si el punto está dentro; si no, mínima a sus bordes (incluido el cierre).
 * Devuelve Infinity si la geometría no tiene puntos.
 */
export function distancePointToGeometryMeters(p: Vec2, g: MetricGeometry): number {
  const pts = g?.points ?? []
  if (pts.length === 0) return Infinity
  if (g.type === "point" || pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y)
  const closed = g.type === "polygon" && pts.length >= 3
  if (closed && pointInPolygon(p, pts)) return 0
  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distancePointToSegment(p, pts[i], pts[i + 1])
    if (d < min) min = d
  }
  if (closed) {
    const d = distancePointToSegment(p, pts[pts.length - 1], pts[0])
    if (d < min) min = d
  }
  return min
}

function isNormPoint(v: unknown): v is NormPoint {
  if (!v || typeof v !== "object") return false
  const { x, y } = v as { x?: unknown; y?: unknown }
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1
  )
}

/**
 * Valida una geometría recibida de fuera (cliente, IA, DXF, BD): tipo
 * conocido, puntos finitos dentro de [0, 1] y cantidad correcta
 * (point = 1, polyline ≥ 2, polygon ≥ 3; máximo MAX_GEOMETRY_POINTS).
 */
export function isValidGeometry(g: unknown): g is ElementGeometry {
  if (!g || typeof g !== "object" || Array.isArray(g)) return false
  const { type, points } = g as { type?: unknown; points?: unknown }
  if (typeof type !== "string" || !(GEOMETRY_TYPES as readonly string[]).includes(type)) return false
  if (!Array.isArray(points) || points.length > MAX_GEOMETRY_POINTS) return false
  if (type === "point" && points.length !== 1) return false
  if (type === "polyline" && points.length < 2) return false
  if (type === "polygon" && points.length < 3) return false
  for (const pt of points) {
    if (!isNormPoint(pt)) return false
  }
  return true
}

function round6(n: number): number {
  const r = Math.round(n * 1e6) / 1e6
  return r === 0 ? 0 : r // evita -0
}

/** Recorta los puntos a [0, 1], redondea a 6 decimales y descarta propiedades extra. */
export function normalizeGeometry(g: ElementGeometry): ElementGeometry {
  const pts = g.points.map((p) => ({ x: round6(clamp01(p.x)), y: round6(clamp01(p.y)) }))
  if (g.type === "point") return { type: "point", points: [pts[0]] }
  return { type: g.type, points: pts }
}
