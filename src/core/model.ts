// Modelo de datos central para planos de riesgo en obras
// Este módulo define las entidades principales y relaciones necesarias
// para edición 2D, visualización 3D, cálculo de riesgo y trabajo offline.

// Identificadores opacos para mantener consistencia entre 2D, 3D y almacenamiento.
export type UUID = string

// Un plano completo de obra (ej. "Edificio A - Planta Baja").
export interface Plano {
  id: UUID
  name: string
  projectId?: UUID
  scaleMetersPerUnit: number
  layers: Layer[]
  elements: Element2D[]
  commits: Commit[]
  createdAt: string
  updatedAt: string
}

// Capas lógicas del plano (estructura, evacuación, equipamiento, etc.).
export interface Layer {
  id: UUID
  name: string
  description?: string
  type: "architectural" | "safety" | "evacuation" | "electrical" | "annotation" | "other"
  isVisible: boolean
  isLocked: boolean
  color?: string
  dxfLayerName?: string
}

// Elemento genérico en 2D. Se especializa en muros, zonas o puntos.
export interface Element2DBase {
  id: UUID
  layerId: UUID
  kind: "wall" | "zone" | "point"
  // Coordenadas en el sistema del plano (unidades abstractas que se escalan a metros).
}

export interface Wall extends Element2DBase {
  kind: "wall"
  start: Vec2
  end: Vec2
  thickness: number
  height: number
  material?: string
}

export interface Zone extends Element2DBase {
  kind: "zone"
  name: string
  code?: string
  polygon: Vec2[]
  usage?: "circulation" | "work" | "storage" | "office" | "evacuation" | "other"
  relatedZoneIds?: UUID[]
  riskSummary?: RiskSummary
}

export interface PointElement extends Element2DBase {
  kind: "point"
  name: string
  code?: string
  position: Vec2
  pointType: "equipment" | "finding" | "reference" | "sensor"
  metadata?: Record<string, unknown>
}

export type Element2D = Wall | Zone | PointElement

// Vector 2D cartesiano en unidades del plano.
export interface Vec2 {
  x: number
  y: number
}

// Hallazgo en campo asociado opcionalmente a una zona y un elemento.
export interface Finding {
  id: UUID
  planoId: UUID
  zoneId?: UUID
  elementId?: UUID
  type: FindingType
  severity: SeverityLevel
  frequency: FrequencyLevel
  description: string
  photoUrls?: string[]
  createdAt: string
  createdByUserId?: UUID
}

export type FindingType =
  | "obstruction"
  | "signage_missing"
  | "ppe_missing"
  | "fall_risk"
  | "electrical_risk"
  | "fire_risk"
  | "chemical_risk"
  | "other"

export type SeverityLevel = 1 | 2 | 3 | 4 | 5
export type FrequencyLevel = 1 | 2 | 3 | 4 | 5

// Resultado del motor de riesgo para una zona concreta.
export interface RiskSummary {
  zoneId: UUID
  index: number
  level: "low" | "medium" | "high" | "critical"
  contributingFindings: UUID[]
  lastUpdatedAt: string
}

// Riesgo agregado por plano (para dashboards).
export interface PlanoRiskAggregate {
  planoId: UUID
  averageIndex: number
  maxIndex: number
  updatedAt: string
}

// Commit tipo Git para versionado offline de planos.
export interface Commit {
  id: UUID
  planoId: UUID
  parentIds: UUID[]
  authorUserId?: UUID
  message: string
  timestamp: string
  // Diff minimal entre commits para ahorrar espacio offline.
  diff: PlanoDiff
}

// Representa los cambios en un plano entre commits.
export interface PlanoDiff {
  addedLayers?: Layer[]
  updatedLayers?: Layer[]
  removedLayerIds?: UUID[]

  addedElements?: Element2D[]
  updatedElements?: Element2D[]
  removedElementIds?: UUID[]

  addedFindings?: Finding[]
  updatedFindings?: Finding[]
  removedFindingIds?: UUID[]
}

// Snapshot completo para operaciones de sincronización o reconstrucción.
export interface PlanoSnapshot {
  plano: Plano
  findings: Finding[]
  riskAggregates?: PlanoRiskAggregate[]
}

// Estado de trabajo local en el cliente, preparado para offline-first.
export interface WorkspaceState {
  planos: Map<UUID, Plano>
  findings: Map<UUID, Finding>
  commits: Map<UUID, Commit>
  headByPlanoId: Map<UUID, UUID>
}

// Estructura mínima serializable para persistencia offline.
export interface SerializedWorkspaceState {
  planos: Plano[]
  findings: Finding[]
  commits: Commit[]
  heads: { planoId: UUID; commitId: UUID }[]
}

// Funciones utilitarias para convertir entre estado en memoria y forma serializable.
export function serializeWorkspace(state: WorkspaceState): SerializedWorkspaceState {
  return {
    planos: Array.from(state.planos.values()),
    findings: Array.from(state.findings.values()),
    commits: Array.from(state.commits.values()),
    heads: Array.from(state.headByPlanoId.entries()).map(([planoId, commitId]) => ({ planoId, commitId })),
  }
}

export function deserializeWorkspace(serialized: SerializedWorkspaceState): WorkspaceState {
  const planos = new Map<UUID, Plano>()
  for (const plano of serialized.planos) {
    planos.set(plano.id, plano)
  }
  const findings = new Map<UUID, Finding>()
  for (const f of serialized.findings) {
    findings.set(f.id, f)
  }
  const commits = new Map<UUID, Commit>()
  for (const c of serialized.commits) {
    commits.set(c.id, c)
  }
  const headByPlanoId = new Map<UUID, UUID>()
  for (const h of serialized.heads) {
    headByPlanoId.set(h.planoId, h.commitId)
  }
  return { planos, findings, commits, headByPlanoId }
}

