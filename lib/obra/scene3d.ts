/**
 * Escena 3D de los planos de una obra (puro, sin three.js: usable en tests).
 *
 * Convierte capas + elementos + hallazgos en primitivas simples que el visor
 * 3D (components/obra/plan-3d.tsx) dibuja tal cual:
 *   - box:      muros (un tramo por segmento), columnas, vigas, tableros, medidores;
 *   - prism:    polígonos extruidos (losas, fundaciones, excavaciones);
 *   - tube:     redes (alcantarillado, agua, electricidad, gas…) como tubos;
 *   - cylinder: cámaras de inspección.
 *
 * Coordenadas: los metros del nivel (x a la derecha, y hacia abajo, como el
 * plano 2D) pasan a three.js como X = x, Z = y, Y = altura. Una cámara sobre la
 * escena mirando hacia abajo con `up = (0, 0, -1)` ve el plano igual que el 2D.
 * Cada nivel se apila a `nivel × LEVEL_HEIGHT_M` metros.
 *
 * Las alturas son convencionales (los planos 2D no las traen): muros de 2,5 m,
 * alcantarillado enterrado a 0,6 m, agua y electricidad por el cielo, gas a
 * 0,3 m. `attributes.depth_m` (profundidad) manda sobre la altura por defecto.
 */
import { geometryToMeters, sanitizeFrame, toLevelMeters } from "./geometry"
import {
  DISCIPLINE_COLORS,
  DISCIPLINE_LABELS,
  ELEMENT_TYPE_DISCIPLINE,
  type Discipline,
  type ElementType,
  type FindingPin,
  type LayerFrame,
  type PlanElement,
  type PlanLayer,
  type Severity,
  type Vec2,
} from "./types"

/** Altura de entrepiso (m): distancia entre el piso de un nivel y el del siguiente. */
export const LEVEL_HEIGHT_M = 2.8
/** Altura de muros, tabiques y columnas (m). */
export const WALL_HEIGHT_M = 2.5
/** Máximo de primitivas por escena (protege al navegador con planos enormes). */
export const MAX_PRIMITIVES = 20_000
/** Máximo de puntos por elemento (se diezma el resto). */
export const MAX_POINTS_PER_ELEMENT = 400

export const SCENE_GROUPS = [
  "muros",
  "estructura",
  "alcantarillado",
  "agua_potable",
  "aguas_lluvia",
  "electrico",
  "gas",
  "climatizacion",
  "incendio",
  "otro",
] as const
export type SceneGroup = (typeof SCENE_GROUPS)[number]

const shortLabel = (d: Discipline) => DISCIPLINE_LABELS[d].split(" (")[0].split(" / ")[0]

export const SCENE_GROUP_LABELS: Record<SceneGroup, string> = {
  muros: "Muros y tabiques",
  estructura: "Estructura",
  alcantarillado: shortLabel("alcantarillado"),
  agua_potable: shortLabel("agua_potable"),
  aguas_lluvia: shortLabel("aguas_lluvia"),
  electrico: shortLabel("electrico"),
  gas: shortLabel("gas"),
  climatizacion: shortLabel("climatizacion"),
  incendio: shortLabel("incendio"),
  otro: "Otros elementos",
}

/** Color de dibujo 3D de cada grupo (muros claros para que destaquen las redes). */
export const SCENE_GROUP_COLORS: Record<SceneGroup, string> = {
  muros: "#d6d1c6",
  estructura: "#c28a5c",
  alcantarillado: DISCIPLINE_COLORS.alcantarillado,
  agua_potable: DISCIPLINE_COLORS.agua_potable,
  aguas_lluvia: DISCIPLINE_COLORS.aguas_lluvia,
  electrico: DISCIPLINE_COLORS.electrico,
  gas: DISCIPLINE_COLORS.gas,
  climatizacion: DISCIPLINE_COLORS.climatizacion,
  incendio: DISCIPLINE_COLORS.incendio,
  otro: DISCIPLINE_COLORS.otro,
}

/** Grupos que ocultan la vista ("solo muros" deja solo estos). */
export const WALL_GROUPS: readonly SceneGroup[] = ["muros"]
/** Grupos sólidos que se vuelven translúcidos con «Rayos X». */
export const SOLID_GROUPS: readonly SceneGroup[] = ["muros", "estructura"]

type PrimitiveBase = {
  element_id: number
  layer_id: number
  level: number
  group: SceneGroup
  color: string
}

/** Caja orientada: centro, largo (eje local x), alto (y), espesor (z) y giro en torno a Y (rad, convención three.js). */
export type SceneBox = PrimitiveBase & {
  kind: "box"
  cx: number
  cy: number
  cz: number
  sx: number
  sy: number
  sz: number
  rot_y: number
}
/** Polígono (X, Z) extruido entre dos alturas. */
export type ScenePrism = PrimitiveBase & {
  kind: "prism"
  polygon: [number, number][]
  y_bottom: number
  y_top: number
  translucent: boolean
}
/** Tubo a lo largo de una polilínea (X, Y, Z). */
export type SceneTube = PrimitiveBase & {
  kind: "tube"
  points: [number, number, number][]
  radius: number
  closed: boolean
}
/** Cilindro vertical. */
export type SceneCylinder = PrimitiveBase & {
  kind: "cylinder"
  cx: number
  cz: number
  radius: number
  y_bottom: number
  y_top: number
}
export type ScenePrimitive = SceneBox | ScenePrism | SceneTube | SceneCylinder

export type SceneFloor = {
  level: number
  elevation: number
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export type ScenePin = {
  finding_id: number
  level: number
  x: number
  y: number
  z: number
  severity: Severity
  status: FindingPin["status"]
  title: string
}

export type SceneGroupCount = { group: SceneGroup; label: string; color: string; count: number }

export type Scene3D = {
  primitives: ScenePrimitive[]
  floors: SceneFloor[]
  pins: ScenePin[]
  /** Grupos presentes en los elementos considerados (antes de ocultar grupos), en orden estable. */
  groups: SceneGroupCount[]
  /** Elementos dibujados (después de los filtros). */
  element_count: number
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null
  /** true si se recortaron primitivas o puntos por los límites de tamaño. */
  truncated: boolean
}

export type BuildScene3DInput = {
  layers: readonly PlanLayer[]
  elements: readonly PlanElement[]
  pins?: readonly FindingPin[]
  /** Niveles a incluir (si falta, todos los de las capas). */
  levels?: readonly number[] | null
  hiddenLayerIds?: readonly number[]
  /** Disciplinas de capa ocultas (como el panel de capas del 2D). */
  hiddenDisciplines?: readonly Discipline[]
  hiddenGroups?: readonly SceneGroup[]
  maxPrimitives?: number
}

// ---------------------------------------------------------------------------
// Reglas por tipo de elemento
// ---------------------------------------------------------------------------

const NETWORK_DISCIPLINES: ReadonlySet<Discipline> = new Set([
  "alcantarillado",
  "agua_potable",
  "aguas_lluvia",
  "electrico",
  "gas",
  "climatizacion",
  "incendio",
])

/** Grupo de filtro de un elemento (por su tipo; "otro" y excavación toman la red de su capa). */
export function sceneGroupOf(el: Pick<PlanElement, "element_type">, layer?: Pick<PlanLayer, "discipline"> | null): SceneGroup {
  switch (el.element_type) {
    case "muro":
    case "muro_carga":
      return "muros"
    case "columna":
    case "viga":
    case "losa":
    case "fundacion":
      return "estructura"
  }
  const d = ELEMENT_TYPE_DISCIPLINE[el.element_type]
  if (d && NETWORK_DISCIPLINES.has(d)) return d as SceneGroup
  if (layer && NETWORK_DISCIPLINES.has(layer.discipline)) return layer.discipline as SceneGroup
  return "otro"
}

type PipeRule = { elevation: number; diameter_mm: number }
/** Altura (m sobre el piso del nivel; negativa = enterrada) y Ø por defecto de cada red. */
export const PIPE_RULES: Partial<Record<ElementType, PipeRule>> = {
  tuberia_alcantarillado: { elevation: -0.6, diameter_mm: 110 },
  tuberia_aguas_lluvia: { elevation: -0.5, diameter_mm: 110 },
  tuberia_agua: { elevation: 2.25, diameter_mm: 25 },
  ducto_electrico: { elevation: 2.4, diameter_mm: 32 },
  linea_gas: { elevation: 0.3, diameter_mm: 20 },
  ducto_clima: { elevation: 2.3, diameter_mm: 250 },
  red_incendio: { elevation: 2.2, diameter_mm: 65 },
}
/** Radio visible de un tubo (m): ni invisible ni más grueso que un muro. */
export const TUBE_RADIUS_RANGE = { min: 0.03, max: 0.35 } as const

function positiveNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Ø (mm) desde los atributos o, si no, desde la etiqueta ("Colector PVC Ø110"). */
export function elementDiameterMm(el: Pick<PlanElement, "attributes" | "label">): number | null {
  const a = positiveNumber(el.attributes?.diameter_mm)
  if (a != null) return a
  const m = /(?:Ø|ø|%%c|\bD(?:N|=)?)\s*(\d{2,4})(?:\s*mm)?\b/i.exec(el.label ?? "")
  if (!m) return null
  const n = Number(m[1])
  return n >= 10 && n <= 3000 ? n : null
}

function depthOf(el: Pick<PlanElement, "attributes">): number | null {
  return positiveNumber(el.attributes?.depth_m)
}

/** Radio (m) del tubo de un elemento de red. */
export function tubeRadiusOf(el: Pick<PlanElement, "element_type" | "attributes" | "label">): number {
  const d = elementDiameterMm(el) ?? PIPE_RULES[el.element_type]?.diameter_mm ?? 50
  return Math.min(TUBE_RADIUS_RANGE.max, Math.max(TUBE_RADIUS_RANGE.min, d / 2000))
}

/** Altura (m sobre el piso del nivel) del eje de un tubo. */
export function tubeElevationOf(el: Pick<PlanElement, "element_type" | "attributes">): number {
  const depth = depthOf(el)
  if (depth != null) return -depth
  return PIPE_RULES[el.element_type]?.elevation ?? 0.3
}

// ---------------------------------------------------------------------------
// Utilidades geométricas
// ---------------------------------------------------------------------------

function finite(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

/** Deja como máximo `max` puntos (conserva el primero y el último). */
export function decimatePoints<T>(pts: readonly T[], max = MAX_POINTS_PER_ELEMENT): T[] {
  if (pts.length <= max || max < 2) return pts.slice()
  const out: T[] = []
  const step = (pts.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)])
  return out
}

/** Caja a lo largo del segmento a→b (plano X, Z) con alto y espesor dados. */
export function segmentBox(a: Vec2, b: Vec2, y0: number, y1: number, thickness: number): Omit<SceneBox, keyof PrimitiveBase | "kind"> | null {
  const dx = b.x - a.x
  const dz = b.y - a.y
  const len = Math.hypot(dx, dz)
  if (!(len > 1e-4)) return null
  return {
    cx: (a.x + b.x) / 2,
    cy: (y0 + y1) / 2,
    cz: (a.y + b.y) / 2,
    // Se alarga medio espesor por lado: así las esquinas de muros que se tocan quedan cerradas.
    sx: len + thickness,
    sy: y1 - y0,
    sz: thickness,
    // three.js gira (1,0,0) en torno a Y a (cos θ, 0, −sen θ): θ = atan2(−dz, dx) alinea el largo con a→b.
    rot_y: Math.atan2(-dz, dx),
  }
}

/** Caja orientada que envuelve un polígono: si tiene 4 vértices se usa su primer lado; si no, ejes. */
function polygonFootprint(pts: Vec2[]): { cx: number; cz: number; sx: number; sz: number; rot_y: number } | null {
  if (pts.length === 0) return null
  if (pts.length === 4) {
    const [p0, p1, p2] = pts
    const w = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    const h = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    if (w > 1e-4 && h > 1e-4) {
      const c = pts.reduce((acc, p) => ({ x: acc.x + p.x / 4, y: acc.y + p.y / 4 }), { x: 0, y: 0 })
      return { cx: c.x, cz: c.y, sx: w, sz: h, rot_y: Math.atan2(-(p1.y - p0.y), p1.x - p0.x) }
    }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { cx: (minX + maxX) / 2, cz: (minY + maxY) / 2, sx: Math.max(maxX - minX, 0.05), sz: Math.max(maxY - minY, 0.05), rot_y: 0 }
}

// ---------------------------------------------------------------------------
// Escena
// ---------------------------------------------------------------------------

/** Altura del piso de un nivel. */
export function levelElevation(level: number): number {
  return level * LEVEL_HEIGHT_M
}

function frameOfLayer(layer: Pick<PlanLayer, "frame">): LayerFrame {
  return sanitizeFrame(layer.frame)
}

const CORNERS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

/** Primitivas de un elemento (en metros; vacío si su geometría no sirve). */
export function elementPrimitives(el: PlanElement, layer: PlanLayer, frame: LayerFrame = frameOfLayer(layer)): ScenePrimitive[] {
  const g = el.geometry
  if (!g || !Array.isArray(g.points) || g.points.length === 0) return []
  const metric = geometryToMeters(g, frame)
  const pts = decimatePoints(metric.points.filter(finite))
  if (pts.length === 0) return []
  const base0 = levelElevation(layer.level)
  const group = sceneGroupOf(el, layer)
  const base: PrimitiveBase = {
    element_id: el.id,
    layer_id: el.layer_id,
    level: layer.level,
    group,
    color: SCENE_GROUP_COLORS[group],
  }
  const out: ScenePrimitive[] = []
  const closed = metric.type === "polygon" && pts.length >= 3
  const ring = closed ? [...pts, pts[0]] : pts
  const box = (b: Omit<SceneBox, keyof PrimitiveBase | "kind"> | null) => {
    if (b) out.push({ ...base, kind: "box", ...b })
  }

  switch (el.element_type) {
    case "muro":
    case "muro_carga": {
      const t = el.element_type === "muro_carga" ? 0.2 : 0.15
      for (let i = 1; i < ring.length; i++) box(segmentBox(ring[i - 1], ring[i], base0, base0 + WALL_HEIGHT_M, t))
      break
    }
    case "viga": {
      for (let i = 1; i < ring.length; i++) box(segmentBox(ring[i - 1], ring[i], base0 + WALL_HEIGHT_M - 0.4, base0 + WALL_HEIGHT_M, 0.2))
      break
    }
    case "columna": {
      const f = metric.type === "point" || pts.length < 3 ? { cx: pts[0].x, cz: pts[0].y, sx: 0.3, sz: 0.3, rot_y: 0 } : polygonFootprint(pts)
      if (f) box({ cx: f.cx, cy: base0 + WALL_HEIGHT_M / 2, cz: f.cz, sx: f.sx, sy: WALL_HEIGHT_M, sz: f.sz, rot_y: f.rot_y })
      break
    }
    case "losa":
    case "fundacion":
    case "excavacion": {
      const [y0, y1] =
        el.element_type === "losa" ? [-0.15, 0] : el.element_type === "fundacion" ? [-0.8, -0.15] : [-(depthOf(el) ?? 1.2), 0]
      if (closed) {
        out.push({
          ...base,
          kind: "prism",
          polygon: pts.map((p) => [p.x, p.y]),
          y_bottom: base0 + y0,
          y_top: base0 + y1,
          translucent: el.element_type === "excavacion",
        })
      } else if (metric.type === "polyline") {
        for (let i = 1; i < pts.length; i++) box(segmentBox(pts[i - 1], pts[i], base0 + y0, base0 + y1, 0.3))
      }
      break
    }
    case "camara_inspeccion": {
      const fp = metric.type === "point" || pts.length < 3 ? null : polygonFootprint(pts)
      const radius = Math.min(1.5, Math.max(0.2, fp ? Math.max(fp.sx, fp.sz) / 2 : (elementDiameterMm(el) ?? 600) / 2000))
      out.push({
        ...base,
        kind: "cylinder",
        cx: fp ? fp.cx : pts[0].x,
        cz: fp ? fp.cz : pts[0].y,
        radius,
        y_bottom: base0 - (depthOf(el) ?? 0.9),
        y_top: base0 + 0.03,
      })
      break
    }
    case "tablero_electrico":
    case "medidor_gas": {
      const fp = metric.type === "point" || pts.length < 3 ? null : polygonFootprint(pts)
      const [w, h, d, y0] = el.element_type === "tablero_electrico" ? [0.5, 0.7, 0.15, 1.2] : [0.4, 0.4, 0.3, 0.3]
      box({ cx: fp ? fp.cx : pts[0].x, cy: base0 + y0 + h / 2, cz: fp ? fp.cz : pts[0].y, sx: w, sy: h, sz: d, rot_y: fp?.rot_y ?? 0 })
      break
    }
    default: {
      if (PIPE_RULES[el.element_type] || (group !== "otro" && el.element_type === "otro")) {
        if (metric.type === "point" || ring.length < 2) {
          if (el.element_type === "otro") box({ cx: pts[0].x, cy: base0 + 0.15, cz: pts[0].y, sx: 0.3, sy: 0.3, sz: 0.3, rot_y: 0 })
          break
        }
        const y = base0 + tubeElevationOf(el)
        out.push({ ...base, kind: "tube", points: ring.map((p) => [p.x, y, p.y]), radius: tubeRadiusOf(el), closed })
        break
      }
      // Otros: marcador en un punto; polilíneas y polígonos como bordillos bajos.
      if (metric.type === "point" || ring.length < 2) {
        box({ cx: pts[0].x, cy: base0 + 0.15, cz: pts[0].y, sx: 0.3, sy: 0.3, sz: 0.3, rot_y: 0 })
      } else {
        for (let i = 1; i < ring.length; i++) box(segmentBox(ring[i - 1], ring[i], base0, base0 + 0.15, 0.1))
      }
    }
  }
  return out
}

/** Arma la escena 3D de los niveles pedidos con los filtros del visor. */
export function buildScene3D(input: BuildScene3DInput): Scene3D {
  const maxPrimitives = Math.max(1, input.maxPrimitives ?? MAX_PRIMITIVES)
  const hiddenLayers = new Set(input.hiddenLayerIds ?? [])
  const hiddenDisciplines = new Set(input.hiddenDisciplines ?? [])
  const hiddenGroups = new Set(input.hiddenGroups ?? [])
  const levelSet = input.levels ? new Set(input.levels) : null
  const layers = input.layers.filter((l) => !levelSet || levelSet.has(l.level))
  const layerById = new Map(layers.map((l) => [l.id, l]))
  const frames = new Map(layers.map((l) => [l.id, frameOfLayer(l)]))

  // Pisos: uno por nivel, con todas sus capas (como el mapa de calor 2D).
  const floorsByLevel = new Map<number, SceneFloor>()
  for (const l of layers) {
    const f = frames.get(l.id)!
    for (const c of CORNERS) {
      const p = toLevelMeters(c, f)
      if (!finite(p)) continue
      const cur = floorsByLevel.get(l.level)
      if (!cur) {
        floorsByLevel.set(l.level, { level: l.level, elevation: levelElevation(l.level), minX: p.x, minZ: p.y, maxX: p.x, maxZ: p.y })
      } else {
        cur.minX = Math.min(cur.minX, p.x)
        cur.minZ = Math.min(cur.minZ, p.y)
        cur.maxX = Math.max(cur.maxX, p.x)
        cur.maxZ = Math.max(cur.maxZ, p.y)
      }
    }
  }
  const floors = [...floorsByLevel.values()].sort((a, b) => a.level - b.level)

  const counts = new Map<SceneGroup, number>()
  const primitives: ScenePrimitive[] = []
  let truncated = false
  let elementCount = 0
  for (const el of input.elements) {
    const layer = layerById.get(el.layer_id)
    if (!layer || hiddenLayers.has(layer.id) || hiddenDisciplines.has(layer.discipline)) continue
    const group = sceneGroupOf(el, layer)
    counts.set(group, (counts.get(group) ?? 0) + 1)
    if (hiddenGroups.has(group)) continue
    if (primitives.length >= maxPrimitives) {
      truncated = true
      continue
    }
    if ((el.geometry?.points?.length ?? 0) > MAX_POINTS_PER_ELEMENT) truncated = true
    let prims: ScenePrimitive[]
    try {
      prims = elementPrimitives(el, layer, frames.get(layer.id))
    } catch {
      prims = []
    }
    if (prims.length === 0) continue
    const room = maxPrimitives - primitives.length
    if (prims.length > room) {
      prims = prims.slice(0, room)
      truncated = true
    }
    primitives.push(...prims)
    elementCount += 1
  }

  const groups: SceneGroupCount[] = SCENE_GROUPS.filter((g) => counts.has(g)).map((g) => ({
    group: g,
    label: SCENE_GROUP_LABELS[g],
    color: SCENE_GROUP_COLORS[g],
    count: counts.get(g) ?? 0,
  }))

  const pins: ScenePin[] = []
  for (const p of input.pins ?? []) {
    if (levelSet && !levelSet.has(p.level)) continue
    const f = frames.get(p.layer_id)
    if (!f) continue
    const m = toLevelMeters({ x: p.x, y: p.y }, f)
    if (!finite(m)) continue
    pins.push({
      finding_id: p.finding_id,
      level: p.level,
      x: m.x,
      y: levelElevation(p.level),
      z: m.y,
      severity: p.severity,
      status: p.status,
      title: p.title,
    })
  }

  return { primitives, floors, pins, groups, element_count: elementCount, bounds: sceneBounds(floors, primitives, pins), truncated }
}

function sceneBounds(floors: SceneFloor[], primitives: ScenePrimitive[], pins: ScenePin[]): Scene3D["bounds"] {
  let b: NonNullable<Scene3D["bounds"]> | null = null
  const add = (x: number, y: number, z: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
    if (!b) b = { minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z }
    else {
      b.minX = Math.min(b.minX, x)
      b.minY = Math.min(b.minY, y)
      b.minZ = Math.min(b.minZ, z)
      b.maxX = Math.max(b.maxX, x)
      b.maxY = Math.max(b.maxY, y)
      b.maxZ = Math.max(b.maxZ, z)
    }
  }
  for (const f of floors) {
    add(f.minX, f.elevation, f.minZ)
    add(f.maxX, f.elevation + WALL_HEIGHT_M, f.maxZ)
  }
  for (const p of primitives) {
    switch (p.kind) {
      case "box": {
        const r = Math.hypot(p.sx, p.sz) / 2
        add(p.cx - r, p.cy - p.sy / 2, p.cz - r)
        add(p.cx + r, p.cy + p.sy / 2, p.cz + r)
        break
      }
      case "prism":
        for (const [x, z] of p.polygon) {
          add(x, p.y_bottom, z)
          add(x, p.y_top, z)
        }
        break
      case "tube":
        for (const [x, y, z] of p.points) {
          add(x - p.radius, y - p.radius, z - p.radius)
          add(x + p.radius, y + p.radius, z + p.radius)
        }
        break
      case "cylinder":
        add(p.cx - p.radius, p.y_bottom, p.cz - p.radius)
        add(p.cx + p.radius, p.y_top, p.cz + p.radius)
        break
    }
  }
  for (const p of pins) {
    add(p.x, p.y, p.z)
    add(p.x, p.y + 1.6, p.z)
  }
  return b
}
