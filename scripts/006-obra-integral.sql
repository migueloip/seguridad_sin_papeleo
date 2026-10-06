-- ============================================================================
-- Migración 006 — Obra Integral (equipo por roles, planos por especialidad,
-- hallazgos geolocalizados, sugerencias de IA con aprobación humana, tareas,
-- revisiones y auditoría).
--
-- ARCHIVO GENERADO desde lib/obra/schema.ts. No editar a mano: regenerar con
--   UPDATE_OBRA_SQL=1 npx vitest run lib/obra/schema.test.ts
--
-- Es idempotente. La app también la aplica sola al primer uso del módulo
-- (desactivable con OBRA_AUTO_MIGRATE=0) o vía POST /api/admin/migrate?scope=obra.
-- ============================================================================
CREATE TABLE IF NOT EXISTS obra_members (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(30) NOT NULL CHECK (role IN ('gerente', 'jefe_obra', 'prevencionista', 'supervisor', 'trabajador', 'visita')),
  worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_obra_members_user ON obra_members(user_id);

CREATE TABLE IF NOT EXISTS obra_plan_layers (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  discipline VARCHAR(30) NOT NULL CHECK (discipline IN ('arquitectura', 'estructura', 'alcantarillado', 'agua_potable', 'aguas_lluvia', 'electrico', 'gas', 'climatizacion', 'incendio', 'otro')),
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
);

CREATE INDEX IF NOT EXISTS idx_obra_layers_project_level ON obra_plan_layers(project_id, level) WHERE deleted_at IS NULL;

ALTER TABLE obra_plan_layers ADD COLUMN IF NOT EXISTS cad_origin JSONB;

CREATE TABLE IF NOT EXISTS obra_ai_suggestions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind VARCHAR(40) NOT NULL CHECK (kind IN ('create_task', 'plan_elements', 'update_finding_severity')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  title VARCHAR(255) NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  severity VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  generator VARCHAR(10) NOT NULL DEFAULT 'reglas' CHECK (generator IN ('ia', 'reglas')),
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
);

CREATE INDEX IF NOT EXISTS idx_obra_suggestions_project_status ON obra_ai_suggestions(project_id, status);

CREATE INDEX IF NOT EXISTS idx_obra_suggestions_finding ON obra_ai_suggestions(finding_id);

CREATE TABLE IF NOT EXISTS obra_plan_elements (
  id SERIAL PRIMARY KEY,
  layer_id INTEGER NOT NULL REFERENCES obra_plan_layers(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  element_type VARCHAR(40) NOT NULL CHECK (element_type IN ('muro', 'muro_carga', 'columna', 'viga', 'losa', 'fundacion', 'tuberia_alcantarillado', 'camara_inspeccion', 'tuberia_agua', 'tuberia_aguas_lluvia', 'ducto_electrico', 'tablero_electrico', 'linea_gas', 'medidor_gas', 'ducto_clima', 'red_incendio', 'excavacion', 'otro')),
  label VARCHAR(255),
  geometry JSONB NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  source VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ia', 'dxf')),
  confidence DOUBLE PRECISION,
  suggestion_id INTEGER REFERENCES obra_ai_suggestions(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_obra_elements_layer ON obra_plan_elements(layer_id);

CREATE INDEX IF NOT EXISTS idx_obra_elements_project ON obra_plan_elements(project_id);

CREATE TABLE IF NOT EXISTS obra_finding_pins (
  finding_id INTEGER PRIMARY KEY REFERENCES findings(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  layer_id INTEGER NOT NULL REFERENCES obra_plan_layers(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  x DOUBLE PRECISION NOT NULL CHECK (x >= 0 AND x <= 1),
  y DOUBLE PRECISION NOT NULL CHECK (y >= 0 AND y <= 1),
  category VARCHAR(30) NOT NULL CHECK (category IN ('grieta', 'humedad_filtracion', 'hundimiento', 'olor_gas', 'falla_electrica', 'corrosion', 'desprendimiento', 'obstruccion', 'excavacion', 'otro')),
  reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_obra_pins_project_level ON obra_finding_pins(project_id, level);

CREATE TABLE IF NOT EXISTS obra_inspections (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  scheduled_for DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'programada' CHECK (status IN ('programada', 'en_curso', 'cerrada')),
  lead_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  summary TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_obra_inspections_project ON obra_inspections(project_id, scheduled_for);

CREATE TABLE IF NOT EXISTS obra_tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority VARCHAR(10) NOT NULL DEFAULT 'media' CHECK (priority IN ('baja', 'media', 'alta', 'critica')),
  status VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'en_progreso', 'hecha', 'cancelada')),
  origin VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'ia', 'reglas', 'hallazgo')),
  suggestion_id INTEGER UNIQUE REFERENCES obra_ai_suggestions(id) ON DELETE SET NULL,
  finding_id INTEGER REFERENCES findings(id) ON DELETE SET NULL,
  layer_id INTEGER REFERENCES obra_plan_layers(id) ON DELETE SET NULL,
  level INTEGER,
  x DOUBLE PRECISION CHECK (x IS NULL OR (x >= 0 AND x <= 1)),
  y DOUBLE PRECISION CHECK (y IS NULL OR (y >= 0 AND y <= 1)),
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_role VARCHAR(30) CHECK (assigned_role IS NULL OR assigned_role IN ('gerente', 'jefe_obra', 'prevencionista', 'supervisor', 'trabajador', 'visita')),
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  inspection_id INTEGER REFERENCES obra_inspections(id) ON DELETE SET NULL,
  due_date DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMP,
  completion_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_obra_tasks_project_status ON obra_tasks(project_id, status);

CREATE INDEX IF NOT EXISTS idx_obra_tasks_assigned_user ON obra_tasks(assigned_user_id);

CREATE INDEX IF NOT EXISTS idx_obra_tasks_inspection ON obra_tasks(inspection_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'obra_tasks_origin_check' AND c.conrelid = 'obra_tasks'::regclass AND pg_get_constraintdef(c.oid) LIKE '%''manual''%' AND pg_get_constraintdef(c.oid) LIKE '%''ia''%' AND pg_get_constraintdef(c.oid) LIKE '%''reglas''%' AND pg_get_constraintdef(c.oid) LIKE '%''hallazgo''%'
  ) THEN
    ALTER TABLE obra_tasks DROP CONSTRAINT IF EXISTS obra_tasks_origin_check;
    ALTER TABLE obra_tasks ADD CONSTRAINT obra_tasks_origin_check CHECK (origin IN ('manual', 'ia', 'reglas', 'hallazgo'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS obra_invitations (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(30) NOT NULL CHECK (role IN ('gerente', 'jefe_obra', 'prevencionista', 'supervisor', 'trabajador', 'visita')),
  worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP,
  accepted_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMP,
  CONSTRAINT obra_invitation_single_outcome CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_obra_invitations_project ON obra_invitations(project_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_obra_invitations_open ON obra_invitations(project_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS obra_audit_log (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_obra_audit_project ON obra_audit_log(project_id, created_at DESC);
