#!/usr/bin/env node
/**
 * Siembra (idempotente) una obra demo del módulo Obra Integral.
 *
 * Uso:
 *   DATABASE_URL=postgres://... node scripts/seed-obra-demo.mjs --owner-email tu@correo.cl
 *   npm run seed:obra-demo -- --owner-email tu@correo.cl
 *
 * Opciones:
 *   --owner-email <email>   (obligatorio) usuario existente que será dueño (gerente) de la obra.
 *   --reset-passwords       vuelve a dejar la clave demo en los usuarios demo que ya existían.
 *
 * Qué crea (solo lo que falta; nunca borra ni sobrescribe datos existentes):
 * - La obra "Edificio Demo Los Aromos" del dueño indicado.
 * - Miembros demo (jefe de obra, prevencionista, supervisor, trabajador y visita/ITO)
 *   con la clave "Demo1234!" (solo al crearlos).
 * - Capas del nivel 1 sin imagen, con sus elementos dibujados: Arquitectura (muros),
 *   Alcantarillado (colector Ø160 y cámaras; esta capa tiene un pequeño desplazamiento y
 *   rotación para probar la alineación), Eléctrico (ducto y tablero), Agua potable y Gas.
 * - El hallazgo "Grieta diagonal en muro eje B" ubicado a ~1,2 m del colector, con su pin.
 * - Una revisión programada y dos tareas manuales de ejemplo.
 *
 * Si falta la migración 006 la aplica leyendo scripts/006-obra-integral.sql (con el mismo
 * advisory lock que usa la app). Requiere el esquema base (POST /api/admin/migrate).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import bcrypt from "bcryptjs"
import postgres from "postgres"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const PROJECT_NAME = "Edificio Demo Los Aromos"
const DEMO_PASSWORD = "Demo1234!"
const LEVEL = 1
const LEVEL_LABEL = "Nivel 1"
const FINDING_TITLE = "Grieta diagonal en muro eje B"
const OBRA_MIGRATION_LOCK_KEY = 7262006
const SEED_LOCK_KEY = 7262106

const DEMO_MEMBERS = [
  { key: "jefe", role: "jefe_obra", email: "jefe.demo@losaromos.test", name: "Jorge Muñoz (jefe de obra)" },
  { key: "prevencionista", role: "prevencionista", email: "prevencion.demo@losaromos.test", name: "Paula Rojas (prevencionista)" },
  { key: "supervisor", role: "supervisor", email: "supervisor.demo@losaromos.test", name: "Héctor Soto (supervisor)" },
  { key: "trabajador", role: "trabajador", email: "trabajador.demo@losaromos.test", name: "Luis Pérez (trabajador)" },
  { key: "visita", role: "visita", email: "ito.demo@losaromos.test", name: "Carla Díaz (ITO)" },
]

// ---------------------------------------------------------------------------
// Argumentos y conexión
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { ownerEmail: "", resetPasswords: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--owner-email") out.ownerEmail = String(argv[++i] ?? "")
    else if (a.startsWith("--owner-email=")) out.ownerEmail = a.slice("--owner-email=".length)
    else if (a === "--reset-passwords") out.resetPasswords = true
    else if (a === "--help" || a === "-h") out.help = true
    else throw new Error(`Argumento desconocido: ${a}`)
  }
  out.ownerEmail = out.ownerEmail.trim().toLowerCase()
  return out
}

function loadEnv() {
  if (process.env.DATABASE_URL || process.env.DIRECT_URL) return
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f)
    if (!fs.existsSync(p)) continue
    try {
      process.loadEnvFile(p)
      return
    } catch {
      // Node antiguo o archivo ilegible: se sigue sin él.
    }
  }
}

function connect(url) {
  const isSupabase = url.includes("supabase")
  const isPooler = url.includes(".pooler.supabase.com") || url.includes(":6543")
  return postgres(url, {
    max: 1,
    onnotice: () => {},
    ssl: isSupabase ? "require" : undefined,
    prepare: isPooler ? false : undefined,
  })
}

// ---------------------------------------------------------------------------
// Geometría (mismo marco que lib/obra/geometry.ts)
// ---------------------------------------------------------------------------

const SHEET = { width_m: 40, aspect: 0.6 }

/** Metros del nivel → coordenada normalizada de la capa (inversa de toLevelMeters). */
function toNorm(frame, [X, Y]) {
  const t = (frame.rotation_deg * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const dx = X - frame.offset_x_m
  const dy = Y - frame.offset_y_m
  const lx = dx * c + dy * s
  const ly = -dx * s + dy * c
  const x = lx / frame.width_m
  const y = ly / (frame.width_m * frame.aspect)
  if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error(`Punto fuera de la lámina: (${X}, ${Y})`)
  return { x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6 }
}

function geom(frame, type, pts) {
  return { type, points: pts.map((p) => toNorm(frame, p)) }
}

const FRAME_BASE = { ...SHEET, offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }
// La lámina de alcantarillado viene "corrida" respecto de arquitectura: se alinea con su marco.
const FRAME_ALC = { ...SHEET, offset_x_m: 0.8, offset_y_m: -0.5, rotation_deg: 1.5 }

/**
 * Edificio de departamentos simple de 30 × 18 m (ejes A–E cada 7,5 m) con un pasillo
 * central de 2 m. Todas las coordenadas están en metros del nivel 1.
 */
function demoLayers() {
  const F = FRAME_BASE
  const A = FRAME_ALC
  return [
    {
      name: "Arquitectura N1",
      discipline: "arquitectura",
      frame: F,
      elements: [
        // Polilínea cerrada y no polígono: un polígono se trata como superficie (todo hallazgo dentro del
        // edificio quedaría "a 0 m" del muro perimetral).
        { type: "muro", label: "Muro perimetral", g: geom(F, "polyline", [[5, 3], [35, 3], [35, 21], [5, 21], [5, 3]]) },
        { type: "muro", label: "Muro pasillo norte", g: geom(F, "polyline", [[5, 11], [35, 11]]) },
        { type: "muro", label: "Muro pasillo sur", g: geom(F, "polyline", [[5, 13], [35, 13]]) },
        { type: "muro_carga", label: "Eje B norte", g: geom(F, "polyline", [[12.5, 3], [12.5, 11]]), attrs: { material: "Hormigón armado e=20 cm" } },
        { type: "muro_carga", label: "Eje B sur", g: geom(F, "polyline", [[12.5, 13], [12.5, 21]]), attrs: { material: "Hormigón armado e=20 cm" } },
        { type: "muro", label: "Eje C norte", g: geom(F, "polyline", [[20, 3], [20, 11]]) },
        { type: "muro", label: "Eje C sur", g: geom(F, "polyline", [[20, 13], [20, 21]]) },
        { type: "muro_carga", label: "Eje D norte", g: geom(F, "polyline", [[27.5, 3], [27.5, 11]]), attrs: { material: "Hormigón armado e=20 cm" } },
        { type: "muro_carga", label: "Eje D sur", g: geom(F, "polyline", [[27.5, 13], [27.5, 21]]), attrs: { material: "Hormigón armado e=20 cm" } },
      ],
    },
    {
      name: "Alcantarillado N1",
      discipline: "alcantarillado",
      frame: A,
      elements: [
        {
          type: "tuberia_alcantarillado",
          label: "C-1",
          g: geom(A, "polyline", [[6, 17.2], [24, 17.2], [38.5, 17.2]]),
          attrs: { diameter_mm: 160, material: "PVC sanitario", depth_m: 1.1 },
        },
        { type: "tuberia_alcantarillado", label: "UD-2", g: geom(A, "polyline", [[30, 13.5], [30, 17.2]]), attrs: { diameter_mm: 110, material: "PVC sanitario" } },
        { type: "camara_inspeccion", label: "CI-1", g: geom(A, "point", [[6, 17.2]]), attrs: { depth_m: 0.9 } },
        { type: "camara_inspeccion", label: "CI-2", g: geom(A, "point", [[24, 17.2]]), attrs: { depth_m: 1.2 } },
      ],
    },
    {
      name: "Eléctrico N1",
      discipline: "electrico",
      frame: F,
      elements: [
        { type: "ducto_electrico", label: "Alimentador pasillo", g: geom(F, "polyline", [[7, 12], [33, 12]]), attrs: { voltage_v: 220 } },
        { type: "tablero_electrico", label: "TDA N1", g: geom(F, "point", [[6.5, 12]]), attrs: { voltage_v: 380 } },
      ],
    },
    {
      name: "Agua potable N1",
      discipline: "agua_potable",
      frame: F,
      elements: [
        { type: "tuberia_agua", label: "Matriz AP", g: geom(F, "polyline", [[37, 5], [15, 5], [15, 9.5]]), attrs: { diameter_mm: 25, material: "PPR" } },
      ],
    },
    {
      name: "Gas N1",
      discipline: "gas",
      frame: F,
      elements: [
        { type: "linea_gas", label: "Red de gas", g: geom(F, "polyline", [[37, 19.5], [33, 19.5], [33, 14.5]]), attrs: { material: "Cobre tipo L", pressure: "Baja presión" } },
        { type: "medidor_gas", label: "Medidor general", g: geom(F, "point", [[37, 19.5]]) },
      ],
    },
  ]
}

// ---------------------------------------------------------------------------
// Utilidades de BD
// ---------------------------------------------------------------------------

function addDaysISO(days) {
  const now = new Date()
  const t = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

async function tableExists(sql, name) {
  const r = await sql`SELECT to_regclass(${`public.${name}`}) AS t`
  return r[0]?.t != null
}

async function ensureObraSchema(sql) {
  for (const t of ["users", "projects", "findings", "workers"]) {
    if (!(await tableExists(sql, t))) {
      throw new Error(`Falta la tabla base "${t}". Aplica primero el esquema base (POST /api/admin/migrate).`)
    }
  }
  const required = [
    "obra_members",
    "obra_plan_layers",
    "obra_ai_suggestions",
    "obra_plan_elements",
    "obra_finding_pins",
    "obra_inspections",
    "obra_tasks",
    "obra_audit_log",
  ]
  const missing = []
  for (const t of required) if (!(await tableExists(sql, t))) missing.push(t)
  if (missing.length === 0) return false
  // Archivo estático del repo (sin datos de usuario): se ejecuta tal cual.
  const ddl = fs.readFileSync(path.join(ROOT, "scripts", "006-obra-integral.sql"), "utf8")
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${OBRA_MIGRATION_LOCK_KEY})`
    await tx.unsafe(ddl)
  })
  return true
}

async function audit(tx, projectId, actorId, action, entityType, entityId, details) {
  await tx`
    INSERT INTO obra_audit_log (project_id, actor_user_id, action, entity_type, entity_id, details)
    VALUES (${projectId}, ${actorId}, ${action}, ${entityType}, ${entityId}, ${tx.json({ ...details, seed: true })})
  `
}

// ---------------------------------------------------------------------------
// Siembra
// ---------------------------------------------------------------------------

async function seed(sql, { ownerEmail, resetPasswords }) {
  const owners = await sql`SELECT id, email, name FROM users WHERE lower(email) = ${ownerEmail} LIMIT 1`
  if (!owners[0]) {
    throw new Error(`No existe un usuario con el correo ${ownerEmail}. Regístralo primero en /auth/register.`)
  }
  const ownerId = Number(owners[0].id)

  // bcrypt es lento: se calcula una vez fuera de la transacción.
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, 10)
  const report = { projectCreated: false, users: [], layers: [], finding: null, inspection: null, tasks: [] }

  const projectId = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`

    // 1) Obra
    let projectId
    const existing = await tx`
      SELECT id FROM projects WHERE user_id = ${ownerId} AND name = ${PROJECT_NAME} ORDER BY id ASC LIMIT 1
    `
    if (existing[0]) {
      projectId = Number(existing[0].id)
    } else {
      const p = await tx`
        INSERT INTO projects (name, location, client, start_date, status, user_id)
        VALUES (${PROJECT_NAME}, ${"Ñuñoa, Santiago"}, ${"Edificación habitacional (demo)"}, ${addDaysISO(-60)}, 'active', ${ownerId})
        RETURNING id
      `
      projectId = Number(p[0].id)
      report.projectCreated = true
    }

    // 2) Equipo demo
    const userIds = {}
    for (const m of DEMO_MEMBERS) {
      const u = await tx`SELECT id FROM users WHERE lower(email) = ${m.email} LIMIT 1`
      let id
      let status
      if (u[0]) {
        id = Number(u[0].id)
        if (resetPasswords && id !== ownerId) {
          await tx`UPDATE users SET password_hash = ${demoHash} WHERE id = ${id}`
          status = "existía (clave demo restablecida)"
        } else {
          status = "existía (se mantiene su clave)"
        }
      } else {
        const r = await tx`
          INSERT INTO users (email, name, password_hash, role) VALUES (${m.email}, ${m.name}, ${demoHash}, 'user') RETURNING id
        `
        id = Number(r[0].id)
        status = "creado"
      }
      userIds[m.key] = id
      if (id !== ownerId) {
        const ins = await tx`
          INSERT INTO obra_members (project_id, user_id, role, invited_by)
          VALUES (${projectId}, ${id}, ${m.role}, ${ownerId})
          ON CONFLICT (project_id, user_id) DO NOTHING
          RETURNING id
        `
        if (ins[0]) {
          await audit(tx, projectId, ownerId, "member.added", "member", Number(ins[0].id), {
            user_id: id,
            email: m.email,
            role: m.role,
            worker_id: null,
            new_user: status === "creado",
          })
        }
      }
      report.users.push({ ...m, id, status })
    }

    // 3) Capas y elementos (una capa existente no se toca)
    const layerIds = {}
    for (const L of demoLayers()) {
      const found = await tx`
        SELECT id FROM obra_plan_layers
        WHERE project_id = ${projectId} AND name = ${L.name} AND level = ${LEVEL} AND deleted_at IS NULL
        ORDER BY id ASC LIMIT 1
      `
      if (found[0]) {
        layerIds[L.name] = Number(found[0].id)
        report.layers.push({ name: L.name, status: "existía" })
        continue
      }
      const r = await tx`
        INSERT INTO obra_plan_layers (
          project_id, name, discipline, level, level_label, width_m, aspect, offset_x_m, offset_y_m, rotation_deg, uploaded_by
        ) VALUES (
          ${projectId}, ${L.name}, ${L.discipline}, ${LEVEL}, ${LEVEL_LABEL}, ${L.frame.width_m}, ${L.frame.aspect},
          ${L.frame.offset_x_m}, ${L.frame.offset_y_m}, ${L.frame.rotation_deg}, ${ownerId}
        )
        RETURNING id
      `
      const layerId = Number(r[0].id)
      layerIds[L.name] = layerId
      await audit(tx, projectId, ownerId, "layer.created", "layer", layerId, {
        name: L.name,
        discipline: L.discipline,
        level: LEVEL,
        has_image: false,
        mime_type: null,
        bytes: 0,
        width_m: L.frame.width_m,
      })
      for (const e of L.elements) {
        await tx`
          INSERT INTO obra_plan_elements (layer_id, project_id, element_type, label, geometry, attributes, source, created_by)
          VALUES (${layerId}, ${projectId}, ${e.type}, ${e.label}, ${tx.json(e.g)}, ${tx.json(e.attrs ?? {})}, 'manual', ${ownerId})
        `
      }
      await audit(tx, projectId, ownerId, "elements.created", "layer", layerId, { count: L.elements.length, source: "manual" })
      const n = L.elements.length
      report.layers.push({ name: L.name, status: `creada con ${n} elemento${n === 1 ? "" : "s"}` })
    }

    // 4) Hallazgo con pin a ~1,2 m del colector C-1 (muro eje B sur, Y = 16 m; colector en Y = 17,2 m)
    const arqId = layerIds["Arquitectura N1"]
    const f = await tx`
      SELECT id FROM findings WHERE project_id = ${projectId} AND title = ${FINDING_TITLE} ORDER BY id ASC LIMIT 1
    `
    if (f[0]) {
      report.finding = { id: Number(f[0].id), status: "existía" }
    } else {
      const reporter = userIds.supervisor ?? ownerId
      const pt = toNorm(FRAME_BASE, [12.5, 16])
      const ins = await tx`
        INSERT INTO findings (user_id, project_id, title, description, severity, status, location, photos)
        VALUES (
          ${ownerId}, ${projectId}, ${FINDING_TITLE},
          ${"Grieta diagonal de unos 2 mm en el muro del eje B, departamento 102, a 1 m del piso. Apareció después de las lluvias de la semana pasada."},
          'high', 'open', ${`Arquitectura N1 · nivel ${LEVEL}`}, ${tx.json([])}
        )
        RETURNING id
      `
      const findingId = Number(ins[0].id)
      await tx`
        INSERT INTO obra_finding_pins (finding_id, project_id, layer_id, level, x, y, category, reported_by)
        VALUES (${findingId}, ${projectId}, ${arqId}, ${LEVEL}, ${pt.x}, ${pt.y}, 'grieta', ${reporter})
      `
      await audit(tx, projectId, reporter, "finding.reported", "finding", findingId, {
        title: FINDING_TITLE,
        severity: "high",
        category: "grieta",
        layer_id: arqId,
        level: LEVEL,
        x: pt.x,
        y: pt.y,
        has_photo: false,
      })
      report.finding = { id: findingId, status: "creado" }
    }

    // 5) Revisión programada (solo si la obra no tiene ninguna abierta)
    const open = await tx`
      SELECT id, title, scheduled_for FROM obra_inspections
      WHERE project_id = ${projectId} AND status <> 'cerrada'
      ORDER BY scheduled_for ASC, id ASC LIMIT 1
    `
    let inspectionId
    if (open[0]) {
      inspectionId = Number(open[0].id)
      report.inspection = { id: inspectionId, status: "ya había una revisión abierta" }
    } else {
      const title = "Revisión semanal de obra"
      const scheduledFor = addDaysISO(3)
      const lead = userIds.prevencionista ?? null
      const r = await tx`
        INSERT INTO obra_inspections (project_id, title, scheduled_for, status, lead_user_id, notes, created_by)
        VALUES (${projectId}, ${title}, ${scheduledFor}, 'programada', ${lead}, ${"Recorrido del nivel 1 con jefe de obra y prevencionista."}, ${ownerId})
        RETURNING id
      `
      inspectionId = Number(r[0].id)
      await audit(tx, projectId, ownerId, "inspection.created", "inspection", inspectionId, {
        title,
        scheduled_for: scheduledFor,
        lead_user_id: lead,
      })
      report.inspection = { id: inspectionId, status: `creada para el ${scheduledFor}` }
    }

    // 6) Tareas manuales de ejemplo (por título)
    const demoTasks = [
      {
        title: "Reponer baranda provisoria en escalera N1",
        description: "Falta el pasamanos intermedio en el tramo entre nivel 1 y 2.",
        priority: "alta",
        assigned_role: "supervisor",
        due: 2,
        checklist: ["Instalar pasamanos a 1 m", "Instalar rodapié", "Registrar foto del antes y después"],
      },
      {
        title: "Despejar pasillo central de escombros",
        description: "Retirar restos de moldaje y escombros del pasillo del nivel 1.",
        priority: "media",
        assigned_role: "trabajador",
        due: 1,
        checklist: ["Retirar escombros", "Ordenar moldajes en acopio"],
      },
    ]
    for (const t of demoTasks) {
      const ex = await tx`SELECT id FROM obra_tasks WHERE project_id = ${projectId} AND title = ${t.title} LIMIT 1`
      if (ex[0]) {
        report.tasks.push({ title: t.title, status: "existía" })
        continue
      }
      const checklist = t.checklist.map((text) => ({ text, done: false }))
      const r = await tx`
        INSERT INTO obra_tasks (
          project_id, title, description, priority, status, origin, level, checklist, assigned_role, inspection_id, due_date, created_by
        ) VALUES (
          ${projectId}, ${t.title}, ${t.description}, ${t.priority}, 'pendiente', 'manual', ${LEVEL}, ${tx.json(checklist)},
          ${t.assigned_role}, ${inspectionId}, ${addDaysISO(t.due)}, ${ownerId}
        )
        RETURNING id
      `
      await audit(tx, projectId, ownerId, "task.created", "task", Number(r[0].id), {
        title: t.title,
        origin: "manual",
        priority: t.priority,
        assigned_role: t.assigned_role,
        inspection_id: inspectionId,
      })
      report.tasks.push({ title: t.title, status: "creada" })
    }

    return projectId
  })

  return { projectId, ownerId, report }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.ownerEmail) {
    console.log("Uso: node scripts/seed-obra-demo.mjs --owner-email <correo-del-dueño> [--reset-passwords]")
    process.exit(args.help ? 0 : 1)
  }
  loadEnv()
  const url = process.env.DATABASE_URL || process.env.DIRECT_URL
  if (!url) throw new Error("Define DATABASE_URL (o DIRECT_URL) para conectarte a la base de datos.")

  const sql = connect(url)
  try {
    const migrated = await ensureObraSchema(sql)
    if (migrated) console.log("✓ Migración 006 (Obra Integral) aplicada.")
    const { projectId, report } = await seed(sql, args)

    console.log("")
    console.log(`Obra demo: "${PROJECT_NAME}" (id ${projectId}) — ${report.projectCreated ? "creada" : "ya existía"}`)
    console.log("")
    console.log("Equipo demo:")
    for (const u of report.users) {
      console.log(`  - ${u.role.padEnd(15)} ${u.email.padEnd(34)} ${u.status}`)
    }
    const anyNew = report.users.some((u) => u.status !== "existía (se mantiene su clave)")
    if (anyNew) console.log(`  Clave de los usuarios demo creados o restablecidos: ${DEMO_PASSWORD}`)
    console.log("")
    console.log("Capas del nivel 1:")
    for (const l of report.layers) console.log(`  - ${l.name}: ${l.status}`)
    console.log(`Hallazgo "${FINDING_TITLE}": ${report.finding.status} (id ${report.finding.id})`)
    console.log(`Revisión: ${report.inspection.status} (id ${report.inspection.id})`)
    for (const t of report.tasks) console.log(`Tarea "${t.title}": ${t.status}`)
    console.log("")
    console.log(`Abre /obra/${projectId}/planos para ver los planos y /obra/${projectId}/planos?finding=${report.finding.id} para el hallazgo.`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
