/**
 * Esquema SQL del módulo Obra Integral (migración 006).
 *
 * Fuente de verdad: este archivo. `scripts/006-obra-integral.sql` es un espejo
 * generado (lo verifica lib/obra/schema.test.ts; regenerar con
 * `UPDATE_OBRA_SQL=1 npx vitest run lib/obra/schema.test.ts`).
 *
 * Todas las sentencias son idempotentes (IF NOT EXISTS) y no reciben datos de
 * usuario: los únicos valores interpolados son los catálogos constantes de
 * lib/obra/types.ts, por eso se ejecutan con sql.unsafe().
 */
import type { Sql } from "postgres"
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
} from "./types"

function inList(values: readonly string[]): string {
  for (const v of values) {
    if (!/^[a-z_]+$/.test(v)) throw new Error(`Valor de catálogo inválido para SQL: ${v}`)
  }
  return values.map((v) => `'${v}'`).join(", ")
}

export const OBRA_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS obra_members (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(30) NOT NULL CHECK (role IN (${inList(OBRA_ROLES)})),
  worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, user_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_members_user ON obra_members(user_id)`,

  `CREATE TABLE IF NOT EXISTS obra_plan_layers (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  discipline VARCHAR(30) NOT NULL CHECK (discipline IN (${inList(DISCIPLINES)})),
  level INTEGER NOT NULL DEFAULT 0,
  level_label VARCHAR(100),
  image_path TEXT,
  image_data TEXT,
  mime_type VARCHAR(100),
  width_px INTEGER,
  height_px INTEGER,
  width_m DOUBLE PRECISION NOT NULL DEFAULT 50 CHECK (width_m > 0),
  aspect DOUBLE PRECISION NOT NULL DEFAULT 0.7 CHECK (aspect > 0),
  offset_x_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  offset_y_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  rotation_deg DOUBLE PRECISION NOT NULL DEFAULT 0,
  opacity DOUBLE PRECISION NOT NULL DEFAULT 0.85 CHECK (opacity >= 0 AND opacity <= 1),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_layers_project_level ON obra_plan_layers(project_id, level) WHERE deleted_at IS NULL`,
  // Origen CAD de una capa importada de DXF ({min_x, max_y, width_units} en unidades del dibujo):
  // permite alinear sola otra capa DXF del mismo nivel y sistema de coordenadas.
  `ALTER TABLE obra_plan_layers ADD COLUMN IF NOT EXISTS cad_origin JSONB`,

  `CREATE TABLE IF NOT EXISTS obra_ai_suggestions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind VARCHAR(40) NOT NULL CHECK (kind IN (${inList(SUGGESTION_KINDS)})),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (${inList(SUGGESTION_STATUSES)})),
  title VARCHAR(255) NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  severity VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (severity IN (${inList(SEVERITIES)})),
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  generator VARCHAR(10) NOT NULL DEFAULT 'reglas' CHECK (generator IN (${inList(SUGGESTION_GENERATORS)})),
  model VARCHAR(120),
  payload JSONB NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  finding_id INTEGER REFERENCES findings(id) ON DELETE SET NULL,
  layer_id INTEGER REFERENCES obra_plan_layers(id) ON DELETE SET NULL,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  applied_entity_type VARCHAR(40),
  applied_entity_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT obra_suggestion_reviewed_by_human CHECK (status NOT IN ('approved', 'rejected') OR reviewed_at IS NOT NULL)
)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_suggestions_project_status ON obra_ai_suggestions(project_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_suggestions_finding ON obra_ai_suggestions(finding_id)`,

  `CREATE TABLE IF NOT EXISTS obra_plan_elements (
  id SERIAL PRIMARY KEY,
  layer_id INTEGER NOT NULL REFERENCES obra_plan_layers(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  element_type VARCHAR(40) NOT NULL CHECK (element_type IN (${inList(ELEMENT_TYPES)})),
  label VARCHAR(255),
  geometry JSONB NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  source VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (source IN (${inList(ELEMENT_SOURCES)})),
  confidence DOUBLE PRECISION,
  suggestion_id INTEGER REFERENCES obra_ai_suggestions(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_elements_layer ON obra_plan_elements(layer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_elements_project ON obra_plan_elements(project_id)`,

  `CREATE TABLE IF NOT EXISTS obra_finding_pins (
  finding_id INTEGER PRIMARY KEY REFERENCES findings(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  layer_id INTEGER NOT NULL REFERENCES obra_plan_layers(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  x DOUBLE PRECISION NOT NULL CHECK (x >= 0 AND x <= 1),
  y DOUBLE PRECISION NOT NULL CHECK (y >= 0 AND y <= 1),
  category VARCHAR(30) NOT NULL CHECK (category IN (${inList(FINDING_CATEGORIES)})),
  reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_pins_project_level ON obra_finding_pins(project_id, level)`,

  `CREATE TABLE IF NOT EXISTS obra_inspections (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  scheduled_for DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'programada' CHECK (status IN (${inList(INSPECTION_STATUSES)})),
  lead_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  summary TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_inspections_project ON obra_inspections(project_id, scheduled_for)`,

  `CREATE TABLE IF NOT EXISTS obra_tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority VARCHAR(10) NOT NULL DEFAULT 'media' CHECK (priority IN (${inList(PRIORITIES)})),
  status VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (status IN (${inList(TASK_STATUSES)})),
  origin VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (origin IN (${inList(TASK_ORIGINS)})),
  suggestion_id INTEGER UNIQUE REFERENCES obra_ai_suggestions(id) ON DELETE SET NULL,
  finding_id INTEGER REFERENCES findings(id) ON DELETE SET NULL,
  layer_id INTEGER REFERENCES obra_plan_layers(id) ON DELETE SET NULL,
  level INTEGER,
  x DOUBLE PRECISION CHECK (x IS NULL OR (x >= 0 AND x <= 1)),
  y DOUBLE PRECISION CHECK (y IS NULL OR (y >= 0 AND y <= 1)),
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_role VARCHAR(30) CHECK (assigned_role IS NULL OR assigned_role IN (${inList(OBRA_ROLES)})),
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  inspection_id INTEGER REFERENCES obra_inspections(id) ON DELETE SET NULL,
  due_date DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMP,
  completion_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_tasks_project_status ON obra_tasks(project_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_tasks_assigned_user ON obra_tasks(assigned_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_tasks_inspection ON obra_tasks(inspection_id)`,

  `CREATE TABLE IF NOT EXISTS obra_audit_log (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS idx_obra_audit_project ON obra_audit_log(project_id, created_at DESC)`,
]

/** Contenido del espejo scripts/006-obra-integral.sql. */
export function renderObraSchemaSql(): string {
  const header = [
    "-- ============================================================================",
    "-- Migración 006 — Obra Integral (equipo por roles, planos por especialidad,",
    "-- hallazgos geolocalizados, sugerencias de IA con aprobación humana, tareas,",
    "-- revisiones y auditoría).",
    "--",
    "-- ARCHIVO GENERADO desde lib/obra/schema.ts. No editar a mano: regenerar con",
    "--   UPDATE_OBRA_SQL=1 npx vitest run lib/obra/schema.test.ts",
    "--",
    "-- Es idempotente. La app también la aplica sola al primer uso del módulo",
    "-- (desactivable con OBRA_AUTO_MIGRATE=0) o vía POST /api/admin/migrate?scope=obra.",
    "-- ============================================================================",
    "",
  ].join("\n")
  return header + OBRA_SCHEMA_STATEMENTS.map((s) => `${s};`).join("\n\n") + "\n"
}

/** Clave del advisory lock que serializa la migración entre instancias. */
export const OBRA_MIGRATION_LOCK_KEY = 7262006

/**
 * Aplica el esquema dentro de una transacción con advisory lock (evita
 * carreras entre lambdas que arrancan a la vez).
 */
export async function applyObraSchema(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`SELECT pg_advisory_xact_lock(${OBRA_MIGRATION_LOCK_KEY})`)
    // Sin esto, cada arranque llena el log con un NOTICE "already exists, skipping" por sentencia.
    await tx.unsafe("SET LOCAL client_min_messages = warning")
    for (const stmt of OBRA_SCHEMA_STATEMENTS) {
      await tx.unsafe(stmt)
    }
  })
}
