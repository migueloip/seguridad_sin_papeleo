/**
 * Tareas del módulo Obra Integral. Solo servidor; sin "use server": cada
 * función recibe el actorUserId explícito y autoriza contra el proyecto
 * resuelto desde la BD.
 *
 * Visibilidad: con "tasks.view_all" se ven todas las tareas del proyecto; sin
 * ese permiso, solo las "propias": asignadas al usuario, o sin persona
 * asignada y con su rol (assigned_user_id IS NULL AND assigned_role = rol).
 */
import { sql } from "@/lib/db"
import {
  getProjectAccessForUser,
  ObraAccessError,
  ObraValidationError,
  requireProjectPermissionForUser,
  writeAudit,
} from "../access"
import { can } from "../permissions"
import {
  OBRA_ROLES,
  PRIORITIES,
  TASK_ORIGINS,
  TASK_STATUSES,
  type ObraRole,
  type ObraTask,
  type Priority,
  type ProjectAccess,
  type TaskInput,
  type TaskOrigin,
  type TaskStatus,
} from "../types"
import { assertProjectUser, getOrCreateNextInspection, lockProjectInspections } from "./inspections"
import {
  asSql,
  cleanLine,
  hasKey,
  mapTask,
  optionalDateISO,
  optionalRefId,
  optionalText,
  parseChecklist,
  requireEnum,
  requireLine,
  requireObject,
  taskOrderBy,
  taskSelect,
  textLength,
  toPositiveInt,
  type Queryable,
  type TaskRow,
} from "./mappers"

export const TASK_LIMITS = {
  titleMin: 3,
  titleMax: 200,
  description: 4000,
  checklistItems: 20,
  checklistItem: 300,
  notes: 2000,
  levelMin: -20,
  levelMax: 200,
  list: 1000,
} as const

const NOT_FOUND = "Tarea no encontrada."

export type TaskFilter = { status?: TaskStatus[]; mine?: boolean; inspection_id?: number | null }

// ---------------------------------------------------------------------------
// Visibilidad y permisos
// ---------------------------------------------------------------------------

/** Condición SQL (alias t) de "tarea propia" del usuario con ese acceso. */
export function mineCondition(q: Queryable, access: Pick<ProjectAccess, "user_id" | "role">) {
  const s = asSql(q)
  return s`(t.assigned_user_id = ${access.user_id} OR (t.assigned_user_id IS NULL AND t.assigned_role = ${access.role}))`
}

/** Versión en memoria de mineCondition. */
export function isOwnTask(
  task: { assigned_user_id: number | null; assigned_role: string | null },
  access: Pick<ProjectAccess, "user_id" | "role">,
): boolean {
  const assigned = task.assigned_user_id == null ? null : Number(task.assigned_user_id)
  if (assigned != null) return assigned === access.user_id
  return task.assigned_role === access.role
}

export function canViewTask(
  task: { assigned_user_id: number | null; assigned_role: string | null },
  access: ProjectAccess,
): boolean {
  return can(access.role, "tasks.view_all") || isOwnTask(task, access)
}

/** ¿Puede cambiar el estado / checklist de la tarea? */
export function canWorkOnTask(
  task: { assigned_user_id: number | null; assigned_role: string | null },
  access: ProjectAccess,
): boolean {
  if (can(access.role, "tasks.manage") || can(access.role, "tasks.complete_any")) return true
  return can(access.role, "tasks.complete_own") && isOwnTask(task, access)
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Lee una tarea del proyecto con nombres (o null). */
export async function getTaskById(q: Queryable, projectId: number, taskId: number): Promise<ObraTask | null> {
  const s = asSql(q)
  const rows = await s<TaskRow[]>`
    ${taskSelect(s)}
    WHERE t.id = ${taskId} AND t.project_id = ${projectId}
    LIMIT 1
  `
  return rows[0] ? mapTask(rows[0]) : null
}

function normalizeFilter(filter: unknown): { status: TaskStatus[]; mine: boolean; inspection_id: number | null | undefined } {
  if (filter === null || filter === undefined) return { status: [], mine: false, inspection_id: undefined }
  const f = requireObject(filter, "Filtro de tareas no válido.")
  let status: TaskStatus[] = []
  if (f.status !== undefined && f.status !== null) {
    if (!Array.isArray(f.status)) throw new ObraValidationError("Filtro de estado no válido.")
    status = [...new Set(f.status.map((s) => requireEnum(s, TASK_STATUSES, "Estado de tarea no válido.")))]
  }
  if (f.mine !== undefined && typeof f.mine !== "boolean") throw new ObraValidationError("Filtro «mis tareas» no válido.")
  let inspectionId: number | null | undefined = undefined
  if (f.inspection_id === null) inspectionId = null
  else if (f.inspection_id !== undefined) {
    const n = toPositiveInt(f.inspection_id)
    if (n == null) throw new ObraValidationError("Revisión no válida.")
    inspectionId = n
  }
  return { status, mine: f.mine === true, inspection_id: inspectionId }
}

/**
 * Tareas del proyecto visibles para el usuario. Orden: abiertas primero,
 * prioridad (crítica > alta > media > baja), vencimiento ascendente (sin
 * fecha al final).
 */
export async function listTasks(userId: number, projectId: number, filter?: TaskFilter): Promise<ObraTask[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "project.view")
  const f = normalizeFilter(filter)
  const onlyMine = f.mine || !can(access.role, "tasks.view_all")
  const rows = await sql<TaskRow[]>`
    ${taskSelect(sql)}
    WHERE t.project_id = ${access.project_id}
    ${onlyMine ? sql`AND ${mineCondition(sql, access)}` : sql``}
    ${f.status.length > 0 ? sql`AND t.status IN ${sql(f.status)}` : sql``}
    ${
      f.inspection_id === undefined
        ? sql``
        : f.inspection_id === null
          ? sql`AND t.inspection_id IS NULL`
          : sql`AND t.inspection_id = ${f.inspection_id}`
    }
    ${taskOrderBy(sql)}
    LIMIT ${TASK_LIMITS.list}
  `
  return rows.map(mapTask)
}

// ---------------------------------------------------------------------------
// Validación de entrada
// ---------------------------------------------------------------------------

type NormalizedTask = {
  title: string
  description: string | null
  priority: Priority
  assigned_role: ObraRole | null
  assigned_user_id: number | null
  due_date: string | null
  inspection_id: number | null | "next"
  finding_id: number | null
  layer_id: number | null
  level: number | null
  x: number | null
  y: number | null
  checklist: string[]
}

function normCoord(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new ObraValidationError("La posición en el plano no es válida.")
  }
  return v
}

function normLevel(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== "number" || !Number.isInteger(v) || v < TASK_LIMITS.levelMin || v > TASK_LIMITS.levelMax) {
    throw new ObraValidationError(`El nivel debe ser un número entero entre ${TASK_LIMITS.levelMin} y ${TASK_LIMITS.levelMax}.`)
  }
  return v
}

function normChecklist(v: unknown): string[] {
  if (v === null || v === undefined) return []
  if (!Array.isArray(v)) throw new ObraValidationError("El checklist debe ser una lista de textos.")
  const out: string[] = []
  for (const it of v) {
    if (typeof it !== "string") throw new ObraValidationError("El checklist debe ser una lista de textos.")
    const s = cleanLine(it)
    if (!s) continue
    if (textLength(s) > TASK_LIMITS.checklistItem) {
      throw new ObraValidationError(`Cada ítem del checklist admite como máximo ${TASK_LIMITS.checklistItem} caracteres.`)
    }
    out.push(s)
  }
  if (out.length > TASK_LIMITS.checklistItems) {
    throw new ObraValidationError(`El checklist admite como máximo ${TASK_LIMITS.checklistItems} ítems.`)
  }
  return out
}

function normInspectionRef(v: unknown): number | null | "next" {
  if (v === "next") return "next"
  return optionalRefId(v, "La revisión")
}

const FIELD_NORMALIZERS: { [K in keyof NormalizedTask]: (v: unknown) => NormalizedTask[K] } = {
  title: (v) => requireLine(v, "El título", TASK_LIMITS.titleMin, TASK_LIMITS.titleMax),
  description: (v) => optionalText(v, "La descripción", TASK_LIMITS.description),
  priority: (v) => requireEnum(v, PRIORITIES, "Prioridad no válida."),
  assigned_role: (v) =>
    v === null || v === undefined || v === "" ? null : requireEnum(v, OBRA_ROLES, "Rol asignado no válido."),
  assigned_user_id: (v) => optionalRefId(v, "La persona asignada"),
  due_date: (v) => optionalDateISO(v, "La fecha de vencimiento"),
  inspection_id: normInspectionRef,
  finding_id: (v) => optionalRefId(v, "El hallazgo"),
  layer_id: (v) => optionalRefId(v, "La capa"),
  level: normLevel,
  x: normCoord,
  y: normCoord,
  checklist: normChecklist,
}

const TASK_FIELDS = Object.keys(FIELD_NORMALIZERS) as Array<keyof NormalizedTask>

/** Normaliza una entrada completa (crear). */
export function normalizeTaskInput(input: unknown): NormalizedTask {
  const o = requireObject(input, "Datos de la tarea no válidos.")
  const out = {
    title: FIELD_NORMALIZERS.title(o.title),
    description: FIELD_NORMALIZERS.description(o.description),
    priority: o.priority === undefined || o.priority === null ? "media" : FIELD_NORMALIZERS.priority(o.priority),
    assigned_role: FIELD_NORMALIZERS.assigned_role(o.assigned_role),
    assigned_user_id: FIELD_NORMALIZERS.assigned_user_id(o.assigned_user_id),
    due_date: FIELD_NORMALIZERS.due_date(o.due_date),
    inspection_id: FIELD_NORMALIZERS.inspection_id(o.inspection_id),
    finding_id: FIELD_NORMALIZERS.finding_id(o.finding_id),
    layer_id: FIELD_NORMALIZERS.layer_id(o.layer_id),
    level: FIELD_NORMALIZERS.level(o.level),
    x: FIELD_NORMALIZERS.x(o.x),
    y: FIELD_NORMALIZERS.y(o.y),
    checklist: FIELD_NORMALIZERS.checklist(o.checklist),
  } satisfies NormalizedTask
  assertCoordPair(out)
  return out
}

/** Normaliza un parche: solo las claves presentes (null = quitar el valor). */
function normalizeTaskPatch(patch: unknown): Partial<NormalizedTask> {
  const o = requireObject(patch, "Datos de la tarea no válidos.")
  const out: Partial<NormalizedTask> = {}
  for (const key of TASK_FIELDS) {
    if (!hasKey(o, key)) continue
    if ((key === "title" || key === "priority") && o[key] === null) {
      throw new ObraValidationError(key === "title" ? "El título es obligatorio." : "Prioridad no válida.")
    }
    ;(out as Record<string, unknown>)[key] = FIELD_NORMALIZERS[key](o[key])
  }
  return out
}

function assertCoordPair(t: { x: number | null; y: number | null }) {
  if ((t.x == null) !== (t.y == null)) throw new ObraValidationError("La posición en el plano requiere x e y.")
}

// ---------------------------------------------------------------------------
// Referencias cruzadas (siempre contra el proyecto autorizado)
// ---------------------------------------------------------------------------

async function assertFindingInProject(q: Queryable, access: ProjectAccess, findingId: number): Promise<void> {
  const s = asSql(q)
  const rows = await s<{ id: number }[]>`
    SELECT id FROM findings
    WHERE id = ${findingId} AND project_id = ${access.project_id}
      AND (user_id = ${access.owner_user_id} OR user_id IS NULL)
    LIMIT 1
  `
  if (!rows[0]) throw new ObraValidationError("El hallazgo indicado no pertenece a esta obra.")
}

async function getLayerLevel(q: Queryable, projectId: number, layerId: number): Promise<number> {
  const s = asSql(q)
  const rows = await s<{ level: number }[]>`
    SELECT level FROM obra_plan_layers
    WHERE id = ${layerId} AND project_id = ${projectId} AND deleted_at IS NULL
    LIMIT 1
  `
  if (!rows[0]) throw new ObraValidationError("La capa indicada no pertenece a esta obra.")
  return Number(rows[0].level)
}

async function assertInspectionUsable(q: Queryable, projectId: number, inspectionId: number): Promise<void> {
  const s = asSql(q)
  const rows = await s<{ status: string }[]>`
    SELECT status FROM obra_inspections WHERE id = ${inspectionId} AND project_id = ${projectId} LIMIT 1
  `
  if (!rows[0]) throw new ObraValidationError("La revisión indicada no pertenece a esta obra.")
  if (rows[0].status === "cerrada") throw new ObraValidationError("La revisión indicada ya está cerrada.")
}

/**
 * Revisión de la tarea: "next" = la próxima abierta (o una nueva; si la tarea
 * vence antes de la próxima programada, una para su vencimiento). Un id
 * explícito se valida bajo el mismo lock que closeInspection, para no anotar
 * una tarea en una revisión que se está cerrando.
 */
async function resolveInspection(
  q: Queryable,
  access: ProjectAccess,
  ref: number | null | "next",
  dueBy?: string | null,
): Promise<number | null> {
  if (ref === "next") return (await getOrCreateNextInspection(q, access.project_id, access.user_id, { dueBy })).id
  if (ref != null) {
    await lockProjectInspections(q, access.project_id)
    await assertInspectionUsable(q, access.project_id, ref)
  }
  return ref
}

function isUniqueViolation(e: unknown, needle: string): boolean {
  const err = e as { code?: string; constraint_name?: string; constraint?: string; message?: string }
  if (err?.code !== "23505") return false
  const name = err.constraint_name ?? err.constraint ?? err.message ?? ""
  return name.includes(needle)
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Crea una tarea dentro de una transacción ya abierta. NO verifica permisos
 * (el llamador ya autorizó), pero SÍ valida la entrada y que hallazgo, capa,
 * revisión, persona asignada y sugerencia pertenezcan a access.project_id.
 * inspection_id "next" usa getOrCreateNextInspection. Audita task.created.
 * Si la sugerencia ya tiene tarea (suggestion_id UNIQUE) lanza
 * ObraValidationError.
 */
export async function createTaskInTx(
  tx: Queryable,
  access: ProjectAccess,
  input: TaskInput,
  meta: { origin: TaskOrigin; suggestion_id?: number | null },
): Promise<ObraTask> {
  const s = asSql(tx)
  const n = normalizeTaskInput(input)
  const origin = requireEnum(meta?.origin, TASK_ORIGINS, "Origen de tarea no válido.")
  const suggestionId = optionalRefId(meta?.suggestion_id, "La sugerencia")

  if (n.finding_id != null) await assertFindingInProject(s, access, n.finding_id)
  let level = n.level
  if (n.layer_id != null) {
    const layerLevel = await getLayerLevel(s, access.project_id, n.layer_id)
    if (level == null) level = layerLevel
  }
  if (n.assigned_user_id != null) {
    await assertProjectUser(s, access.project_id, n.assigned_user_id, "La persona asignada")
  }
  if (suggestionId != null) {
    const sg = await s<{ id: number }[]>`
      SELECT id FROM obra_ai_suggestions WHERE id = ${suggestionId} AND project_id = ${access.project_id} LIMIT 1
    `
    if (!sg[0]) throw new ObraValidationError("La sugerencia indicada no pertenece a esta obra.")
  }
  const inspectionId = await resolveInspection(s, access, n.inspection_id, n.due_date)
  const checklist = n.checklist.map((text) => ({ text, done: false }))

  let id: number
  try {
    const ins = await s<{ id: number }[]>`
      INSERT INTO obra_tasks (
        project_id, title, description, priority, status, origin, suggestion_id, finding_id, layer_id,
        level, x, y, checklist, assigned_role, assigned_user_id, inspection_id, due_date, created_by
      ) VALUES (
        ${access.project_id}, ${n.title}, ${n.description}, ${n.priority}, 'pendiente', ${origin}, ${suggestionId},
        ${n.finding_id}, ${n.layer_id}, ${level}, ${n.x}, ${n.y}, ${s.json(checklist)}, ${n.assigned_role},
        ${n.assigned_user_id}, ${inspectionId}, ${n.due_date}::date, ${access.user_id}
      )
      RETURNING id
    `
    id = Number(ins[0].id)
  } catch (e) {
    if (isUniqueViolation(e, "suggestion_id")) throw new ObraValidationError("Esta sugerencia ya fue anotada como tarea.")
    throw e
  }

  await writeAudit(
    {
      project_id: access.project_id,
      actor_user_id: access.user_id,
      action: "task.created",
      entity_type: "task",
      entity_id: id,
      details: {
        title: n.title,
        origin,
        priority: n.priority,
        suggestion_id: suggestionId,
        finding_id: n.finding_id,
        inspection_id: inspectionId,
        assigned_role: n.assigned_role,
        assigned_user_id: n.assigned_user_id,
      },
    },
    tx,
  )
  const task = await getTaskById(s, access.project_id, id)
  if (!task) throw new Error("No se pudo leer la tarea recién creada")
  return task
}

/**
 * Crea una tarea manual (permiso tasks.manage). Si se indica hallazgo, el
 * origen queda como "hallazgo". Con `tx` se ejecuta dentro de esa transacción.
 */
export async function createTask(userId: number, projectId: number, input: TaskInput, tx?: Queryable): Promise<ObraTask> {
  const access = await requireProjectPermissionForUser(userId, projectId, "tasks.manage")
  const findingRef = input && typeof input === "object" ? (input as TaskInput).finding_id : null
  const origin: TaskOrigin = findingRef != null ? "hallazgo" : "manual"
  if (tx) return createTaskInTx(tx, access, input, { origin })
  return (await sql.begin((t) => createTaskInTx(t, access, input, { origin }))) as ObraTask
}

/** Resuelve el proyecto de la tarea desde la BD (404 si no existe o sin acceso). */
async function resolveTaskAccess(userId: number, taskId: unknown): Promise<{ access: ProjectAccess; taskId: number }> {
  const id = toPositiveInt(taskId)
  if (id == null) throw new ObraAccessError(404, NOT_FOUND)
  const rows = await sql<{ project_id: number }[]>`SELECT project_id FROM obra_tasks WHERE id = ${id}`
  if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
  const access = await getProjectAccessForUser(userId, Number(rows[0].project_id))
  if (!access) throw new ObraAccessError(404, NOT_FOUND)
  return { access, taskId: id }
}

type LockedTask = {
  id: number
  status: string
  assigned_user_id: number | null
  assigned_role: string | null
  checklist: unknown
  completion_notes: string | null
}

async function lockTask(q: Queryable, projectId: number, taskId: number): Promise<LockedTask> {
  const s = asSql(q)
  const rows = await s<LockedTask[]>`
    SELECT id, status, assigned_user_id, assigned_role, checklist, completion_notes
    FROM obra_tasks
    WHERE id = ${taskId} AND project_id = ${projectId}
    FOR UPDATE
  `
  if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
  return rows[0]
}

/** ¿Es dueño o integrante actual del proyecto? (versión booleana de assertProjectUser). */
async function isProjectUser(q: Queryable, projectId: number, userId: number): Promise<boolean> {
  try {
    await assertProjectUser(q, projectId, userId, "La persona asignada")
    return true
  } catch (e) {
    if (e instanceof ObraValidationError) return false
    throw e
  }
}

/** 404 si no la puede ver; 403 si la ve pero no puede trabajarla. */
function assertCanWork(task: LockedTask, access: ProjectAccess) {
  if (!canViewTask(task, access)) throw new ObraAccessError(404, NOT_FOUND)
  if (!canWorkOnTask(task, access)) throw new ObraAccessError(403, "Tu rol en esta obra no permite cerrar esta tarea.")
}

/** Edita una tarea (permiso tasks.manage). Solo cambia las claves presentes en el parche. */
export async function updateTask(userId: number, taskId: number, patch: Partial<TaskInput>): Promise<ObraTask> {
  const { access, taskId: id } = await resolveTaskAccess(userId, taskId)
  if (!can(access.role, "tasks.manage")) throw new ObraAccessError(403, "Tu rol en esta obra no permite editar tareas.")
  const p = normalizeTaskPatch(patch)

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    // Si cambia la revisión, el lock por proyecto va ANTES que el de la tarea (mismo orden que
    // closeInspection, que traslada tareas): así no se interbloquean.
    if (p.inspection_id !== undefined) await lockProjectInspections(s, access.project_id)
    const rows = await s<TaskRow[]>`
      ${taskSelect(s)}
      WHERE t.id = ${id} AND t.project_id = ${access.project_id}
      FOR UPDATE OF t
    `
    if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
    const cur = mapTask(rows[0])

    const changes: string[] = []
    const next = {
      title: cur.title,
      description: cur.description,
      priority: cur.priority,
      assigned_role: cur.assigned_role,
      assigned_user_id: cur.assigned_user_id,
      due_date: cur.due_date,
      inspection_id: cur.inspection_id,
      finding_id: cur.finding_id,
      layer_id: cur.layer_id,
      level: cur.level,
      x: cur.x,
      y: cur.y,
      checklist: cur.checklist,
    }

    if (p.title !== undefined) next.title = p.title
    if (p.description !== undefined) next.description = p.description
    if (p.priority !== undefined) next.priority = p.priority
    if (p.assigned_role !== undefined) next.assigned_role = p.assigned_role
    if (p.assigned_user_id !== undefined && p.assigned_user_id !== cur.assigned_user_id) {
      if (p.assigned_user_id != null) {
        await assertProjectUser(s, access.project_id, p.assigned_user_id, "La persona asignada")
      }
      next.assigned_user_id = p.assigned_user_id
    }
    if (p.due_date !== undefined) next.due_date = p.due_date
    if (p.finding_id !== undefined && p.finding_id !== cur.finding_id) {
      if (p.finding_id != null) await assertFindingInProject(s, access, p.finding_id)
      next.finding_id = p.finding_id
    }
    if (p.layer_id !== undefined && p.layer_id !== cur.layer_id) {
      if (p.layer_id != null) {
        const layerLevel = await getLayerLevel(s, access.project_id, p.layer_id)
        if (p.level === undefined) next.level = layerLevel
      }
      next.layer_id = p.layer_id
    }
    if (p.level !== undefined) next.level = p.level
    if (p.x !== undefined) next.x = p.x
    if (p.y !== undefined) next.y = p.y
    assertCoordPair(next)
    if (p.inspection_id !== undefined && p.inspection_id !== cur.inspection_id) {
      next.inspection_id = await resolveInspection(s, access, p.inspection_id, next.due_date)
    }
    if (p.checklist !== undefined) {
      // Conserva "hecho" de los ítems cuyo texto no cambió.
      const pool = [...cur.checklist]
      next.checklist = p.checklist.map((text) => {
        const idx = pool.findIndex((it) => it.text === text)
        const done = idx >= 0 ? pool[idx].done : false
        if (idx >= 0) pool.splice(idx, 1)
        return { text, done }
      })
    }

    for (const key of TASK_FIELDS) {
      const a = (cur as Record<string, unknown>)[key]
      const b = (next as Record<string, unknown>)[key]
      if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changes.push(key)
    }
    if (changes.length === 0) return cur

    await s`
      UPDATE obra_tasks SET
        title = ${next.title},
        description = ${next.description},
        priority = ${next.priority},
        assigned_role = ${next.assigned_role},
        assigned_user_id = ${next.assigned_user_id},
        due_date = ${next.due_date}::date,
        inspection_id = ${next.inspection_id},
        finding_id = ${next.finding_id},
        layer_id = ${next.layer_id},
        level = ${next.level},
        x = ${next.x},
        y = ${next.y},
        checklist = ${s.json(next.checklist)},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "task.updated",
        entity_type: "task",
        entity_id: id,
        details: { changes },
      },
      tx,
    )
    const out = await getTaskById(s, access.project_id, id)
    if (!out) throw new ObraAccessError(404, NOT_FOUND)
    return out
  })) as ObraTask
}

/**
 * Cambia el estado de una tarea. Permisos: tasks.manage o tasks.complete_any
 * sobre cualquier tarea; tasks.complete_own solo sobre las propias. Cancelar
 * o reabrir una tarea cancelada exige tasks.manage. Pasar a "hecha" registra
 * completed_by/at y las notas; salir de "hecha" las limpia.
 * Si la tarea queda abierta (pendiente / en progreso) y su persona asignada ya
 * no es del equipo (p.ej. se reabre una hecha de alguien que salió), queda sin
 * persona, con su rol asignado (removeMember se lo dejó), como las que
 * removeMember libera; el audit lo registra en unassigned_user_id.
 */
export async function setTaskStatus(userId: number, taskId: number, status: TaskStatus, notes?: string): Promise<ObraTask> {
  const { access, taskId: id } = await resolveTaskAccess(userId, taskId)
  const st = requireEnum(status, TASK_STATUSES, "Estado de tarea no válido.")
  const note = optionalText(notes, "Las notas", TASK_LIMITS.notes)

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const cur = await lockTask(s, access.project_id, id)
    assertCanWork(cur, access)
    if ((st === "cancelada" || cur.status === "cancelada") && st !== cur.status && !can(access.role, "tasks.manage")) {
      throw new ObraAccessError(403, "Solo quien gestiona tareas puede cancelarlas o reabrir una cancelada.")
    }

    if (cur.status === st) {
      if (st === "hecha" && note != null && note !== cur.completion_notes) {
        await s`UPDATE obra_tasks SET completion_notes = ${note}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
        await writeAudit(
          {
            project_id: access.project_id,
            actor_user_id: userId,
            action: "task.updated",
            entity_type: "task",
            entity_id: id,
            details: { changes: ["completion_notes"] },
          },
          tx,
        )
      }
    } else {
      let unassignedUserId: number | null = null
      if (st === "hecha") {
        await s`
          UPDATE obra_tasks
          SET status = 'hecha', completed_by = ${userId}, completed_at = CURRENT_TIMESTAMP,
              completion_notes = ${note}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
        `
      } else {
        if ((st === "pendiente" || st === "en_progreso") && cur.assigned_user_id != null) {
          const assigned = Number(cur.assigned_user_id)
          if (!(await isProjectUser(s, access.project_id, assigned))) unassignedUserId = assigned
        }
        await s`
          UPDATE obra_tasks
          SET status = ${st}, completed_by = NULL, completed_at = NULL, completion_notes = NULL,
              ${unassignedUserId != null ? s`assigned_user_id = NULL,` : s``}
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
        `
      }
      await writeAudit(
        {
          project_id: access.project_id,
          actor_user_id: userId,
          action: "task.status_changed",
          entity_type: "task",
          entity_id: id,
          details: {
            from: cur.status,
            to: st,
            notes: note,
            ...(unassignedUserId != null ? { unassigned_user_id: unassignedUserId } : {}),
          },
        },
        tx,
      )
    }
    const out = await getTaskById(s, access.project_id, id)
    if (!out) throw new ObraAccessError(404, NOT_FOUND)
    return out
  })) as ObraTask
}

/** Marca o desmarca un ítem del checklist (mismos permisos que el cambio de estado). */
export async function toggleChecklistItem(userId: number, taskId: number, index: number, done: boolean): Promise<ObraTask> {
  const { access, taskId: id } = await resolveTaskAccess(userId, taskId)
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    throw new ObraValidationError("El ítem del checklist no existe.")
  }
  if (typeof done !== "boolean") throw new ObraValidationError("Indica si el ítem está hecho.")

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const cur = await lockTask(s, access.project_id, id)
    assertCanWork(cur, access)
    const checklist = parseChecklist(cur.checklist)
    if (index >= checklist.length) throw new ObraValidationError("El ítem del checklist no existe.")
    if (checklist[index].done !== done) {
      checklist[index] = { ...checklist[index], done }
      await s`
        UPDATE obra_tasks SET checklist = ${s.json(checklist)}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}
      `
      await writeAudit(
        {
          project_id: access.project_id,
          actor_user_id: userId,
          action: "task.checklist_toggled",
          entity_type: "task",
          entity_id: id,
          details: { index, done, text: checklist[index].text },
        },
        tx,
      )
    }
    const out = await getTaskById(s, access.project_id, id)
    if (!out) throw new ObraAccessError(404, NOT_FOUND)
    return out
  })) as ObraTask
}
