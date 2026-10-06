/**
 * Motor de correlación determinista: hallazgo en el plano → elementos cercanos
 * de todas las capas (mismo nivel y adyacentes) → hipótesis técnicas según las
 * reglas de lib/obra/rules.ts. Puro (sin BD ni servidor; usable en cliente).
 *
 * "La geometría prueba, la IA explica": todo lo que se devuelve aquí es
 * verificable por un humano (elemento, capa, distancia en planta y relación de
 * nivel). La IA solo redacta y prioriza sobre estas correlaciones.
 */
import {
  clamp01,
  distancePointToGeometryMeters,
  geometryToMeters,
  isValidGeometry,
  sanitizeFrame,
  toLevelMeters,
} from "./geometry"
import { CORRELATION_RULES, DEFAULT_SEARCH_RADIUS_M } from "./rules"
import {
  DISCIPLINE_LABELS,
  ELEMENT_TYPE_DISCIPLINE,
  FINDING_CATEGORIES,
  PRIORITIES,
  type Correlation,
  type CorrelationRule,
  type CreateTaskPayload,
  type Discipline,
  type ElementAttributes,
  type ElementGeometry,
  type ElementType,
  type FindingCategory,
  type LayerFrame,
  type LevelRelation,
  type Priority,
  type Severity,
  type Vec2,
} from "./types"

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

export type CorrelationLayerInput = {
  id: number
  name: string
  discipline: Discipline
  level: number
  frame: LayerFrame
}

export type CorrelationElementInput = {
  id: number
  layer_id: number
  element_type: ElementType
  label: string | null
  geometry: ElementGeometry
  attributes?: ElementAttributes
}

export type CorrelationFindingInput = {
  level: number
  /** Marco de la capa donde está el pin del hallazgo. */
  frame: LayerFrame
  /** Coordenadas normalizadas del pin en su capa. */
  x: number
  y: number
  category: FindingCategory
  severity: Severity
}

export type CorrelateOptions = {
  /** Reglas a aplicar (por defecto CORRELATION_RULES). */
  rules?: CorrelationRule[]
  /** Máximo de correlaciones devueltas (por defecto 5). */
  maxResults?: number
  /** Radio de búsqueda en metros (por defecto DEFAULT_SEARCH_RADIUS_M). */
  radiusM?: number
}

/**
 * Correlación con la descripción legible del elemento (incluye Ø). Es un
 * superconjunto de Correlation: se puede guardar tal cual en la evidencia y
 * describeCorrelation() la aprovecha si está presente.
 */
export type CorrelationWithDescription = Correlation & { element_description: string }

// ---------------------------------------------------------------------------
// Prioridad y severidad
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<Priority, number> = { baja: 0, media: 1, alta: 2, critica: 3 }

/** Peso de cada prioridad en el puntaje de relevancia. */
export const PRIORITY_WEIGHT: Record<Priority, number> = { baja: 0.25, media: 0.5, alta: 0.75, critica: 1 }

/** Plazo máximo (días) según la prioridad final: si la prioridad sube, el plazo se acorta. */
export const MAX_DUE_DAYS_BY_PRIORITY: Record<Priority, number> = { critica: 1, alta: 3, media: 7, baja: 14 }

const SEVERITY_TO_PRIORITY: Record<Severity, Priority> = {
  low: "baja",
  medium: "media",
  high: "alta",
  critical: "critica",
}
const PRIORITY_TO_SEVERITY: Record<Priority, Severity> = {
  baja: "low",
  media: "medium",
  alta: "high",
  critica: "critical",
}

export function priorityFromSeverity(s: Severity): Priority {
  return SEVERITY_TO_PRIORITY[s] ?? "media"
}

export function severityFromPriority(p: Priority): Severity {
  return PRIORITY_TO_SEVERITY[p] ?? "medium"
}

/**
 * Prioridad final de una correlación: la de la regla, subida un nivel si el
 * hallazgo es de severidad alta o crítica y la regla tiene una prioridad
 * menor que esa severidad. Nunca baja la prioridad de la regla.
 */
export function combinePriority(rulePriority: Priority, severity: Severity): Priority {
  const base = PRIORITY_RANK[rulePriority]
  if (base == null) return "media"
  if (severity !== "high" && severity !== "critical") return rulePriority
  const sevRank = PRIORITY_RANK[priorityFromSeverity(severity)]
  if (base < sevRank) return PRIORITIES[base + 1]
  return rulePriority
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

export const RELATION_TEXT: Record<LevelRelation, string> = {
  mismo_nivel: "en el mismo nivel",
  nivel_inferior: "en el nivel inferior (bajo el hallazgo)",
  nivel_superior: "en el nivel superior (sobre el hallazgo)",
}

type ElementNoun = { article: "el" | "la"; noun: string; linear: boolean }

/** Sustantivo en español de cada tipo de elemento, para redactar frases. */
const ELEMENT_NOUNS: Record<ElementType, ElementNoun> = {
  muro: { article: "el", noun: "muro", linear: false },
  muro_carga: { article: "el", noun: "muro de carga", linear: false },
  columna: { article: "la", noun: "columna", linear: false },
  viga: { article: "la", noun: "viga", linear: false },
  losa: { article: "la", noun: "losa", linear: false },
  fundacion: { article: "la", noun: "fundación", linear: false },
  tuberia_alcantarillado: { article: "el", noun: "colector de alcantarillado", linear: true },
  camara_inspeccion: { article: "la", noun: "cámara de inspección", linear: false },
  tuberia_agua: { article: "la", noun: "tubería de agua potable", linear: true },
  tuberia_aguas_lluvia: { article: "la", noun: "tubería de aguas lluvia", linear: true },
  ducto_electrico: { article: "la", noun: "canalización eléctrica", linear: true },
  tablero_electrico: { article: "el", noun: "tablero eléctrico", linear: false },
  linea_gas: { article: "la", noun: "red de gas", linear: true },
  medidor_gas: { article: "el", noun: "medidor de gas", linear: false },
  ducto_clima: { article: "el", noun: "ducto de climatización", linear: true },
  red_incendio: { article: "la", noun: "red contra incendio", linear: true },
  excavacion: { article: "la", noun: "excavación", linear: false },
  otro: { article: "el", noun: "elemento", linear: false },
}

function nounFor(type: ElementType): ElementNoun {
  return ELEMENT_NOUNS[type] ?? ELEMENT_NOUNS.otro
}

/** Verbo de ubicación: "pasa" para elementos lineales (tuberías, ductos), "se ubica" para el resto. */
function verbFor(type: ElementType): string {
  return nounFor(type).linear ? "pasa" : "se ubica"
}

/** Recorta a `max` caracteres (por puntos de código, sin cortar emojis ni tildes compuestas). */
function truncateText(s: string, max: number): string {
  const chars = Array.from(s)
  if (chars.length <= max) return s
  return (
    chars
      .slice(0, Math.max(0, max - 1))
      .join("")
      .trimEnd() + "…"
  )
}

/**
 * Texto de una sola línea, sin caracteres de control. Por defecto quita
 * también las comillas angulares (se usan para encerrar etiquetas).
 */
function cleanInline(v: unknown, max: number, keepQuotes = false): string {
  if (typeof v !== "string") return ""
  let out = ""
  for (const ch of v) {
    const c = ch.codePointAt(0) ?? 0
    const isQuote = !keepQuotes && (ch === "«" || ch === "»")
    out += c < 0x20 || (c >= 0x7f && c <= 0x9f) || isQuote ? " " : ch
  }
  return truncateText(out.replace(/\s+/g, " ").trim(), max)
}

function formatNumberCl(n: number, decimals: number): string {
  const f = 10 ** decimals
  const r = Math.round(n * f) / f
  return String(r).replace(".", ",")
}

/** Distancia en formato chileno (coma decimal): "1,2 m"; bajo 5 cm, "menos de 0,1 m". */
export function formatDistanceCl(m: number): string {
  if (typeof m !== "number" || !Number.isFinite(m) || m < 0) return "distancia desconocida"
  if (m < 0.05) return "menos de 0,1 m"
  return `${m.toFixed(1).replace(".", ",")} m`
}

function diameterOf(attributes: ElementAttributes | null | undefined): number | null {
  const raw: unknown = attributes?.diameter_mm
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : null
}

/**
 * Descripción legible de un elemento: tipo (con artículo por defecto),
 * etiqueta entre comillas angulares y diámetro si lo tiene.
 * Ej.: "el colector de alcantarillado «C-3» Ø160".
 */
export function describeElement(
  el: { element_type: ElementType; label?: string | null; attributes?: ElementAttributes | null },
  opts: { article?: boolean } = {},
): string {
  const noun = nounFor(el.element_type)
  const parts = [opts.article === false ? noun.noun : `${noun.article} ${noun.noun}`]
  const label = cleanInline(el.label, 60)
  if (label) parts.push(`«${label}»`)
  const d = diameterOf(el.attributes)
  if (d != null) parts.push(`Ø${formatNumberCl(d, 1)}`)
  return parts.join(" ")
}

const PLACEHOLDER_RE = /\{(elemento|distancia|capa|relacion|verbo)\}/g

function fillHypothesis(template: string, vars: Record<string, string>): string {
  return String(template ?? "").replace(PLACEHOLDER_RE, (_m, key: string) => vars[key] ?? "")
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RESULTS = 5
const DISTANCE_EXPONENT = 0.7
const ADJACENT_LEVEL_FACTOR = 0.75

function levelRelation(findingLevel: number, layerLevel: number): LevelRelation | null {
  const diff = Number(layerLevel) - Number(findingLevel)
  if (diff === 0) return "mismo_nivel"
  if (diff === -1) return "nivel_inferior"
  if (diff === 1) return "nivel_superior"
  return null
}

function clampInt(n: unknown, min: number, max: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : min
  return v < min ? min : v > max ? max : v
}

type RuleMatch = { rule: CorrelationRule; priority: Priority; score: number }

function matchRule(
  rule: CorrelationRule,
  elementType: ElementType,
  relation: LevelRelation,
  distance: number,
  severity: Severity,
): RuleMatch | null {
  if (!rule.element_types.includes(elementType)) return null
  if (!rule.relations.includes(relation)) return null
  const maxD = Number(rule.max_distance_m)
  if (!Number.isFinite(maxD) || maxD < 0 || distance > maxD) return null
  const priority = combinePriority(rule.base_priority, severity)
  const proximity = maxD > 0 ? Math.pow(Math.max(0, 1 - distance / maxD), DISTANCE_EXPONENT) : 1
  const levelFactor = relation === "mismo_nivel" ? 1 : ADJACENT_LEVEL_FACTOR
  const score = (PRIORITY_WEIGHT[priority] ?? 0) * proximity * levelFactor
  return { rule, priority, score }
}

function bestMatch(
  rules: CorrelationRule[],
  elementType: ElementType,
  relation: LevelRelation,
  distance: number,
  severity: Severity,
): RuleMatch | null {
  let best: RuleMatch | null = null
  for (const rule of rules) {
    const m = matchRule(rule, elementType, relation, distance, severity)
    if (m && (!best || m.score > best.score)) best = m
  }
  return best
}

/**
 * Tipos lineales (muros y redes). Si vienen como polígono (p.ej. una polilínea
 * cerrada importada de DXF: el contorno de un edificio o un anillo de cañería),
 * la distancia se mide a su contorno: estar "dentro" del anillo no es estar
 * sobre el muro o la cañería. Las superficies (losa, fundación, excavación,
 * columna...) sí usan 0 m dentro del polígono.
 */
const LINEAR_ELEMENT_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  "muro",
  "muro_carga",
  "tuberia_alcantarillado",
  "tuberia_agua",
  "tuberia_aguas_lluvia",
  "ducto_electrico",
  "linea_gas",
  "ducto_clima",
  "red_incendio",
])

function elementDistanceMeters(origin: Vec2, element: CorrelationElementInput, frame: LayerFrame): number {
  const g = geometryToMeters(element.geometry, frame)
  if (g.type === "polygon" && g.points.length >= 3 && LINEAR_ELEMENT_TYPES.has(element.element_type)) {
    return distancePointToGeometryMeters(origin, { type: "polyline", points: [...g.points, g.points[0]] })
  }
  return distancePointToGeometryMeters(origin, g)
}

type Candidate = {
  match: RuleMatch
  element: CorrelationElementInput
  layer: CorrelationLayerInput
  relation: LevelRelation
  distance: number
}

/**
 * Busca los elementos de las capas entregadas (mismo nivel del hallazgo y
 * niveles ±1) que estén dentro del radio y les aplica las reglas.
 *
 * - Distancia en planta, en metros del nivel: el hallazgo se convierte con su
 *   marco y cada elemento con el marco de SU capa.
 * - Por elemento queda una sola correlación: la regla de mayor puntaje. Las
 *   reglas genéricas (categoría "*") solo se usan si ninguna regla específica
 *   de la categoría del hallazgo aplica a ese elemento.
 * - Orden: prioridad final descendente, luego puntaje descendente y luego
 *   distancia ascendente. La prioridad va primero para que una correlación de
 *   contexto (baja) no desplace a una hipótesis específica de prioridad alta
 *   cuando solo se convierten las primeras en sugerencias.
 */
export function correlateFinding(
  finding: CorrelationFindingInput,
  layers: CorrelationLayerInput[],
  elements: CorrelationElementInput[],
  opts: CorrelateOptions = {},
): Correlation[] {
  const rules = opts.rules ?? CORRELATION_RULES
  const maxResults =
    typeof opts.maxResults === "number" && !Number.isNaN(opts.maxResults)
      ? Math.max(0, Math.floor(opts.maxResults))
      : DEFAULT_MAX_RESULTS
  const radius =
    typeof opts.radiusM === "number" && Number.isFinite(opts.radiusM) && opts.radiusM >= 0
      ? opts.radiusM
      : DEFAULT_SEARCH_RADIUS_M
  if (maxResults === 0) return []

  const specificRules = rules.filter((r) => r.categories.includes(finding.category))
  const genericRules = rules.filter((r) => !r.categories.includes(finding.category) && r.categories.includes("*"))
  if (specificRules.length === 0 && genericRules.length === 0) return []

  const origin = toLevelMeters({ x: clamp01(finding.x), y: clamp01(finding.y) }, finding.frame)

  const layerInfo = new Map<number, { layer: CorrelationLayerInput; relation: LevelRelation; frame: LayerFrame }>()
  for (const layer of layers ?? []) {
    const relation = levelRelation(finding.level, layer.level)
    if (relation) layerInfo.set(layer.id, { layer, relation, frame: sanitizeFrame(layer.frame) })
  }

  const byElement = new Map<number, Candidate>()
  for (const element of elements ?? []) {
    const info = layerInfo.get(element.layer_id)
    if (!info || !isValidGeometry(element.geometry)) continue
    const distance = elementDistanceMeters(origin, element, info.frame)
    if (!(distance <= radius)) continue
    const match =
      bestMatch(specificRules, element.element_type, info.relation, distance, finding.severity) ??
      bestMatch(genericRules, element.element_type, info.relation, distance, finding.severity)
    if (!match) continue
    const prev = byElement.get(element.id)
    if (!prev || match.score > prev.match.score) {
      byElement.set(element.id, { match, element, layer: info.layer, relation: info.relation, distance })
    }
  }

  const sorted = [...byElement.values()].sort(
    (a, b) =>
      (PRIORITY_WEIGHT[b.match.priority] ?? 0) - (PRIORITY_WEIGHT[a.match.priority] ?? 0) ||
      b.match.score - a.match.score ||
      a.distance - b.distance ||
      a.element.id - b.element.id,
  )

  return sorted.slice(0, maxResults).map((c): CorrelationWithDescription => {
    const { rule, priority, score } = c.match
    const distance_m = Math.round(c.distance * 100) / 100
    const element_description = describeElement(c.element)
    const layerName = cleanInline(c.layer.name, 120) || "sin nombre"
    const hypothesis = fillHypothesis(rule.hypothesis, {
      elemento: element_description,
      distancia: formatDistanceCl(distance_m),
      capa: layerName,
      relacion: RELATION_TEXT[c.relation],
      verbo: verbFor(c.element.element_type),
    })
    return {
      rule_id: rule.id,
      element_id: c.element.id,
      element_type: c.element.element_type,
      element_label: c.element.label ?? null,
      layer_id: c.layer.id,
      layer_name: c.layer.name,
      discipline: c.layer.discipline,
      relation: c.relation,
      distance_m,
      priority,
      score: Math.round(score * 10_000) / 10_000,
      hypothesis,
      recommended_actions: [...rule.recommended_actions],
      suggested_role: rule.suggested_role,
      due_in_days: Math.min(clampInt(rule.due_in_days, 0, 365), MAX_DUE_DAYS_BY_PRIORITY[priority]),
      element_description,
    }
  })
}

function elementDescriptionOf(c: Correlation): string {
  const extra = (c as Partial<CorrelationWithDescription>).element_description
  if (typeof extra === "string" && extra.trim()) return cleanInline(extra, 160, true)
  return describeElement({ element_type: c.element_type, label: c.element_label })
}

/**
 * Frase de evidencia verificable de una correlación. Ej.:
 * "A 1,2 m, en el mismo nivel, pasa el colector de alcantarillado «C-3» Ø160 (capa Alcantarillado N1)."
 */
export function describeCorrelation(c: Correlation): string {
  const relation = RELATION_TEXT[c.relation] ?? "en un nivel cercano"
  const layer = cleanInline(c.layer_name, 120) || "sin nombre"
  return `A ${formatDistanceCl(c.distance_m)}, ${relation}, ${verbFor(c.element_type)} ${elementDescriptionOf(c)} (capa ${layer}).`
}

// ---------------------------------------------------------------------------
// Correlación → tarea sugerida
// ---------------------------------------------------------------------------

const TASK_TITLE_BY_CATEGORY: Record<FindingCategory, { verb: string; noun: string }> = {
  grieta: { verb: "Revisar", noun: "grieta" },
  humedad_filtracion: { verb: "Revisar", noun: "humedad" },
  hundimiento: { verb: "Revisar", noun: "hundimiento" },
  olor_gas: { verb: "Atender", noun: "olor" },
  falla_electrica: { verb: "Revisar", noun: "falla eléctrica" },
  corrosion: { verb: "Tratar", noun: "corrosión" },
  desprendimiento: { verb: "Revisar", noun: "desprendimiento" },
  obstruccion: { verb: "Despejar", noun: "obstrucción" },
  excavacion: { verb: "Controlar", noun: "excavación" },
  otro: { verb: "Revisar", noun: "hallazgo" },
}

const TASK_TITLE_MAX = 120

function isFindingCategory(v: unknown): v is FindingCategory {
  return typeof v === "string" && (FINDING_CATEGORIES as readonly string[]).includes(v)
}

/** Categoría para el título: la del hallazgo si se conoce; si no, la única categoría de la regla. */
function categoryForTask(c: Correlation, explicit: unknown): FindingCategory | null {
  if (isFindingCategory(explicit)) return explicit
  const rule = CORRELATION_RULES.find((r) => r.id === c.rule_id)
  const cats = (rule?.categories ?? []).filter((x): x is FindingCategory => x !== "*")
  return cats.length === 1 ? cats[0] : null
}

function placeFor(c: Correlation, withLabel: boolean): string {
  const target = describeElement(
    { element_type: c.element_type, label: withLabel ? c.element_label : null },
    { article: false },
  )
  if (c.relation === "nivel_inferior") return `sobre ${target} del nivel inferior`
  if (c.relation === "nivel_superior") return `bajo ${target} del nivel superior`
  return `junto a ${target}`
}

function taskTitle(c: Correlation, findingTitle: string, category: FindingCategory | null): string {
  const build = (withLabel: boolean) => {
    const place = placeFor(c, withLabel)
    if (!category) return `Revisar hallazgo «${truncateText(findingTitle || "sin título", 50)}» ${place}`
    const t = TASK_TITLE_BY_CATEGORY[category]
    const noun = category === "olor_gas" && ELEMENT_TYPE_DISCIPLINE[c.element_type] === "gas" ? "olor a gas" : t.noun
    return `${t.verb} ${noun} ${place}`
  }
  const full = build(true)
  if (Array.from(full).length <= TASK_TITLE_MAX) return full
  return truncateText(build(false), TASK_TITLE_MAX)
}

/**
 * Convierte una correlación en el payload de una sugerencia `create_task`
 * (lo que se anota en la próxima revisión si un humano lo aprueba).
 * `finding.category` es opcional: si se omite se deduce de la regla.
 */
export function correlationToTaskPayload(
  c: Correlation,
  finding: {
    id: number
    title: string
    layer_id: number
    level: number
    x: number
    y: number
    category?: FindingCategory
  },
): CreateTaskPayload {
  const findingTitle = cleanInline(finding.title, 200)
  const title = taskTitle(c, findingTitle, categoryForTask(c, finding.category))
  const discipline = DISCIPLINE_LABELS[c.discipline] ?? c.discipline
  const evidence =
    `Evidencia: elemento #${c.element_id} de la capa «${cleanInline(c.layer_name, 120) || "sin nombre"}» (${discipline}), ` +
    `${RELATION_TEXT[c.relation] ?? "en un nivel cercano"}, a ${formatDistanceCl(c.distance_m)} en planta del hallazgo ` +
    `#${finding.id} «${findingTitle || "sin título"}». Regla aplicada: ${c.rule_id}.`
  const description = truncateText(`${String(c.hypothesis ?? "").trim()}\n\n${evidence}`, 4000)
  const checklist = (c.recommended_actions ?? [])
    .map((a) => cleanInline(a, 300))
    .filter((a) => a.length > 0)
    .slice(0, 20)
  return {
    title,
    description,
    priority: c.priority,
    assigned_role: c.suggested_role ?? null,
    due_in_days: clampInt(c.due_in_days, 0, 365),
    finding_id: finding.id,
    layer_id: finding.layer_id,
    level: finding.level,
    x: clamp01(finding.x),
    y: clamp01(finding.y),
    checklist,
  }
}
