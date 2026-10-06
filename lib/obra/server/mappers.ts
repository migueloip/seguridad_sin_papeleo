/**
 * Conversión fila de BD → DTO (lib/obra/types.ts) del módulo Obra Integral.
 *
 * Funciones puras: no consultan la BD. Además exporta los SELECT base
 * (fragmentos de postgres v3) que entregan exactamente las columnas que espera
 * cada mapper, para que todos los módulos de lib/obra/server los reutilicen:
 *
 *   const rows = await q<TaskRow[]>`${taskSelect(q)} WHERE t.id = ${id}`
 *   return rows.map(mapTask)
 *
 * Normalizaciones:
 * - postgres devuelve bigint/COUNT(*) como string → se convierten a number.
 * - Timestamps (Date) → string ISO.
 * - Columnas DATE → "YYYY-MM-DD". Los SELECT base usan to_char(...) en SQL; si
 *   llega un Date (postgres.js interpreta las DATE como medianoche UTC) se
 *   formatea con componentes UTC para no correr el día por zona horaria.
 * - Catálogos desconocidos caen a un valor por defecto seguro.
 * - JSONB que llegue como string se parsea.
 *
 * También reúne validadores de entrada compartidos (requireLine,
 * optionalText, requireDateISO...) que lanzan ObraValidationError.
 */
import type { Sql, TransactionSql } from "postgres"
import { ObraValidationError } from "../access"
import { sanitizeFrame } from "../geometry"
import {
  DISCIPLINES,
  ELEMENT_SOURCES,
  ELEMENT_TYPES,
  FINDING_CATEGORIES,
  INSPECTION_STATUSES,
  OBRA_ROLES,
  PRIORITIES,
  SEVERITIES,
  SUGGESTION_GENERATORS,
  SUGGESTION_KINDS,
  SUGGESTION_STATUSES,
  TASK_ORIGINS,
  TASK_STATUSES,
  type AiSuggestion,
  type AuditEntry,
  type ElementAttributes,
  type ElementGeometry,
  type FindingPin,
  type ObraInspection,
  type ObraMember,
  type ObraRole,
  type ObraTask,
  type PlanElement,
  type PlanLayer,
  type SuggestionEvidence,
  type SuggestionPayload,
} from "../types"

// ---------------------------------------------------------------------------
// Conexión: el tipo TransactionSql de postgres v3 pierde la firma de tagged
// template (usa Omit<Sql>), así que se trabaja siempre con el tipo Sql.
// ---------------------------------------------------------------------------

/** Cliente global o transacción (sql.begin). */
export type Queryable = Sql | TransactionSql

/** Trata una transacción como Sql para poder usarla como tagged template. */
export function asSql(q: Queryable): Sql {
  return q as unknown as Sql
}

// ---------------------------------------------------------------------------
// Conversión de valores primitivos
// ---------------------------------------------------------------------------

/** Número finito o 0 (bigint/COUNT llegan como string). */
export function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v === "bigint") return Number(v)
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** Número finito o null. */
export function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "bigint") return Number(v)
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v
  if (v === null || v === undefined) return fallback
  return String(v)
}

function toStrOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return typeof v === "string" ? v : String(v)
}

/** Timestamp → ISO. Acepta Date o string. */
export function toIso(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString()
  if (typeof v === "string") {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? v : d.toISOString()
  }
  return ""
}

export function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = toIso(v)
  return s || null
}

/** Columna DATE → "YYYY-MM-DD" (sin desfase por zona horaria). */
export function toDateOnly(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    const y = v.getUTCFullYear()
    const m = String(v.getUTCMonth() + 1).padStart(2, "0")
    const d = String(v.getUTCDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  if (typeof v === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(v)
    return m ? m[1] : null
  }
  return null
}

/** JSONB que puede llegar como string (según configuración del driver). */
export function parseJson(v: unknown): unknown {
  if (typeof v !== "string") return v
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback
}

function oneOfOrNull<T extends string>(v: unknown, list: readonly T[]): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null
}

function asRecord(v: unknown): Record<string, unknown> {
  const p = parseJson(v)
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {}
}

/** Checklist JSONB → [{ text, done }] (acepta también strings sueltos). */
export function parseChecklist(v: unknown): Array<{ text: string; done: boolean }> {
  const p = parseJson(v)
  if (!Array.isArray(p)) return []
  const out: Array<{ text: string; done: boolean }> = []
  for (const it of p) {
    if (typeof it === "string") {
      out.push({ text: it, done: false })
    } else if (it && typeof it === "object") {
      const o = it as { text?: unknown; done?: unknown }
      out.push({ text: toStr(o.text), done: o.done === true })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Normalización y validación de entrada del cliente (lanzan ObraValidationError
// con un mensaje mostrable en español).
// ---------------------------------------------------------------------------

const MAX_INT4 = 2_147_483_647

function isControlChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return c < 0x20 || (c >= 0x7f && c <= 0x9f)
}

/** Largo en puntos de código (como VARCHAR en Postgres). */
export function textLength(s: string): number {
  return Array.from(s).length
}

/** Una línea: sin caracteres de control y con espacios colapsados. */
export function cleanLine(v: unknown): string {
  if (typeof v !== "string") return ""
  let out = ""
  for (const ch of v) out += isControlChar(ch) ? " " : ch
  return out.replace(/\s+/g, " ").trim()
}

/** Texto multilínea: conserva saltos de línea y tabulaciones, quita otros controles. */
export function cleanText(v: unknown): string {
  if (typeof v !== "string") return ""
  let out = ""
  for (const ch of v.replace(/\r\n?/g, "\n")) {
    if (ch === "\n" || ch === "\t" || !isControlChar(ch)) out += ch
  }
  return out.replace(/\n{3,}/g, "\n\n").trim()
}

/** Entero positivo que cabe en INTEGER, o null. */
export function toPositiveInt(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_INT4 ? n : null
}

/** Texto obligatorio de una línea con largo [min, max]. */
export function requireLine(v: unknown, label: string, min: number, max: number): string {
  const s = cleanLine(v)
  const len = textLength(s)
  if (len < min || len > max) {
    throw new ObraValidationError(`${label} debe tener entre ${min} y ${max} caracteres.`)
  }
  return s
}

/** Texto opcional (multilínea) de hasta `max` caracteres; vacío → null. */
export function optionalText(v: unknown, label: string, max: number): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== "string") throw new ObraValidationError(`${label} no es válido.`)
  const s = cleanText(v)
  if (!s) return null
  if (textLength(s) > max) throw new ObraValidationError(`${label} admite como máximo ${max} caracteres.`)
  return s
}

/** Valida una fecha real "YYYY-MM-DD" (años 2000–2100). */
export function isDateISO(v: unknown): v is string {
  if (typeof v !== "string") return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export function requireDateISO(v: unknown, label: string): string {
  const s = typeof v === "string" ? v.trim() : v
  if (!isDateISO(s)) throw new ObraValidationError(`${label} debe ser una fecha válida con formato AAAA-MM-DD.`)
  return s
}

export function optionalDateISO(v: unknown, label: string): string | null {
  if (v === null || v === undefined || v === "") return null
  return requireDateISO(v, label)
}

/** Id de referencia opcional (null/undefined → null). */
export function optionalRefId(v: unknown, label: string): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = toPositiveInt(v)
  if (n == null) throw new ObraValidationError(`${label} no es válido.`)
  return n
}

/** Valor obligatorio de un catálogo. */
export function requireEnum<T extends string>(v: unknown, list: readonly T[], message: string): T {
  if (typeof v === "string" && (list as readonly string[]).includes(v)) return v as T
  throw new ObraValidationError(message)
}

/** Objeto plano de entrada (o error). */
export function requireObject(v: unknown, message: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ObraValidationError(message)
  return v as Record<string, unknown>
}

/** ¿El objeto trae la clave (aunque sea null)? Para parches parciales. */
export function hasKey(o: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key) && o[key] !== undefined
}

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

export const OPEN_TASK_STATUSES = ["pendiente", "en_progreso"] as const

/**
 * Columnas esperadas por mapTask: todas las de obra_tasks (due_date como
 * "YYYY-MM-DD" o Date) más assigned_user_name y created_by_name.
 */
export type TaskRow = {
  id: number | string
  project_id: number | string
  title: string
  description: string | null
  priority: string
  status: string
  origin: string
  suggestion_id: number | string | null
  finding_id: number | string | null
  layer_id: number | string | null
  level: number | string | null
  x: number | string | null
  y: number | string | null
  checklist: unknown
  assigned_role: string | null
  assigned_user_id: number | string | null
  assigned_user_name: string | null
  inspection_id: number | string | null
  due_date: string | Date | null
  created_by: number | string | null
  created_by_name: string | null
  completed_by: number | string | null
  completed_at: Date | string | null
  completion_notes: string | null
  created_at: Date | string
  updated_at: Date | string
}

export function mapTask(r: TaskRow): ObraTask {
  return {
    id: toNum(r.id),
    project_id: toNum(r.project_id),
    title: toStr(r.title),
    description: toStrOrNull(r.description),
    priority: oneOf(r.priority, PRIORITIES, "media"),
    status: oneOf(r.status, TASK_STATUSES, "pendiente"),
    origin: oneOf(r.origin, TASK_ORIGINS, "manual"),
    suggestion_id: toNumOrNull(r.suggestion_id),
    finding_id: toNumOrNull(r.finding_id),
    layer_id: toNumOrNull(r.layer_id),
    level: toNumOrNull(r.level),
    x: toNumOrNull(r.x),
    y: toNumOrNull(r.y),
    checklist: parseChecklist(r.checklist),
    assigned_role: oneOfOrNull(r.assigned_role, OBRA_ROLES),
    assigned_user_id: toNumOrNull(r.assigned_user_id),
    assigned_user_name: toStrOrNull(r.assigned_user_name),
    inspection_id: toNumOrNull(r.inspection_id),
    due_date: toDateOnly(r.due_date),
    created_by: toNumOrNull(r.created_by),
    created_by_name: toStrOrNull(r.created_by_name),
    completed_by: toNumOrNull(r.completed_by),
    completed_at: toIsoOrNull(r.completed_at),
    completion_notes: toStrOrNull(r.completion_notes),
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  }
}

/** SELECT base de tareas (alias t) con nombres de asignado y creador. Completar con WHERE/ORDER BY. */
export function taskSelect(q: Queryable) {
  const s = asSql(q)
  return s`
    SELECT
      t.id, t.project_id, t.title, t.description, t.priority, t.status, t.origin, t.suggestion_id,
      t.finding_id, t.layer_id, t.level, t.x, t.y, t.checklist, t.assigned_role, t.assigned_user_id,
      COALESCE(NULLIF(au.name, ''), au.email) AS assigned_user_name,
      t.inspection_id,
      to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
      t.created_by,
      COALESCE(NULLIF(cu.name, ''), cu.email) AS created_by_name,
      t.completed_by, t.completed_at, t.completion_notes, t.created_at, t.updated_at
    FROM obra_tasks t
    LEFT JOIN users au ON au.id = t.assigned_user_id
    LEFT JOIN users cu ON cu.id = t.created_by
  `
}

/**
 * ORDER BY estándar de tareas: abiertas primero, prioridad (crítica > alta >
 * media > baja), vencimiento ascendente (sin fecha al final) y más nuevas primero.
 */
export function taskOrderBy(q: Queryable) {
  const s = asSql(q)
  return s`
    ORDER BY
      CASE WHEN t.status IN ('pendiente', 'en_progreso') THEN 0 ELSE 1 END,
      CASE t.priority WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
      t.due_date ASC NULLS LAST,
      t.id DESC
  `
}

// ---------------------------------------------------------------------------
// Revisiones
// ---------------------------------------------------------------------------

/**
 * Columnas esperadas por mapInspection: las de obra_inspections
 * (scheduled_for como "YYYY-MM-DD" o Date) más lead_user_name, task_count y
 * open_task_count.
 */
export type InspectionRow = {
  id: number | string
  project_id: number | string
  title: string
  scheduled_for: string | Date
  status: string
  lead_user_id: number | string | null
  lead_user_name: string | null
  notes: string | null
  summary: string | null
  task_count: number | string | null
  open_task_count: number | string | null
  created_by: number | string | null
  created_at: Date | string
  closed_at: Date | string | null
}

export function mapInspection(r: InspectionRow): ObraInspection {
  return {
    id: toNum(r.id),
    project_id: toNum(r.project_id),
    title: toStr(r.title),
    scheduled_for: toDateOnly(r.scheduled_for) ?? "",
    status: oneOf(r.status, INSPECTION_STATUSES, "programada"),
    lead_user_id: toNumOrNull(r.lead_user_id),
    lead_user_name: toStrOrNull(r.lead_user_name),
    notes: toStrOrNull(r.notes),
    summary: toStrOrNull(r.summary),
    task_count: toNum(r.task_count),
    open_task_count: toNum(r.open_task_count),
    created_by: toNumOrNull(r.created_by),
    created_at: toIso(r.created_at),
    closed_at: toIsoOrNull(r.closed_at),
  }
}

/** SELECT base de revisiones (alias i) con responsable y conteo de tareas. */
export function inspectionSelect(q: Queryable) {
  const s = asSql(q)
  return s`
    SELECT
      i.id, i.project_id, i.title,
      to_char(i.scheduled_for, 'YYYY-MM-DD') AS scheduled_for,
      i.status, i.lead_user_id,
      COALESCE(NULLIF(lu.name, ''), lu.email) AS lead_user_name,
      i.notes, i.summary,
      (SELECT COUNT(*) FROM obra_tasks ct WHERE ct.inspection_id = i.id)::int AS task_count,
      (SELECT COUNT(*) FROM obra_tasks ct WHERE ct.inspection_id = i.id
         AND ct.status IN ('pendiente', 'en_progreso'))::int AS open_task_count,
      i.created_by, i.created_at, i.closed_at
    FROM obra_inspections i
    LEFT JOIN users lu ON lu.id = i.lead_user_id
  `
}

// ---------------------------------------------------------------------------
// Miembros
// ---------------------------------------------------------------------------

/**
 * Columnas esperadas por mapMember: id (null para el dueño), project_id,
 * user_id, email, name, role, worker_id, worker_name, is_owner, created_at.
 */
export type MemberRow = {
  id: number | string | null
  project_id: number | string
  user_id: number | string
  email: string
  name: string | null
  role: string
  worker_id: number | string | null
  worker_name: string | null
  is_owner: boolean | null
  created_at: Date | string | null
}

export function mapMember(r: MemberRow): ObraMember {
  const isOwner = r.is_owner === true
  return {
    id: isOwner ? null : toNumOrNull(r.id),
    project_id: toNum(r.project_id),
    user_id: toNum(r.user_id),
    email: toStr(r.email),
    name: toStrOrNull(r.name),
    role: isOwner ? "gerente" : oneOf<ObraRole>(r.role, OBRA_ROLES, "visita"),
    worker_id: toNumOrNull(r.worker_id),
    worker_name: toStrOrNull(r.worker_name),
    is_owner: isOwner,
    created_at: toIsoOrNull(r.created_at),
  }
}

/** SELECT base de miembros explícitos (alias m) con usuario y trabajador vinculado. */
export function memberSelect(q: Queryable) {
  const s = asSql(q)
  return s`
    SELECT
      m.id, m.project_id, m.user_id, u.email, u.name, m.role, m.worker_id,
      NULLIF(TRIM(CONCAT_WS(' ', w.first_name, w.last_name)), '') AS worker_name,
      false AS is_owner, m.created_at
    FROM obra_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN workers w ON w.id = m.worker_id
  `
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

/**
 * Columnas esperadas por mapAudit: las de obra_audit_log (id es BIGSERIAL y
 * llega como string) más actor_name.
 */
export type AuditRow = {
  id: number | string
  project_id: number | string | null
  actor_user_id: number | string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: number | string | null
  details: unknown
  created_at: Date | string
}

export function mapAudit(r: AuditRow): AuditEntry {
  return {
    id: toNum(r.id),
    project_id: toNum(r.project_id),
    actor_user_id: toNumOrNull(r.actor_user_id),
    actor_name: toStrOrNull(r.actor_name),
    action: toStr(r.action),
    entity_type: toStr(r.entity_type),
    entity_id: toNumOrNull(r.entity_id),
    details: asRecord(r.details),
    created_at: toIso(r.created_at),
  }
}

/** SELECT base de auditoría (alias a) con nombre del actor. */
export function auditSelect(q: Queryable) {
  const s = asSql(q)
  return s`
    SELECT
      a.id, a.project_id, a.actor_user_id,
      COALESCE(NULLIF(u.name, ''), u.email) AS actor_name,
      a.action, a.entity_type, a.entity_id, a.details, a.created_at
    FROM obra_audit_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
  `
}

// ---------------------------------------------------------------------------
// Sugerencias de IA
// ---------------------------------------------------------------------------

/**
 * Columnas esperadas por mapSuggestion: las de obra_ai_suggestions más
 * reviewed_by_name. `payload` puede estar guardado como { kind, data } (salida
 * de parseSuggestionPayload) o solo como `data`; en ese caso se envuelve con
 * la columna `kind`.
 */
export type SuggestionRow = {
  id: number | string
  project_id: number | string
  kind: string
  status: string
  title: string
  rationale: string | null
  severity: string
  confidence: number | string | null
  generator: string
  model: string | null
  payload: unknown
  evidence: unknown
  finding_id: number | string | null
  layer_id: number | string | null
  requested_by: number | string | null
  reviewed_by: number | string | null
  reviewed_by_name: string | null
  reviewed_at: Date | string | null
  review_notes: string | null
  applied_entity_type: string | null
  applied_entity_id: number | string | null
  created_at: Date | string
}

export function mapSuggestion(r: SuggestionRow): AiSuggestion {
  const kind = oneOf(r.kind, SUGGESTION_KINDS, "create_task")
  const raw = parseJson(r.payload)
  let payload: SuggestionPayload
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "kind" in raw && "data" in raw) {
    payload = { kind, data: (raw as { data: unknown }).data } as SuggestionPayload
  } else {
    payload = { kind, data: raw ?? {} } as SuggestionPayload
  }
  return {
    id: toNum(r.id),
    project_id: toNum(r.project_id),
    kind,
    status: oneOf(r.status, SUGGESTION_STATUSES, "pending"),
    title: toStr(r.title),
    rationale: toStr(r.rationale),
    severity: oneOf(r.severity, SEVERITIES, "medium"),
    confidence: toNumOrNull(r.confidence),
    generator: oneOf(r.generator, SUGGESTION_GENERATORS, "reglas"),
    model: toStrOrNull(r.model),
    payload,
    evidence: asRecord(r.evidence) as SuggestionEvidence,
    finding_id: toNumOrNull(r.finding_id),
    layer_id: toNumOrNull(r.layer_id),
    requested_by: toNumOrNull(r.requested_by),
    reviewed_by: toNumOrNull(r.reviewed_by),
    reviewed_by_name: toStrOrNull(r.reviewed_by_name),
    reviewed_at: toIsoOrNull(r.reviewed_at),
    review_notes: toStrOrNull(r.review_notes),
    applied_entity_type: toStrOrNull(r.applied_entity_type),
    applied_entity_id: toNumOrNull(r.applied_entity_id),
    created_at: toIso(r.created_at),
  }
}

/** SELECT base de sugerencias (alias s) con nombre del revisor. */
export function suggestionSelect(q: Queryable) {
  const s = asSql(q)
  return s`
    SELECT
      s.id, s.project_id, s.kind, s.status, s.title, s.rationale, s.severity, s.confidence,
      s.generator, s.model, s.payload, s.evidence, s.finding_id, s.layer_id, s.requested_by,
      s.reviewed_by,
      COALESCE(NULLIF(ru.name, ''), ru.email) AS reviewed_by_name,
      s.reviewed_at, s.review_notes, s.applied_entity_type, s.applied_entity_id, s.created_at
    FROM obra_ai_suggestions s
    LEFT JOIN users ru ON ru.id = s.reviewed_by
  `
}

// ---------------------------------------------------------------------------
// Capas de plano
// ---------------------------------------------------------------------------

/**
 * Columnas esperadas por mapLayer: las de obra_plan_layers SIN image_data
 * (usar has_image calculado en SQL; si no viene, se deduce de image_path /
 * image_data) más element_count. image_data NUNCA se copia al DTO.
 */
export type LayerRow = {
  id: number | string
  project_id: number | string
  name: string
  discipline: string
  level: number | string
  level_label: string | null
  has_image?: boolean | null
  image_path?: string | null
  image_data?: string | null
  mime_type: string | null
  width_px: number | string | null
  height_px: number | string | null
  width_m: number | string
  aspect: number | string
  offset_x_m: number | string
  offset_y_m: number | string
  rotation_deg: number | string
  opacity: number | string
  element_count?: number | string | null
  uploaded_by: number | string | null
  created_at: Date | string
  updated_at: Date | string
}

export function mapLayer(r: LayerRow): PlanLayer {
  const hasImage =
    typeof r.has_image === "boolean"
      ? r.has_image
      : (r.image_path != null && r.image_path !== "") || (r.image_data != null && r.image_data !== "")
  const opacity = toNumOrNull(r.opacity)
  return {
    id: toNum(r.id),
    project_id: toNum(r.project_id),
    name: toStr(r.name),
    discipline: oneOf(r.discipline, DISCIPLINES, "otro"),
    level: toNum(r.level),
    level_label: toStrOrNull(r.level_label),
    has_image: hasImage,
    mime_type: toStrOrNull(r.mime_type),
    width_px: toNumOrNull(r.width_px),
    height_px: toNumOrNull(r.height_px),
    frame: sanitizeFrame({
      width_m: toNumOrNull(r.width_m) ?? undefined,
      aspect: toNumOrNull(r.aspect) ?? undefined,
      offset_x_m: toNumOrNull(r.offset_x_m) ?? undefined,
      offset_y_m: toNumOrNull(r.offset_y_m) ?? undefined,
      rotation_deg: toNumOrNull(r.rotation_deg) ?? undefined,
    }),
    opacity: opacity == null ? 0.85 : Math.min(1, Math.max(0, opacity)),
    element_count: toNum(r.element_count),
    uploaded_by: toNumOrNull(r.uploaded_by),
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  }
}

/**
 * SELECT base de capas (alias l) sin la columna pesada image_data: has_image
 * se calcula en SQL y element_count cuenta sus elementos. No filtra borradas:
 * agregar `WHERE l.deleted_at IS NULL` según corresponda.
 */
export function layerSelect(q: Queryable) {
  const s = asSql(q)
  return s`
    SELECT
      l.id, l.project_id, l.name, l.discipline, l.level, l.level_label,
      (l.image_path IS NOT NULL OR l.image_data IS NOT NULL) AS has_image,
      l.mime_type, l.width_px, l.height_px, l.width_m, l.aspect, l.offset_x_m, l.offset_y_m,
      l.rotation_deg, l.opacity,
      (SELECT COUNT(*) FROM obra_plan_elements le WHERE le.layer_id = l.id)::int AS element_count,
      l.uploaded_by, l.created_at, l.updated_at
    FROM obra_plan_layers l
  `
}

// ---------------------------------------------------------------------------
// Elementos de plano
// ---------------------------------------------------------------------------

/** Columnas esperadas por mapElement: las de obra_plan_elements. */
export type ElementRow = {
  id: number | string
  layer_id: number | string
  project_id: number | string
  element_type: string
  label: string | null
  geometry: unknown
  attributes: unknown
  source: string
  confidence: number | string | null
  created_by: number | string | null
  created_at: Date | string
}

export function mapElement(r: ElementRow): PlanElement {
  return {
    id: toNum(r.id),
    layer_id: toNum(r.layer_id),
    project_id: toNum(r.project_id),
    element_type: oneOf(r.element_type, ELEMENT_TYPES, "otro"),
    label: toStrOrNull(r.label),
    geometry: parseJson(r.geometry) as ElementGeometry,
    attributes: asRecord(r.attributes) as ElementAttributes,
    source: oneOf(r.source, ELEMENT_SOURCES, "manual"),
    confidence: toNumOrNull(r.confidence),
    created_by: toNumOrNull(r.created_by),
    created_at: toIso(r.created_at),
  }
}

/** SELECT base de elementos (alias e). */
export function elementSelect(q: Queryable) {
  const s = asSql(q)
  return s`
    SELECT
      e.id, e.layer_id, e.project_id, e.element_type, e.label, e.geometry, e.attributes,
      e.source, e.confidence, e.created_by, e.created_at
    FROM obra_plan_elements e
  `
}

// ---------------------------------------------------------------------------
// Hallazgos en el plano
// ---------------------------------------------------------------------------

/**
 * Columnas esperadas por mapPin: las de obra_finding_pins más title,
 * description, severity y status del finding.
 */
export type PinRow = {
  finding_id: number | string
  project_id: number | string
  layer_id: number | string
  level: number | string
  x: number | string
  y: number | string
  category: string
  reported_by: number | string | null
  created_at: Date | string
  title: string
  description: string | null
  severity: string
  status: string | null
}

const FINDING_STATUSES = ["open", "in_progress", "resolved", "closed"] as const

export function mapPin(r: PinRow): FindingPin {
  return {
    finding_id: toNum(r.finding_id),
    project_id: toNum(r.project_id),
    layer_id: toNum(r.layer_id),
    level: toNum(r.level),
    x: toNum(r.x),
    y: toNum(r.y),
    category: oneOf(r.category, FINDING_CATEGORIES, "otro"),
    reported_by: toNumOrNull(r.reported_by),
    created_at: toIso(r.created_at),
    title: toStr(r.title),
    description: toStrOrNull(r.description),
    severity: oneOf(r.severity, SEVERITIES, "medium"),
    status: oneOf(r.status, FINDING_STATUSES, "open"),
  }
}

/** SELECT base de pines (alias p) con datos del hallazgo (alias f). */
export function pinSelect(q: Queryable) {
  const s = asSql(q)
  return s`
    SELECT
      p.finding_id, p.project_id, p.layer_id, p.level, p.x, p.y, p.category, p.reported_by,
      p.created_at, f.title, f.description, f.severity, f.status
    FROM obra_finding_pins p
    JOIN findings f ON f.id = p.finding_id
  `
}
