import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function POST() {
  try {
    await sql`CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, location VARCHAR(255), client VARCHAR(255), start_date DATE, end_date DATE, status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS workers (id SERIAL PRIMARY KEY, rut VARCHAR(20) UNIQUE NOT NULL, first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL, role VARCHAR(100), company VARCHAR(255), phone VARCHAR(20), email VARCHAR(255), project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS document_types (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, description TEXT, validity_days INTEGER, is_mandatory BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS documents (id SERIAL PRIMARY KEY, worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE, document_type_id INTEGER REFERENCES document_types(id) ON DELETE SET NULL, file_name VARCHAR(255) NOT NULL, file_url TEXT, issue_date DATE, expiry_date DATE, status VARCHAR(50) DEFAULT 'valid', extracted_data JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS checklist_categories (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS checklist_templates (id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES checklist_categories(id) ON DELETE SET NULL, name VARCHAR(255) NOT NULL, description TEXT, items JSONB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS completed_checklists (id SERIAL PRIMARY KEY, template_id INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, inspector_name VARCHAR(255), location VARCHAR(255), completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, responses JSONB NOT NULL, notes TEXT, status VARCHAR(50) DEFAULT 'completed', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS findings (id SERIAL PRIMARY KEY, checklist_id INTEGER REFERENCES completed_checklists(id) ON DELETE SET NULL, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, title VARCHAR(255) NOT NULL, description TEXT, severity VARCHAR(50) NOT NULL, location VARCHAR(255), responsible_person VARCHAR(255), due_date DATE, resolved_at TIMESTAMP, resolution_notes TEXT, photos JSONB, status VARCHAR(50) DEFAULT 'open', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS reports (id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, report_type VARCHAR(50) NOT NULL, title VARCHAR(255) NOT NULL, date_from DATE, date_to DATE, content JSONB, file_url TEXT, generated_by VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, type VARCHAR(50) NOT NULL, title VARCHAR(255) NOT NULL, message TEXT, related_id INTEGER, related_type VARCHAR(50), is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE INDEX IF NOT EXISTS idx_workers_project ON workers(project_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_workers_rut ON workers(rut)`
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_worker ON documents(worker_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_expiry ON documents(expiry_date)`
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity)`
    await sql`CREATE INDEX IF NOT EXISTS idx_completed_checklists_project ON completed_checklists(project_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read)`
    await sql`ALTER TABLE IF EXISTS checklist_categories ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS checklist_templates ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`CREATE INDEX IF NOT EXISTS idx_checklist_categories_user ON checklist_categories(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_checklist_templates_user ON checklist_templates(user_id)`
    await sql`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, name VARCHAR(255), password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, token VARCHAR(255) UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP NOT NULL)`
    await sql`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`
    await sql`ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS workers ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS documents ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS completed_checklists ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`ALTER TABLE IF EXISTS reports ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`
    await sql`CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_workers_user ON workers(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_findings_user ON findings(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_completed_checklists_user ON completed_checklists(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id)`
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "migration error" }, { status: 500 })
  }
}
