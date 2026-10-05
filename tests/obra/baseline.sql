-- Esquema base equivalente a POST /api/admin/migrate (sin RLS/policies de Supabase).
-- Solo para tests de integración (tests/obra/*.int.test.ts). No aplicar en producción.
CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, name VARCHAR(255), password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';
CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, token VARCHAR(255) UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE TABLE IF NOT EXISTS settings (id SERIAL PRIMARY KEY, key VARCHAR(100) NOT NULL, value TEXT, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE IF EXISTS settings ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS settings DROP CONSTRAINT IF EXISTS settings_key_key;
ALTER TABLE IF EXISTS settings ADD CONSTRAINT settings_user_key UNIQUE (user_id, key);
CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, location VARCHAR(255), client VARCHAR(255), start_date DATE, end_date DATE, status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS workers (id SERIAL PRIMARY KEY, rut VARCHAR(20) UNIQUE NOT NULL, first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL, role VARCHAR(100), company VARCHAR(255), phone VARCHAR(20), email VARCHAR(255), project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS document_types (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, description TEXT, validity_days INTEGER, is_mandatory BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS documents (id SERIAL PRIMARY KEY, worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE, document_type_id INTEGER REFERENCES document_types(id) ON DELETE SET NULL, file_name VARCHAR(255) NOT NULL, file_url TEXT, issue_date DATE, expiry_date DATE, status VARCHAR(50) DEFAULT 'valid', extracted_data JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS mobile_documents (id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, title VARCHAR(255) NOT NULL, description TEXT, photos JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS checklist_categories (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS checklist_templates (id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES checklist_categories(id) ON DELETE SET NULL, name VARCHAR(255) NOT NULL, description TEXT, items JSONB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS completed_checklists (id SERIAL PRIMARY KEY, template_id INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, inspector_name VARCHAR(255), location VARCHAR(255), completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, responses JSONB NOT NULL, notes TEXT, status VARCHAR(50) DEFAULT 'completed', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS findings (id SERIAL PRIMARY KEY, checklist_id INTEGER REFERENCES completed_checklists(id) ON DELETE SET NULL, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, title VARCHAR(255) NOT NULL, description TEXT, severity VARCHAR(50) NOT NULL, location VARCHAR(255), responsible_person VARCHAR(255), due_date DATE, resolved_at TIMESTAMP, resolution_notes TEXT, photos JSONB, status VARCHAR(50) DEFAULT 'open', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reports (id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, report_type VARCHAR(50) NOT NULL, title VARCHAR(255) NOT NULL, date_from DATE, date_to DATE, content JSONB, file_url TEXT, generated_by VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, type VARCHAR(50) NOT NULL, title VARCHAR(255) NOT NULL, message TEXT, related_id INTEGER, related_type VARCHAR(50), is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS plan_types (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(100) NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS plans (id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, name VARCHAR(255) NOT NULL, plan_type VARCHAR(50) NOT NULL, file_name VARCHAR(255) NOT NULL, file_url TEXT, mime_type VARCHAR(100), extracted JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS plan_floors (id SERIAL PRIMARY KEY, plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE, name VARCHAR(100) NOT NULL, level INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS plan_zones (id SERIAL PRIMARY KEY, plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE, floor_id INTEGER REFERENCES plan_floors(id) ON DELETE SET NULL, name VARCHAR(100) NOT NULL, code VARCHAR(50), zone_type VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_workers_project ON workers(project_id);
CREATE INDEX IF NOT EXISTS idx_workers_rut ON workers(rut);
CREATE INDEX IF NOT EXISTS idx_documents_worker ON documents(worker_id);
CREATE INDEX IF NOT EXISTS idx_documents_expiry ON documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_mobile_documents_project ON mobile_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_completed_checklists_project ON completed_checklists(project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
ALTER TABLE IF EXISTS checklist_categories ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS checklist_templates ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_checklist_categories_user ON checklist_categories(user_id);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_user ON checklist_templates(user_id);
ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS workers ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS documents ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS mobile_documents ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS completed_checklists ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS reports ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS plan_types ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS plans ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS plan_floors ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS plan_zones ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_workers_user ON workers(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_mobile_documents_user ON mobile_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_findings_user ON findings(user_id);
CREATE INDEX IF NOT EXISTS idx_completed_checklists_user ON completed_checklists(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_types_user ON plan_types(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_floors_user ON plan_floors(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_zones_user ON plan_zones(user_id);
ALTER TABLE IF EXISTS plan_zones ADD COLUMN IF NOT EXISTS bounds JSONB;
ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS responsible_worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS plan_zone_id INTEGER REFERENCES plan_zones(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS related_document_type_ids JSONB;
CREATE INDEX IF NOT EXISTS idx_findings_responsible_worker ON findings(responsible_worker_id);
CREATE INDEX IF NOT EXISTS idx_findings_plan_zone ON findings(plan_zone_id);
CREATE TABLE IF NOT EXISTS admonitions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE, admonition_date DATE NOT NULL, admonition_type VARCHAR(50) NOT NULL, reason TEXT NOT NULL, supervisor_signature TEXT, attachments JSONB, status VARCHAR(50) DEFAULT 'active', approval_status VARCHAR(50) DEFAULT 'pending', approved_at TIMESTAMP, rejected_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_admonitions_user ON admonitions(user_id);
CREATE INDEX IF NOT EXISTS idx_admonitions_worker ON admonitions(worker_id);
CREATE INDEX IF NOT EXISTS idx_admonitions_type ON admonitions(admonition_type);
CREATE INDEX IF NOT EXISTS idx_admonitions_status ON admonitions(status);
CREATE INDEX IF NOT EXISTS idx_admonitions_approval ON admonitions(approval_status);
CREATE INDEX IF NOT EXISTS idx_admonitions_date ON admonitions(admonition_date);
INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'ai_provider', 'google', 'Proveedor de IA para OCR e informes'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ai_provider');
INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'ai_model', 'gemini-2.5-flash', 'Modelo de IA a usar'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ai_model');
INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'ai_api_key', '', 'API Key del proveedor de IA'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ai_api_key');
INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'ocr_method', 'tesseract', 'Metodo de OCR: tesseract o ai'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ocr_method');
INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'company_name', 'SafeWork Pro', 'Nombre de la empresa'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'company_name');
INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'company_logo', '', 'URL del logo de la empresa'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'company_logo');
