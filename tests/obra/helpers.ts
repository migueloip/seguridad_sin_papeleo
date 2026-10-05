/**
 * Utilidades para tests de integración del módulo Obra contra un Postgres real.
 *
 * Se activan solo si existe TEST_DATABASE_ADMIN_URL (p.ej.
 * postgres://postgres:postgres@localhost:5432/postgres). Cada archivo de test
 * crea su propia base `ssp_test_<nombre>` desde cero (esquema base + 006), así
 * los archivos pueden correr en paralelo sin pisarse.
 *
 * Patrón de uso (ver tests/obra/access.int.test.ts):
 *
 *   // @vitest-environment node
 *   vi.mock("@/lib/auth", async () => (await import("@/tests/obra/helpers")).authMock)
 *   vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
 *   describe.skipIf(!HAS_TEST_DB)("...", () => {
 *     let db: TestDb
 *     beforeAll(async () => { db = await setupObraTestDb("tareas") })   // ANTES de importar actions
 *     afterAll(async () => { await db.close() })
 *     it("...", async () => {
 *       const { createTask } = await import("@/app/actions/obra/tasks")
 *       actAs(db.users.gerente)
 *       ...
 *     })
 *   })
 */
import fs from "node:fs"
import path from "node:path"
import postgres from "postgres"
import { OBRA_SCHEMA_STATEMENTS } from "@/lib/obra/schema"

export const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_ADMIN_URL)

// ---------------------------------------------------------------------------
// Sesión simulada (sustituye a @/lib/auth)
// ---------------------------------------------------------------------------

const authState: { userId: number | null } = { userId: null }

/** Simula que `userId` es el usuario con sesión iniciada (null = sin sesión). */
export function actAs(userId: number | null) {
  authState.userId = userId
}

export const authMock = {
  getSession: async () =>
    authState.userId == null
      ? null
      : { user_id: authState.userId, email: `user${authState.userId}@test.cl`, name: `Usuario ${authState.userId}`, role: "user" },
  getCurrentUserId: async () => authState.userId,
  createSession: async () => undefined,
  destroySession: async () => undefined,
}

// ---------------------------------------------------------------------------
// Base de datos de prueba
// ---------------------------------------------------------------------------

export type TestDb = {
  url: string
  /** Cliente directo para preparar datos y verificar resultados. */
  sql: postgres.Sql
  /** Usuarios sembrados: el dueño (gerente implícito) y un miembro por rol, más un extraño. */
  users: {
    gerente: number
    jefe_obra: number
    prevencionista: number
    supervisor: number
    trabajador: number
    visita: number
    extrano: number
  }
  /** Proyecto principal (del gerente) y un proyecto ajeno (del extraño). */
  projectId: number
  otherProjectId: number
  close: () => Promise<void>
}

export async function setupObraTestDb(name: string): Promise<TestDb> {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
  if (!adminUrl) throw new Error("TEST_DATABASE_ADMIN_URL no definida")
  const dbName = `ssp_test_${name.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE ${dbName}`)
  await admin.end()

  const u = new URL(adminUrl)
  u.pathname = `/${dbName}`
  const url = u.toString()
  const sql = postgres(url, { max: 2, onnotice: () => {} })

  const baseline = fs.readFileSync(path.resolve(__dirname, "baseline.sql"), "utf8")
  await sql.unsafe(baseline)
  for (const stmt of OBRA_SCHEMA_STATEMENTS) await sql.unsafe(stmt)

  // El módulo de la app (lib/db) leerá esta URL al importarse por primera vez.
  process.env.DATABASE_URL = url
  process.env.DIRECT_URL = url
  // El esquema ya está aplicado; evitar que la app lo re-aplique en cada test.
  process.env.OBRA_AUTO_MIGRATE = "0"

  const mkUser = async (key: string) => {
    const r = await sql<{ id: number }[]>`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (${`${key}@test.cl`}, ${key}, 'x', 'user') RETURNING id`
    return Number(r[0].id)
  }
  const users = {
    gerente: await mkUser("gerente"),
    jefe_obra: await mkUser("jefe_obra"),
    prevencionista: await mkUser("prevencionista"),
    supervisor: await mkUser("supervisor"),
    trabajador: await mkUser("trabajador"),
    visita: await mkUser("visita"),
    extrano: await mkUser("extrano"),
  }
  const p = await sql<{ id: number }[]>`
    INSERT INTO projects (name, user_id, status) VALUES ('Edificio Los Aromos', ${users.gerente}, 'active') RETURNING id`
  const projectId = Number(p[0].id)
  const op = await sql<{ id: number }[]>`
    INSERT INTO projects (name, user_id, status) VALUES ('Obra ajena', ${users.extrano}, 'active') RETURNING id`
  const otherProjectId = Number(op[0].id)

  for (const role of ["jefe_obra", "prevencionista", "supervisor", "trabajador", "visita"] as const) {
    await sql`INSERT INTO obra_members (project_id, user_id, role, invited_by)
              VALUES (${projectId}, ${users[role]}, ${role}, ${users.gerente})`
  }

  return {
    url,
    sql,
    users,
    projectId,
    otherProjectId,
    close: async () => {
      await sql.end({ timeout: 1 })
      try {
        const { sql: appSql } = await import("@/lib/db")
        await appSql.end({ timeout: 1 })
      } catch {
        // la app nunca llegó a importar lib/db
      }
    },
  }
}
