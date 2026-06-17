// Aplica la RLS efectiva (mismo DDL que app/api/admin/migrate/route.ts) contra
// la base apuntada por DATABASE_URL. Idempotente. Uso:
//   node --env-file=.env scripts/apply-rls.mjs
//
// Modelo: la app se conecta como `postgres` (BYPASSRLS) y, para las queries con
// contexto de tenant, hace SET LOCAL ROLE authenticated (rol sujeto a RLS).
// Por eso las políticas son TO authenticated y leen current_setting('app.user_id').
import postgres from "postgres"

let dbUrl = process.env.DATABASE_URL || process.env.DIRECT_URL || ""
try {
  const u = new URL(dbUrl)
  const h = u.hostname.toLowerCase()
  const isSupabaseDbHost = h.startsWith("db.") && h.endsWith(".supabase.co")
  const isSupabasePoolerHost = h.endsWith(".pooler.supabase.com")
  if ((isSupabaseDbHost || isSupabasePoolerHost) && !u.searchParams.get("sslmode")) {
    u.searchParams.set("sslmode", "require")
  }
  if (isSupabasePoolerHost && u.port !== "6543") u.port = "6543"
  dbUrl = u.toString()
} catch {}

const sql = postgres(dbUrl, {
  max: 1,
  connect_timeout: 10,
  ssl: dbUrl.includes("supabase") ? "require" : undefined,
})

const bootstrapTables = [
  "users", "sessions", "notifications", "document_types",
  "checklist_categories", "checklist_templates",
]
const tenantTables = [
  "projects", "plan_types", "workers", "worker_stats_daily", "documents",
  "mobile_documents", "mobile_tombstones", "findings", "completed_checklists",
  "reports", "settings", "admonitions", "plans", "plan_floors", "plan_zones",
]

try {
  for (const t of bootstrapTables) {
    await sql.unsafe(`ALTER TABLE IF EXISTS ${t} ENABLE ROW LEVEL SECURITY`)
    await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${t}`)
    await sql.unsafe(`DROP POLICY IF EXISTS self_only ON ${t}`)
    await sql.unsafe(`DROP POLICY IF EXISTS select_document_types_all ON ${t}`)
    await sql.unsafe(`DROP POLICY IF EXISTS select_document_types_anon ON ${t}`)
    await sql.unsafe(`DROP POLICY IF EXISTS app_all_${t} ON ${t}`)
    await sql.unsafe(`CREATE POLICY app_all_${t} ON ${t} FOR ALL TO authenticated USING (true) WITH CHECK (true)`)
  }
  console.log("bootstrap: ENABLE + política app_all TO authenticated ->", bootstrapTables.join(", "))

  for (const t of tenantTables) {
    await sql.unsafe(`ALTER TABLE IF EXISTS ${t} ENABLE ROW LEVEL SECURITY`)
    await sql.unsafe(`ALTER TABLE IF EXISTS ${t} NO FORCE ROW LEVEL SECURITY`)
    await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${t}`)
    for (const action of ["select", "insert", "update", "delete"]) {
      await sql.unsafe(`DROP POLICY IF EXISTS ${action}_${t}_own ON ${t}`)
    }
    const visible = t === "settings"
      ? `(NULLIF(current_setting('app.user_id', true), '')::int = user_id OR user_id IS NULL)`
      : `(NULLIF(current_setting('app.user_id', true), '')::int = user_id)`
    const owned = `(NULLIF(current_setting('app.user_id', true), '')::int = user_id)`
    await sql.unsafe(`CREATE POLICY select_${t}_own ON ${t} FOR SELECT TO authenticated USING ${visible}`)
    await sql.unsafe(`CREATE POLICY insert_${t}_own ON ${t} FOR INSERT TO authenticated WITH CHECK ${owned}`)
    await sql.unsafe(`CREATE POLICY update_${t}_own ON ${t} FOR UPDATE TO authenticated USING ${visible} WITH CHECK ${owned}`)
    await sql.unsafe(`CREATE POLICY delete_${t}_own ON ${t} FOR DELETE TO authenticated USING ${visible}`)
    console.log(`tenant: ENABLE + 4 políticas TO authenticated -> ${t}`)
  }

  console.log("\nRLS_APPLIED_OK")
} catch (e) {
  console.log("RLS_APPLY_ERR", e?.code || "", e?.message || String(e))
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
