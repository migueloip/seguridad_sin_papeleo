import { NextResponse } from "next/server"
import { sql, clearTenantContext } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    if ((session.role || "user") !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 })
    // getSession fijó el contexto de tenant (rol authenticated). El DDL de esta
    // ruta (CREATE/ALTER/CREATE POLICY) requiere el rol dueño `postgres`, así que
    // limpiamos el contexto para correr todo como postgres.
    clearTenantContext()
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
    // --- Row Level Security ---------------------------------------------------
    // La app se conecta como `postgres` (BYPASSRLS), así que las queries con
    // contexto de tenant cambian a `SET LOCAL ROLE authenticated` (ver lib/db.ts),
    // rol que SÍ está sujeto a RLS. Por eso TODAS las políticas son TO authenticated:
    // el rol `anon` de PostgREST queda denegado (no se exponen datos por la API REST
    // de Supabase) y `postgres` sigue con bypass para el bootstrap/DDL.
    // El user_id se lee con current_setting('app.user_id') (NULLIF por el '' inicial)
    // -> sin contexto no hay filas (fail-closed para el rol authenticated).

    // Tablas de bootstrap/compartidas: RLS habilitada (protege de PostgREST anon)
    // con política permisiva solo para `authenticated`, ya que la app las consulta
    // como authenticated cuando hay contexto. La tenencia de estas la controla el
    // código (auth por token, filtros de admin).
    const bootstrapTables = [
      "users", "sessions", "notifications", "document_types",
      "checklist_categories", "checklist_templates",
    ]
    for (const t of bootstrapTables) {
      await sql.unsafe(`ALTER TABLE IF EXISTS ${t} ENABLE ROW LEVEL SECURITY`)
      // Limpia esquemas RLS previos (huérfanos) que usaban app.current_user_id.
      await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${t}`)
      await sql.unsafe(`DROP POLICY IF EXISTS self_only ON ${t}`)
      await sql.unsafe(`DROP POLICY IF EXISTS select_document_types_all ON ${t}`)
      await sql.unsafe(`DROP POLICY IF EXISTS select_document_types_anon ON ${t}`)
      await sql.unsafe(`DROP POLICY IF EXISTS app_all_${t} ON ${t}`)
      await sql.unsafe(`CREATE POLICY app_all_${t} ON ${t} FOR ALL TO authenticated USING (true) WITH CHECK (true)`)
    }

    // Tablas tenant: aislamiento por usuario impuesto por la base de datos.
    const tenantTables = [
      "projects", "plan_types", "workers", "worker_stats_daily", "documents",
      "mobile_documents", "mobile_tombstones", "findings", "completed_checklists",
      "reports", "settings", "admonitions", "plans", "plan_floors", "plan_zones",
    ]
    for (const t of tenantTables) {
      await sql.unsafe(`ALTER TABLE IF EXISTS ${t} ENABLE ROW LEVEL SECURITY`)
      // No se fuerza RLS: las queries de la app corren como `authenticated` (no es
      // dueño), así que la RLS normal aplica. NO FORCE normaliza estados previos.
      await sql.unsafe(`ALTER TABLE IF EXISTS ${t} NO FORCE ROW LEVEL SECURITY`)
      // Limpia el esquema RLS previo (huérfano) basado en app.current_user_id.
      await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${t}`)
      for (const action of ["select", "insert", "update", "delete"]) {
        await sql.unsafe(`DROP POLICY IF EXISTS ${action}_${t}_own ON ${t}`)
      }
      // settings incluye filas globales (user_id IS NULL) con los defaults, que
      // deben ser legibles por cualquier usuario. INSERT/UPDATE siguen estrictos
      // (un usuario solo escribe filas con su propio user_id).
      const visible = t === "settings"
        ? `(NULLIF(current_setting('app.user_id', true), '')::int = user_id OR user_id IS NULL)`
        : `(NULLIF(current_setting('app.user_id', true), '')::int = user_id)`
      const owned = `(NULLIF(current_setting('app.user_id', true), '')::int = user_id)`
      await sql.unsafe(`CREATE POLICY select_${t}_own ON ${t} FOR SELECT TO authenticated USING ${visible}`)
      await sql.unsafe(`CREATE POLICY insert_${t}_own ON ${t} FOR INSERT TO authenticated WITH CHECK ${owned}`)
      await sql.unsafe(`CREATE POLICY update_${t}_own ON ${t} FOR UPDATE TO authenticated USING ${visible} WITH CHECK ${owned}`)
      await sql.unsafe(`CREATE POLICY delete_${t}_own ON ${t} FOR DELETE TO authenticated USING ${visible}`)
    }

    return NextResponse.json({ ok: true, rls: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "migration error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
