/**
 * Elementos de plano (obra_plan_elements): tuberías, ductos, muros... en
 * coordenadas normalizadas de su capa. Solo servidor; sin "use server".
 *
 * - Manual y DXF: los confirma un humano en la UI y se insertan directo
 *   (plans.manage), en lote y dentro de una transacción.
 * - IA de visión: requestLayerExtraction NUNCA inserta elementos; crea una
 *   sugerencia `plan_elements` pendiente que un revisor aprueba (ver
 *   lib/obra/server/suggestions.ts).
 */
import { sql } from "@/lib/db"
import { getAiSettingsForUser } from "@/lib/mobile-api"
import { getProjectAccessForUser, ObraAccessError, ObraValidationError, requireProjectPermissionForUser, writeAudit } from "../access"
import { isValidGeometry, MAX_GEOMETRY_POINTS, normalizeGeometry } from "../geometry"
import { can, type Permission } from "../permissions"
import { parseSuggestionPayload, SuggestionPayloadError } from "../suggestions"
import {
  DISCIPLINE_LABELS,
  DISCIPLINES,
  ELEMENT_SOURCES,
  ELEMENT_TYPES,
  type Discipline,
  type ElementAttributes,
  type ElementGeometry,
  type ElementSource,
  type ElementType,
  type PlanElement,
  type PlanElementDraft,
  type ProjectAccess,
} from "../types"
import { extractElementsFromImage, ObraAiError } from "./ai"
import { authorizeLayer, LAYER_LIMITS } from "./layers"
import {
  asSql,
  cleanLine,
  cleanText,
  elementSelect,
  hasKey,
  mapElement,
  requireEnum,
  requireObject,
  textLength,
  toPositiveInt,
  type ElementRow,
  type Queryable,
} from "./mappers"
import { readStoredImage } from "./storage"

export const ELEMENT_LIMITS = {
  perCall: 5000,
  labelMax: 255,
  /** Suma de vértices de todos los elementos de una llamada. */
  totalPoints: 250_000,
  list: 20_000,
  attributeKeys: 30,
  attributeKeyMax: 60,
  attributeText: 500,
  insertChunk: 1000,
} as const

const NOT_FOUND = "Elemento no encontrado."

export const AI_NOT_CONFIGURED =
  "La IA no está configurada para esta obra: el gerente debe configurar la API key en Configuración."

export type NormalizedElementDraft = {
  element_type: ElementType
  label: string | null
  geometry: ElementGeometry
  attributes: ElementAttributes
  confidence: number | null
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"])
const NUMERIC_ATTRIBUTES: Record<string, { min: number; max: number }> = {
  diameter_mm: { min: 0, max: 100_000 },
  depth_m: { min: 0, max: 1_000 },
  voltage_v: { min: 0, max: 1_000_000 },
}

/**
 * Atributos técnicos: objeto plano con valores primitivos. Las claves se
 * limpian y acotan; los números técnicos fuera de rango y los valores no
 * primitivos se descartan.
 */
export function sanitizeElementAttributes(v: unknown, label = "Los atributos del elemento"): ElementAttributes {
  if (v === null || v === undefined) return {}
  if (typeof v !== "object" || Array.isArray(v)) throw new ObraValidationError(`${label} no son válidos.`)
  const out: ElementAttributes = {}
  let count = 0
  for (const [rawKey, value] of Object.entries(v as Record<string, unknown>)) {
    if (count >= ELEMENT_LIMITS.attributeKeys) break
    const key = Array.from(cleanLine(rawKey)).slice(0, ELEMENT_LIMITS.attributeKeyMax).join("")
    if (!key || RESERVED_KEYS.has(key)) continue
    const numeric = NUMERIC_ATTRIBUTES[key]
    if (numeric) {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN
      if (Number.isFinite(n) && n > numeric.min && n <= numeric.max) {
        out[key] = n
        count++
      }
      continue
    }
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value
    else if (typeof value === "boolean") out[key] = value
    else if (typeof value === "string") {
      const s = Array.from(cleanText(value)).slice(0, ELEMENT_LIMITS.attributeText).join("")
      if (!s) continue
      out[key] = s
    } else continue
    count++
  }
  return out
}

function normLabel(v: unknown, prefix: string): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== "string") throw new ObraValidationError(`${prefix}la etiqueta no es válida.`)
  const s = cleanLine(v)
  if (!s) return null
  if (textLength(s) > ELEMENT_LIMITS.labelMax) {
    throw new ObraValidationError(`${prefix}la etiqueta admite como máximo ${ELEMENT_LIMITS.labelMax} caracteres.`)
  }
  return s
}

function normGeometry(v: unknown, prefix: string): ElementGeometry {
  if (!isValidGeometry(v)) {
    throw new ObraValidationError(
      `${prefix}la geometría no es válida (punto = 1 vértice, polilínea ≥ 2, polígono ≥ 3, máximo ${MAX_GEOMETRY_POINTS} puntos, coordenadas entre 0 y 1).`,
    )
  }
  return normalizeGeometry(v)
}

function normConfidence(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null
  return Math.min(1, Math.max(0, v))
}

/**
 * Valida un borrador de elemento (tipo de catálogo, geometría, etiqueta y
 * atributos). `index` (base 0) se usa para el mensaje de error.
 */
export function normalizeElementDraft(v: unknown, index?: number): NormalizedElementDraft {
  const prefix = index === undefined ? "Elemento: " : `Elemento n.º ${index + 1}: `
  const o = requireObject(v, `${prefix}los datos no son válidos.`)
  return {
    element_type: requireEnum(o.element_type, ELEMENT_TYPES, `${prefix}el tipo de elemento no es válido.`),
    label: normLabel(o.label, prefix),
    geometry: normGeometry(o.geometry, prefix),
    attributes: sanitizeElementAttributes(o.attributes, `${prefix}los atributos`),
    confidence: normConfidence(o.confidence),
  }
}

/** Valida una lista de borradores (1..perCall y tope de vértices totales). */
export function normalizeElementDrafts(drafts: unknown): NormalizedElementDraft[] {
  if (!Array.isArray(drafts) || drafts.length === 0) throw new ObraValidationError("Indica al menos un elemento.")
  if (drafts.length > ELEMENT_LIMITS.perCall) {
    throw new ObraValidationError(`Se pueden cargar como máximo ${ELEMENT_LIMITS.perCall} elementos por vez.`)
  }
  const out = drafts.map((d, i) => normalizeElementDraft(d, i))
  const points = out.reduce((n, d) => n + d.geometry.points.length, 0)
  if (points > ELEMENT_LIMITS.totalPoints) {
    throw new ObraValidationError(
      `Los elementos suman demasiados vértices (máximo ${ELEMENT_LIMITS.totalPoints} por carga). Divide la importación.`,
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// Inserción en lote (compartida con la aprobación de sugerencias plan_elements)
// ---------------------------------------------------------------------------

/**
 * Inserta elementos ya validados en una capa, dentro de una transacción
 * abierta. NO verifica permisos ni la capa: el llamador ya lo hizo.
 */
export async function insertElementsInTx(
  tx: Queryable,
  projectId: number,
  layerId: number,
  drafts: NormalizedElementDraft[],
  meta: { source: ElementSource; created_by: number; suggestion_id?: number | null },
): Promise<number> {
  const s = asSql(tx)
  const source = requireEnum(meta.source, ELEMENT_SOURCES, "Origen de elementos no válido.")
  let inserted = 0
  for (let i = 0; i < drafts.length; i += ELEMENT_LIMITS.insertChunk) {
    const chunk = drafts.slice(i, i + ELEMENT_LIMITS.insertChunk).map((d) => ({
      layer_id: layerId,
      project_id: projectId,
      element_type: d.element_type,
      label: d.label,
      geometry: s.json(d.geometry as unknown as Parameters<typeof s.json>[0]),
      attributes: s.json(d.attributes as Parameters<typeof s.json>[0]),
      source,
      confidence: source === "ia" ? d.confidence : null,
      suggestion_id: meta.suggestion_id ?? null,
      created_by: meta.created_by,
    }))
    const res = await s<{ id: number }[]>`
      INSERT INTO obra_plan_elements ${s(
        chunk,
        "layer_id",
        "project_id",
        "element_type",
        "label",
        "geometry",
        "attributes",
        "source",
        "confidence",
        "suggestion_id",
        "created_by",
      )}
      RETURNING id
    `
    inserted += res.length
  }
  return inserted
}

/** Bloquea una capa no borrada del proyecto (para escribir en ella) o lanza ObraValidationError. */
export async function lockLayerForWrite(
  tx: Queryable,
  projectId: number,
  layerId: number,
): Promise<{ id: number; name: string; discipline: Discipline; level: number }> {
  const s = asSql(tx)
  const rows = await s<{ id: number; name: string; discipline: string; level: number }[]>`
    SELECT id, name, discipline, level FROM obra_plan_layers
    WHERE id = ${layerId} AND project_id = ${projectId} AND deleted_at IS NULL
    FOR UPDATE
  `
  const r = rows[0]
  if (!r) throw new ObraValidationError("La capa indicada no pertenece a esta obra o fue eliminada.")
  return {
    id: Number(r.id),
    name: String(r.name),
    discipline: requireEnum(r.discipline, DISCIPLINES, "Especialidad no válida."),
    level: Number(r.level),
  }
}

// ---------------------------------------------------------------------------
// Acceso por elemento
// ---------------------------------------------------------------------------

async function authorizeElement(
  userId: number,
  elementId: unknown,
  permission: Permission,
): Promise<{ access: ProjectAccess; elementId: number }> {
  const id = toPositiveInt(elementId)
  if (id == null) throw new ObraAccessError(404, NOT_FOUND)
  const rows = await sql<{ project_id: number }[]>`
    SELECT e.project_id
    FROM obra_plan_elements e
    JOIN obra_plan_layers l ON l.id = e.layer_id AND l.project_id = e.project_id
    WHERE e.id = ${id} AND l.deleted_at IS NULL
  `
  if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
  const access = await getProjectAccessForUser(userId, Number(rows[0].project_id))
  if (!access) throw new ObraAccessError(404, NOT_FOUND)
  if (!can(access.role, permission)) throw new ObraAccessError(403, "Tu rol en esta obra no permite esta acción.")
  return { access, elementId: id }
}

async function getElementById(q: Queryable, projectId: number, elementId: number): Promise<PlanElement | null> {
  const s = asSql(q)
  const rows = await s<ElementRow[]>`${elementSelect(s)} WHERE e.id = ${elementId} AND e.project_id = ${projectId}`
  return rows[0] ? mapElement(rows[0]) : null
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Elementos de capas no borradas del proyecto (plans.view), opcionalmente por nivel o capa. */
export async function listElements(
  userId: number,
  projectId: number,
  opts?: { level?: number; layer_id?: number },
): Promise<PlanElement[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "plans.view")
  const o = opts === undefined || opts === null ? {} : requireObject(opts, "Filtro de elementos no válido.")
  let level: number | null = null
  if (hasKey(o, "level") && o.level !== null) {
    const v = o.level
    if (typeof v !== "number" || !Number.isInteger(v) || v < LAYER_LIMITS.levelMin || v > LAYER_LIMITS.levelMax) {
      throw new ObraValidationError("Nivel no válido.")
    }
    level = v
  }
  let layerId: number | null = null
  if (hasKey(o, "layer_id") && o.layer_id !== null) {
    layerId = toPositiveInt(o.layer_id)
    if (layerId == null) throw new ObraValidationError("Capa no válida.")
  }
  const rows = await sql<ElementRow[]>`
    ${elementSelect(sql)}
    JOIN obra_plan_layers l ON l.id = e.layer_id
    WHERE e.project_id = ${access.project_id} AND l.project_id = ${access.project_id} AND l.deleted_at IS NULL
    ${level != null ? sql`AND l.level = ${level}` : sql``}
    ${layerId != null ? sql`AND e.layer_id = ${layerId}` : sql``}
    ORDER BY e.layer_id ASC, e.id ASC
    LIMIT ${ELEMENT_LIMITS.list}
  `
  return rows.map(mapElement)
}

/**
 * Inserta elementos confirmados por un humano (dibujo manual o importación
 * DXF) en una capa (plans.manage). Todo o nada, en una transacción.
 */
export async function createElements(
  userId: number,
  layerId: number,
  drafts: PlanElementDraft[],
  source: "manual" | "dxf",
): Promise<{ inserted: number; project_id: number }> {
  const { access, layerId: id } = await authorizeLayer(userId, layerId, "plans.manage")
  if (source !== "manual" && source !== "dxf") throw new ObraValidationError("Origen de elementos no válido.")
  const rows = normalizeElementDrafts(drafts)
  const inserted = (await sql.begin(async (tx) => {
    await lockLayerForWrite(tx, access.project_id, id)
    const n = await insertElementsInTx(tx, access.project_id, id, rows, { source, created_by: userId })
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "elements.created",
        entity_type: "layer",
        entity_id: id,
        details: { count: n, source },
      },
      tx,
    )
    return n
  })) as number
  return { inserted, project_id: access.project_id }
}

export type UpdateElementPatch = {
  element_type?: ElementType
  label?: string | null
  attributes?: ElementAttributes
  geometry?: ElementGeometry
}

/** Edita un elemento (plans.manage). Los atributos se reemplazan completos. */
export async function updateElement(userId: number, elementId: number, patch: UpdateElementPatch): Promise<PlanElement> {
  const { access, elementId: id } = await authorizeElement(userId, elementId, "plans.manage")
  const o = requireObject(patch, "Datos del elemento no válidos.")
  const p: Partial<NormalizedElementDraft> = {}
  if (hasKey(o, "element_type")) p.element_type = requireEnum(o.element_type, ELEMENT_TYPES, "Tipo de elemento no válido.")
  if (hasKey(o, "label")) p.label = normLabel(o.label, "Elemento: ")
  if (hasKey(o, "attributes")) p.attributes = sanitizeElementAttributes(o.attributes)
  if (hasKey(o, "geometry")) p.geometry = normGeometry(o.geometry, "Elemento: ")

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const rows = await s<ElementRow[]>`
      ${elementSelect(s)}
      JOIN obra_plan_layers l ON l.id = e.layer_id
      WHERE e.id = ${id} AND e.project_id = ${access.project_id} AND l.deleted_at IS NULL
      FOR UPDATE OF e
    `
    if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
    const cur = mapElement(rows[0])
    const next = {
      element_type: p.element_type ?? cur.element_type,
      label: p.label !== undefined ? p.label : cur.label,
      attributes: p.attributes ?? cur.attributes,
      geometry: p.geometry ?? cur.geometry,
    }
    const changes = (["element_type", "label", "attributes", "geometry"] as const).filter(
      (k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(cur[k] ?? null),
    )
    if (changes.length === 0) return cur
    await s`
      UPDATE obra_plan_elements SET
        element_type = ${next.element_type},
        label = ${next.label},
        attributes = ${s.json(next.attributes as Parameters<typeof s.json>[0])},
        geometry = ${s.json(next.geometry as unknown as Parameters<typeof s.json>[0])}
      WHERE id = ${id}
    `
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "element.updated",
        entity_type: "element",
        entity_id: id,
        details: { changes, layer_id: cur.layer_id },
      },
      tx,
    )
    const out = await getElementById(s, access.project_id, id)
    if (!out) throw new ObraAccessError(404, NOT_FOUND)
    return out
  })) as PlanElement
}

/** Elimina un elemento (plans.manage). Devuelve el proyecto para revalidar. */
export async function deleteElement(userId: number, elementId: number): Promise<{ project_id: number }> {
  const { access, elementId: id } = await authorizeElement(userId, elementId, "plans.manage")
  await sql.begin(async (tx) => {
    const s = asSql(tx)
    const rows = await s<{ layer_id: number; element_type: string; label: string | null; source: string }[]>`
      DELETE FROM obra_plan_elements
      WHERE id = ${id} AND project_id = ${access.project_id}
      RETURNING layer_id, element_type, label, source
    `
    if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "element.deleted",
        entity_type: "element",
        entity_id: id,
        details: {
          layer_id: Number(rows[0].layer_id),
          element_type: rows[0].element_type,
          label: rows[0].label,
          source: rows[0].source,
        },
      },
      tx,
    )
  })
  return { project_id: access.project_id }
}

/**
 * Pide a la IA de visión los elementos de la lámina de una capa (ai.request).
 * Usa la configuración de IA del DUEÑO del proyecto. NUNCA inserta elementos:
 * crea una sugerencia `plan_elements` pendiente (y reemplaza las pendientes
 * anteriores de la misma capa).
 */
export async function requestLayerExtraction(
  userId: number,
  layerId: number,
): Promise<{ suggestion_id: number; element_count: number; project_id: number }> {
  const { access, layerId: id } = await authorizeLayer(userId, layerId, "ai.request")
  const rows = await sql<{ name: string; discipline: string; image_path: string | null; image_data: string | null }[]>`
    SELECT name, discipline, image_path, image_data FROM obra_plan_layers
    WHERE id = ${id} AND project_id = ${access.project_id} AND deleted_at IS NULL
  `
  const layer = rows[0]
  if (!layer) throw new ObraAccessError(404, "Capa no encontrada.")
  if (!layer.image_path && !layer.image_data) {
    throw new ObraValidationError("La capa no tiene imagen: sube la lámina antes de pedir la detección con IA.")
  }
  const discipline = requireEnum(layer.discipline, DISCIPLINES, "Especialidad no válida.")
  const settings = await getAiSettingsForUser(access.owner_user_id)
  if (!settings.ready) throw new ObraValidationError(AI_NOT_CONFIGURED)

  const image = await readStoredImage({ image_path: layer.image_path, image_data: layer.image_data })
  let extracted: { elements: PlanElementDraft[]; model: string }
  try {
    extracted = await extractElementsFromImage(settings, image, { discipline, layerName: layer.name })
  } catch (e) {
    if (e instanceof ObraAiError) throw new ObraValidationError(e.message)
    throw e
  }
  if (extracted.elements.length === 0) {
    throw new ObraValidationError("La IA no detectó elementos de esta especialidad en la lámina.")
  }
  let payload
  try {
    payload = parseSuggestionPayload("plan_elements", { layer_id: id, elements: extracted.elements })
  } catch (e) {
    if (e instanceof SuggestionPayloadError) throw new ObraValidationError(e.message)
    throw e
  }
  const elements = payload.data.elements
  const confidences = elements.map((e) => e.confidence).filter((c): c is number => typeof c === "number")
  const confidence =
    confidences.length > 0 ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000 : null
  const name = cleanLine(layer.name)
  const title = Array.from(`Incorporar ${elements.length} elementos detectados en «${name}»`).slice(0, 255).join("")
  const rationale =
    `La IA detectó ${elements.length} elementos de ${DISCIPLINE_LABELS[discipline]} en la lámina de la capa «${name}». ` +
    "Revisa la superposición, desmarca los que no correspondan y aprueba para incorporarlos al plano."
  const evidence = {
    layer_id: id,
    notes: [
      `Propuesta generada por ${extracted.model} a partir de la imagen de la capa.`,
      "Las coordenadas son aproximadas: verifica la alineación con la lámina antes de aprobar.",
    ],
  }

  const suggestionId = (await sql.begin(async (tx) => {
    const s = asSql(tx)
    await lockLayerForWrite(s, access.project_id, id)
    const superseded = await s<{ id: number }[]>`
      UPDATE obra_ai_suggestions SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ${access.project_id} AND layer_id = ${id} AND kind = 'plan_elements' AND status = 'pending'
      RETURNING id
    `
    const ins = await s<{ id: number }[]>`
      INSERT INTO obra_ai_suggestions (
        project_id, kind, status, title, rationale, severity, confidence, generator, model,
        payload, evidence, layer_id, requested_by
      ) VALUES (
        ${access.project_id}, 'plan_elements', 'pending', ${title}, ${rationale}, 'low', ${confidence}, 'ia',
        ${extracted.model}, ${s.json(payload as unknown as Parameters<typeof s.json>[0])},
        ${s.json(evidence)}, ${id}, ${userId}
      )
      RETURNING id
    `
    const sid = Number(ins[0].id)
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "layer.extraction_requested",
        entity_type: "layer",
        entity_id: id,
        details: { suggestion_id: sid, element_count: elements.length, model: extracted.model, superseded: superseded.length },
      },
      tx,
    )
    return sid
  })) as number

  return { suggestion_id: suggestionId, element_count: elements.length, project_id: access.project_id }
}
