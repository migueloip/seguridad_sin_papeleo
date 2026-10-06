/**
 * Capas de plano por especialidad (obra_plan_layers). Solo servidor; sin
 * "use server": cada función recibe el actorUserId explícito y autoriza
 * contra el proyecto resuelto desde la BD.
 *
 * - La imagen de la lámina se guarda en el bucket privado (o inline sin
 *   Supabase) y se sirve solo por /api/obra/layers/[id]/image con control de
 *   acceso. image_data nunca viaja en los DTO.
 * - El borrado es lógico (deleted_at): los elementos y pines quedan en la BD
 *   pero dejan de listarse.
 */
import { sql } from "@/lib/db"
import {
  getProjectAccessForUser,
  ObraAccessError,
  ObraValidationError,
  requireProjectPermissionForUser,
  writeAudit,
} from "../access"
import { DEFAULT_FRAME } from "../geometry"
import { can, type Permission } from "../permissions"
import { DISCIPLINES, type Discipline, type LayerFrame, type PlanLayer, type ProjectAccess } from "../types"
import {
  asSql,
  cleanLine,
  hasKey,
  layerSelect,
  mapLayer,
  requireEnum,
  requireLine,
  requireObject,
  textLength,
  toPositiveInt,
  type LayerRow,
  type Queryable,
} from "./mappers"
import {
  decodeImageDataUrl,
  deleteObraObject,
  MAX_IMAGE_DIMENSION_PX,
  readStoredImage,
  storeLayerImage,
  type ImageMime,
} from "./storage"

export const LAYER_LIMITS = {
  nameMin: 1,
  nameMax: 120,
  levelMin: -10,
  levelMax: 200,
  levelLabelMax: 100,
  widthMin: 1,
  widthMax: 5000,
  aspectMax: 100,
  offsetMax: 10_000,
  rotationMin: -360,
  rotationMax: 360,
  list: 500,
} as const

const NOT_FOUND = "Capa no encontrada."

export type LayerImageInput = { data_url: string; width_px: number; height_px: number }

export type CreateLayerInput = {
  name: string
  discipline: Discipline
  level: number
  level_label?: string | null
  image?: LayerImageInput | null
  width_m?: number
  aspect?: number
}

export type UpdateLayerPatch = {
  name?: string
  discipline?: Discipline
  level?: number
  level_label?: string | null
  frame?: Partial<LayerFrame>
  opacity?: number
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

function normName(v: unknown): string {
  return requireLine(v, "El nombre de la capa", LAYER_LIMITS.nameMin, LAYER_LIMITS.nameMax)
}

function normDiscipline(v: unknown): Discipline {
  return requireEnum(v, DISCIPLINES, "Especialidad no válida.")
}

function normLevel(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < LAYER_LIMITS.levelMin || v > LAYER_LIMITS.levelMax) {
    throw new ObraValidationError(
      `El nivel debe ser un número entero entre ${LAYER_LIMITS.levelMin} y ${LAYER_LIMITS.levelMax}.`,
    )
  }
  return v
}

function normLevelLabel(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== "string") throw new ObraValidationError("La etiqueta del nivel no es válida.")
  const s = cleanLine(v)
  if (!s) return null
  if (textLength(s) > LAYER_LIMITS.levelLabelMax) {
    throw new ObraValidationError(`La etiqueta del nivel admite como máximo ${LAYER_LIMITS.levelLabelMax} caracteres.`)
  }
  return s
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

function normWidth(v: unknown): number {
  if (!finite(v) || v < LAYER_LIMITS.widthMin || v > LAYER_LIMITS.widthMax) {
    throw new ObraValidationError(
      `El ancho real de la lámina debe estar entre ${LAYER_LIMITS.widthMin} y ${LAYER_LIMITS.widthMax} metros.`,
    )
  }
  return v
}

function normAspect(v: unknown): number {
  if (!finite(v) || v <= 0 || v > LAYER_LIMITS.aspectMax) {
    throw new ObraValidationError("La proporción alto/ancho de la lámina debe ser un número mayor que 0.")
  }
  return v
}

function normOffset(v: unknown, label: string): number {
  if (!finite(v) || Math.abs(v) > LAYER_LIMITS.offsetMax) {
    throw new ObraValidationError(`${label} debe estar entre −${LAYER_LIMITS.offsetMax} y ${LAYER_LIMITS.offsetMax} metros.`)
  }
  return v
}

function normRotation(v: unknown): number {
  if (!finite(v) || v < LAYER_LIMITS.rotationMin || v > LAYER_LIMITS.rotationMax) {
    throw new ObraValidationError("La rotación debe estar entre −360 y 360 grados.")
  }
  return v
}

function normOpacity(v: unknown): number {
  if (!finite(v) || v < 0 || v > 1) throw new ObraValidationError("La opacidad debe estar entre 0 y 1.")
  return v
}

function normPx(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_IMAGE_DIMENSION_PX) {
    throw new ObraValidationError("Las dimensiones de la imagen no son válidas.")
  }
  return v
}

type NormalizedImage = {
  bytes: Buffer
  mime: ImageMime
  ext: string
  width_px: number
  height_px: number
}

/** Valida la imagen de la capa; las dimensiones reales del archivo mandan sobre las declaradas. */
function normImage(v: unknown): NormalizedImage | null {
  if (v === null || v === undefined) return null
  const o = requireObject(v, "La imagen de la capa no es válida.")
  const img = decodeImageDataUrl(o.data_url, "La imagen de la capa")
  const declaredW = normPx(o.width_px)
  const declaredH = normPx(o.height_px)
  const width = img.width_px ?? declaredW
  const height = img.height_px ?? declaredH
  if (width == null || height == null) throw new ObraValidationError("No se pudo leer el tamaño de la imagen de la capa.")
  return { bytes: img.bytes, mime: img.mime, ext: img.ext, width_px: width, height_px: height }
}

// ---------------------------------------------------------------------------
// Acceso por capa (proyecto resuelto desde la BD)
// ---------------------------------------------------------------------------

type LayerAccess = { access: ProjectAccess; layerId: number }

/**
 * Resuelve el proyecto de una capa NO borrada y autoriza contra ESE proyecto:
 * 404 si no existe, está borrada o el usuario no tiene acceso; 403 si su rol
 * no tiene el permiso.
 */
export async function authorizeLayer(userId: number, layerId: unknown, permission: Permission): Promise<LayerAccess> {
  const id = toPositiveInt(layerId)
  if (id == null) throw new ObraAccessError(404, NOT_FOUND)
  const rows = await sql<{ project_id: number }[]>`
    SELECT project_id FROM obra_plan_layers WHERE id = ${id} AND deleted_at IS NULL
  `
  if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
  const access = await getProjectAccessForUser(userId, Number(rows[0].project_id))
  if (!access) throw new ObraAccessError(404, NOT_FOUND)
  if (!can(access.role, permission)) throw new ObraAccessError(403, "Tu rol en esta obra no permite esta acción.")
  return { access, layerId: id }
}

/** Lee una capa (no borrada) del proyecto como DTO, o null. */
export async function getLayerById(q: Queryable, projectId: number, layerId: number): Promise<PlanLayer | null> {
  const s = asSql(q)
  const rows = await s<LayerRow[]>`
    ${layerSelect(s)}
    WHERE l.id = ${layerId} AND l.project_id = ${projectId} AND l.deleted_at IS NULL
    LIMIT 1
  `
  return rows[0] ? mapLayer(rows[0]) : null
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Capas no borradas del proyecto, por nivel y especialidad, con su cantidad de elementos. */
export async function listLayers(userId: number, projectId: number): Promise<PlanLayer[]> {
  const access = await requireProjectPermissionForUser(userId, projectId, "plans.view")
  const rows = await sql<LayerRow[]>`
    ${layerSelect(sql)}
    WHERE l.project_id = ${access.project_id} AND l.deleted_at IS NULL
    ORDER BY l.level ASC, l.discipline ASC, l.name ASC, l.id ASC
    LIMIT ${LAYER_LIMITS.list}
  `
  return rows.map(mapLayer)
}

/**
 * Crea una capa (plans.manage). Si trae imagen, la proporción del marco es
 * alto/ancho de la imagen real; si no, `aspect` (o 0,7). Ancho por defecto 50 m.
 */
export async function createLayer(userId: number, projectId: number, input: CreateLayerInput): Promise<PlanLayer> {
  const access = await requireProjectPermissionForUser(userId, projectId, "plans.manage")
  const o = requireObject(input, "Datos de la capa no válidos.")
  const name = normName(o.name)
  const discipline = normDiscipline(o.discipline)
  const level = normLevel(o.level)
  const levelLabel = normLevelLabel(o.level_label)
  const widthM = o.width_m === undefined || o.width_m === null ? DEFAULT_FRAME.width_m : normWidth(o.width_m)
  const image = normImage(o.image)
  let aspect: number
  if (image) aspect = image.height_px / image.width_px
  else aspect = o.aspect === undefined || o.aspect === null ? DEFAULT_FRAME.aspect : normAspect(o.aspect)
  aspect = normAspect(aspect)

  // Se reserva el id antes de subir la imagen: así la subida (red) ocurre fuera
  // de la transacción y la ruta del objeto lleva el id de la capa.
  const seq = await sql<{ id: number }[]>`SELECT nextval(pg_get_serial_sequence('obra_plan_layers', 'id'))::int AS id`
  const layerId = Number(seq[0].id)
  const stored = image ? await storeLayerImage(access.project_id, layerId, image) : { image_path: null, image_data: null }

  try {
    return (await sql.begin(async (tx) => {
      const s = asSql(tx)
      await s`
        INSERT INTO obra_plan_layers (
          id, project_id, name, discipline, level, level_label, image_path, image_data, mime_type,
          width_px, height_px, width_m, aspect, uploaded_by
        ) VALUES (
          ${layerId}, ${access.project_id}, ${name}, ${discipline}, ${level}, ${levelLabel},
          ${stored.image_path}, ${stored.image_data}, ${image?.mime ?? null},
          ${image?.width_px ?? null}, ${image?.height_px ?? null}, ${widthM}, ${aspect}, ${userId}
        )
      `
      await writeAudit(
        {
          project_id: access.project_id,
          actor_user_id: userId,
          action: "layer.created",
          entity_type: "layer",
          entity_id: layerId,
          details: {
            name,
            discipline,
            level,
            has_image: Boolean(image),
            mime_type: image?.mime ?? null,
            bytes: image?.bytes.length ?? 0,
            width_m: widthM,
          },
        },
        tx,
      )
      const layer = await getLayerById(s, access.project_id, layerId)
      if (!layer) throw new Error("No se pudo leer la capa recién creada")
      return layer
    })) as PlanLayer
  } catch (e) {
    if (stored.image_path) await deleteObraObject(stored.image_path)
    throw e
  }
}

/** Normaliza el parche de un marco: solo las claves presentes. */
function normFramePatch(v: unknown): Partial<LayerFrame> {
  const f = requireObject(v, "El marco de la capa no es válido.")
  const out: Partial<LayerFrame> = {}
  if (hasKey(f, "width_m")) out.width_m = normWidth(f.width_m)
  if (hasKey(f, "aspect")) out.aspect = normAspect(f.aspect)
  if (hasKey(f, "offset_x_m")) out.offset_x_m = normOffset(f.offset_x_m, "El desplazamiento horizontal")
  if (hasKey(f, "offset_y_m")) out.offset_y_m = normOffset(f.offset_y_m, "El desplazamiento vertical")
  if (hasKey(f, "rotation_deg")) out.rotation_deg = normRotation(f.rotation_deg)
  return out
}

/**
 * Edita una capa (plans.manage): nombre, especialidad, nivel, etiqueta, marco
 * parcial y opacidad. Si cambia el nivel, los pines y tareas ubicados en la
 * capa se mueven con ella.
 */
export async function updateLayer(userId: number, layerId: number, patch: UpdateLayerPatch): Promise<PlanLayer> {
  const { access, layerId: id } = await authorizeLayer(userId, layerId, "plans.manage")
  const o = requireObject(patch, "Datos de la capa no válidos.")
  const p: {
    name?: string
    discipline?: Discipline
    level?: number
    level_label?: string | null
    frame?: Partial<LayerFrame>
    opacity?: number
  } = {}
  if (hasKey(o, "name")) p.name = normName(o.name)
  if (hasKey(o, "discipline")) p.discipline = normDiscipline(o.discipline)
  if (hasKey(o, "level")) p.level = normLevel(o.level)
  if (hasKey(o, "level_label")) p.level_label = normLevelLabel(o.level_label)
  if (hasKey(o, "frame")) p.frame = normFramePatch(o.frame)
  if (hasKey(o, "opacity")) p.opacity = normOpacity(o.opacity)

  return (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const rows = await s<LayerRow[]>`
      ${layerSelect(s)}
      WHERE l.id = ${id} AND l.project_id = ${access.project_id} AND l.deleted_at IS NULL
      FOR UPDATE OF l
    `
    if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
    const cur = mapLayer(rows[0])
    const next = {
      name: p.name ?? cur.name,
      discipline: p.discipline ?? cur.discipline,
      level: p.level ?? cur.level,
      level_label: p.level_label !== undefined ? p.level_label : cur.level_label,
      frame: { ...cur.frame, ...(p.frame ?? {}) },
      opacity: p.opacity ?? cur.opacity,
    }
    const changes: string[] = []
    if (next.name !== cur.name) changes.push("name")
    if (next.discipline !== cur.discipline) changes.push("discipline")
    if (next.level !== cur.level) changes.push("level")
    if ((next.level_label ?? null) !== (cur.level_label ?? null)) changes.push("level_label")
    for (const k of ["width_m", "aspect", "offset_x_m", "offset_y_m", "rotation_deg"] as const) {
      if (next.frame[k] !== cur.frame[k]) changes.push(`frame.${k}`)
    }
    if (next.opacity !== cur.opacity) changes.push("opacity")
    if (changes.length === 0) return cur

    await s`
      UPDATE obra_plan_layers SET
        name = ${next.name},
        discipline = ${next.discipline},
        level = ${next.level},
        level_label = ${next.level_label},
        width_m = ${next.frame.width_m},
        aspect = ${next.frame.aspect},
        offset_x_m = ${next.frame.offset_x_m},
        offset_y_m = ${next.frame.offset_y_m},
        rotation_deg = ${next.frame.rotation_deg},
        opacity = ${next.opacity},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `
    if (next.level !== cur.level) {
      await s`UPDATE obra_finding_pins SET level = ${next.level} WHERE layer_id = ${id} AND project_id = ${access.project_id}`
      await s`
        UPDATE obra_tasks SET level = ${next.level}, updated_at = CURRENT_TIMESTAMP
        WHERE layer_id = ${id} AND project_id = ${access.project_id}
      `
    }
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "layer.updated",
        entity_type: "layer",
        entity_id: id,
        details: { changes, frame: next.frame, level: next.level },
      },
      tx,
    )
    const out = await getLayerById(s, access.project_id, id)
    if (!out) throw new ObraAccessError(404, NOT_FOUND)
    return out
  })) as PlanLayer
}

/** Borrado lógico de una capa (plans.manage). Devuelve el proyecto para revalidar. */
export async function deleteLayer(userId: number, layerId: number): Promise<{ project_id: number }> {
  const { access, layerId: id } = await authorizeLayer(userId, layerId, "plans.manage")
  await sql.begin(async (tx) => {
    const s = asSql(tx)
    const rows = await s<{ name: string; discipline: string; level: number }[]>`
      UPDATE obra_plan_layers SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND project_id = ${access.project_id} AND deleted_at IS NULL
      RETURNING name, discipline, level
    `
    if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "layer.deleted",
        entity_type: "layer",
        entity_id: id,
        details: { name: rows[0].name, discipline: rows[0].discipline, level: Number(rows[0].level) },
      },
      tx,
    )
  })
  return { project_id: access.project_id }
}

/** Imagen de una capa (plans.view), con el tipo real detectado en sus bytes. */
export async function readLayerImage(userId: number, layerId: number): Promise<{ bytes: Buffer; mime: string }> {
  const { access, layerId: id } = await authorizeLayer(userId, layerId, "plans.view")
  const rows = await sql<{ image_path: string | null; image_data: string | null }[]>`
    SELECT image_path, image_data FROM obra_plan_layers
    WHERE id = ${id} AND project_id = ${access.project_id} AND deleted_at IS NULL
  `
  const row = rows[0]
  if (!row || (!row.image_path && !row.image_data)) throw new ObraAccessError(404, "La capa no tiene imagen.")
  return readStoredImage({ image_path: row.image_path, image_data: row.image_data })
}
