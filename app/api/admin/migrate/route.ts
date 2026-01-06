import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    if ((session.role || "user") !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 })
    const url = new URL(req.url)
    const scope = url.searchParams.get("scope")
    if (scope === "admonitions") {
      await sql`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, name VARCHAR(255), password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
      await sql`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user'`
      await sql`CREATE TABLE IF NOT EXISTS workers (id SERIAL PRIMARY KEY, rut VARCHAR(20) UNIQUE NOT NULL, first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL, role VARCHAR(100), company VARCHAR(255), phone VARCHAR(20), email VARCHAR(255), project_id INTEGER, status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
      await sql`CREATE TABLE IF NOT EXISTS admonitions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE, admonition_date DATE NOT NULL, admonition_type VARCHAR(50) NOT NULL, reason TEXT NOT NULL, supervisor_signature TEXT, attachments JSONB, status VARCHAR(50) DEFAULT 'active', approval_status VARCHAR(50) DEFAULT 'pending', approved_at TIMESTAMP, rejected_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
      await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_user ON admonitions(user_id)`
      await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_worker ON admonitions(worker_id)`
      await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_type ON admonitions(admonition_type)`
      await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_status ON admonitions(status)`
      await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_approval ON admonitions(approval_status)`
      await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_date ON admonitions(admonition_date)`
      return NextResponse.json({ ok: true })
    }
    await sql`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, name VARCHAR(255), password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user'`
    await sql`CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, token VARCHAR(255) UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP NOT NULL)`
    await sql`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`
    await sql`CREATE TABLE IF NOT EXISTS settings (id SERIAL PRIMARY KEY, key VARCHAR(100) NOT NULL, value TEXT, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`ALTER TABLE IF EXISTS settings ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS settings DROP CONSTRAINT IF EXISTS settings_key_key`
    await sql`ALTER TABLE IF EXISTS settings ADD CONSTRAINT settings_user_key UNIQUE (user_id, key)`
    await sql`CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, location VARCHAR(255), client VARCHAR(255), start_date DATE, end_date DATE, status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS workers (id SERIAL PRIMARY KEY, rut VARCHAR(20) UNIQUE NOT NULL, first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL, role VARCHAR(100), company VARCHAR(255), phone VARCHAR(20), email VARCHAR(255), project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS document_types (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, description TEXT, validity_days INTEGER, is_mandatory BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS documents (id SERIAL PRIMARY KEY, worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE, document_type_id INTEGER REFERENCES document_types(id) ON DELETE SET NULL, file_name VARCHAR(255) NOT NULL, file_url TEXT, issue_date DATE, expiry_date DATE, status VARCHAR(50) DEFAULT 'valid', extracted_data JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS mobile_documents (id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, title VARCHAR(255) NOT NULL, description TEXT, photos JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS checklist_categories (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS checklist_templates (id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES checklist_categories(id) ON DELETE SET NULL, name VARCHAR(255) NOT NULL, description TEXT, items JSONB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS completed_checklists (id SERIAL PRIMARY KEY, template_id INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, inspector_name VARCHAR(255), location VARCHAR(255), completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, responses JSONB NOT NULL, notes TEXT, status VARCHAR(50) DEFAULT 'completed', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS findings (id SERIAL PRIMARY KEY, checklist_id INTEGER REFERENCES completed_checklists(id) ON DELETE SET NULL, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, title VARCHAR(255) NOT NULL, description TEXT, severity VARCHAR(50) NOT NULL, location VARCHAR(255), responsible_person VARCHAR(255), due_date DATE, resolved_at TIMESTAMP, resolution_notes TEXT, photos JSONB, status VARCHAR(50) DEFAULT 'open', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS reports (id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, report_type VARCHAR(50) NOT NULL, title VARCHAR(255) NOT NULL, date_from DATE, date_to DATE, content JSONB, file_url TEXT, generated_by VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, type VARCHAR(50) NOT NULL, title VARCHAR(255) NOT NULL, message TEXT, related_id INTEGER, related_type VARCHAR(50), is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS plan_types (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(100) NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS plans (id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, name VARCHAR(255) NOT NULL, plan_type VARCHAR(50) NOT NULL, file_name VARCHAR(255) NOT NULL, file_url TEXT, mime_type VARCHAR(100), extracted JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS plan_floors (id SERIAL PRIMARY KEY, plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE, name VARCHAR(100) NOT NULL, level INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS plan_zones (id SERIAL PRIMARY KEY, plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE, floor_id INTEGER REFERENCES plan_floors(id) ON DELETE SET NULL, name VARCHAR(100) NOT NULL, code VARCHAR(50), zone_type VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE INDEX IF NOT EXISTS idx_workers_project ON workers(project_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_workers_rut ON workers(rut)`
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_worker ON documents(worker_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_expiry ON documents(expiry_date)`
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_mobile_documents_project ON mobile_documents(project_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity)`
    await sql`CREATE INDEX IF NOT EXISTS idx_completed_checklists_project ON completed_checklists(project_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read)`
    await sql`ALTER TABLE IF EXISTS checklist_categories ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS checklist_templates ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`CREATE INDEX IF NOT EXISTS idx_checklist_categories_user ON checklist_categories(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_checklist_templates_user ON checklist_templates(user_id)`
    await sql`ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS workers ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS documents ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS mobile_documents ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS completed_checklists ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS reports ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS plan_types ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS plans ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS plan_floors ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS plan_zones ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_workers_user ON workers(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_mobile_documents_user ON mobile_documents(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_findings_user ON findings(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_completed_checklists_user ON completed_checklists(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_plan_types_user ON plan_types(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_plan_floors_user ON plan_floors(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_plan_zones_user ON plan_zones(user_id)`
    await sql`ALTER TABLE IF EXISTS plan_zones ADD COLUMN IF NOT EXISTS bounds JSONB`
    await sql`ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS responsible_worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL`
    await sql`ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS plan_zone_id INTEGER REFERENCES plan_zones(id) ON DELETE SET NULL`
    await sql`ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS related_document_type_ids JSONB`
    await sql`CREATE INDEX IF NOT EXISTS idx_findings_responsible_worker ON findings(responsible_worker_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_findings_plan_zone ON findings(plan_zone_id)`
    await sql`CREATE TABLE IF NOT EXISTS admonitions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE, admonition_date DATE NOT NULL, admonition_type VARCHAR(50) NOT NULL, reason TEXT NOT NULL, supervisor_signature TEXT, attachments JSONB, status VARCHAR(50) DEFAULT 'active', approval_status VARCHAR(50) DEFAULT 'pending', approved_at TIMESTAMP, rejected_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_user ON admonitions(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_worker ON admonitions(worker_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_type ON admonitions(admonition_type)`
    await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_status ON admonitions(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_approval ON admonitions(approval_status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_date ON admonitions(admonition_date)`
    await sql`INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'ai_provider', 'google', 'Proveedor de IA para OCR e informes'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ai_provider')`
    await sql`INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'ai_model', 'gemini-2.5-flash', 'Modelo de IA a usar'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ai_model')`
    await sql`INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'ai_api_key', '', 'API Key del proveedor de IA'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ai_api_key')`
    await sql`INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'ocr_method', 'tesseract', 'Metodo de OCR: tesseract o ai'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ocr_method')`
    await sql`INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'company_name', 'SafeWork Pro', 'Nombre de la empresa'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'company_name')`
    await sql`INSERT INTO settings (user_id, key, value, description)
      SELECT NULL, 'company_logo', '', 'URL del logo de la empresa'
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'company_logo')`
    const workers = await sql<{ id: number; rut: string | null }>`SELECT id, rut FROM workers WHERE rut IS NOT NULL`
    for (const w of workers) {
      const cleaned = String(w.rut || "")
      const body = cleaned.replace(/[^0-9kK]/gi, "").slice(0, -1).toUpperCase()
      const dv = cleaned.replace(/[^0-9kK]/gi, "").slice(-1).toUpperCase()
      if (!body || !dv) continue
      const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
      const formatted = `${withDots}-${dv}`
      await sql`UPDATE workers SET rut = ${formatted} WHERE id = ${w.id}`
    }
    await sql`ALTER TABLE users ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE sessions ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE notifications ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE document_types ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE checklist_categories ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE projects ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE workers ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE documents ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE mobile_documents ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE findings ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE completed_checklists ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE reports ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE settings ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE admonitions ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE plan_types ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE plans ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE plan_floors ENABLE ROW LEVEL SECURITY`
    await sql`ALTER TABLE plan_zones ENABLE ROW LEVEL SECURITY`

    await sql`DROP POLICY IF EXISTS select_document_types_all ON document_types`
    await sql`DROP POLICY IF EXISTS select_document_types_anon ON document_types`
    await sql`CREATE POLICY select_document_types_all ON document_types FOR SELECT TO authenticated USING (true)`
    await sql`CREATE POLICY select_document_types_anon ON document_types FOR SELECT TO anon USING (true)`

    await sql`DROP POLICY IF EXISTS select_projects_own ON projects`
    await sql`DROP POLICY IF EXISTS insert_projects_own ON projects`
    await sql`DROP POLICY IF EXISTS update_projects_own ON projects`
    await sql`DROP POLICY IF EXISTS delete_projects_own ON projects`
    await sql`CREATE POLICY select_projects_own ON projects FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_projects_own ON projects FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_projects_own ON projects FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_projects_own ON projects FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_plan_types_own ON plan_types`
    await sql`DROP POLICY IF EXISTS insert_plan_types_own ON plan_types`
    await sql`DROP POLICY IF EXISTS update_plan_types_own ON plan_types`
    await sql`DROP POLICY IF EXISTS delete_plan_types_own ON plan_types`
    await sql`CREATE POLICY select_plan_types_own ON plan_types FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_plan_types_own ON plan_types FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_plan_types_own ON plan_types FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_plan_types_own ON plan_types FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_workers_own ON workers`
    await sql`DROP POLICY IF EXISTS insert_workers_own ON workers`
    await sql`DROP POLICY IF EXISTS update_workers_own ON workers`
    await sql`DROP POLICY IF EXISTS delete_workers_own ON workers`
    await sql`CREATE POLICY select_workers_own ON workers FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_workers_own ON workers FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_workers_own ON workers FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_workers_own ON workers FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_documents_own ON documents`
    await sql`DROP POLICY IF EXISTS insert_documents_own ON documents`
    await sql`DROP POLICY IF EXISTS update_documents_own ON documents`
    await sql`DROP POLICY IF EXISTS delete_documents_own ON documents`
    await sql`CREATE POLICY select_documents_own ON documents FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_documents_own ON documents FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_documents_own ON documents FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_documents_own ON documents FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_mobile_documents_own ON mobile_documents`
    await sql`DROP POLICY IF EXISTS insert_mobile_documents_own ON mobile_documents`
    await sql`DROP POLICY IF EXISTS update_mobile_documents_own ON mobile_documents`
    await sql`DROP POLICY IF EXISTS delete_mobile_documents_own ON mobile_documents`
    await sql`CREATE POLICY select_mobile_documents_own ON mobile_documents FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_mobile_documents_own ON mobile_documents FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_mobile_documents_own ON mobile_documents FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_mobile_documents_own ON mobile_documents FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_findings_own ON findings`
    await sql`DROP POLICY IF EXISTS insert_findings_own ON findings`
    await sql`DROP POLICY IF EXISTS update_findings_own ON findings`
    await sql`DROP POLICY IF EXISTS delete_findings_own ON findings`
    await sql`CREATE POLICY select_findings_own ON findings FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_findings_own ON findings FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_findings_own ON findings FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_findings_own ON findings FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_completed_checklists_own ON completed_checklists`
    await sql`DROP POLICY IF EXISTS insert_completed_checklists_own ON completed_checklists`
    await sql`DROP POLICY IF EXISTS update_completed_checklists_own ON completed_checklists`
    await sql`DROP POLICY IF EXISTS delete_completed_checklists_own ON completed_checklists`
    await sql`CREATE POLICY select_completed_checklists_own ON completed_checklists FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_completed_checklists_own ON completed_checklists FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_completed_checklists_own ON completed_checklists FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_completed_checklists_own ON completed_checklists FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_reports_own ON reports`
    await sql`DROP POLICY IF EXISTS insert_reports_own ON reports`
    await sql`DROP POLICY IF EXISTS update_reports_own ON reports`
    await sql`DROP POLICY IF EXISTS delete_reports_own ON reports`
    await sql`CREATE POLICY select_reports_own ON reports FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_reports_own ON reports FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_reports_own ON reports FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_reports_own ON reports FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_settings_own ON settings`
    await sql`DROP POLICY IF EXISTS insert_settings_own ON settings`
    await sql`DROP POLICY IF EXISTS update_settings_own ON settings`
    await sql`DROP POLICY IF EXISTS delete_settings_own ON settings`
    await sql`CREATE POLICY select_settings_own ON settings FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_settings_own ON settings FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_settings_own ON settings FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_settings_own ON settings FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_admonitions_own ON admonitions`
    await sql`DROP POLICY IF EXISTS insert_admonitions_own ON admonitions`
    await sql`DROP POLICY IF EXISTS update_admonitions_own ON admonitions`
    await sql`DROP POLICY IF EXISTS delete_admonitions_own ON admonitions`
    await sql`CREATE POLICY select_admonitions_own ON admonitions FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_admonitions_own ON admonitions FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_admonitions_own ON admonitions FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_admonitions_own ON admonitions FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_plans_own ON plans`
    await sql`DROP POLICY IF EXISTS insert_plans_own ON plans`
    await sql`DROP POLICY IF EXISTS update_plans_own ON plans`
    await sql`DROP POLICY IF EXISTS delete_plans_own ON plans`
    await sql`CREATE POLICY select_plans_own ON plans FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_plans_own ON plans FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_plans_own ON plans FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_plans_own ON plans FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_plan_floors_own ON plan_floors`
    await sql`DROP POLICY IF EXISTS insert_plan_floors_own ON plan_floors`
    await sql`DROP POLICY IF EXISTS update_plan_floors_own ON plan_floors`
    await sql`DROP POLICY IF EXISTS delete_plan_floors_own ON plan_floors`
    await sql`CREATE POLICY select_plan_floors_own ON plan_floors FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_plan_floors_own ON plan_floors FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_plan_floors_own ON plan_floors FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_plan_floors_own ON plan_floors FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    await sql`DROP POLICY IF EXISTS select_plan_zones_own ON plan_zones`
    await sql`DROP POLICY IF EXISTS insert_plan_zones_own ON plan_zones`
    await sql`DROP POLICY IF EXISTS update_plan_zones_own ON plan_zones`
    await sql`DROP POLICY IF EXISTS delete_plan_zones_own ON plan_zones`
    await sql`CREATE POLICY select_plan_zones_own ON plan_zones FOR SELECT TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY insert_plan_zones_own ON plan_zones FOR INSERT TO authenticated WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY update_plan_zones_own ON plan_zones FOR UPDATE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id) WITH CHECK ((auth.jwt()->>'user_id')::int = user_id)`
    await sql`CREATE POLICY delete_plan_zones_own ON plan_zones FOR DELETE TO authenticated USING ((auth.jwt()->>'user_id')::int = user_id)`

    return NextResponse.json({ ok: true, rls: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "migration error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
