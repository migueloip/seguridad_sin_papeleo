/**
 * Obra Integral — tipos y catálogos compartidos.
 *
 * Este archivo es el CONTRATO entre el esquema SQL (lib/obra/schema.ts), el
 * motor de correlación (lib/obra/correlation.ts), los server actions
 * (app/actions/obra/*) y la UI (components/obra/*). No importa nada de
 * servidor: se puede usar desde componentes cliente.
 *
 * Convenciones:
 * - Los valores de catálogo (roles, disciplinas, tipos...) son strings en
 *   español sin tildes, en snake_case, y se guardan tal cual en la BD.
 * - Coordenadas normalizadas: {x, y} en [0, 1] sobre la lámina de una capa
 *   (0,0 = esquina superior izquierda). Se convierten a metros del nivel con
 *   el LayerFrame de la capa (ver lib/obra/geometry.ts).
 * - Fechas: string ISO (timestamps) o "YYYY-MM-DD" (fechas sin hora).
 */

// ---------------------------------------------------------------------------
// Roles del equipo de obra
// ---------------------------------------------------------------------------

export const OBRA_ROLES = ["gerente", "jefe_obra", "prevencionista", "supervisor", "trabajador", "visita"] as const
export type ObraRole = (typeof OBRA_ROLES)[number]

export const OBRA_ROLE_LABELS: Record<ObraRole, string> = {
  gerente: "Gerente de proyecto",
  jefe_obra: "Jefe / Administrador de obra",
  prevencionista: "Prevencionista de riesgos",
  supervisor: "Supervisor / Capataz",
  trabajador: "Trabajador",
  visita: "Visita / ITO (solo lectura)",
}

export const OBRA_ROLE_DESCRIPTIONS: Record<ObraRole, string> = {
  gerente: "Ve todo el proyecto, gestiona el equipo y aprueba cualquier decisión sugerida por IA.",
  jefe_obra: "Dirige la obra: planos, tareas, revisiones y aprobación de sugerencias de IA.",
  prevencionista: "Gestiona hallazgos, revisiones y aprueba sugerencias de IA, incluidas las críticas.",
  supervisor: "Reporta hallazgos, ve las tareas de la obra y cierra las de su cuadrilla.",
  trabajador: "Reporta condiciones inseguras y cierra las tareas que tiene asignadas.",
  visita: "Acceso de solo lectura (mandante, ITO, inspector externo).",
}

// ---------------------------------------------------------------------------
// Planos por especialidad
// ---------------------------------------------------------------------------

export const DISCIPLINES = [
  "arquitectura",
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
export type Discipline = (typeof DISCIPLINES)[number]

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  arquitectura: "Arquitectura (muros, recintos)",
  estructura: "Estructura (columnas, vigas, losas)",
  alcantarillado: "Alcantarillado / Sanitario",
  agua_potable: "Agua potable",
  aguas_lluvia: "Aguas lluvia",
  electrico: "Eléctrico",
  gas: "Gas",
  climatizacion: "Climatización / Ventilación",
  incendio: "Red contra incendio",
  otro: "Otro",
}

/** Color de dibujo por disciplina (hex, legible sobre fondo claro y oscuro). */
export const DISCIPLINE_COLORS: Record<Discipline, string> = {
  arquitectura: "#8a8f98",
  estructura: "#b45309",
  alcantarillado: "#7c3aed",
  agua_potable: "#0284c7",
  aguas_lluvia: "#0d9488",
  electrico: "#eab308",
  gas: "#dc2626",
  climatizacion: "#64748b",
  incendio: "#e11d48",
  otro: "#6b7280",
}

export const ELEMENT_TYPES = [
  "muro",
  "muro_carga",
  "columna",
  "viga",
  "losa",
  "fundacion",
  "tuberia_alcantarillado",
  "camara_inspeccion",
  "tuberia_agua",
  "tuberia_aguas_lluvia",
  "ducto_electrico",
  "tablero_electrico",
  "linea_gas",
  "medidor_gas",
  "ducto_clima",
  "red_incendio",
  "excavacion",
  "otro",
] as const
export type ElementType = (typeof ELEMENT_TYPES)[number]

export const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  muro: "Muro / tabique",
  muro_carga: "Muro de carga",
  columna: "Columna / pilar",
  viga: "Viga",
  losa: "Losa",
  fundacion: "Fundación",
  tuberia_alcantarillado: "Colector / tubería de alcantarillado",
  camara_inspeccion: "Cámara de inspección",
  tuberia_agua: "Tubería de agua potable",
  tuberia_aguas_lluvia: "Tubería de aguas lluvia",
  ducto_electrico: "Ducto / canalización eléctrica",
  tablero_electrico: "Tablero eléctrico",
  linea_gas: "Red de gas",
  medidor_gas: "Medidor / regulador de gas",
  ducto_clima: "Ducto de climatización",
  red_incendio: "Red húmeda / seca contra incendio",
  excavacion: "Excavación / zanja",
  otro: "Otro elemento",
}

/** Disciplina a la que pertenece naturalmente cada tipo de elemento. */
export const ELEMENT_TYPE_DISCIPLINE: Record<ElementType, Discipline> = {
  muro: "arquitectura",
  muro_carga: "estructura",
  columna: "estructura",
  viga: "estructura",
  losa: "estructura",
  fundacion: "estructura",
  tuberia_alcantarillado: "alcantarillado",
  camara_inspeccion: "alcantarillado",
  tuberia_agua: "agua_potable",
  tuberia_aguas_lluvia: "aguas_lluvia",
  ducto_electrico: "electrico",
  tablero_electrico: "electrico",
  linea_gas: "gas",
  medidor_gas: "gas",
  ducto_clima: "climatizacion",
  red_incendio: "incendio",
  excavacion: "otro",
  otro: "otro",
}

export type NormPoint = { x: number; y: number }
export type Vec2 = { x: number; y: number }

export type ElementGeometry =
  | { type: "point"; points: [NormPoint] }
  | { type: "polyline"; points: NormPoint[] }
  | { type: "polygon"; points: NormPoint[] }

/** Atributos técnicos opcionales de un elemento (todos opcionales). */
export type ElementAttributes = {
  diameter_mm?: number
  depth_m?: number
  material?: string
  voltage_v?: number
  pressure?: string
  notes?: string
  dxf_layer?: string
  [key: string]: unknown
}

export const ELEMENT_SOURCES = ["manual", "ia", "dxf"] as const
export type ElementSource = (typeof ELEMENT_SOURCES)[number]

/**
 * Marco de una capa: cómo se convierte una coordenada normalizada de su
 * lámina a metros del "marco del nivel" (común a todas las capas del mismo
 * nivel del proyecto).
 *   local  = (x * width_m, y * width_m * aspect)
 *   rot    = rotate(local, rotation_deg) (sentido horario en pantalla, eje y hacia abajo)
 *   world  = rot + (offset_x_m, offset_y_m)
 */
export type LayerFrame = {
  width_m: number
  aspect: number
  offset_x_m: number
  offset_y_m: number
  rotation_deg: number
}

/**
 * Origen CAD de una capa importada de DXF, en unidades del dibujo: X mínima
 * (borde izquierdo) e Y máxima (borde superior) de la lámina, y su ancho.
 * Con él, otra capa DXF del mismo nivel y sistema de coordenadas se alinea
 * sola (metros por unidad = width_m / width_units).
 */
export type CadOrigin = { min_x: number; max_y: number; width_units: number }

export type PlanLayer = {
  id: number
  project_id: number
  name: string
  discipline: Discipline
  level: number
  level_label: string | null
  /** Solo capas importadas de DXF (null en imágenes y PDF). */
  cad_origin?: CadOrigin | null
  /** true si la capa tiene imagen (se sirve en /api/obra/layers/[id]/image). */
  has_image: boolean
  mime_type: string | null
  width_px: number | null
  height_px: number | null
  frame: LayerFrame
  opacity: number
  element_count: number
  uploaded_by: number | null
  created_at: string
  updated_at: string
}

export type PlanElement = {
  id: number
  layer_id: number
  project_id: number
  element_type: ElementType
  label: string | null
  geometry: ElementGeometry
  attributes: ElementAttributes
  source: ElementSource
  confidence: number | null
  created_by: number | null
  created_at: string
}

/** Borrador de elemento (entrada manual, DXF o propuesta de IA aún no aprobada). */
export type PlanElementDraft = {
  element_type: ElementType
  label?: string | null
  geometry: ElementGeometry
  attributes?: ElementAttributes
  confidence?: number | null
}

// ---------------------------------------------------------------------------
// Hallazgos geolocalizados en el plano
// ---------------------------------------------------------------------------

export const FINDING_CATEGORIES = [
  "grieta",
  "humedad_filtracion",
  "hundimiento",
  "olor_gas",
  "falla_electrica",
  "corrosion",
  "desprendimiento",
  "obstruccion",
  "excavacion",
  "otro",
] as const
export type FindingCategory = (typeof FINDING_CATEGORIES)[number]

export const FINDING_CATEGORY_LABELS: Record<FindingCategory, string> = {
  grieta: "Grieta / fisura",
  humedad_filtracion: "Humedad / filtración",
  hundimiento: "Hundimiento / asentamiento",
  olor_gas: "Olor a gas o alcantarilla",
  falla_electrica: "Falla eléctrica / chispa",
  corrosion: "Corrosión / óxido",
  desprendimiento: "Desprendimiento de material",
  obstruccion: "Obstrucción / rebalse",
  excavacion: "Excavación / zanja",
  otro: "Otro",
}

export const SEVERITIES = ["low", "medium", "high", "critical"] as const
export type Severity = (typeof SEVERITIES)[number]
export const SEVERITY_LABELS: Record<Severity, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
}

export type FindingPin = {
  finding_id: number
  project_id: number
  layer_id: number
  level: number
  x: number
  y: number
  category: FindingCategory
  reported_by: number | null
  created_at: string
  // Datos del hallazgo (tabla findings)
  title: string
  description: string | null
  severity: Severity
  status: "open" | "in_progress" | "resolved" | "closed"
}

// ---------------------------------------------------------------------------
// Motor de correlación espacial (resultado determinista, sin IA)
// ---------------------------------------------------------------------------

export const LEVEL_RELATIONS = ["mismo_nivel", "nivel_inferior", "nivel_superior"] as const
export type LevelRelation = (typeof LEVEL_RELATIONS)[number]

export const PRIORITIES = ["baja", "media", "alta", "critica"] as const
export type Priority = (typeof PRIORITIES)[number]
export const PRIORITY_LABELS: Record<Priority, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  critica: "Crítica",
}

export type CorrelationRule = {
  id: string
  /** Categorías de hallazgo a las que aplica ("*" = cualquiera). */
  categories: Array<FindingCategory | "*">
  element_types: ElementType[]
  /** Distancia máxima en metros (en planta) para que la regla aplique. */
  max_distance_m: number
  /** Relaciones de nivel en que aplica. */
  relations: LevelRelation[]
  base_priority: Priority
  /** Hipótesis técnica, en español, con placeholders {elemento} {distancia} {capa} {relacion}. */
  hypothesis: string
  recommended_actions: string[]
  /** Rol sugerido para ejecutar la acción. */
  suggested_role: ObraRole
  /** Días sugeridos para revisar (plazo). */
  due_in_days: number
}

export type Correlation = {
  rule_id: string
  element_id: number
  element_type: ElementType
  element_label: string | null
  layer_id: number
  layer_name: string
  discipline: Discipline
  relation: LevelRelation
  distance_m: number
  priority: Priority
  /** 0..1, mayor = más relevante. */
  score: number
  /** Hipótesis ya rellenada (placeholders resueltos). */
  hypothesis: string
  recommended_actions: string[]
  suggested_role: ObraRole
  due_in_days: number
}

// ---------------------------------------------------------------------------
// Sugerencias de IA con aprobación humana obligatoria
// ---------------------------------------------------------------------------

export const SUGGESTION_KINDS = ["create_task", "plan_elements", "update_finding_severity"] as const
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number]

export const SUGGESTION_KIND_LABELS: Record<SuggestionKind, string> = {
  create_task: "Anotar tarea para la próxima revisión",
  plan_elements: "Incorporar elementos detectados en el plano",
  update_finding_severity: "Cambiar severidad de un hallazgo",
}

export const SUGGESTION_STATUSES = ["pending", "approved", "rejected", "superseded"] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = {
  pending: "Pendiente de aprobación",
  approved: "Aprobada y aplicada",
  rejected: "Rechazada",
  superseded: "Reemplazada por un análisis más nuevo",
}

/** Quién generó la sugerencia: un LLM o el motor de reglas (sin IA configurada). */
export const SUGGESTION_GENERATORS = ["ia", "reglas"] as const
export type SuggestionGenerator = (typeof SUGGESTION_GENERATORS)[number]

export type CreateTaskPayload = {
  title: string
  description: string
  priority: Priority
  assigned_role: ObraRole | null
  due_in_days: number
  finding_id: number | null
  layer_id: number | null
  level: number | null
  x: number | null
  y: number | null
  checklist: string[]
}

export type PlanElementsPayload = {
  layer_id: number
  elements: PlanElementDraft[]
}

export type UpdateFindingSeverityPayload = {
  finding_id: number
  from: Severity
  to: Severity
  reason: string
}

export type SuggestionPayload =
  | { kind: "create_task"; data: CreateTaskPayload }
  | { kind: "plan_elements"; data: PlanElementsPayload }
  | { kind: "update_finding_severity"; data: UpdateFindingSeverityPayload }

/** Evidencia que respalda una sugerencia (siempre verificable por un humano). */
export type SuggestionEvidence = {
  correlations?: Correlation[]
  finding_id?: number
  layer_id?: number
  notes?: string[]
}

export type AiSuggestion = {
  id: number
  project_id: number
  kind: SuggestionKind
  status: SuggestionStatus
  title: string
  rationale: string
  /** Severidad del riesgo que motiva la sugerencia (decide quién puede aprobar). */
  severity: Severity
  confidence: number | null
  generator: SuggestionGenerator
  model: string | null
  payload: SuggestionPayload
  evidence: SuggestionEvidence
  finding_id: number | null
  layer_id: number | null
  requested_by: number | null
  reviewed_by: number | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  review_notes: string | null
  /** Entidad creada al aplicar (p.ej. id de la tarea). */
  applied_entity_type: string | null
  applied_entity_id: number | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Tareas y revisiones (inspecciones programadas)
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ["pendiente", "en_progreso", "hecha", "cancelada"] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  hecha: "Hecha",
  cancelada: "Cancelada",
}

/**
 * Origen de una tarea: creada a mano, desde un hallazgo, o al aprobar una
 * sugerencia redactada por un modelo de IA ("ia") o por el motor de reglas
 * ("reglas"). Las dos últimas siempre llevan suggestion_id.
 */
export const TASK_ORIGINS = ["manual", "ia", "reglas", "hallazgo"] as const
export type TaskOrigin = (typeof TASK_ORIGINS)[number]

export type ObraTask = {
  id: number
  project_id: number
  title: string
  description: string | null
  priority: Priority
  status: TaskStatus
  origin: TaskOrigin
  suggestion_id: number | null
  finding_id: number | null
  layer_id: number | null
  level: number | null
  x: number | null
  y: number | null
  checklist: Array<{ text: string; done: boolean }>
  assigned_role: ObraRole | null
  assigned_user_id: number | null
  assigned_user_name: string | null
  inspection_id: number | null
  due_date: string | null
  created_by: number | null
  created_by_name: string | null
  completed_by: number | null
  completed_at: string | null
  completion_notes: string | null
  created_at: string
  updated_at: string
}

export const INSPECTION_STATUSES = ["programada", "en_curso", "cerrada"] as const
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number]
export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  programada: "Programada",
  en_curso: "En curso",
  cerrada: "Cerrada",
}

export type ObraInspection = {
  id: number
  project_id: number
  title: string
  scheduled_for: string
  status: InspectionStatus
  lead_user_id: number | null
  lead_user_name: string | null
  notes: string | null
  summary: string | null
  task_count: number
  open_task_count: number
  created_by: number | null
  created_at: string
  closed_at: string | null
}

// ---------------------------------------------------------------------------
// Equipo, acceso y auditoría
// ---------------------------------------------------------------------------

export type ObraMember = {
  /** null para el dueño implícito del proyecto (projects.user_id). */
  id: number | null
  project_id: number
  user_id: number
  email: string
  name: string | null
  role: ObraRole
  worker_id: number | null
  worker_name: string | null
  is_owner: boolean
  created_at: string | null
}

// Invitaciones al equipo (reemplazan el alta directa con contraseña temporal)

export const INVITATION_STATUSES = ["pendiente", "aceptada", "revocada", "vencida"] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]
export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  pendiente: "Pendiente",
  aceptada: "Aceptada",
  revocada: "Revocada",
  vencida: "Vencida",
}

/** Días que dura un enlace de invitación. */
export const INVITATION_TTL_DAYS = 7

/** Invitación vista por quien gestiona el equipo (nunca incluye el token). */
export type ObraInvitation = {
  id: number
  project_id: number
  email: string
  name: string | null
  role: ObraRole
  worker_id: number | null
  worker_name: string | null
  invited_by: number | null
  invited_by_name: string | null
  status: InvitationStatus
  created_at: string
  expires_at: string
  accepted_at: string | null
}

/**
 * Vista pública de una invitación (página /invitacion/[token]). Solo la ve
 * quien tiene el enlace; no revela si el correo ya tiene cuenta.
 */
export type InvitationPreview = {
  project_name: string
  role: ObraRole
  email: string
  name: string | null
  inviter_name: string | null
  status: InvitationStatus
  expires_at: string
}

/** Resultado de crear o regenerar una invitación: el enlace se muestra una sola vez. */
export type InvitationLink = {
  invitation: ObraInvitation
  /** URL absoluta /invitacion/<token>. Solo se guarda el hash del token. */
  url: string
}

// Subida directa de planos a Supabase Storage (evita el límite de tamaño de las server actions)

/** Permiso de subida firmado para una imagen de capa. */
export type LayerUploadTicket = {
  /** Ruta interna del objeto en el bucket privado (obra/<projectId>/uploads/<uuid>.<ext>). */
  path: string
  /** URL absoluta a la que el navegador hace PUT del archivo. */
  upload_url: string
  /** Token de la URL firmada (ya incluido en upload_url; se expone para depurar). */
  token: string
  /** Segundos de validez de la URL firmada. */
  expires_in: number
  max_bytes: number
  mime: string
}

export type ProjectAccess = {
  project_id: number
  project_name: string
  /** Dueño/tenant del proyecto (projects.user_id). Los datos heredados se guardan con este user_id. */
  owner_user_id: number
  user_id: number
  role: ObraRole
  is_owner: boolean
}

export type AuditEntry = {
  id: number
  project_id: number
  actor_user_id: number | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: number | null
  details: Record<string, unknown>
  created_at: string
}

/** Resultado uniforme de los server actions de Obra que mutan datos. */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// DTOs de pantallas
// ---------------------------------------------------------------------------

/** Tarjeta de obra en el hub /obra. */
export type ObraProjectSummary = ProjectAccess & {
  open_tasks: number
  my_open_tasks: number
  overdue_tasks: number
  pending_suggestions: number
  open_findings: number
  critical_findings: number
  next_inspection_date: string | null
}

export type RiskLevel = "bajo" | "medio" | "alto" | "critico"

export type ObraDashboard = {
  access: ProjectAccess & { permissions: string[] }
  counts: {
    open_tasks: number
    overdue_tasks: number
    my_open_tasks: number
    pending_suggestions: number
    pending_critical_suggestions: number
    open_findings: number
    pinned_findings: number
    layers: number
    elements: number
    members: number
  }
  findings_by_severity: Record<Severity, number>
  tasks_by_status: Record<TaskStatus, number>
  next_inspection: ObraInspection | null
  /** Tareas abiertas del usuario (asignadas a él o a su rol sin persona asignada). */
  my_tasks: ObraTask[]
  /** Solo si el rol puede revisar sugerencias (ai.review); si no, []. */
  pending_suggestions: AiSuggestion[]
  /** Solo si el rol tiene audit.view; si no, []. */
  recent_activity: AuditEntry[]
  risk: { score: number; level: RiskLevel }
}

/** Entrada para crear una tarea manual. */
export type TaskInput = {
  title: string
  description?: string | null
  priority?: Priority
  assigned_role?: ObraRole | null
  assigned_user_id?: number | null
  due_date?: string | null
  /** id de revisión, null = sin revisión, "next" = la próxima (se crea si no existe). */
  inspection_id?: number | null | "next"
  finding_id?: number | null
  layer_id?: number | null
  level?: number | null
  x?: number | null
  y?: number | null
  checklist?: string[]
}
