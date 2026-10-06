/**
 * Payloads de sugerencias de IA: esquemas zod, normalización y transiciones
 * de estado. Puro (sin BD ni servidor; usable en cliente).
 *
 * Todo payload que entra al sistema (generado por el motor de reglas, por un
 * LLM o editado por un revisor en "Editar y aprobar") pasa por
 * parseSuggestionPayload(), que valida tipos y catálogos y recorta textos.
 */
import { z } from "zod"
import { isValidGeometry, normalizeGeometry } from "./geometry"
import {
  ELEMENT_TYPES,
  OBRA_ROLES,
  PRIORITIES,
  SEVERITIES,
  SUGGESTION_KINDS,
  type CreateTaskPayload,
  type ElementAttributes,
  type ElementGeometry,
  type PlanElementsPayload,
  type SuggestionKind,
  type SuggestionPayload,
  type SuggestionStatus,
  type UpdateFindingSeverityPayload,
} from "./types"

/** Límites de longitud y cantidad aplicados a los payloads. */
export const SUGGESTION_LIMITS = {
  title: 200,
  description: 4000,
  checklistItems: 20,
  checklistItemLength: 300,
  reason: 1000,
  elements: 2000,
  elementLabel: 255,
  attributeKeys: 30,
  attributeText: 500,
  maxDueInDays: 365,
} as const

/** Error de validación de un payload (mensaje en español, apto para mostrar). */
export class SuggestionPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SuggestionPayloadError"
  }
}

// ---------------------------------------------------------------------------
// Limpieza de textos
// ---------------------------------------------------------------------------

function isControl(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return c < 0x20 || (c >= 0x7f && c <= 0x9f)
}

/** Recorta a `max` caracteres contando puntos de código (como VARCHAR en Postgres). */
function truncate(s: string, max: number): string {
  const chars = Array.from(s)
  return chars.length <= max ? s : chars.slice(0, max).join("").trimEnd()
}

/** Una línea: sin caracteres de control y con espacios colapsados. */
function cleanLine(s: string, max: number): string {
  let out = ""
  for (const ch of s) out += isControl(ch) ? " " : ch
  return truncate(out.replace(/\s+/g, " ").trim(), max)
}

/** Texto multilínea: conserva saltos de línea y tabulaciones, quita otros controles. */
function cleanText(s: string, max: number): string {
  let out = ""
  for (const ch of s.replace(/\r\n?/g, "\n")) {
    if (ch === "\n" || ch === "\t" || !isControl(ch)) out += ch
  }
  return truncate(out.replace(/\n{3,}/g, "\n\n").trim(), max)
}

function cleanChecklist(items: string[] | null | undefined): string[] {
  return (items ?? [])
    .map((s) => cleanLine(s, SUGGESTION_LIMITS.checklistItemLength))
    .filter((s) => s.length > 0)
    .slice(0, SUGGESTION_LIMITS.checklistItems)
}

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"])
const NUMERIC_ATTRIBUTES: Record<string, { min: number; max: number }> = {
  diameter_mm: { min: 0, max: 100_000 },
  depth_m: { min: 0, max: 1_000 },
  voltage_v: { min: 0, max: 1_000_000 },
}

/** Atributos técnicos: solo valores primitivos, claves acotadas y números con rango razonable. */
function sanitizeAttributes(raw: Record<string, unknown> | null | undefined): ElementAttributes {
  const out: ElementAttributes = {}
  let count = 0
  for (const [rawKey, value] of Object.entries(raw ?? {})) {
    if (count >= SUGGESTION_LIMITS.attributeKeys) break
    const key = cleanLine(rawKey, 60)
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
      const s = cleanText(value, SUGGESTION_LIMITS.attributeText)
      if (!s) continue
      out[key] = s
    } else continue
    count++
  }
  return out
}

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

/**
 * Fija el tipo de salida de un esquema. El tsconfig del repo usa
 * `strict: false` y, sin strictNullChecks, zod infiere todas las claves como
 * opcionales; los tests de lib/obra/suggestions.test.ts verifican la forma real.
 */
function typedSchema<T>(schema: z.ZodTypeAny): z.ZodType<T, z.ZodTypeDef, unknown> {
  return schema as unknown as z.ZodType<T, z.ZodTypeDef, unknown>
}

const optionalId = z
  .number()
  .int()
  .positive()
  .nullish()
  .transform((v) => v ?? null)

const optionalCoord = z
  .number()
  .finite()
  .min(0)
  .max(1)
  .nullish()
  .transform((v) => v ?? null)

const requiredLine = (max: number, message: string) =>
  z
    .string()
    .transform((s) => cleanLine(s, max))
    .refine((s) => s.length > 0, { message })

export const createTaskPayloadSchema = typedSchema<CreateTaskPayload>(
  z
    .object({
      title: requiredLine(SUGGESTION_LIMITS.title, "El título de la tarea es obligatorio."),
      description: z
        .string()
        .nullish()
        .transform((s) => cleanText(s ?? "", SUGGESTION_LIMITS.description)),
      priority: z
        .enum(PRIORITIES)
        .nullish()
        .transform((p) => p ?? "media"),
      assigned_role: z
        .enum(OBRA_ROLES)
        .nullish()
        .transform((r) => r ?? null),
      due_in_days: z
        .number()
        .finite()
        .min(0)
        .max(SUGGESTION_LIMITS.maxDueInDays)
        .nullish()
        .transform((n) => (n == null ? 7 : Math.round(n))),
      finding_id: optionalId,
      layer_id: optionalId,
      level: z
        .number()
        .int()
        .min(-50)
        .max(500)
        .nullish()
        .transform((v) => v ?? null),
      x: optionalCoord,
      y: optionalCoord,
      checklist: z.array(z.string()).nullish().transform(cleanChecklist),
    })
    .refine((p) => (p.x === null) === (p.y === null), {
      message: "Las coordenadas x e y deben venir juntas.",
      path: ["x"],
    }),
)

const planElementDraftSchema = z.object({
  element_type: z.enum(ELEMENT_TYPES),
  label: z
    .string()
    .nullish()
    .transform((s) => cleanLine(s ?? "", SUGGESTION_LIMITS.elementLabel) || null),
  geometry: z
    .custom<ElementGeometry>((g) => isValidGeometry(g), {
      message:
        "La geometría del elemento no es válida (punto = 1 vértice, polilínea ≥ 2, polígono ≥ 3, coordenadas entre 0 y 1).",
    })
    .transform((g) => normalizeGeometry(g)),
  attributes: z
    .record(z.unknown())
    .nullish()
    .transform((a) => sanitizeAttributes(a)),
  confidence: z
    .number()
    .finite()
    .min(0)
    .max(1)
    .nullish()
    .transform((v) => v ?? null),
})

export const planElementsPayloadSchema = typedSchema<PlanElementsPayload>(
  z.object({
    layer_id: z.number().int().positive(),
    elements: z
      .array(planElementDraftSchema)
      .min(1, "La sugerencia debe incluir al menos un elemento.")
      .max(SUGGESTION_LIMITS.elements, `Una sugerencia admite como máximo ${SUGGESTION_LIMITS.elements} elementos.`),
  }),
)

export const updateFindingSeverityPayloadSchema = typedSchema<UpdateFindingSeverityPayload>(
  z
    .object({
      finding_id: z.number().int().positive(),
      from: z.enum(SEVERITIES),
      to: z.enum(SEVERITIES),
      reason: requiredLine(SUGGESTION_LIMITS.reason, "Indica el motivo del cambio de severidad."),
    })
    .refine((p) => p.from !== p.to, {
      message: "La severidad nueva debe ser distinta de la actual.",
      path: ["to"],
    }),
)

// ---------------------------------------------------------------------------
// Mensajes de error en español
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  title: "título",
  description: "descripción",
  priority: "prioridad",
  assigned_role: "rol asignado",
  due_in_days: "plazo en días",
  finding_id: "hallazgo",
  layer_id: "capa",
  level: "nivel",
  x: "coordenada x",
  y: "coordenada y",
  checklist: "checklist",
  elements: "elementos",
  element_type: "tipo de elemento",
  label: "etiqueta",
  geometry: "geometría",
  attributes: "atributos",
  confidence: "confianza",
  from: "severidad actual",
  to: "severidad nueva",
  reason: "motivo",
}

const TYPE_LABELS: Record<string, string> = {
  string: "un texto",
  number: "un número",
  integer: "un número entero",
  boolean: "verdadero o falso",
  object: "un objeto",
  array: "una lista",
}

const KIND_ERROR_PREFIX: Record<SuggestionKind, string> = {
  create_task: "Tarea sugerida inválida",
  plan_elements: "Elementos de plano sugeridos inválidos",
  update_finding_severity: "Cambio de severidad sugerido inválido",
}

const spanishErrorMap: z.ZodErrorMap = (issue) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") return { message: "es obligatorio" }
      if (issue.expected === "integer") return { message: "debe ser un número entero" }
      return { message: `debe ser ${TYPE_LABELS[issue.expected] ?? "de otro tipo"}` }
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `tiene un valor no permitido («${String(issue.received).slice(0, 40)}»)` }
    case z.ZodIssueCode.too_small:
      if (issue.type === "array") return { message: `debe tener al menos ${issue.minimum} elemento(s)` }
      if (issue.type === "string") return { message: "no puede estar vacío" }
      return { message: `debe ser ${issue.inclusive ? "mayor o igual a" : "mayor que"} ${issue.minimum}` }
    case z.ZodIssueCode.too_big:
      if (issue.type === "array") return { message: `admite como máximo ${issue.maximum} elementos` }
      if (issue.type === "string") return { message: `admite como máximo ${issue.maximum} caracteres` }
      return { message: `debe ser ${issue.inclusive ? "menor o igual a" : "menor que"} ${issue.maximum}` }
    case z.ZodIssueCode.not_finite:
      return { message: "debe ser un número finito" }
    default:
      return { message: "tiene un valor inválido" }
  }
}

function fieldPath(path: (string | number)[]): string {
  return path.map((seg) => (typeof seg === "number" ? `n.º ${seg + 1}` : (FIELD_LABELS[seg] ?? seg))).join(" › ")
}

function formatIssue(kind: SuggestionKind, issue: z.ZodIssue): string {
  const prefix = KIND_ERROR_PREFIX[kind]
  const msg = issue.message || "tiene un valor inválido"
  // Mensajes propios de los esquemas: oraciones completas (empiezan con mayúscula).
  if (/^[A-ZÁÉÍÓÚÑ]/.test(msg)) {
    return issue.path.length > 0 ? `${prefix} (${fieldPath(issue.path)}): ${msg}` : `${prefix}: ${msg}`
  }
  if (issue.path.length === 0) {
    return issue.code === z.ZodIssueCode.invalid_type
      ? `${prefix}: se esperaba un objeto con los datos de la sugerencia.`
      : `${prefix}: ${msg}.`
  }
  return `${prefix}: el campo «${fieldPath(issue.path)}» ${msg}.`
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function isSuggestionKind(v: unknown): v is SuggestionKind {
  return typeof v === "string" && (SUGGESTION_KINDS as readonly string[]).includes(v)
}

function runSchema<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, kind: SuggestionKind, raw: unknown): T {
  const result = schema.safeParse(raw, { errorMap: spanishErrorMap })
  if (!result.success) throw new SuggestionPayloadError(formatIssue(kind, result.error.issues[0]))
  return result.data
}

/**
 * Valida y normaliza el payload de una sugerencia del tipo `kind`.
 * `data` es el contenido (p.ej. un CreateTaskPayload); también se acepta el
 * sobre completo `{ kind, data }` si su `kind` coincide.
 * Lanza SuggestionPayloadError (subclase de Error) con mensaje en español.
 */
export function parseSuggestionPayload(kind: SuggestionKind, data: unknown): SuggestionPayload {
  if (!isSuggestionKind(kind)) throw new SuggestionPayloadError("Tipo de sugerencia desconocido.")
  let raw = data
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "kind" in raw && "data" in raw) {
    const envelope = raw as { kind: unknown; data: unknown }
    if (envelope.kind !== kind) {
      throw new SuggestionPayloadError("El tipo de la sugerencia no coincide con su contenido.")
    }
    raw = envelope.data
  }
  switch (kind) {
    case "create_task":
      return { kind, data: runSchema(createTaskPayloadSchema, kind, raw) }
    case "plan_elements":
      return { kind, data: runSchema(planElementsPayloadSchema, kind, raw) }
    case "update_finding_severity":
      return { kind, data: runSchema(updateFindingSeverityPayloadSchema, kind, raw) }
    default:
      throw new SuggestionPayloadError("Tipo de sugerencia desconocido.")
  }
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/** Transiciones permitidas: solo una sugerencia pendiente cambia de estado; el resto son terminales. */
export const SUGGESTION_TRANSITIONS: Record<SuggestionStatus, SuggestionStatus[]> = {
  pending: ["approved", "rejected", "superseded"],
  approved: [],
  rejected: [],
  superseded: [],
}

export function canTransition(from: SuggestionStatus, to: SuggestionStatus): boolean {
  const allowed = Object.prototype.hasOwnProperty.call(SUGGESTION_TRANSITIONS, from)
    ? SUGGESTION_TRANSITIONS[from]
    : undefined
  return Array.isArray(allowed) && allowed.includes(to)
}
