/**
 * Hallazgos ubicados en el plano (obra_finding_pins + findings) y su análisis.
 * Solo servidor; sin "use server".
 *
 * Flujo (docs/PLAN-OBRA-INTEGRAL.md §4.2):
 * 1. Quien tenga findings.report toca el plano y reporta: se crea el finding
 *    (tenant = dueño del proyecto) y su pin en UNA transacción.
 * 2. El motor determinista (lib/obra/correlation.ts) cruza el pin con los
 *    elementos de su nivel y de los adyacentes y deja sugerencias `create_task`
 *    PENDIENTES (generator = 'reglas'). Nada se aplica sin aprobación humana.
 * 3. "Analizar con IA" (ai.request) reemplaza las pendientes: el LLM redacta
 *    y prioriza sobre las correlaciones, pero la evidencia es siempre la
 *    determinista.
 */
import { sql } from "@/lib/db"
import { getAiSettingsForUser } from "@/lib/mobile-api"
import {
  getProjectAccessForUser,
  ObraAccessError,
  ObraValidationError,
  requireProjectPermissionForUser,
  writeAudit,
} from "../access"
import { classifyFindingText } from "../classify"
import {
  correlateFinding,
  correlationToTaskPayload,
  describeCorrelation,
  severityFromPriority,
  type CorrelationElementInput,
  type CorrelationLayerInput,
} from "../correlation"
import { sanitizeFrame } from "../geometry"
import { can } from "../permissions"
import { parseSuggestionPayload, SuggestionPayloadError } from "../suggestions"
import {
  DISCIPLINES,
  ELEMENT_TYPES,
  FINDING_CATEGORIES,
  SEVERITIES,
  type AiSuggestion,
  type Correlation,
  type CreateTaskPayload,
  type ElementAttributes,
  type ElementGeometry,
  type ElementType,
  type FindingCategory,
  type FindingPin,
  type LayerFrame,
  type ObraTask,
  type Priority,
  type ProjectAccess,
  type Severity,
  type SuggestionEvidence,
  type SuggestionGenerator,
  type SuggestionKind,
  type SuggestionPayload,
} from "../types"
import { ObraAiError, writeTaskSuggestionsWithAi, type AiTaskItem } from "./ai"
import {
  asSql,
  cleanLine,
  hasKey,
  mapPin,
  mapSuggestion,
  mapTask,
  optionalText,
  parseJson,
  pinSelect,
  requireEnum,
  requireLine,
  requireObject,
  suggestionSelect,
  taskOrderBy,
  taskSelect,
  toIso,
  toPositiveInt,
  type PinRow,
  type Queryable,
  type SuggestionRow,
  type TaskRow,
} from "./mappers"
import { decodeImageDataUrl, deleteObraObject, storeFindingPhoto, type DecodedImage } from "./storage"
import { mineCondition } from "./tasks"

export const PIN_LIMITS = {
  titleMin: 3,
  titleMax: 200,
  description: 4000,
  location: 255,
  list: 2000,
  unpinned: 200,
  contextSuggestions: 100,
  contextTasks: 200,
  maxTaskSuggestions: 3,
  reasonMax: 1000,
  levelMin: -10,
  levelMax: 200,
} as const

const NOT_FOUND = "Hallazgo no encontrado."

export type ReportFindingInput = {
  layer_id: number
  x: number
  y: number
  title: string
  description?: string | null
  severity: Severity
  category?: FindingCategory | null
  photo_data_url?: string | null
}

export type PinExistingInput = {
  finding_id: number
  layer_id: number
  x: number
  y: number
  category?: FindingCategory | null
}

export type UnpinnedFinding = { id: number; title: string; severity: Severity; status: string; created_at: string }

export type FindingAnalysis = { correlations: Correlation[]; suggestions: AiSuggestion[] }

export type FindingContext = {
  pin: FindingPin
  correlations: Correlation[]
  suggestions: AiSuggestion[]
  tasks: ObraTask[]
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  const chars = Array.from(s)
  return chars.length <= max ? s : chars.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…"
}

function normCoord(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new ObraValidationError("La ubicación en el plano no es válida (x e y deben estar entre 0 y 1).")
  }
  return v
}

function normLayerId(v: unknown): number {
  const id = toPositiveInt(v)
  if (id == null) throw new ObraValidationError("Selecciona la capa del plano donde ubicar el hallazgo.")
  return id
}

function normCategory(v: unknown): FindingCategory | null {
  if (v === null || v === undefined || v === "") return null
  return requireEnum(v, FINDING_CATEGORIES, "Categoría de hallazgo no válida.")
}

function toValidation(e: unknown): never {
  if (e instanceof SuggestionPayloadError) throw new ObraValidationError(e.message)
  throw e
}

/** Valida un payload create_task con el esquema compartido (errores → ObraValidationError). */
function parseTaskPayload(data: unknown): { kind: "create_task"; data: CreateTaskPayload } {
  try {
    const p = parseSuggestionPayload("create_task", data)
    if (p.kind !== "create_task") throw new ObraValidationError("Tarea sugerida inválida.")
    return p
  } catch (e) {
    toValidation(e)
  }
}

const PRIORITY_RANK: Record<Priority, number> = { baja: 0, media: 1, alta: 2, critica: 3 }

function maxPriority(a: Priority, b: Priority): Priority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "23505"
}

/** Capa no borrada del proyecto, bloqueada en modo compartido (o error de validación). */
async function lockLayerShared(q: Queryable, projectId: number, layerId: number): Promise<{ name: string; level: number }> {
  const s = asSql(q)
  const rows = await s<{ name: string; level: number }[]>`
    SELECT name, level FROM obra_plan_layers
    WHERE id = ${layerId} AND project_id = ${projectId} AND deleted_at IS NULL
    FOR SHARE
  `
  if (!rows[0]) throw new ObraValidationError("La capa indicada no pertenece a esta obra o fue eliminada.")
  return { name: String(rows[0].name), level: Number(rows[0].level) }
}

/** Pin con datos del hallazgo (o null). */
export async function getPin(q: Queryable, projectId: number, findingId: number): Promise<FindingPin | null> {
  const s = asSql(q)
  const rows = await s<PinRow[]>`
    ${pinSelect(s)}
    WHERE p.finding_id = ${findingId} AND p.project_id = ${projectId} AND f.project_id = p.project_id
    LIMIT 1
  `
  return rows[0] ? mapPin(rows[0]) : null
}

/**
 * Resuelve el proyecto de un hallazgo UBICADO desde la BD (su pin) y el
 * acceso del usuario a ESE proyecto. 404 si no existe, no está ubicado o el
 * usuario no tiene acceso.
 */
async function resolvePinAccess(
  userId: number,
  findingId: unknown,
): Promise<{ access: ProjectAccess; findingId: number; reportedBy: number | null }> {
  const id = toPositiveInt(findingId)
  if (id == null) throw new ObraAccessError(404, NOT_FOUND)
  const rows = await sql<{ project_id: number; reported_by: number | null }[]>`
    SELECT p.project_id, p.reported_by
    FROM obra_finding_pins p
    JOIN findings f ON f.id = p.finding_id AND f.project_id = p.project_id
    WHERE p.finding_id = ${id}
  `
  if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
  const access = await getProjectAccessForUser(userId, Number(rows[0].project_id))
  if (!access) throw new ObraAccessError(404, NOT_FOUND)
  const reportedBy = rows[0].reported_by == null ? null : Number(rows[0].reported_by)
  return { access, findingId: id, reportedBy }
}

/** Con findings.view se ven todos los hallazgos; sin él, solo los que reportó el usuario. */
function canSeeFinding(access: ProjectAccess, reportedBy: number | null): boolean {
  return can(access.role, "findings.view") || (reportedBy != null && reportedBy === access.user_id)
}

// ---------------------------------------------------------------------------
// Correlación (motor determinista)
// ---------------------------------------------------------------------------

type LayerFrameRow = {
  id: number
  name: string
  discipline: string
  level: number
  width_m: number
  aspect: number
  offset_x_m: number
  offset_y_m: number
  rotation_deg: number
}

function frameOf(r: Pick<LayerFrameRow, "width_m" | "aspect" | "offset_x_m" | "offset_y_m" | "rotation_deg">): LayerFrame {
  return sanitizeFrame({
    width_m: Number(r.width_m),
    aspect: Number(r.aspect),
    offset_x_m: Number(r.offset_x_m),
    offset_y_m: Number(r.offset_y_m),
    rotation_deg: Number(r.rotation_deg),
  })
}

/**
 * Correlaciones vivas de un pin: capas no borradas de su nivel y de los
 * adyacentes, con sus elementos, y el marco de la capa del pin.
 */
async function computeCorrelations(q: Queryable, projectId: number, pin: FindingPin): Promise<Correlation[]> {
  const s = asSql(q)
  const own = await s<LayerFrameRow[]>`
    SELECT id, name, discipline, level, width_m, aspect, offset_x_m, offset_y_m, rotation_deg
    FROM obra_plan_layers WHERE id = ${pin.layer_id} AND project_id = ${projectId}
  `
  if (!own[0]) return []
  const layerRows = await s<LayerFrameRow[]>`
    SELECT id, name, discipline, level, width_m, aspect, offset_x_m, offset_y_m, rotation_deg
    FROM obra_plan_layers
    WHERE project_id = ${projectId} AND deleted_at IS NULL
      AND level BETWEEN ${pin.level - 1} AND ${pin.level + 1}
  `
  if (layerRows.length === 0) return []
  const layers: CorrelationLayerInput[] = layerRows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    discipline: (DISCIPLINES as readonly string[]).includes(r.discipline) ? (r.discipline as CorrelationLayerInput["discipline"]) : "otro",
    level: Number(r.level),
    frame: frameOf(r),
  }))
  const elementRows = await s<
    { id: number; layer_id: number; element_type: string; label: string | null; geometry: unknown; attributes: unknown }[]
  >`
    SELECT id, layer_id, element_type, label, geometry, attributes
    FROM obra_plan_elements
    WHERE project_id = ${projectId} AND layer_id IN ${s(layers.map((l) => l.id))}
  `
  const elements: CorrelationElementInput[] = []
  for (const r of elementRows) {
    if (!(ELEMENT_TYPES as readonly string[]).includes(r.element_type)) continue
    const attrs = parseJson(r.attributes)
    elements.push({
      id: Number(r.id),
      layer_id: Number(r.layer_id),
      element_type: r.element_type as ElementType,
      label: r.label,
      geometry: parseJson(r.geometry) as ElementGeometry,
      attributes: attrs && typeof attrs === "object" && !Array.isArray(attrs) ? (attrs as ElementAttributes) : {},
    })
  }
  return correlateFinding(
    { level: pin.level, frame: frameOf(own[0]), x: pin.x, y: pin.y, category: pin.category, severity: pin.severity },
    layers,
    elements,
  )
}

// ---------------------------------------------------------------------------
// Análisis → sugerencias pendientes
// ---------------------------------------------------------------------------

type SuggestionDraft = {
  kind: SuggestionKind
  title: string
  rationale: string
  severity: Severity
  confidence: number | null
  payload: SuggestionPayload
  evidence: SuggestionEvidence
}

function clampConfidence(n: number): number | null {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null
}

function taskDraftFromRules(pin: FindingPin, c: Correlation, notes: string[]): SuggestionDraft {
  const payload = parseTaskPayload(correlationToTaskPayload(c, taskFindingRef(pin)))
  return {
    kind: "create_task",
    title: payload.data.title,
    rationale: c.hypothesis,
    severity: severityFromPriority(c.priority),
    confidence: clampConfidence(c.score),
    payload,
    evidence: { correlations: [c], finding_id: pin.finding_id, ...(notes.length > 0 ? { notes } : {}) },
  }
}

function taskDraftFromAi(pin: FindingPin, c: Correlation, item: AiTaskItem, notes: string[]): SuggestionDraft {
  const base = correlationToTaskPayload(c, taskFindingRef(pin))
  // La IA puede subir la prioridad y acortar el plazo, nunca relajar lo que dicta la regla determinista.
  const priority = maxPriority(item.priority, c.priority)
  const role = item.assigned_role && item.assigned_role !== "visita" ? item.assigned_role : c.suggested_role
  const rationale = item.rationale || c.hypothesis
  const payload = parseTaskPayload({
    ...base,
    title: item.title,
    description: truncate(`${rationale}\n\n${base.description}`, 4000),
    priority,
    assigned_role: role,
    due_in_days: Math.min(item.due_in_days, base.due_in_days),
    checklist: item.checklist.length > 0 ? item.checklist : base.checklist,
  })
  return {
    kind: "create_task",
    title: payload.data.title,
    rationale,
    severity: severityFromPriority(priority),
    confidence: clampConfidence(c.score),
    payload,
    evidence: { correlations: [c], finding_id: pin.finding_id, ...(notes.length > 0 ? { notes } : {}) },
  }
}

function taskFindingRef(pin: FindingPin) {
  return {
    id: pin.finding_id,
    title: pin.title,
    layer_id: pin.layer_id,
    level: pin.level,
    x: pin.x,
    y: pin.y,
    category: pin.category,
  }
}

function severityDraft(pin: FindingPin, best: Correlation, notes: string[]): SuggestionDraft {
  let payload: SuggestionPayload
  try {
    payload = parseSuggestionPayload("update_finding_severity", {
      finding_id: pin.finding_id,
      from: pin.severity,
      to: "critical",
      reason: truncate(`${describeCorrelation(best)} ${best.hypothesis}`, PIN_LIMITS.reasonMax),
    })
  } catch (e) {
    toValidation(e)
  }
  return {
    kind: "update_finding_severity",
    title: truncate(`Subir a «Crítica» la severidad del hallazgo «${cleanLine(pin.title)}»`, 255),
    rationale: best.hypothesis,
    severity: "critical",
    confidence: clampConfidence(best.score),
    payload,
    evidence: { correlations: [best], finding_id: pin.finding_id, ...(notes.length > 0 ? { notes } : {}) },
  }
}

/**
 * Análisis interno (NO verifica permisos: el llamador ya autorizó). Reemplaza
 * las sugerencias pendientes del hallazgo y crea hasta 3 `create_task` (más
 * `update_finding_severity` si la mejor correlación es crítica y el hallazgo
 * no lo es). La llamada a la IA ocurre fuera de la transacción.
 */
async function runAnalysis(access: ProjectAccess, findingId: number, useAi: boolean): Promise<FindingAnalysis> {
  const pin = await getPin(sql, access.project_id, findingId)
  if (!pin) throw new ObraAccessError(404, NOT_FOUND)
  const correlations = await computeCorrelations(sql, access.project_id, pin)

  const notes: string[] = []
  let generator: SuggestionGenerator = "reglas"
  let model: string | null = null
  let aiItems: AiTaskItem[] | null = null
  if (useAi && correlations.length > 0) {
    const settings = await getAiSettingsForUser(access.owner_user_id)
    if (!settings.ready) {
      notes.push("La IA no está configurada para esta obra: las sugerencias se generaron con el motor de reglas.")
    } else {
      try {
        const descRows = await sql<{ description: string | null }[]>`
          SELECT description FROM findings WHERE id = ${findingId} AND project_id = ${access.project_id}
        `
        const r = await writeTaskSuggestionsWithAi(
          settings,
          { title: pin.title, description: descRows[0]?.description ?? null, category: pin.category, severity: pin.severity },
          correlations,
        )
        if (r.items.length > 0) {
          aiItems = r.items
          generator = "ia"
          model = r.model
        } else {
          notes.push("La IA no propuso tareas válidas sobre la evidencia: las sugerencias se generaron con el motor de reglas.")
        }
      } catch (e) {
        if (!(e instanceof ObraAiError)) throw e
        notes.push("La IA no respondió: las sugerencias se generaron con el motor de reglas.")
      }
    }
  }

  const drafts: SuggestionDraft[] = []
  if (aiItems) {
    for (const item of aiItems.slice(0, PIN_LIMITS.maxTaskSuggestions)) {
      drafts.push(taskDraftFromAi(pin, correlations[item.correlation_index], item, notes))
    }
  } else {
    for (const c of correlations.slice(0, PIN_LIMITS.maxTaskSuggestions)) drafts.push(taskDraftFromRules(pin, c, notes))
  }
  const best = correlations[0]
  if (best && best.priority === "critica" && pin.severity !== "critical") drafts.push(severityDraft(pin, best, notes))

  const result = (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const locked = await s<{ finding_id: number }[]>`
      SELECT finding_id FROM obra_finding_pins
      WHERE finding_id = ${findingId} AND project_id = ${access.project_id}
      FOR UPDATE
    `
    if (!locked[0]) throw new ObraAccessError(404, NOT_FOUND)
    const superseded = await s<{ id: number }[]>`
      UPDATE obra_ai_suggestions SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ${access.project_id} AND finding_id = ${findingId} AND status = 'pending'
        AND kind IN ('create_task', 'update_finding_severity')
      RETURNING id
    `
    const ids: number[] = []
    for (const d of drafts) {
      const draftGenerator: SuggestionGenerator = d.kind === "create_task" ? generator : "reglas"
      const ins = await s<{ id: number }[]>`
        INSERT INTO obra_ai_suggestions (
          project_id, kind, status, title, rationale, severity, confidence, generator, model,
          payload, evidence, finding_id, layer_id, requested_by
        ) VALUES (
          ${access.project_id}, ${d.kind}, 'pending', ${d.title}, ${d.rationale}, ${d.severity}, ${d.confidence},
          ${draftGenerator}, ${draftGenerator === "ia" ? model : null},
          ${s.json(d.payload as unknown as Parameters<typeof s.json>[0])},
          ${s.json(d.evidence as unknown as Parameters<typeof s.json>[0])},
          ${findingId}, ${pin.layer_id}, ${access.user_id}
        )
        RETURNING id
      `
      ids.push(Number(ins[0].id))
    }
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: access.user_id,
        action: "finding.analyzed",
        entity_type: "finding",
        entity_id: findingId,
        details: {
          use_ai: useAi,
          generator,
          model,
          correlations: correlations.length,
          suggestion_ids: ids,
          superseded: superseded.length,
          ...(notes.length > 0 ? { notes } : {}),
        },
      },
      tx,
    )
    if (ids.length === 0) return { correlations, suggestions: [] }
    const rows = await s<SuggestionRow[]>`${suggestionSelect(s)} WHERE s.id IN ${s(ids)} ORDER BY s.id ASC`
    return { correlations, suggestions: rows.map(mapSuggestion) }
  })) as FindingAnalysis
  return result
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Pines del proyecto en capas no borradas; sin findings.view, solo los que reportó el usuario. */
export async function listPins(userId: number, projectId: number, opts?: { level?: number }): Promise<FindingPin[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "plans.view")
  const o = opts === undefined || opts === null ? {} : requireObject(opts, "Filtro de hallazgos no válido.")
  let level: number | null = null
  if (hasKey(o, "level") && o.level !== null) {
    const v = o.level
    if (typeof v !== "number" || !Number.isInteger(v) || v < PIN_LIMITS.levelMin || v > PIN_LIMITS.levelMax) {
      throw new ObraValidationError("Nivel no válido.")
    }
    level = v
  }
  const onlyOwn = !can(access.role, "findings.view")
  const rows = await sql<PinRow[]>`
    ${pinSelect(sql)}
    JOIN obra_plan_layers l ON l.id = p.layer_id
    WHERE p.project_id = ${access.project_id} AND f.project_id = p.project_id AND l.deleted_at IS NULL
    ${level != null ? sql`AND p.level = ${level}` : sql``}
    ${onlyOwn ? sql`AND p.reported_by = ${userId}` : sql``}
    ORDER BY p.created_at DESC, p.finding_id DESC
    LIMIT ${PIN_LIMITS.list}
  `
  return rows.map(mapPin)
}

/**
 * Reporta un hallazgo en el plano (findings.report): crea el finding (con
 * user_id = dueño del proyecto) y su pin en una transacción, y deja
 * sugerencias por reglas pendientes (no aplica nada).
 */
export async function reportFindingOnPlan(
  userId: number,
  projectId: number,
  input: ReportFindingInput,
): Promise<{ finding_id: number; pin: FindingPin; suggestions: AiSuggestion[] }> {
  const access = await requireProjectPermissionForUser(userId, projectId, "findings.report")
  const o = requireObject(input, "Datos del hallazgo no válidos.")
  const layerId = normLayerId(o.layer_id)
  const x = normCoord(o.x)
  const y = normCoord(o.y)
  const title = requireLine(o.title, "El título", PIN_LIMITS.titleMin, PIN_LIMITS.titleMax)
  const description = optionalText(o.description, "La descripción", PIN_LIMITS.description)
  const severity = requireEnum(o.severity, SEVERITIES, "Severidad no válida.")
  const category = normCategory(o.category) ?? classifyFindingText(`${title} ${description ?? ""}`)
  let photo: DecodedImage | null = null
  if (o.photo_data_url !== undefined && o.photo_data_url !== null && o.photo_data_url !== "") {
    photo = decodeImageDataUrl(o.photo_data_url, "La foto")
  }

  // Validación previa de la capa (barata) para no subir la foto en vano.
  await lockLayerShared(sql, access.project_id, layerId)
  const stored = photo ? await storeFindingPhoto(access.project_id, photo) : null

  let findingId: number
  try {
    findingId = (await sql.begin(async (tx) => {
      const s = asSql(tx)
      const layer = await lockLayerShared(s, access.project_id, layerId)
      const location = truncate(`${cleanLine(layer.name)} · nivel ${layer.level}`, PIN_LIMITS.location)
      const photos = stored ? [stored.ref] : []
      const ins = await s<{ id: number }[]>`
        INSERT INTO findings (user_id, project_id, title, description, severity, status, location, photos)
        VALUES (
          ${access.owner_user_id}, ${access.project_id}, ${title}, ${description}, ${severity}, 'open',
          ${location}, ${s.json(photos)}
        )
        RETURNING id
      `
      const id = Number(ins[0].id)
      await s`
        INSERT INTO obra_finding_pins (finding_id, project_id, layer_id, level, x, y, category, reported_by)
        VALUES (${id}, ${access.project_id}, ${layerId}, ${layer.level}, ${x}, ${y}, ${category}, ${userId})
      `
      await writeAudit(
        {
          project_id: access.project_id,
          actor_user_id: userId,
          action: "finding.reported",
          entity_type: "finding",
          entity_id: id,
          details: { title, severity, category, layer_id: layerId, level: layer.level, x, y, has_photo: Boolean(stored) },
        },
        tx,
      )
      return id
    })) as number
  } catch (e) {
    if (stored?.path) await deleteObraObject(stored.path)
    throw e
  }

  // Las reglas no cuestan ni aplican nada: se ejecutan aunque el rol no tenga ai.request.
  let suggestions: AiSuggestion[] = []
  try {
    suggestions = (await runAnalysis(access, findingId, false)).suggestions
  } catch (e) {
    console.error("[obra] análisis por reglas falló tras reportar el hallazgo", e)
  }
  const pin = await getPin(sql, access.project_id, findingId)
  if (!pin) throw new Error("No se pudo leer el hallazgo recién reportado")
  return { finding_id: findingId, pin, suggestions }
}

/**
 * Ubica en el plano un hallazgo existente del proyecto que aún no tiene pin
 * (findings.report y findings.view: hay que poder ver el hallazgo para
 * ubicarlo). Deja además sugerencias por reglas pendientes.
 */
export async function pinExistingFinding(userId: number, projectId: number, input: PinExistingInput): Promise<FindingPin> {
  const access = await requireProjectPermissionForUser(userId, projectId, "findings.report")
  if (!can(access.role, "findings.view")) {
    throw new ObraAccessError(403, "Tu rol en esta obra no permite ubicar hallazgos existentes.")
  }
  const o = requireObject(input, "Datos del hallazgo no válidos.")
  const findingId = toPositiveInt(o.finding_id)
  if (findingId == null) throw new ObraValidationError("Hallazgo no válido.")
  const layerId = normLayerId(o.layer_id)
  const x = normCoord(o.x)
  const y = normCoord(o.y)
  const explicitCategory = normCategory(o.category)

  try {
    await sql.begin(async (tx) => {
      const s = asSql(tx)
      const f = await s<{ id: number; title: string; description: string | null }[]>`
        SELECT id, title, description FROM findings
        WHERE id = ${findingId} AND project_id = ${access.project_id}
          AND (user_id = ${access.owner_user_id} OR user_id IS NULL)
        FOR UPDATE
      `
      if (!f[0]) throw new ObraValidationError("El hallazgo indicado no pertenece a esta obra.")
      const existing = await s<{ finding_id: number }[]>`SELECT finding_id FROM obra_finding_pins WHERE finding_id = ${findingId}`
      if (existing[0]) throw new ObraValidationError("El hallazgo ya está ubicado en el plano.")
      const layer = await lockLayerShared(s, access.project_id, layerId)
      const category = explicitCategory ?? classifyFindingText(`${f[0].title ?? ""} ${f[0].description ?? ""}`)
      await s`
        INSERT INTO obra_finding_pins (finding_id, project_id, layer_id, level, x, y, category, reported_by)
        VALUES (${findingId}, ${access.project_id}, ${layerId}, ${layer.level}, ${x}, ${y}, ${category}, ${userId})
      `
      await writeAudit(
        {
          project_id: access.project_id,
          actor_user_id: userId,
          action: "finding.pinned",
          entity_type: "finding",
          entity_id: findingId,
          details: { layer_id: layerId, level: layer.level, x, y, category },
        },
        tx,
      )
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw new ObraValidationError("El hallazgo ya está ubicado en el plano.")
    throw e
  }

  try {
    await runAnalysis(access, findingId, false)
  } catch (e) {
    console.error("[obra] análisis por reglas falló tras ubicar el hallazgo", e)
  }
  const pin = await getPin(sql, access.project_id, findingId)
  if (!pin) throw new Error("No se pudo leer el pin recién creado")
  return pin
}

/** Hallazgos del proyecto sin ubicar en el plano (findings.view), más recientes primero. */
export async function listUnpinnedFindings(userId: number, projectId: number): Promise<UnpinnedFinding[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "findings.view")
  const rows = await sql<{ id: number; title: string; severity: string; status: string | null; created_at: Date | string }[]>`
    SELECT f.id, f.title, f.severity, f.status, f.created_at
    FROM findings f
    WHERE f.project_id = ${access.project_id}
      AND (f.user_id = ${access.owner_user_id} OR f.user_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM obra_finding_pins p WHERE p.finding_id = f.id)
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ${PIN_LIMITS.unpinned}
  `
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ""),
    severity: (SEVERITIES as readonly string[]).includes(r.severity) ? (r.severity as Severity) : "medium",
    status: String(r.status ?? "open"),
    created_at: toIso(r.created_at),
  }))
}

/**
 * Analiza un hallazgo ubicado. Con use_ai exige ai.request; sin IA basta con
 * poder ver el hallazgo (findings.view o haberlo reportado). Si la IA falla o
 * no está configurada, cae a las reglas y lo indica en evidence.notes.
 */
export async function analyzeFinding(
  userId: number,
  findingId: number,
  opts?: { use_ai?: boolean },
): Promise<FindingAnalysis & { project_id: number }> {
  const { access, findingId: id, reportedBy } = await resolvePinAccess(userId, findingId)
  const o = opts === undefined || opts === null ? {} : requireObject(opts, "Opciones de análisis no válidas.")
  if (o.use_ai !== undefined && typeof o.use_ai !== "boolean") throw new ObraValidationError("Opción de IA no válida.")
  const useAi = o.use_ai === true
  if (!canSeeFinding(access, reportedBy)) throw new ObraAccessError(404, NOT_FOUND)
  if (useAi && !can(access.role, "ai.request")) {
    throw new ObraAccessError(403, "Tu rol en esta obra no permite pedir análisis con IA.")
  }
  const result = await runAnalysis(access, id, useAi)
  return { ...result, project_id: access.project_id }
}

/** Contexto de un hallazgo ubicado: pin, correlaciones en vivo, sugerencias y tareas vinculadas. */
export async function getFindingContext(userId: number, findingId: number): Promise<FindingContext> {
  const { access, findingId: id, reportedBy } = await resolvePinAccess(userId, findingId)
  if (!canSeeFinding(access, reportedBy)) throw new ObraAccessError(404, NOT_FOUND)
  const pin = await getPin(sql, access.project_id, id)
  if (!pin) throw new ObraAccessError(404, NOT_FOUND)
  const onlyOwnTasks = !can(access.role, "tasks.view_all")
  const [correlations, suggestionRows, taskRows] = await Promise.all([
    computeCorrelations(sql, access.project_id, pin),
    sql<SuggestionRow[]>`
      ${suggestionSelect(sql)}
      WHERE s.project_id = ${access.project_id} AND s.finding_id = ${id}
      ORDER BY s.created_at DESC, s.id ASC
      LIMIT ${PIN_LIMITS.contextSuggestions}
    `,
    sql<TaskRow[]>`
      ${taskSelect(sql)}
      WHERE t.project_id = ${access.project_id} AND t.finding_id = ${id}
      ${onlyOwnTasks ? sql`AND ${mineCondition(sql, access)}` : sql``}
      ${taskOrderBy(sql)}
      LIMIT ${PIN_LIMITS.contextTasks}
    `,
  ])
  return {
    pin,
    correlations,
    suggestions: suggestionRows.map(mapSuggestion),
    tasks: taskRows.map(mapTask),
  }
}
