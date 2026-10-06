// @vitest-environment node
/**
 * Seed demo (scripts/seed-obra-demo.mjs) contra Postgres real: se ejecuta como
 * proceso aparte (igual que `npm run seed:obra-demo`) sobre una BD de prueba y
 * se verifica que deja la obra, las capas, el hallazgo y las sugerencias del
 * MISMO análisis por reglas de la app (analyzeFindingAsSystem), que una
 * segunda corrida no duplica nada y que la sugerencia sembrada se puede
 * aprobar con approveSuggestion (payload compatible).
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Correlation, CreateTaskPayload } from "@/lib/obra/types"
import { HAS_TEST_DB, setupObraTestDb, type TestDb } from "./helpers"

vi.mock("@/lib/auth", async () => (await import("./helpers")).authMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const run = promisify(execFile)
const ROOT = path.resolve(__dirname, "..", "..")
const SEED = path.join(ROOT, "scripts", "seed-obra-demo.mjs")
const PROJECT_NAME = "Edificio Demo Los Aromos"
const FINDING_TITLE = "Grieta diagonal en muro eje B"

type Counts = Record<string, number>

describe.skipIf(!HAS_TEST_DB)("seed demo de Obra (BD real, proceso aparte)", () => {
  let db: TestDb
  let ownerEmail = ""
  let firstOutput = ""
  let secondOutput = ""
  let countsAfterFirst: Counts = {}
  let projectId = 0
  let findingId = 0

  async function runSeed(opts: { email?: string; nodeArgs?: string[] } = {}): Promise<string> {
    const args = [...(opts.nodeArgs ?? []), SEED, "--owner-email", opts.email ?? ownerEmail]
    const { stdout, stderr } = await run(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: db.url, DIRECT_URL: db.url, NODE_ENV: "test" },
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return `${stdout}\n${stderr}`
  }

  async function counts(): Promise<Counts> {
    const r = await db.sql<Counts[]>`
      SELECT
        (SELECT COUNT(*) FROM projects WHERE name = ${PROJECT_NAME})::int AS projects,
        (SELECT COUNT(*) FROM users WHERE email LIKE '%.demo@losaromos.test')::int AS demo_users,
        (SELECT COUNT(*) FROM obra_members m JOIN projects p ON p.id = m.project_id WHERE p.name = ${PROJECT_NAME})::int AS members,
        (SELECT COUNT(*) FROM obra_plan_layers)::int AS layers,
        (SELECT COUNT(*) FROM obra_plan_elements)::int AS elements,
        (SELECT COUNT(*) FROM findings WHERE title = ${FINDING_TITLE})::int AS findings,
        (SELECT COUNT(*) FROM obra_finding_pins)::int AS pins,
        (SELECT COUNT(*) FROM obra_ai_suggestions)::int AS suggestions,
        (SELECT COUNT(*) FROM obra_inspections)::int AS inspections,
        (SELECT COUNT(*) FROM obra_tasks)::int AS tasks,
        (SELECT COUNT(*) FROM obra_audit_log)::int AS audit
    `
    return r[0]
  }

  beforeAll(async () => {
    db = await setupObraTestDb("seed_int_test")
    // El dueño de la obra demo: un usuario existente (el seed no crea al dueño).
    const owner = await db.sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${db.users.gerente}`
    ownerEmail = owner[0].email
    firstOutput = await runSeed()
    countsAfterFirst = await counts()
    const p = await db.sql<{ id: number }[]>`
      SELECT id FROM projects WHERE name = ${PROJECT_NAME} AND user_id = ${db.users.gerente}`
    projectId = Number(p[0]?.id ?? 0)
    const f = await db.sql<{ id: number }[]>`SELECT id FROM findings WHERE project_id = ${projectId} AND title = ${FINDING_TITLE}`
    findingId = Number(f[0]?.id ?? 0)
    secondOutput = await runSeed()
  }, 240_000)
  afterAll(async () => {
    await db?.close()
  })

  it("primera corrida: obra, equipo, capas con elementos, hallazgo con pin, revisión y tareas", async () => {
    expect(firstOutput).not.toMatch(/✗/)
    expect(projectId).toBeGreaterThan(0)
    expect(findingId).toBeGreaterThan(0)
    expect(countsAfterFirst).toMatchObject({ projects: 1, demo_users: 5, members: 5, findings: 1, pins: 1, inspections: 1, tasks: 2 })

    const layers = await db.sql<{ name: string; discipline: string; n: number }[]>`
      SELECT l.name, l.discipline, COUNT(e.id)::int AS n
      FROM obra_plan_layers l LEFT JOIN obra_plan_elements e ON e.layer_id = l.id
      WHERE l.project_id = ${projectId} AND l.deleted_at IS NULL
      GROUP BY l.id ORDER BY l.id`
    expect(layers.map((l) => l.discipline)).toEqual(["arquitectura", "alcantarillado", "electrico", "agua_potable", "gas"])
    expect(layers.every((l) => l.n > 0)).toBe(true)

    const pin = await db.sql<{ project_id: number; category: string; level: number }[]>`
      SELECT project_id, category, level FROM obra_finding_pins WHERE finding_id = ${findingId}`
    expect(pin[0]).toMatchObject({ project_id: projectId, category: "grieta", level: 1 })
  })

  it("deja al menos una sugerencia create_task pendiente del motor de reglas que referencia el colector", async () => {
    expect(firstOutput).toMatch(/Sugerencias del hallazgo: \d+ sugerencias? pendientes? del motor de reglas/)
    expect(firstOutput).not.toMatch(/⚠/)
    const colector = await db.sql<{ id: number }[]>`
      SELECT id FROM obra_plan_elements
      WHERE project_id = ${projectId} AND element_type = 'tuberia_alcantarillado' AND label = 'C-1'`
    expect(colector).toHaveLength(1)
    const colectorId = Number(colector[0].id)

    const rows = await db.sql<
      { id: number; kind: string; status: string; generator: string; requested_by: number; payload: unknown; evidence: unknown }[]
    >`
      SELECT id, kind, status, generator, requested_by, payload, evidence FROM obra_ai_suggestions
      WHERE project_id = ${projectId} AND finding_id = ${findingId}
      ORDER BY id`
    const tasks = rows.filter((r) => r.kind === "create_task")
    expect(tasks.length).toBeGreaterThanOrEqual(1)
    expect(rows.every((r) => r.status === "pending" && r.generator === "reglas")).toBe(true)
    // Actor del análisis: el dueño del proyecto.
    expect(rows.every((r) => Number(r.requested_by) === db.users.gerente)).toBe(true)

    const aboutColector = tasks.filter((t) => {
      const ev = t.evidence as { correlations?: Correlation[] }
      return ev.correlations?.some((c) => Number(c.element_id) === colectorId)
    })
    expect(aboutColector.length).toBeGreaterThanOrEqual(1)
    const payload = aboutColector[0].payload as { kind: string; data: CreateTaskPayload }
    expect(payload.kind).toBe("create_task")
    expect(payload.data.finding_id).toBe(findingId)

    const audit = await db.sql<{ actor_user_id: number; details: Record<string, unknown> }[]>`
      SELECT actor_user_id, details FROM obra_audit_log
      WHERE project_id = ${projectId} AND action = 'finding.analyzed' AND entity_id = ${findingId}`
    expect(audit).toHaveLength(1)
    expect(Number(audit[0].actor_user_id)).toBe(db.users.gerente)
    expect(audit[0].details).toMatchObject({ via: "seed", use_ai: false, generator: "reglas" })
    expect((audit[0].details.suggestion_ids as number[]).sort()).toEqual(rows.map((r) => Number(r.id)).sort())
  })

  it("segunda corrida: no duplica nada (tampoco sugerencias ni auditoría)", async () => {
    expect(secondOutput).not.toMatch(/✗/)
    expect(secondOutput).toMatch(/ya existía/)
    expect(secondOutput).toMatch(/Sugerencias del hallazgo: ya tenía \d+ sugerencias?/)
    expect(await counts()).toEqual(countsAfterFirst)
  })

  it("la sugerencia sembrada se aprueba con approveSuggestion: tarea con origin 'reglas' en la próxima revisión", async () => {
    const { approveSuggestion } = await import("@/lib/obra/server/suggestions")
    const rows = await db.sql<{ id: number }[]>`
      SELECT id FROM obra_ai_suggestions
      WHERE project_id = ${projectId} AND finding_id = ${findingId} AND kind = 'create_task' AND status = 'pending'
      ORDER BY id LIMIT 1`
    const sid = Number(rows[0].id)
    const r = await approveSuggestion(db.users.gerente, sid, { notes: "Aprobada en el test del seed." })
    expect(r.applied_entity_type).toBe("task")
    expect(r.suggestion).toMatchObject({ id: sid, status: "approved", reviewed_by: db.users.gerente })
    expect(r.inspection).not.toBeNull()
    const t = await db.sql<{ origin: string; suggestion_id: number; finding_id: number; project_id: number; inspection_id: number | null }[]>`
      SELECT origin, suggestion_id, finding_id, project_id, inspection_id FROM obra_tasks WHERE id = ${r.applied_entity_id}`
    expect(t[0]).toMatchObject({ origin: "reglas", suggestion_id: sid, finding_id: findingId, project_id: projectId })
    expect(Number(t[0].inspection_id)).toBe(r.inspection?.id)

    // Un tercer seed tampoco re-analiza un hallazgo que ya tiene sugerencias revisadas.
    const before = await counts()
    const out = await runSeed()
    expect(out).toMatch(/ya tenía/)
    expect(await counts()).toEqual(before)
  }, 120_000)

  it("si no se puede cargar el análisis de la app, el seed termina igual y explica cómo generarlas desde la UI", async () => {
    // Hook de carga de módulos que simula que esbuild no está disponible.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssp-seed-test-"))
    try {
      fs.writeFileSync(
        path.join(dir, "hook.mjs"),
        'export async function resolve(s, c, next) { if (s === "esbuild") throw new Error("esbuild no disponible (simulado)"); return next(s, c) }\n',
      )
      fs.writeFileSync(path.join(dir, "register.mjs"), 'import { register } from "node:module"\nregister("./hook.mjs", import.meta.url)\n')
      // Otro dueño: crea una obra demo nueva, cuyo hallazgo aún no tiene sugerencias.
      const other = await db.sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${db.users.jefe_obra}`
      const out = await runSeed({ email: other[0].email, nodeArgs: ["--import", pathToFileURL(path.join(dir, "register.mjs")).href] })
      expect(out).not.toMatch(/✗/)
      expect(out).toMatch(/Sugerencias del hallazgo: no generadas/)
      expect(out).toMatch(/No se pudo cargar el análisis de la app \(esbuild no disponible \(simulado\)\)/)
      expect(out).toMatch(/«Analizar con IA»/)
      const p = await db.sql<{ id: number }[]>`SELECT id FROM projects WHERE name = ${PROJECT_NAME} AND user_id = ${db.users.jefe_obra}`
      expect(p).toHaveLength(1)
      const f = await db.sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM obra_finding_pins WHERE project_id = ${p[0].id}`
      expect(f[0].n).toBe(1)
      const sg = await db.sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM obra_ai_suggestions WHERE project_id = ${p[0].id}`
      expect(sg[0].n).toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
