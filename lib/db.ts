import postgres from "postgres"
import { AsyncLocalStorage } from "node:async_hooks"

const databaseUrlRaw = process.env.DATABASE_URL || ""
const directUrlRaw = process.env.DIRECT_URL || ""
let dbUrl = databaseUrlRaw || directUrlRaw || "postgresql://postgres:postgres@localhost:5432/ssp?schema=public"

// Configure Supabase connection parameters
try {
  const u = new URL(dbUrl)
  const h = u.hostname.toLowerCase()
  const isSupabaseDbHost = h.startsWith("db.") && h.endsWith(".supabase.co")
  const isSupabasePoolerHost = h.endsWith(".pooler.supabase.com")
  const port = u.port || ""
  if ((isSupabaseDbHost || isSupabasePoolerHost) && !u.searchParams.get("sslmode")) {
    u.searchParams.set("sslmode", "require")
  }
  if (isSupabasePoolerHost && port !== "6543") {
    u.port = "6543"
  }
  dbUrl = u.toString()
} catch { }

// Create postgres connection with connection pooling
const client = postgres(dbUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: dbUrl.includes("supabase") ? "require" : undefined,
})

/**
 * Contexto de tenant por-request. La capa de auth (lib/auth.ts y
 * lib/mobile-auth.ts) fija el user_id con `tenantContext.enterWith({ userId })`
 * una vez resuelta la sesión; las políticas RLS lo leen vía
 * `current_setting('app.user_id')`. Ver scripts de RLS en
 * app/api/admin/migrate/route.ts.
 */
export const tenantContext = new AsyncLocalStorage<{ userId: number } | undefined>()

function isTemplateCall(args: unknown[]): args is [TemplateStringsArray, ...unknown[]] {
  const first = args[0] as { raw?: unknown } | undefined
  return Array.isArray(first) && first != null && "raw" in (first as object)
}

// DDL (CREATE/ALTER/DROP/...) debe correr como el dueño `postgres`, no como
// `authenticated` (que no tiene permisos de esquema). Varias acciones hacen
// "ensure schema" (CREATE TABLE/INDEX IF NOT EXISTS, ALTER ... ADD COLUMN)
// después de resolver la sesión, así que detectamos DDL y lo dejamos pasar como
// postgres aunque haya contexto de tenant.
const DDL_RE = /^[\s(]*(create|alter|drop|truncate|grant|revoke|comment)\s/i

/**
 * Wrapper sobre el cliente porsager. Cuando hay contexto de tenant, cada query
 * tagged-template (que no sea DDL) se ejecuta dentro de una micro-transacción que:
 *   1. cambia el rol a `authenticated` (SET LOCAL ROLE) — el rol dueño `postgres`
 *      de Supabase tiene BYPASSRLS, así que las políticas NO le aplican; en cambio
 *      `authenticated` (del que `postgres` es miembro) sí está sujeto a RLS;
 *   2. fija `app.user_id` (set_config local a la transacción — seguro con el pool);
 *   3. corre la query, ya filtrada por la RLS.
 * Ambos cambios son LOCAL a la transacción, así que la conexión vuelve a `postgres`
 * al hacer COMMIT (seguro con el pool). Sin contexto (bootstrap de auth: login,
 * getSession) o si es DDL, la query corre directa como `postgres`. Es transparente
 * para los call sites: la firma y los métodos (`.json`, etc.) son los del cliente real.
 */
const sql: typeof client = new Proxy(client, {
  apply(target, _thisArg, args: unknown[]) {
    const direct = () => (target as unknown as (...a: unknown[]) => unknown)(...args)
    const ctx = tenantContext.getStore()
    if (!ctx || !isTemplateCall(args)) return direct()
    const [strings, ...values] = args
    if (DDL_RE.test(strings[0] ?? "")) return direct()
    return client.begin(async (tx) => {
      const run = tx as unknown as (...a: unknown[]) => Promise<unknown>
      await run`SET LOCAL ROLE authenticated`
      await run`SELECT set_config('app.user_id', ${String(ctx.userId)}, true)`
      return run(strings, ...values)
    })
  },
})

export { sql }

/**
 * Limpia el contexto de tenant para el resto del request: las queries volverán a
 * correr como `postgres` (con BYPASSRLS y permisos de DDL). Lo usa el endpoint de
 * migración, que ejecuta DDL (CREATE/ALTER/CREATE POLICY) que `authenticated` no
 * puede ejecutar.
 */
export function clearTenantContext(): void {
  tenantContext.enterWith(undefined)
}

/**
 * Ejecuta `fn` con el contexto de tenant fijado. Útil para rutas o tests que no
 * pasan por la cookie de sesión. En el flujo normal el contexto se fija con
 * `enterWith` en la capa de auth, así que no hace falta envolver cada acción.
 */
export function runAsUser<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ userId }, fn)
}

// Types
export interface Project {
  id: number
  user_id: number
  name: string
  location: string | null
  client: string | null
  start_date: string | null
  end_date: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface Worker {
  id: number
  user_id: number
  rut: string
  first_name: string
  last_name: string
  role: string | null
  company: string | null
  phone: string | null
  email: string | null
  project_id: number | null
  status: string
  created_at: string
  updated_at: string
}

export interface DocumentType {
  id: number
  name: string
  description: string | null
  validity_days: number | null
  is_mandatory: boolean
  created_at: string
}

export interface Document {
  id: number
  user_id: number
  worker_id: number
  document_type_id: number | null
  file_name: string
  file_url: string | null
  issue_date: string | null
  expiry_date: string | null
  status: string
  extracted_data: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface PlanType {
  id: number
  user_id: number
  name: string
  description: string | null
  created_at: string
}

export interface ChecklistCategory {
  id: number
  name: string
  description: string | null
  created_at: string
}

export interface ChecklistTemplate {
  id: number
  category_id: number | null
  name: string
  description: string | null
  items: ChecklistItem[]
  created_at: string
  updated_at: string
}

export interface ChecklistItem {
  id: number
  text: string
  category: string
}

export interface CompletedChecklist {
  id: number
  user_id: number
  template_id: number | null
  project_id: number | null
  inspector_name: string | null
  location: string | null
  completed_at: string
  responses: Record<string, boolean | string>
  notes: string | null
  status: string
  created_at: string
}

export interface Finding {
  id: number
  user_id: number
  checklist_id: number | null
  project_id: number | null
  title: string
  description: string | null
  severity: "low" | "medium" | "high" | "critical"
  location: string | null
  responsible_person: string | null
  due_date: string | null
  resolved_at: string | null
  resolution_notes: string | null
  photos: string[] | null
  status: "open" | "in_progress" | "resolved" | "closed"
  created_at: string
  updated_at: string
}

export interface Report {
  id: number
  user_id: number
  project_id: number | null
  report_type: string
  title: string
  date_from: string | null
  date_to: string | null
  content: Record<string, unknown> | null
  file_url: string | null
  generated_by: string | null
  created_at: string
}

export interface Notification {
  id: number
  type: string
  title: string
  message: string | null
  related_id: number | null
  related_type: string | null
  is_read: boolean
  created_at: string
}

export interface User {
  id: number
  email: string
  name: string | null
  password_hash: string
  role: string
  created_at: string
}

export interface Session {
  id: number
  user_id: number
  token: string
  created_at: string
  expires_at: string
}

export interface Plan {
  id: number
  user_id: number
  project_id: number | null
  name: string
  plan_type: string
  file_name: string
  file_url: string | null
  mime_type: string | null
  extracted: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface PlanFloor {
  id: number
  user_id: number
  plan_id: number
  name: string
  level: number | null
  created_at: string
}

export interface PlanZone {
  id: number
  user_id: number
  plan_id: number
  floor_id: number | null
  name: string
  code: string | null
  zone_type: string | null
  created_at: string
}

export interface AdmonitionAttachment {
  file_name: string
  file_url: string | null
  mime?: string | null
}

export interface Admonition {
  id: number
  user_id: number
  worker_id: number
  admonition_date: string
  admonition_type: "verbal" | "escrita" | "suspension"
  reason: string
  supervisor_signature: string | null
  attachments: AdmonitionAttachment[] | null
  status: "active" | "archived" | "archivada"
  approval_status: "pending" | "approved" | "rejected"
  approved_at: string | null
  rejected_at: string | null
  created_at: string
  updated_at: string
}
