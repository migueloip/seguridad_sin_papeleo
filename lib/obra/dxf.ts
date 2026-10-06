/**
 * Importación de planos DXF (ASCII) para Obra Integral.
 *
 * Parser mínimo y puro (sin dependencias, usable en el navegador) más el mapeo
 * de nombres de capa CAD típicos en Chile a tipos de elemento, y la conversión
 * a borradores de elementos en coordenadas normalizadas de la lámina.
 *
 * Alcance deliberado:
 * - Lee HEADER ($INSUNITS), TABLES (capas) y ENTITIES. El contenido de BLOCKS
 *   se ignora: un INSERT queda como un punto en su punto de inserción.
 * - Entidades: LINE, LWPOLYLINE, POLYLINE/VERTEX/SEQEND, POINT, CIRCLE, ARC
 *   (aprox. con 12 segmentos), SPLINE (aproximada), INSERT, TEXT, MTEXT y
 *   ATTRIB. El resto (cotas, achurados...) se cuenta en una advertencia.
 * - Se omite el espacio papel (código 67 = 1): marcos y viñetas de las
 *   presentaciones descuadrarían la extensión del plano.
 * - Nunca lanza por una entidad rota: la omite y deja una advertencia. Solo
 *   lanza si el archivo es DXF binario o DWG.
 *
 * Flujo típico en la UI:
 *   const parsed = parseDxf(await readTextFile(file))
 *   const mapping = suggestLayerMapping(parsed)   // el usuario lo revisa
 *   const { drafts, aspect, suggested_width_m } = dxfToElementDrafts(parsed, mapping)
 */
import {
  DISCIPLINES,
  ELEMENT_TYPE_DISCIPLINE,
  ELEMENT_TYPES,
  type Discipline,
  type ElementAttributes,
  type ElementGeometry,
  type ElementType,
  type NormPoint,
  type PlanElementDraft,
  type Vec2,
} from "./types"

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type DxfEntityKind = "line" | "polyline" | "point" | "circle" | "insert" | "text"

export type DxfEntity = {
  kind: DxfEntityKind
  layer: string
  /** Coordenadas en unidades del dibujo (sistema universal, Y hacia arriba). */
  points: Vec2[]
  closed?: boolean
  radius?: number
  block?: string
  text?: string
}

export type DxfExtents = { minX: number; minY: number; maxX: number; maxY: number }

export type ParsedDxf = {
  /** Capas de la tabla LAYER más las que solo aparecen en entidades (sin duplicados, sin distinguir mayúsculas). */
  layers: string[]
  entities: DxfEntity[]
  /** Valor de $INSUNITS (0 = sin unidad) o null si el archivo no lo declara. */
  insunits: number | null
  /** Extensión calculada a partir de las entidades importadas (no de $EXTMIN/$EXTMAX). */
  extents: DxfExtents | null
  warnings: string[]
}

/** Capa CAD → tipo de elemento (null = no importar esa capa). */
export type DxfLayerMapping = Record<string, ElementType | null>

export type DxfToDraftsOptions = {
  /** Máximo de elementos a generar (por defecto 4000). */
  maxElements?: number
  /** Usar el texto más cercano de la misma capa como etiqueta (por defecto true). */
  labelFromText?: boolean
}

export type DxfToDraftsResult = {
  drafts: PlanElementDraft[]
  /** Alto / ancho de la lámina (para LayerFrame.aspect). */
  aspect: number
  /** Ancho de la lámina en unidades del dibujo. */
  width_units: number
  /** Ancho real sugerido en metros según $INSUNITS (null si no se puede saber). */
  suggested_width_m: number | null
  /** Elementos que no se generaron por superar maxElements. */
  skipped: number
  /** Elementos generados por capa. */
  per_layer: Record<string, number>
  /** Avisos de la conversión (unidades supuestas, entidades degeneradas...). */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const DXF_UNSUPPORTED_FORMAT_MESSAGE = "Formato no soportado: exporta el plano como DXF ASCII"
export const DXF_ARC_SEGMENTS = 12
export const DXF_DEFAULT_MAX_ELEMENTS = 4000
/** Igual al máximo de puntos que acepta isValidGeometry (lib/obra/geometry.ts). */
export const DXF_MAX_POINTS_PER_ELEMENT = 5000
/** Tolerancia de Douglas-Peucker, como fracción del ancho de la lámina. */
export const DXF_SIMPLIFY_TOLERANCE = 0.0005
/** Distancia máxima texto-elemento para usarlo como etiqueta, como fracción del ancho. */
export const DXF_LABEL_MAX_DISTANCE = 0.02
export const DXF_LABEL_MAX_LENGTH = 120

/** Factor $INSUNITS → metros (solo unidades lineales comunes). */
export const DXF_INSUNITS_TO_METERS: Readonly<Record<number, number>> = {
  1: 0.0254, // pulgadas
  2: 0.3048, // pies
  4: 0.001, // milímetros
  5: 0.01, // centímetros
  6: 1, // metros
  7: 1000, // kilómetros
  10: 0.9144, // yardas
  14: 0.1, // decímetros
}

export const DXF_INSUNITS_LABELS: Readonly<Record<number, string>> = {
  0: "sin unidad",
  1: "pulgadas",
  2: "pies",
  4: "milímetros",
  5: "centímetros",
  6: "metros",
  7: "kilómetros",
  10: "yardas",
  14: "decímetros",
}

const MAX_ENTITY_WARNINGS = 40
const MAX_ABS_COORD = 1e12
const MAX_ENTITIES = 400_000
const MAX_TEXT_LENGTH = 500
const CODE_LINE_RE = /^-?\d{1,6}$/

/** Metros por unidad del dibujo según $INSUNITS, o null si es desconocida. */
export function dxfUnitsToMeters(insunits: number | null | undefined): number | null {
  if (insunits == null) return null
  return DXF_INSUNITS_TO_METERS[insunits] ?? null
}

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

class WarningList {
  private readonly items: string[] = []
  private extra = 0

  add(message: string): void {
    if (this.items.length < MAX_ENTITY_WARNINGS) this.items.push(message)
    else this.extra++
  }

  toArray(): string[] {
    return this.extra > 0 ? [...this.items, `…y ${this.extra} advertencias más.`] : [...this.items]
  }
}

function toNum(v: string | undefined): number {
  if (v === undefined) return NaN
  const t = v.trim()
  if (t === "") return NaN
  const n = Number(t)
  return Number.isFinite(n) && Math.abs(n) <= MAX_ABS_COORD ? n : NaN
}

function toInt(v: string | undefined, fallback = 0): number {
  const n = toNum(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function isFinitePoint(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** Distancia al cuadrado de p al segmento ab. */
function segDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return dist2(p, a)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const qx = a.x + t * dx
  const qy = a.y + t * dy
  const ex = p.x - qx
  const ey = p.y - qy
  return ex * ex + ey * ey
}

/** Quita tildes y pasa a mayúsculas. */
function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
}

// ---------------------------------------------------------------------------
// Detección de formatos no soportados
// ---------------------------------------------------------------------------

function assertAsciiDxf(text: string): void {
  const head = text.slice(0, 4096)
  if (head.startsWith("AutoCAD Binary DXF")) throw new Error(DXF_UNSUPPORTED_FORMAT_MESSAGE)
  // Firmas de DWG: "AC1015", "AC1032", "AC1.50", "MC0.0"...
  if (/^(AC1\d{3}|AC[12]\.\d|MC0\.0)/.test(head)) throw new Error(DXF_UNSUPPORTED_FORMAT_MESSAGE)
  let bad = 0
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i)
    if (c === 0 || c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++
  }
  if (head.length > 0 && bad / head.length > 0.1) throw new Error(DXF_UNSUPPORTED_FORMAT_MESSAGE)
}

// ---------------------------------------------------------------------------
// Lector de pares código/valor (recorre el texto una sola vez)
// ---------------------------------------------------------------------------

class PairReader {
  private pos = 0
  private readonly text: string
  /** Número de la última línea leída (1 = primera). */
  line = 0
  code = 0
  value = ""
  /** Líneas de código no numéricas que se saltaron para resincronizar. */
  badLines = 0
  firstBadLine = 0

  constructor(text: string) {
    this.text = text
  }

  private readLine(): string | null {
    const t = this.text
    if (this.pos >= t.length) return null
    let end = t.indexOf("\n", this.pos)
    if (end === -1) end = t.length
    const s = t.slice(this.pos, end)
    this.pos = end + 1
    this.line++
    return s
  }

  next(): boolean {
    for (;;) {
      const raw = this.readLine()
      if (raw === null) return false
      const c = raw.trim()
      if (!CODE_LINE_RE.test(c)) {
        if (c !== "") {
          this.badLines++
          if (!this.firstBadLine) this.firstBadLine = this.line
        }
        continue
      }
      const v = this.readLine()
      if (v === null) return false
      this.code = Number(c)
      this.value = v.trim()
      return true
    }
  }
}

// ---------------------------------------------------------------------------
// Geometría auxiliar del parser (OCS, arcos, bulges, splines)
// ---------------------------------------------------------------------------

type RawEntity = { type: string; line: number; codes: number[]; values: string[] }
type PointTransform = (p: Vec2) => Vec2
type BulgeVertex = { x: number; y: number; b: number }

function rawGet(e: RawEntity, code: number): string | undefined {
  const i = e.codes.indexOf(code)
  return i === -1 ? undefined : e.values[i]
}

function rawPoint(e: RawEntity, cx: number, cy: number): Vec2 | null {
  const x = toNum(rawGet(e, cx))
  const y = toNum(rawGet(e, cy))
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

/**
 * Transformación del sistema de coordenadas del objeto (OCS) al universal,
 * según la dirección de extrusión (210/220/230) y el "arbitrary axis
 * algorithm" de AutoCAD. null = identidad (extrusión 0,0,1).
 */
function ocsTransform(e: RawEntity): PointTransform | null {
  const nx0 = toNum(rawGet(e, 210))
  const ny0 = toNum(rawGet(e, 220))
  const nz0 = toNum(rawGet(e, 230))
  const vx = Number.isFinite(nx0) ? nx0 : 0
  const vy = Number.isFinite(ny0) ? ny0 : 0
  const vz = Number.isFinite(nz0) ? nz0 : 1
  const len = Math.sqrt(vx * vx + vy * vy + vz * vz)
  if (!(len > 1e-12)) return null
  const nx = vx / len
  const ny = vy / len
  const nz = vz / len
  if (Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12 && nz > 0) return null
  let ax: number
  let ay: number
  let az: number
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) {
    // Ax = Wy × N
    ax = nz
    ay = 0
    az = -nx
  } else {
    // Ax = Wz × N
    ax = -ny
    ay = nx
    az = 0
  }
  const al = Math.sqrt(ax * ax + ay * ay + az * az)
  ax /= al
  ay /= al
  az /= al
  // Ay = N × Ax
  const bx = ny * az - nz * ay
  const by = nz * ax - nx * az
  return (p) => ({ x: p.x * ax + p.y * bx, y: p.x * ay + p.y * by })
}

function applyTransform(points: Vec2[], tf: PointTransform | null): Vec2[] {
  return tf ? points.map(tf) : points
}

/** Arco (ángulos en grados, sentido antihorario) aproximado con `segments` tramos. */
function arcPoints(
  c: Vec2,
  r: number,
  startDeg: number,
  endDeg: number,
  segments: number,
): { points: Vec2[]; closed: boolean } {
  let sweep = (((endDeg - startDeg) % 360) + 360) % 360
  if (sweep < 1e-9) sweep = 360
  const full = sweep >= 360 - 1e-9
  const a0 = (startDeg * Math.PI) / 180
  const s = (sweep * Math.PI) / 180
  const points: Vec2[] = []
  const last = full ? segments - 1 : segments
  for (let i = 0; i <= last; i++) {
    const a = a0 + (s * i) / segments
    points.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
  }
  return { points, closed: full }
}

/** Puntos intermedios del arco definido por un "bulge" entre p0 y p1 (sin los extremos). */
function bulgeArc(p0: Vec2, p1: Vec2, bulge: number): Vec2[] {
  const theta = 4 * Math.atan(bulge)
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const d = Math.sqrt(dx * dx + dy * dy)
  if (!(d > 0) || !Number.isFinite(theta)) return []
  const tanHalf = Math.tan(theta / 2)
  if (!Number.isFinite(tanHalf) || Math.abs(tanHalf) < 1e-12) return []
  // Distancia (con signo) del punto medio al centro, sobre la normal izquierda.
  const h = d / 2 / tanHalf
  const cx = (p0.x + p1.x) / 2 + (-dy / d) * h
  const cy = (p0.y + p1.y) / 2 + (dx / d) * h
  const r = Math.sqrt((p0.x - cx) ** 2 + (p0.y - cy) ** 2)
  const a0 = Math.atan2(p0.y - cy, p0.x - cx)
  const segs = Math.min(24, Math.max(2, Math.ceil((Math.abs(theta) / (2 * Math.PI)) * 24)))
  const out: Vec2[] = []
  for (let k = 1; k < segs; k++) {
    const a = a0 + (theta * k) / segs
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return out
}

function expandBulges(verts: BulgeVertex[], closed: boolean): Vec2[] {
  const out: Vec2[] = []
  const n = verts.length
  for (let i = 0; i < n; i++) {
    const a = verts[i]
    out.push({ x: a.x, y: a.y })
    const hasNext = i < n - 1 || (closed && n > 2)
    if (hasNext && Math.abs(a.b) > 1e-9) {
      const b = verts[(i + 1) % n]
      for (const p of bulgeArc(a, b, a.b)) out.push(p)
    }
  }
  return out
}

/** Evalúa una B-spline (racional si hay pesos) con el algoritmo de De Boor. */
function evalBSpline(ctrl: Vec2[], weights: number[], knots: number[], degree: number, samples: number): Vec2[] | null {
  const n = ctrl.length
  if (degree < 1 || n <= degree || knots.length !== n + degree + 1) return null
  for (let i = 1; i < knots.length; i++) if (knots[i] < knots[i - 1]) return null
  const t0 = knots[degree]
  const t1 = knots[n]
  if (!(t1 > t0)) return null
  const useWeights = weights.length === n && weights.every((w) => w > 0)
  const out: Vec2[] = []
  for (let s = 0; s <= samples; s++) {
    const t = t0 + ((t1 - t0) * s) / samples
    let k = degree
    while (k < n - 1 && t >= knots[k + 1]) k++
    const d: Array<[number, number, number]> = []
    for (let j = 0; j <= degree; j++) {
      const p = ctrl[k - degree + j]
      const w = useWeights ? weights[k - degree + j] : 1
      d.push([p.x * w, p.y * w, w])
    }
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j
        const denom = knots[i + degree - r + 1] - knots[i]
        const alpha = denom === 0 ? 0 : (t - knots[i]) / denom
        const a = d[j - 1]
        const b = d[j]
        d[j] = [(1 - alpha) * a[0] + alpha * b[0], (1 - alpha) * a[1] + alpha * b[1], (1 - alpha) * a[2] + alpha * b[2]]
      }
    }
    const [X, Y, W] = d[degree]
    if (!(W !== 0)) return null
    out.push({ x: X / W, y: Y / W })
  }
  return out.every(isFinitePoint) ? out : null
}

// ---------------------------------------------------------------------------
// Limpieza de textos (TEXT / MTEXT)
// ---------------------------------------------------------------------------

/** Quita los códigos de formato de MTEXT (\P, \f...;, {}, \S...;) dejando texto plano. */
function stripMTextFormatting(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === "{" || ch === "}") continue
    if (ch !== "\\") {
      out += ch
      continue
    }
    const n = s[i + 1]
    if (n === undefined) break
    if (n === "P" || n === "N" || n === "~" || n === "X") {
      out += " "
      i++
    } else if (n === "\\" || n === "{" || n === "}") {
      out += n
      i++
    } else if ("LlOoKk".includes(n)) {
      i++
    } else if (n === "U" && s[i + 2] === "+" && /^[0-9A-Fa-f]{4}$/.test(s.slice(i + 3, i + 7))) {
      out += String.fromCharCode(parseInt(s.slice(i + 3, i + 7), 16))
      i += 6
    } else if (n === "S") {
      const end = s.indexOf(";", i + 2)
      const stack = end === -1 ? s.slice(i + 2) : s.slice(i + 2, end)
      out += stack.replace(/[\^#]/g, "/")
      i = end === -1 ? s.length : end
    } else if ("ACcFfHQTWpa".includes(n)) {
      const end = s.indexOf(";", i + 2)
      i = end === -1 ? s.length : end
    } else {
      out += n
      i++
    }
  }
  return out
}

/** Códigos especiales de AutoCAD: %%c (Ø), %%d (°), %%p (±), %%nnn y \U+XXXX. */
function decodeSpecialCodes(s: string): string {
  const t = s.indexOf("\\U+") === -1 ? s : s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  if (t.indexOf("%%") === -1) return t
  let out = ""
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "%" || t[i + 1] !== "%" || i + 2 >= t.length) {
      out += t[i]
      continue
    }
    const c = t[i + 2].toLowerCase()
    if (c === "c") out += "Ø"
    else if (c === "d") out += "°"
    else if (c === "p") out += "±"
    else if (c === "%") out += "%"
    else if (c === "u" || c === "o" || c === "k") {
      // subrayado / sobrerrayado / tachado: se ignoran
    } else if (/^\d{3}$/.test(t.slice(i + 2, i + 5))) {
      out += String.fromCharCode(parseInt(t.slice(i + 2, i + 5), 10))
      i += 2
    } else {
      out += "%%" + t[i + 2]
    }
    i += 2
  }
  return out
}

function cleanDxfText(raw: string, mtext: boolean): string {
  const base = mtext ? stripMTextFormatting(raw) : raw
  return decodeSpecialCodes(base).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH)
}

// ---------------------------------------------------------------------------
// parseDxf
// ---------------------------------------------------------------------------

type PolylineAcc = {
  layer: string
  line: number
  flags: number
  tf: PointTransform | null
  verts: BulgeVertex[]
  skip: boolean
  bad: number
}

/**
 * Lee un DXF ASCII. Tolera CRLF/LF, espacios alrededor de códigos y valores,
 * líneas basura y entidades rotas (se omiten con advertencia).
 * Lanza Error(DXF_UNSUPPORTED_FORMAT_MESSAGE) si es DXF binario o DWG.
 */
export function parseDxf(text: string): ParsedDxf {
  if (typeof text !== "string") throw new Error(DXF_UNSUPPORTED_FORMAT_MESSAGE)
  let src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  assertAsciiDxf(src)
  // Finales de línea solo CR (Mac antiguo).
  if (src.indexOf("\n") === -1 && src.indexOf("\r") !== -1) src = src.split("\r").join("\n")

  const warn = new WarningList()
  const entities: DxfEntity[] = []
  const layerOrder: string[] = []
  const layerCanon = new Map<string, string>()
  const unsupported = new Map<string, number>()
  let insunits: number | null = null
  let paperSpace = 0
  let meshes = 0
  let splinesApprox = 0
  let truncated = false

  const canonLayer = (raw: string | undefined): string => {
    const name = (raw ?? "").trim() || "0"
    const key = name.toUpperCase()
    const existing = layerCanon.get(key)
    if (existing !== undefined) return existing
    layerCanon.set(key, name)
    layerOrder.push(name)
    return name
  }

  const entityWarn = (e: { type: string; line: number }, layer: string, reason: string) => {
    warn.add(`${e.type} (línea ${e.line}, capa ${layer}): ${reason}; se omitió.`)
  }

  const push = (ent: DxfEntity) => {
    if (entities.length >= MAX_ENTITIES) {
      truncated = true
      return
    }
    entities.push(ent)
  }

  let acc: PolylineAcc | null = null

  const closePolyline = (missingSeqend: boolean) => {
    const a = acc
    acc = null
    if (!a || a.skip) return
    if (missingSeqend) warn.add(`POLYLINE (línea ${a.line}, capa ${a.layer}): falta SEQEND; se cerró igualmente.`)
    if (a.bad > 0) warn.add(`POLYLINE (línea ${a.line}, capa ${a.layer}): ${a.bad} vértice(s) con coordenadas inválidas omitidos.`)
    if (a.verts.length < 2) {
      entityWarn({ type: "POLYLINE", line: a.line }, a.layer, "tiene menos de 2 vértices válidos")
      return
    }
    const closed = (a.flags & 1) === 1
    push({ kind: "polyline", layer: a.layer, points: applyTransform(expandBulges(a.verts, closed), a.tf), closed })
  }

  const finishEntity = (e: RawEntity) => {
    const type = e.type
    if (type === "VERTEX") {
      if (!acc) {
        warn.add(`VERTEX (línea ${e.line}) fuera de una POLYLINE; se omitió.`)
        return
      }
      if (acc.skip) return
      const vflags = toInt(rawGet(e, 70))
      if (vflags & 16) return // punto de control de spline (no está sobre la curva)
      const p = rawPoint(e, 10, 20)
      if (!p) {
        acc.bad++
        return
      }
      const b = toNum(rawGet(e, 42))
      acc.verts.push({ x: p.x, y: p.y, b: Number.isFinite(b) ? b : 0 })
      return
    }
    if (type === "SEQEND") {
      if (acc) closePolyline(false)
      return
    }

    const layer = canonLayer(rawGet(e, 8))
    if (toInt(rawGet(e, 67)) === 1) {
      paperSpace++
      if (type === "POLYLINE") acc = { layer, line: e.line, flags: 0, tf: null, verts: [], skip: true, bad: 0 }
      return
    }

    switch (type) {
      case "LINE": {
        const a = rawPoint(e, 10, 20)
        const b = rawPoint(e, 11, 21)
        if (!a || !b) return entityWarn(e, layer, "coordenadas inválidas")
        push({ kind: "line", layer, points: [a, b] })
        return
      }
      case "LWPOLYLINE": {
        const verts: BulgeVertex[] = []
        let flags = 0
        for (let i = 0; i < e.codes.length; i++) {
          const c = e.codes[i]
          const v = e.values[i]
          if (c === 10) verts.push({ x: toNum(v), y: NaN, b: 0 })
          else if (c === 20) {
            const last = verts[verts.length - 1]
            if (last && Number.isNaN(last.y)) last.y = toNum(v)
          } else if (c === 42) {
            const last = verts[verts.length - 1]
            const b = toNum(v)
            if (last) last.b = Number.isFinite(b) ? b : 0
          } else if (c === 70) flags = toInt(v)
        }
        const valid = verts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        if (valid.length < verts.length) {
          warn.add(`LWPOLYLINE (línea ${e.line}, capa ${layer}): ${verts.length - valid.length} vértice(s) con coordenadas inválidas omitidos.`)
        }
        if (valid.length < 2) return entityWarn(e, layer, "tiene menos de 2 vértices válidos")
        const closed = (flags & 1) === 1
        push({ kind: "polyline", layer, points: applyTransform(expandBulges(valid, closed), ocsTransform(e)), closed })
        return
      }
      case "POLYLINE": {
        const flags = toInt(rawGet(e, 70))
        const isMesh = (flags & 16) !== 0 || (flags & 64) !== 0
        if (isMesh) meshes++
        const is3d = (flags & 8) !== 0
        acc = { layer, line: e.line, flags, tf: is3d ? null : ocsTransform(e), verts: [], skip: isMesh, bad: 0 }
        return
      }
      case "POINT": {
        const p = rawPoint(e, 10, 20)
        if (!p) return entityWarn(e, layer, "coordenadas inválidas")
        push({ kind: "point", layer, points: [p] })
        return
      }
      case "CIRCLE": {
        const c = rawPoint(e, 10, 20)
        const r = toNum(rawGet(e, 40))
        if (!c || !(r > 0)) return entityWarn(e, layer, "centro o radio inválido")
        push({ kind: "circle", layer, points: applyTransform([c], ocsTransform(e)), radius: r })
        return
      }
      case "ARC": {
        const c = rawPoint(e, 10, 20)
        const r = toNum(rawGet(e, 40))
        const a0 = toNum(rawGet(e, 50))
        const a1 = toNum(rawGet(e, 51))
        if (!c || !(r > 0) || !Number.isFinite(a0) || !Number.isFinite(a1)) {
          return entityWarn(e, layer, "centro, radio o ángulos inválidos")
        }
        const arc = arcPoints(c, r, a0, a1, DXF_ARC_SEGMENTS)
        push({ kind: "polyline", layer, points: applyTransform(arc.points, ocsTransform(e)), closed: arc.closed })
        return
      }
      case "SPLINE": {
        const ctrl: Vec2[] = []
        const fit: Vec2[] = []
        const knots: number[] = []
        const weights: number[] = []
        let pendingCtrl: Vec2 | null = null
        let pendingFit: Vec2 | null = null
        for (let i = 0; i < e.codes.length; i++) {
          const c = e.codes[i]
          const v = toNum(e.values[i])
          if (c === 10) {
            pendingCtrl = { x: v, y: NaN }
            ctrl.push(pendingCtrl)
          } else if (c === 20 && pendingCtrl && Number.isNaN(pendingCtrl.y)) pendingCtrl.y = v
          else if (c === 11) {
            pendingFit = { x: v, y: NaN }
            fit.push(pendingFit)
          } else if (c === 21 && pendingFit && Number.isNaN(pendingFit.y)) pendingFit.y = v
          else if (c === 40) knots.push(v)
          else if (c === 41) weights.push(v)
        }
        const flags = toInt(rawGet(e, 70))
        const degree = toInt(rawGet(e, 71), 3)
        const closed = (flags & 1) === 1
        const ctrlOk = ctrl.every(isFinitePoint)
        let points: Vec2[] | null = null
        if (ctrlOk && ctrl.length >= 2 && knots.every(Number.isFinite)) {
          points = evalBSpline(ctrl, weights, knots, degree, Math.min(2000, Math.max(16, ctrl.length * 6)))
        }
        if (!points) {
          const fitOk = fit.length >= 2 && fit.every(isFinitePoint)
          if (fitOk) points = fit
          else if (ctrlOk && ctrl.length >= 2) points = ctrl
          if (points) splinesApprox++
        }
        if (!points) return entityWarn(e, layer, "puntos de control inválidos")
        push({ kind: "polyline", layer, points, closed })
        return
      }
      case "INSERT": {
        const p = rawPoint(e, 10, 20)
        if (!p) return entityWarn(e, layer, "punto de inserción inválido")
        const block = (rawGet(e, 2) ?? "").trim()
        push({ kind: "insert", layer, points: applyTransform([p], ocsTransform(e)), block })
        return
      }
      case "TEXT":
      case "ATTRIB":
      case "MTEXT": {
        const p = rawPoint(e, 10, 20)
        if (!p) return entityWarn(e, layer, "punto de inserción inválido")
        let raw = ""
        if (type === "MTEXT") {
          for (let i = 0; i < e.codes.length; i++) if (e.codes[i] === 3) raw += e.values[i]
          raw += rawGet(e, 1) ?? ""
        } else {
          raw = rawGet(e, 1) ?? ""
        }
        const txt = cleanDxfText(raw, type === "MTEXT")
        if (!txt) return
        // MTEXT usa coordenadas universales; TEXT y ATTRIB, las del objeto.
        const pts = type === "MTEXT" ? [p] : applyTransform([p], ocsTransform(e))
        push({ kind: "text", layer, points: pts, text: txt })
        return
      }
      default:
        unsupported.set(type, (unsupported.get(type) ?? 0) + 1)
    }
  }

  const reader = new PairReader(src)
  let section = ""
  let awaitingSectionName = false
  let headerVar = ""
  let tableName = ""
  let awaitingTableName = false
  let inLayerRecord = false
  let layerRecordNamed = false
  let sawEntitiesSection = false
  let sawAnyPair = false
  let current: RawEntity | null = null

  const safeFinish = (e: RawEntity) => {
    try {
      finishEntity(e)
    } catch {
      warn.add(`${e.type} (línea ${e.line}): entidad ilegible; se omitió.`)
    }
  }

  const endEntities = () => {
    if (current) safeFinish(current)
    current = null
    if (acc) closePolyline(true)
  }

  while (reader.next()) {
    const code = reader.code
    const value = reader.value
    sawAnyPair = true
    if (code === 0) {
      const kw = value.toUpperCase()
      if (kw === "SECTION") {
        endEntities()
        section = ""
        awaitingSectionName = true
        continue
      }
      if (kw === "ENDSEC") {
        endEntities()
        section = ""
        awaitingSectionName = false
        continue
      }
      if (kw === "EOF") break
    }
    if (awaitingSectionName) {
      if (code === 2) {
        section = value.toUpperCase()
        awaitingSectionName = false
        if (section === "ENTITIES") sawEntitiesSection = true
      }
      continue
    }

    if (section === "ENTITIES") {
      if (code === 0) {
        if (current) safeFinish(current)
        const type = value.toUpperCase()
        if (acc && type !== "VERTEX" && type !== "SEQEND") closePolyline(true)
        current = { type, line: reader.line - 1, codes: [], values: [] }
      } else if (current) {
        current.codes.push(code)
        current.values.push(value)
      }
    } else if (section === "HEADER") {
      if (code === 9) headerVar = value.toUpperCase()
      else if (code === 70 && headerVar === "$INSUNITS") {
        const n = toInt(value, -1)
        if (n >= 0 && n <= 24) insunits = n
        else warn.add(`Valor de $INSUNITS inválido (${value}); se ignoró.`)
      }
    } else if (section === "TABLES") {
      if (code === 0) {
        const kw = value.toUpperCase()
        if (kw === "TABLE") {
          awaitingTableName = true
          tableName = ""
          inLayerRecord = false
        } else if (kw === "ENDTAB") {
          tableName = ""
          inLayerRecord = false
        } else {
          inLayerRecord = tableName === "LAYER" && kw === "LAYER"
          layerRecordNamed = false
        }
      } else if (code === 2) {
        if (awaitingTableName) {
          tableName = value.toUpperCase()
          awaitingTableName = false
        } else if (inLayerRecord && !layerRecordNamed && value.trim() !== "") {
          canonLayer(value)
          layerRecordNamed = true
        }
      }
    }
    // BLOCKS, CLASSES, OBJECTS, THUMBNAILIMAGE...: se ignoran.
  }
  endEntities()

  const summary: string[] = []
  if (!sawAnyPair) {
    summary.push("El archivo está vacío o no tiene formato DXF (pares código/valor).")
  } else if (!sawEntitiesSection) {
    summary.push("No se encontró la sección ENTITIES: el archivo no parece un DXF válido.")
  }
  if (reader.badLines > 0) {
    summary.push(`Se ignoraron ${reader.badLines} línea(s) mal formadas (la primera en la línea ${reader.firstBadLine}).`)
  }
  if (paperSpace > 0) summary.push(`Se omitieron ${paperSpace} entidad(es) del espacio papel (presentaciones).`)
  if (meshes > 0) summary.push(`Se omitieron ${meshes} malla(s) 3D (POLYLINE de caras).`)
  if (splinesApprox > 0) summary.push(`${splinesApprox} spline(s) se aproximaron por sus puntos de ajuste o de control.`)
  if (unsupported.size > 0) {
    const total = [...unsupported.values()].reduce((s, n) => s + n, 0)
    const detail = [...unsupported.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t, n]) => `${t} (${n})`)
      .join(", ")
    summary.push(`Se ignoraron ${total} entidad(es) de tipos no soportados: ${detail}${unsupported.size > 6 ? ", …" : ""}.`)
  }
  if (truncated) summary.push(`El plano tiene más de ${MAX_ENTITIES} entidades; se leyeron solo las primeras.`)
  if (sawEntitiesSection && entities.length === 0) {
    summary.push("El DXF no contiene entidades compatibles (líneas, polilíneas, puntos, círculos, arcos, bloques o textos).")
  }

  return {
    layers: layerOrder,
    entities,
    insunits,
    extents: computeExtents(entities, () => true),
    warnings: [...summary, ...warn.toArray()],
  }
}

function computeExtents(entities: DxfEntity[], include: (e: DxfEntity) => boolean): DxfExtents | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const e of entities) {
    if (!include(e)) continue
    const r = e.kind === "circle" && e.radius && e.radius > 0 ? e.radius : 0
    for (const p of e.points) {
      if (!isFinitePoint(p)) continue
      if (p.x - r < minX) minX = p.x - r
      if (p.x + r > maxX) maxX = p.x + r
      if (p.y - r < minY) minY = p.y - r
      if (p.y + r > maxY) maxY = p.y + r
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { minX, minY, maxX, maxY }
}

/** Cantidad de entidades por capa (útil para mostrar solo capas con contenido al mapear). */
export function countEntitiesByLayer(parsed: ParsedDxf): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of parsed.entities) out[e.layer] = (out[e.layer] ?? 0) + 1
  return out
}

// ---------------------------------------------------------------------------
// Capas CAD → tipo de elemento
// ---------------------------------------------------------------------------

type TokenMatcher = {
  exact?: readonly string[]
  prefix?: readonly string[]
  seq?: ReadonlyArray<readonly string[]>
}

function hasSeq(tokens: string[], seq: readonly string[]): boolean {
  outer: for (let i = 0; i + seq.length <= tokens.length; i++) {
    for (let j = 0; j < seq.length; j++) if (tokens[i + j] !== seq[j]) continue outer
    return true
  }
  return false
}

function matchTokens(tokens: string[], m: TokenMatcher): boolean {
  for (const t of tokens) {
    if (m.exact && m.exact.includes(t)) return true
    if (m.prefix && m.prefix.some((p) => t.startsWith(p))) return true
  }
  if (m.seq) for (const s of m.seq) if (hasSeq(tokens, s)) return true
  return false
}

/**
 * Separa un nombre de capa en tokens: sin tildes, en mayúsculas, cortando en
 * cualquier carácter no alfanumérico y entre letras y dígitos ("ALC01" →
 * ALC, 01). Para capas de referencias externas ("PLANTA|ALC" o
 * "PLANTA$0$ALC") usa solo el nombre propio de la capa.
 */
function layerTokens(name: string): string[] {
  let s = name
  const pipe = s.lastIndexOf("|")
  if (pipe >= 0) s = s.slice(pipe + 1)
  const bound = /\$\d+\$/g
  let lastEnd = -1
  for (let m = bound.exec(s); m; m = bound.exec(s)) lastEnd = m.index + m[0].length
  if (lastEnd >= 0) s = s.slice(lastEnd)
  s = foldText(s)
  const out: string[] = []
  let cur = ""
  let curType = 0
  for (const ch of s) {
    const t = ch >= "A" && ch <= "Z" ? 1 : ch >= "0" && ch <= "9" ? 2 : 0
    if (t === 0) {
      if (cur) out.push(cur)
      cur = ""
      curType = 0
      continue
    }
    if (curType !== 0 && t !== curType) {
      out.push(cur)
      cur = ""
    }
    cur += ch
    curType = t
  }
  if (cur) out.push(cur)
  // "AS BUILT" no es "aguas servidas".
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i] === "AS" && out[i + 1] === "BUILT") {
      out.splice(i, 2, "ASBUILT")
    }
  }
  return out
}

/** Capas de anotación: nunca son elementos, aunque lleven el prefijo de una especialidad. */
const ANNOTATION: TokenMatcher = {
  exact: ["EJE", "EJES", "TXT", "NOTA", "NOTAS", "DIM", "DIMS", "VP", "TAG", "TAGS"],
  prefix: [
    "COTA",
    "DIMENS",
    "TEXT",
    "HATCH",
    "ACHUR",
    "DEFPOINT",
    "MARCO",
    "VIEWPORT",
    "VPORT",
    "ROTULO",
    "VINETA",
    "LEYENDA",
    "SIMBOLOG",
    "TITULO",
    "GRILLA",
    "ANNO",
  ],
}

/**
 * Objetos de arquitectura que no son muros ni estructura ("ARQ-PUERTAS").
 * Solo bloquean las reglas de arquitectura/estructura: "ELEC-ARTEFACTOS" sigue
 * siendo eléctrico.
 */
const NON_STRUCTURAL_OBJECTS: TokenMatcher = {
  prefix: ["PUERTA", "VENTANA", "MOBILIARIO", "MUEBLE", "ARTEFACTO", "VEGETAC", "ARBOL", "PAVIMENTO"],
}

const ELEC_TOKENS: TokenMatcher = {
  exact: ["ELE", "FZA"],
  prefix: ["ELEC", "FUERZA", "ALUMB", "ENCH", "CANALIZ", "ILUMIN"],
}
const AGUA_TOKENS: TokenMatcher = {
  exact: ["AP", "AF", "AC", "APF", "APC"],
  prefix: ["AGUA", "POTABLE"],
  seq: [["A", "P"]],
}
const GAS_TOKENS: TokenMatcher = { exact: ["GAS", "GLP", "GN"] }

type LayerRule = { type: ElementType; test: (tokens: string[]) => boolean }

const byTokens = (matcher: TokenMatcher) => (tokens: string[]) => matchTokens(tokens, matcher)

/**
 * Reglas de instalaciones y excavación, en orden de prioridad: primero los
 * tipos específicos (cámara, tablero, medidor), luego los generales.
 */
const MEP_RULES: readonly LayerRule[] = [
  { type: "excavacion", test: byTokens({ prefix: ["EXCAV", "ZANJA"] }) },
  {
    type: "camara_inspeccion",
    test: (t) =>
      matchTokens(t, { exact: ["CAM", "CI"], prefix: ["CAMARA"], seq: [["C", "I"]] }) &&
      !matchTokens(t, ELEC_TOKENS) &&
      !matchTokens(t, GAS_TOKENS),
  },
  { type: "tablero_electrico", test: byTokens({ exact: ["TDA", "TDF", "TG", "TGAUX", "TD"], prefix: ["TABLERO"] }) },
  {
    type: "red_incendio",
    test: byTokens({
      exact: ["INC", "RH", "RS"],
      prefix: ["INCEND", "SPRINK", "GABINETE", "ROCIADOR"],
      seq: [
        ["RED", "HUMEDA"],
        ["RED", "SECA"],
      ],
    }),
  },
  {
    type: "tuberia_aguas_lluvia",
    test: byTokens({
      exact: ["ALL", "AALL"],
      prefix: ["LLUVIA", "BAJADA"],
      seq: [
        ["A", "LL"],
        ["AA", "LL"],
        ["A", "A", "L", "L"],
        ["A", "L", "L"],
      ],
    }),
  },
  {
    type: "tuberia_alcantarillado",
    test: byTokens({
      exact: ["AS", "UD", "AASS", "SANR"],
      prefix: ["ALC", "SANIT", "COLECTOR", "DESAG", "SERVIDA"],
      seq: [
        ["A", "S"],
        ["AA", "SS"],
      ],
    }),
  },
  { type: "tuberia_agua", test: byTokens(AGUA_TOKENS) },
  { type: "ducto_electrico", test: byTokens(ELEC_TOKENS) },
  { type: "medidor_gas", test: byTokens({ prefix: ["MEDIDOR", "REGULADOR"] }) },
  { type: "linea_gas", test: byTokens(GAS_TOKENS) },
  { type: "ducto_clima", test: byTokens({ exact: ["VENT"], prefix: ["CLIMA", "HVAC", "VENTIL", "EXTRAC"] }) },
]

/** Reglas de arquitectura y estructura (después de las de instalaciones). */
const STRUCTURE_RULES: readonly LayerRule[] = [
  {
    type: "muro_carga",
    test: (t) =>
      (matchTokens(t, { prefix: ["MURO"] }) && matchTokens(t, { exact: ["HA"], prefix: ["HORMIG", "CARGA"] })) ||
      matchTokens(t, { exact: ["MHA"], seq: [["M", "HA"]] }),
  },
  { type: "columna", test: byTokens({ exact: ["COL", "COLS"], prefix: ["COLUMN", "PILAR"] }) },
  { type: "viga", test: byTokens({ prefix: ["VIGA", "CADENA", "BEAM"] }) },
  { type: "losa", test: byTokens({ prefix: ["LOSA", "SLAB"] }) },
  { type: "fundacion", test: byTokens({ exact: ["FTNG"], prefix: ["FUND", "ZAP", "RADIER", "FOUND", "FOOTING"] }) },
  { type: "muro", test: byTokens({ prefix: ["MURO", "TABIQUE", "ARQ", "WALL"] }) },
]

/**
 * Adivina el tipo de elemento a partir del nombre de una capa CAD (convenciones
 * habituales en Chile: "ALC-COLECTOR", "A.P.", "ELEC-FZA", "MURO HA"...).
 * Insensible a mayúsculas y tildes; las siglas cortas solo cuentan como token
 * completo ("AS" no se detecta dentro de "CASA"). Devuelve null para capas de
 * anotación (cotas, textos, ejes, achurados...) o desconocidas.
 */
export function guessElementTypeFromLayer(layerName: string): ElementType | null {
  if (typeof layerName !== "string") return null
  const tokens = layerTokens(layerName)
  if (tokens.length === 0) return null
  if (tokens.length === 1 && tokens[0] === "0") return null
  if (matchTokens(tokens, ANNOTATION)) return null
  for (const rule of MEP_RULES) {
    if (rule.test(tokens)) return rule.type
  }
  if (matchTokens(tokens, NON_STRUCTURAL_OBJECTS)) return null
  for (const rule of STRUCTURE_RULES) {
    if (rule.test(tokens)) return rule.type
  }
  return null
}

/** Mapeo sugerido para todas las capas del archivo (el usuario lo revisa antes de importar). */
export function suggestLayerMapping(parsed: ParsedDxf): DxfLayerMapping {
  const out: DxfLayerMapping = {}
  for (const layer of parsed.layers) out[layer] = guessElementTypeFromLayer(layer)
  return out
}

/**
 * Disciplina mayoritaria de una lista de tipos (cada elemento cuenta una vez).
 * "otro" solo gana si no hay ninguna otra; empates según el orden de DISCIPLINES.
 */
export function disciplineFromElementTypes(types: ElementType[]): Discipline {
  const counts = new Map<Discipline, number>()
  for (const t of types ?? []) {
    const d = ELEMENT_TYPE_DISCIPLINE[t]
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  let best: Discipline = "otro"
  let bestCount = 0
  for (const d of DISCIPLINES) {
    if (d === "otro") continue
    const n = counts.get(d) ?? 0
    if (n > bestCount) {
      best = d
      bestCount = n
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Simplificación (Douglas-Peucker con cola de prioridad)
// ---------------------------------------------------------------------------

/** Trabajo máximo (puntos recorridos) de una simplificación: acota el peor caso O(n²). */
const DP_WORK_BUDGET = 30_000_000

type DpSegment = { first: number; last: number; idx: number; d: number }

/**
 * Douglas-Peucker que agrega primero los puntos más significativos (mayor
 * desviación) hasta cumplir la tolerancia o llegar a maxPoints. Sin límite
 * alcanzado entrega lo mismo que el DP clásico; con límite, la mejor
 * aproximación con maxPoints puntos. Los empates se resuelven hacia el centro
 * del tramo para mantener la recursión balanceada.
 */
function douglasPeucker(pts: Vec2[], tol: number, maxPoints: number): Vec2[] {
  const n = pts.length
  if (n <= 2) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  let kept = 2
  const tol2 = tol > 0 ? tol * tol : 0
  let work = 0
  const heap: DpSegment[] = []

  const heapPush = (seg: DpSegment) => {
    heap.push(seg)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent].d >= heap[i].d) break
      const tmp = heap[parent]
      heap[parent] = heap[i]
      heap[i] = tmp
      i = parent
    }
  }

  const heapPop = (): DpSegment | undefined => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length > 0 && last) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let big = i
        if (l < heap.length && heap[l].d > heap[big].d) big = l
        if (r < heap.length && heap[r].d > heap[big].d) big = r
        if (big === i) break
        const tmp = heap[big]
        heap[big] = heap[i]
        heap[i] = tmp
        i = big
      }
    }
    return top
  }

  const addSegment = (first: number, last: number) => {
    if (last - first < 2) return
    work += last - first
    const a = pts[first]
    const b = pts[last]
    const mid = (first + last) / 2
    let maxD = -1
    let idx = -1
    for (let i = first + 1; i < last; i++) {
      const d = segDist2(pts[i], a, b)
      if (d > maxD || (d === maxD && Math.abs(i - mid) < Math.abs(idx - mid))) {
        maxD = d
        idx = i
      }
    }
    if (idx !== -1 && maxD > tol2) heapPush({ first, last, idx, d: maxD })
  }

  addSegment(0, n - 1)
  while (heap.length > 0 && kept < maxPoints && work <= DP_WORK_BUDGET) {
    const seg = heapPop() as DpSegment
    keep[seg.idx] = 1
    kept++
    addSegment(seg.first, seg.idx)
    addSegment(seg.idx, seg.last)
  }
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i])
  return out
}

/** Elimina puntos a menos de `tol` del último conservado (O(n), previo a DP en polilíneas enormes). */
function radialReduce(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length <= 2) return pts.slice()
  const tol2 = tol * tol
  const out: Vec2[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    if (dist2(pts[i], out[out.length - 1]) > tol2) out.push(pts[i])
  }
  out.push(pts[pts.length - 1])
  return out
}

/** Simplifica una polilínea (o anillo si closed) con tolerancia `tol` y como máximo maxPoints puntos. */
function simplifyPath(pts: Vec2[], closed: boolean, tol: number, maxPoints: number): Vec2[] {
  const work = pts.length > 20_000 ? radialReduce(pts, tol) : pts
  if (!closed) return douglasPeucker(work, tol, Math.max(2, maxPoints))
  // Anillo: se cierra con el primer punto para simplificar y luego se quita.
  const ring = douglasPeucker([...work, work[0]], tol, Math.max(3, maxPoints) + 1)
  ring.pop()
  return ring
}

function dedupeConsecutive(pts: Vec2[], eps2: number): Vec2[] {
  const out: Vec2[] = []
  for (const p of pts) {
    if (!isFinitePoint(p)) continue
    if (out.length === 0 || dist2(p, out[out.length - 1]) > eps2) out.push(p)
  }
  return out
}

// ---------------------------------------------------------------------------
// Validación local mínima (no depende de lib/obra/geometry.ts)
// ---------------------------------------------------------------------------

function isValidDraftGeometry(g: ElementGeometry): boolean {
  const pts = g.points as NormPoint[]
  if (!Array.isArray(pts) || pts.length > DXF_MAX_POINTS_PER_ELEMENT) return false
  if (g.type === "point" && pts.length !== 1) return false
  if (g.type === "polyline" && pts.length < 2) return false
  if (g.type === "polygon" && pts.length < 3) return false
  return pts.every((p) => isFinitePoint(p) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
}

// ---------------------------------------------------------------------------
// Etiquetas desde textos cercanos (índice en grilla)
// ---------------------------------------------------------------------------

type TextItem = { x: number; y: number; text: string }

class TextIndex {
  private readonly cells = new Map<string, TextItem[]>()
  private readonly all: TextItem[] = []
  private readonly cell: number

  constructor(cell: number) {
    this.cell = cell > 0 ? cell : 1
  }

  add(item: TextItem): void {
    this.all.push(item)
    const key = `${Math.floor(item.x / this.cell)},${Math.floor(item.y / this.cell)}`
    const list = this.cells.get(key)
    if (list) list.push(item)
    else this.cells.set(key, [item])
  }

  get size(): number {
    return this.all.length
  }

  /** Candidatos dentro del rectángulo [x0,x1]×[y0,y1]. */
  private candidates(x0: number, y0: number, x1: number, y1: number): TextItem[] {
    const gx0 = Math.floor(x0 / this.cell)
    const gx1 = Math.floor(x1 / this.cell)
    const gy0 = Math.floor(y0 / this.cell)
    const gy1 = Math.floor(y1 / this.cell)
    if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > 2500 || this.all.length <= 32) return this.all
    const out: TextItem[] = []
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const list = this.cells.get(`${gx},${gy}`)
        if (list) for (const it of list) out.push(it)
      }
    }
    return out
  }

  /** Texto más cercano a la geometría (en unidades del dibujo) dentro de maxDist. */
  nearest(points: Vec2[], closed: boolean, maxDist: number): string | null {
    if (this.all.length === 0 || points.length === 0) return null
    const max2 = maxDist * maxDist
    let bestText: string | null = null
    let bestD = Infinity
    if (points.length === 1) {
      const p = points[0]
      for (const it of this.candidates(p.x - maxDist, p.y - maxDist, p.x + maxDist, p.y + maxDist)) {
        const d = dist2(it, p)
        if (d <= max2 && d < bestD) {
          bestText = it.text
          bestD = d
        }
      }
      return bestText
    }
    const segCount = closed ? points.length : points.length - 1
    for (let i = 0; i < segCount; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      const cands = this.candidates(
        Math.min(a.x, b.x) - maxDist,
        Math.min(a.y, b.y) - maxDist,
        Math.max(a.x, b.x) + maxDist,
        Math.max(a.y, b.y) + maxDist,
      )
      for (const it of cands) {
        const d = segDist2(it, a, b)
        if (d <= max2 && d < bestD) {
          bestText = it.text
          bestD = d
        }
      }
    }
    return bestText
  }
}

// ---------------------------------------------------------------------------
// dxfToElementDrafts
// ---------------------------------------------------------------------------

function round6(v: number): number {
  const r = Math.round(v * 1e6) / 1e6
  return r === 0 ? 0 : r // evita -0
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function isElementType(v: unknown): v is ElementType {
  return typeof v === "string" && (ELEMENT_TYPES as readonly string[]).includes(v)
}

function formatNumber(n: number): string {
  return n.toLocaleString("es-CL", { maximumFractionDigits: 2 })
}

/**
 * Convierte las entidades de las capas mapeadas en borradores de elementos.
 *
 * Normalización (coherente con LayerFrame): la lámina es el rectángulo que
 * envuelve las entidades de capas mapeadas (o todas, si ninguna lo está).
 *   x = (X − minX) / ancho,  y = (maxY − Y) / alto   (Y se invierte: en DXF crece hacia arriba)
 *   aspect = alto / ancho
 * Así, con LayerFrame { width_m: ancho·factor, aspect }, el punto vuelve a
 * metros con la misma escala en ambos ejes.
 */
export function dxfToElementDrafts(
  parsed: ParsedDxf,
  mapping: DxfLayerMapping,
  opts: DxfToDraftsOptions = {},
): DxfToDraftsResult {
  const warnings: string[] = []
  const maxElements =
    typeof opts.maxElements === "number" && Number.isFinite(opts.maxElements) && opts.maxElements >= 1
      ? Math.floor(opts.maxElements)
      : DXF_DEFAULT_MAX_ELEMENTS
  const labelFromText = opts.labelFromText !== false
  const entities = Array.isArray(parsed?.entities) ? parsed.entities : []

  // Búsqueda de tipo por capa: exacta y, si no, sin distinguir mayúsculas.
  const upperMap = new Map<string, ElementType | null>()
  const invalidTypes = new Set<string>()
  for (const [k, v] of Object.entries(mapping ?? {})) {
    if (v != null && !isElementType(v)) {
      invalidTypes.add(String(v))
      continue
    }
    if (!upperMap.has(k.toUpperCase())) upperMap.set(k.toUpperCase(), v ?? null)
  }
  if (invalidTypes.size > 0) warnings.push(`Se ignoraron tipos de elemento desconocidos en el mapeo: ${[...invalidTypes].join(", ")}.`)
  const typeCache = new Map<string, ElementType | null>()
  const typeFor = (layer: string): ElementType | null => {
    const cached = typeCache.get(layer)
    if (cached !== undefined) return cached
    let t: ElementType | null = null
    if (mapping && Object.prototype.hasOwnProperty.call(mapping, layer)) {
      const v = mapping[layer]
      t = isElementType(v) ? v : null
    } else {
      t = upperMap.get(layer.toUpperCase()) ?? null
    }
    typeCache.set(layer, t)
    return t
  }

  const isGeom = (e: DxfEntity) => e.kind !== "text"
  const mappedGeom = entities.filter((e) => isGeom(e) && typeFor(e.layer) !== null)
  const extents =
    computeExtents(mappedGeom, () => true) ??
    computeExtents(entities, isGeom) ??
    computeExtents(entities, () => true)

  const empty: DxfToDraftsResult = {
    drafts: [],
    aspect: 1,
    width_units: 0,
    suggested_width_m: null,
    skipped: 0,
    per_layer: {},
    warnings,
  }
  if (!extents) {
    warnings.push("El plano no tiene entidades con coordenadas.")
    return empty
  }
  if (mappedGeom.length === 0) warnings.push("Ninguna capa con geometría está asignada a un tipo de elemento.")

  const { minX, minY, maxX, maxY } = extents
  const w = maxX - minX
  const h = maxY - minY
  const eps = 1e-9 * Math.max(1, Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY))
  const wEff = w > eps ? w : h > eps ? h : 1
  const hEff = Math.max(h, wEff * 0.01)
  const aspect = round6(hEff / wEff) || 0.01
  const tol = DXF_SIMPLIFY_TOLERANCE * wEff
  const dedupeEps2 = (wEff * 1e-7) ** 2
  const labelDist = DXF_LABEL_MAX_DISTANCE * wEff

  const toNorm = (p: Vec2): NormPoint => ({
    x: clamp01(round6((p.x - minX) / wEff)),
    y: clamp01(round6((maxY - p.y) / hEff)),
  })

  // Índices de textos por capa mapeada.
  const textIndex = new Map<string, TextIndex>()
  if (labelFromText) {
    for (const e of entities) {
      if (e.kind !== "text" || !e.text || typeFor(e.layer) === null) continue
      const p = e.points[0]
      if (!p || !isFinitePoint(p)) continue
      let idx = textIndex.get(e.layer)
      if (!idx) {
        idx = new TextIndex(labelDist)
        textIndex.set(e.layer, idx)
      }
      idx.add({ x: p.x, y: p.y, text: e.text.slice(0, DXF_LABEL_MAX_LENGTH) })
    }
  }

  const unitFactor = dxfUnitsToMeters(parsed?.insunits ?? null)
  const toMm = unitFactor != null ? unitFactor * 1000 : null

  const drafts: PlanElementDraft[] = []
  const perLayer: Record<string, number> = {}
  let skipped = 0
  let degenerate = 0

  for (const e of mappedGeom) {
    const type = typeFor(e.layer) as ElementType
    if (drafts.length >= maxElements) {
      skipped++
      continue
    }
    const attributes: ElementAttributes = { dxf_layer: e.layer }
    let geometry: ElementGeometry | null = null
    let labelPts: Vec2[] = []
    let labelClosed = false

    if (e.kind === "line" || e.kind === "polyline") {
      let pts = dedupeConsecutive(e.points, dedupeEps2)
      let closed = Boolean(e.closed)
      if (closed && pts.length > 1 && dist2(pts[0], pts[pts.length - 1]) <= dedupeEps2) pts.pop()
      if (closed && pts.length < 3) closed = false
      if (pts.length >= 2) {
        pts = simplifyPath(pts, closed, tol, DXF_MAX_POINTS_PER_ELEMENT)
        const norm: NormPoint[] = []
        for (const p of pts) {
          const q = toNorm(p)
          const prev = norm[norm.length - 1]
          if (!prev || prev.x !== q.x || prev.y !== q.y) norm.push(q)
        }
        if (closed && norm.length > 1) {
          const f = norm[0]
          const l = norm[norm.length - 1]
          if (f.x === l.x && f.y === l.y) norm.pop()
        }
        if (closed && norm.length >= 3) geometry = { type: "polygon", points: norm }
        else if (norm.length >= 2) geometry = { type: "polyline", points: norm }
        labelPts = pts
        labelClosed = closed
      }
    } else {
      const p = e.points[0]
      if (p && isFinitePoint(p)) {
        geometry = { type: "point", points: [toNorm(p)] }
        labelPts = [p]
        if (e.kind === "circle" && e.radius && e.radius > 0 && toMm != null) {
          attributes.diameter_mm = Math.round(e.radius * 2 * toMm * 10) / 10
        }
        if (e.kind === "insert" && e.block) attributes.dxf_block = e.block
      }
    }

    if (!geometry || !isValidDraftGeometry(geometry)) {
      degenerate++
      continue
    }
    const idx = textIndex.get(e.layer)
    const label = idx && idx.size > 0 ? idx.nearest(labelPts, labelClosed, labelDist) : null
    drafts.push({ element_type: type, label, geometry, attributes })
    perLayer[e.layer] = (perLayer[e.layer] ?? 0) + 1
  }

  if (degenerate > 0) warnings.push(`Se omitieron ${degenerate} entidad(es) degeneradas (longitud cero o sin coordenadas válidas).`)
  if (skipped > 0) {
    warnings.push(`El plano supera el máximo de ${maxElements} elementos: se omitieron ${skipped}. Desmarca capas que no necesites.`)
  }

  // Ancho real sugerido.
  const insunits = parsed?.insunits ?? null
  let suggested: number | null = null
  if (unitFactor != null) {
    suggested = wEff * unitFactor
  } else if (insunits == null || insunits === 0) {
    if (wEff > 1000) {
      suggested = wEff / 1000
      warnings.push(
        `El DXF no declara unidades y mide ${formatNumber(wEff)} de ancho: se asumió que está en milímetros (≈ ${formatNumber(wEff / 1000)} m). Verifica el ancho real.`,
      )
    } else {
      warnings.push(
        `El DXF no declara unidades: indica el ancho real de la lámina en metros (si el dibujo está en metros, son ${formatNumber(wEff)} m).`,
      )
    }
  } else {
    warnings.push(`Unidades del DXF no reconocidas ($INSUNITS = ${insunits}): indica el ancho real en metros.`)
  }
  if (suggested != null) {
    suggested = Math.round(suggested * 1000) / 1000
    if (!(suggested > 0) || !Number.isFinite(suggested)) suggested = null
  }

  return {
    drafts,
    aspect,
    width_units: wEff,
    suggested_width_m: suggested,
    skipped,
    per_layer: perLayer,
    warnings,
  }
}
