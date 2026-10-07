/**
 * Capas de plano por especialidad (obra_plan_layers). Solo servidor; sin
 * "use server": cada función recibe el actorUserId explícito y autoriza
 * contra el proyecto resuelto desde la BD.
 *
 * - La imagen de la lámina se guarda en el bucket privado (o inline sin
 *   Supabase) y se sirve solo por /api/obra/layers/[id]/image con control de
 *   acceso. image_data nunca viaja en los DTO.
 * - Láminas grandes: createLayerUploadTicket firma una subida directa del
 *   navegador al bucket (obra/<proyecto>/uploads/<uuid>.<ext>), con cuota por
 *   persona y por obra, y la registra en obra_layer_uploads. createLayer
 *   recibe `image_upload` con esa ruta: exige un permiso PROPIO sin usar, y
 *   verifica el objeto (que sea del proyecto, exista, pese ≤ 25 MB y sea
 *   PNG/JPEG/WebP real) antes de guardarla; una misma ruta no se puede usar en
 *   dos capas. Si la capa no se crea por un error de validación, el objeto se
 *   borra; los de permisos vencidos que nunca quedaron en una capa los borra
 *   sweepAbandonedLayerUploads (al pedir cada permiso nuevo).
 * - La lámina subida directo puede traer una copia reducida (≤ 3000 px) que
 *   es la que se envía a la IA de visión (analysis_image_path).
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
import {
  DISCIPLINES,
  type CadOrigin,
  type Discipline,
  type LayerFrame,
  type LayerUploadTicket,
  type PlanLayer,
  type ProjectAccess,
} from "../types"
import {
  asSql,
  cleanLine,
  hasKey,
  layerSelect,
  mapLayer,
  parseCadOrigin,
  requireEnum,
  requireLine,
  requireObject,
  textLength,
  toPositiveInt,
  type LayerRow,
  type Queryable,
} from "./mappers"
import {
  AI_IMAGE_MAX_BYTES,
  createObraSignedDownloadUrl,
  decodeImageDataUrl,
  deleteObraObject,
  deleteObraObjects,
  formatMegabytes,
  isLayerUploadPath,
  isSupabaseStorageEnabled,
  MAX_IMAGE_DIMENSION_PX,
  newLayerUploadPath,
  normalizeImageMime,
  PLAN_INLINE_MAX_BYTES,
  PLAN_UPLOAD_MAX_BYTES,
  readStoredImage,
  SIGNED_UPLOAD_EXPIRES_IN_S,
  signObraUpload,
  storeLayerAnalysisImage,
  storeLayerImage,
  verifyUploadedObraImage,
  type DecodedImage,
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

/**
 * Espacio de claves del advisory lock (pg_advisory_xact_lock(int, int)) que
 * serializa, por proyecto, el uso de láminas subidas directo (una ruta no puede
 * quedar en dos capas aunque lleguen dos createLayer a la vez).
 */
const LAYER_UPLOAD_LOCK_NS = 7262008

/**
 * Cuota de permisos de subida directa (cada uno permite subir hasta 25 MB):
 * por persona y hora (en todas sus obras) y por obra y día. Límite blando,
 * como assertAiQuota.
 */
export const LAYER_UPLOAD_QUOTA = { perUserHour: 30, perProjectDay: 150 } as const

/** Permisos vencidos (2 h) que se limpian por llamada a sweepAbandonedLayerUploads. */
const UPLOAD_SWEEP_BATCH = 20

/** Mismo mensaje si el objeto no existe o la ruta no tiene un permiso propio sin usar (no revela cuál). */
const UPLOAD_NOT_FOUND = "No se encontró la imagen subida. Vuelve a subir el archivo."

export type LayerImageInput = { data_url: string; width_px: number; height_px: number }

/**
 * Lámina ya subida directo al bucket con un LayerUploadTicket. `analysis_data_url`
 * (opcional): copia reducida (data URL de ≤ AI_IMAGE_MAX_BYTES) para la IA.
 */
export type LayerImageUploadInput = { path: string; width_px: number; height_px: number; analysis_data_url?: string | null }

export type LayerUploadTicketInput = { mime: string; size_bytes: number }

export type CreateLayerInput = {
  name: string
  discipline: Discipline
  level: number
  level_label?: string | null
  image?: LayerImageInput | null
  /** Alternativa a `image` para láminas grandes: ruta devuelta por createLayerUploadTicket (mismo proyecto). */
  image_upload?: LayerImageUploadInput | null
  width_m?: number
  aspect?: number
  /** Solo DXF: origen CAD de la lámina (ver dxfToElementDrafts). Alinea la capa con otras DXF del nivel. */
  cad_origin?: CadOrigin | null
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
    throw new ObraValidationError(
      `La proporción alto/ancho de la lámina debe ser mayor que 0 y como máximo ${LAYER_LIMITS.aspectMax}.`,
    )
  }
  return v
}

/** Proporción alto/ancho de una imagen (lámina): mismo rango que normAspect, con un mensaje sobre la imagen. */
function imageAspect(widthPx: number, heightPx: number): number {
  const a = heightPx / widthPx
  if (!finite(a) || a <= 0 || a > LAYER_LIMITS.aspectMax) {
    throw new ObraValidationError(
      `La lámina es demasiado angosta: su alto no puede superar ${LAYER_LIMITS.aspectMax} veces su ancho. Recórtala o usa otra.`,
    )
  }
  return a
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

const CAD_COORD_MAX = 1e12

/** Origen CAD de una capa DXF: números finitos y ancho positivo (o null). */
function normCadOrigin(v: unknown): CadOrigin | null {
  if (v === null || v === undefined) return null
  const o = requireObject(v, "El origen del DXF no es válido.")
  const ok = (x: unknown): x is number => finite(x) && Math.abs(x) <= CAD_COORD_MAX
  if (!ok(o.min_x) || !ok(o.max_y) || !ok(o.width_units) || o.width_units <= 0) {
    throw new ObraValidationError("El origen del DXF no es válido.")
  }
  return { min_x: o.min_x, max_y: o.max_y, width_units: o.width_units }
}

function round6(n: number): number {
  const r = Math.round(n * 1e6) / 1e6
  return r === 0 ? 0 : r
}

/**
 * Marco de una capa DXF nueva para que el mismo punto CAD caiga en el mismo
 * lugar del nivel que en la capa DXF de referencia (misma rotación; el
 * desplazamiento es el de la referencia más la diferencia de origen, rotada).
 * null si las escalas no coinciden (±1 %: otras unidades u otro ancho) o si el
 * desplazamiento excede el límite: en ese caso se alinea a mano.
 */
export function alignCadFrame(
  cad: CadOrigin,
  widthM: number,
  ref: { cad: CadOrigin; frame: Pick<LayerFrame, "width_m" | "offset_x_m" | "offset_y_m" | "rotation_deg"> },
): { offset_x_m: number; offset_y_m: number; rotation_deg: number } | null {
  const kRef = ref.frame.width_m / ref.cad.width_units
  const kNew = widthM / cad.width_units
  if (!(kRef > 0) || !Number.isFinite(kRef) || Math.abs(kNew - kRef) > 0.01 * kRef) return null
  const dx = (cad.min_x - ref.cad.min_x) * kRef
  const dy = (ref.cad.max_y - cad.max_y) * kRef
  const t = (ref.frame.rotation_deg * Math.PI) / 180
  const c = Math.cos(t)
  const sn = Math.sin(t)
  const ox = ref.frame.offset_x_m + dx * c - dy * sn
  const oy = ref.frame.offset_y_m + dx * sn + dy * c
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null
  if (Math.abs(ox) > LAYER_LIMITS.offsetMax || Math.abs(oy) > LAYER_LIMITS.offsetMax) return null
  return { offset_x_m: round6(ox), offset_y_m: round6(oy), rotation_deg: ref.frame.rotation_deg }
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

type NormalizedUpload = { path: string; width_px: number; height_px: number; analysis: DecodedImage | null }

/** Valida la referencia a una lámina subida directo: ruta exacta del MISMO proyecto y dimensiones declaradas. */
function normImageUpload(v: unknown, projectId: number): NormalizedUpload {
  const o = requireObject(v, "La imagen subida de la capa no es válida.")
  if (!isSupabaseStorageEnabled()) {
    throw new ObraValidationError("La subida directa de planos requiere Supabase Storage, que no está configurado.")
  }
  if (!isLayerUploadPath(projectId, o.path)) {
    throw new ObraValidationError("La imagen subida no corresponde a esta obra o su ruta no es válida.")
  }
  const width = normPx(o.width_px)
  const height = normPx(o.height_px)
  if (width == null || height == null) throw new ObraValidationError("Faltan las dimensiones de la imagen subida.")
  let analysis: DecodedImage | null = null
  if (o.analysis_data_url !== undefined && o.analysis_data_url !== null) {
    analysis = decodeImageDataUrl(o.analysis_data_url, "La copia reducida de la lámina")
    if (analysis.bytes.length > AI_IMAGE_MAX_BYTES) {
      throw new ObraValidationError(
        `La copia reducida de la lámina supera el máximo de ${formatMegabytes(AI_IMAGE_MAX_BYTES)}.`,
      )
    }
  }
  return { path: o.path, width_px: width, height_px: height, analysis }
}

/** ¿Alguna capa (borrada o no) usa esta lámina subida? */
async function isUploadUsed(q: Queryable, path: string): Promise<boolean> {
  const s = asSql(q)
  const rows = await s<{ id: number }[]>`SELECT id FROM obra_plan_layers WHERE image_path = ${path} LIMIT 1`
  return Boolean(rows[0])
}

/** Una lámina subida solo puede quedar en una capa (borrada o no). */
async function assertUploadUnused(q: Queryable, path: string): Promise<void> {
  if (await isUploadUsed(q, path)) {
    throw new ObraValidationError("Esa imagen subida ya se usó en otra capa. Vuelve a subir el archivo.")
  }
}

type UploadTicketRow = { id: number; used_at: Date | null; discarded_at: Date | null }

/**
 * Permiso de subida de ESTA persona para esa ruta y obra, sin usar ni
 * descartado (o ObraValidationError genérico). `lock` = FOR UPDATE (solo
 * dentro de sql.begin): así la limpieza (SKIP LOCKED) no lo descarta mientras
 * se crea la capa.
 */
async function requireOwnUploadTicket(
  q: Queryable,
  access: ProjectAccess,
  path: string,
  lock: boolean,
): Promise<number> {
  const s = asSql(q)
  const rows = await s<UploadTicketRow[]>`
    SELECT id, used_at, discarded_at FROM obra_layer_uploads
    WHERE path = ${path} AND project_id = ${access.project_id} AND user_id = ${access.user_id}
    ${lock ? s`FOR UPDATE` : s``}
  `
  const t = rows[0]
  if (!t || t.used_at != null || t.discarded_at != null) throw new ObraValidationError(UPLOAD_NOT_FOUND)
  return Number(t.id)
}

/**
 * Descarta una lámina subida directo que no llegó a una capa (p.ej. la capa no
 * se creó por un error de validación): marca SU permiso como descartado y
 * borra el objeto. Nunca toca un permiso ajeno ni una ruta que alguna capa
 * use (mismo advisory lock que createLayer). Mejor esfuerzo.
 */
async function discardOwnUpload(access: ProjectAccess, path: string): Promise<void> {
  try {
    const discarded = (await sql.begin(async (tx) => {
      const s = asSql(tx)
      await s`SELECT pg_advisory_xact_lock(${LAYER_UPLOAD_LOCK_NS}::int, ${access.project_id}::int)`
      if (await isUploadUsed(s, path)) return false
      const rows = await s<{ id: number }[]>`
        UPDATE obra_layer_uploads SET discarded_at = LOCALTIMESTAMP
        WHERE path = ${path} AND project_id = ${access.project_id} AND user_id = ${access.user_id}
          AND used_at IS NULL AND discarded_at IS NULL
        RETURNING id
      `
      return Boolean(rows[0])
    })) as boolean
    if (discarded) await deleteObraObject(path)
  } catch (e) {
    console.error("[obra/layers] no se pudo descartar la lámina subida", e)
  }
}

/**
 * Borra del bucket las láminas de permisos vencidos hace más de una hora que
 * no quedaron en ninguna capa (subida abandonada, diálogo cerrado, capa que
 * falló), de cualquier obra, de a UPLOAD_SWEEP_BATCH. Se llama al pedir un
 * permiso nuevo; mejor esfuerzo. Devuelve cuántos objetos descartó.
 */
export async function sweepAbandonedLayerUploads(limit: number = UPLOAD_SWEEP_BATCH): Promise<number> {
  if (!isSupabaseStorageEnabled()) return 0
  const paths = (await sql.begin(async (tx) => {
    const s = asSql(tx)
    const rows = await s<{ id: number; path: string }[]>`
      SELECT id, path FROM obra_layer_uploads
      WHERE used_at IS NULL AND discarded_at IS NULL AND expires_at < LOCALTIMESTAMP - interval '1 hour'
      ORDER BY expires_at
      LIMIT ${Math.max(1, Math.min(100, Math.floor(limit)))}
      FOR UPDATE SKIP LOCKED
    `
    if (rows.length === 0) return []
    const used = await s<{ image_path: string }[]>`
      SELECT image_path FROM obra_plan_layers WHERE image_path IN ${s(rows.map((r) => r.path))}
    `
    const usedPaths = new Set(used.map((r) => r.image_path))
    const keep = rows.filter((r) => usedPaths.has(r.path)).map((r) => Number(r.id))
    const drop = rows.filter((r) => !usedPaths.has(r.path))
    if (keep.length > 0) await s`UPDATE obra_layer_uploads SET used_at = LOCALTIMESTAMP WHERE id IN ${s(keep)}`
    if (drop.length > 0) {
      await s`UPDATE obra_layer_uploads SET discarded_at = LOCALTIMESTAMP WHERE id IN ${s(drop.map((r) => Number(r.id)))}`
    }
    return drop.map((r) => r.path)
  })) as string[]
  if (paths.length > 0) await deleteObraObjects(paths)
  return paths.length
}

/** Cuota de permisos de subida (LAYER_UPLOAD_QUOTA) o ObraValidationError. */
async function assertUploadQuota(access: ProjectAccess): Promise<void> {
  const rows = await sql<{ user_hour: number; project_day: number }[]>`
    SELECT
      (SELECT COUNT(*) FROM obra_layer_uploads
        WHERE user_id = ${access.user_id} AND created_at > LOCALTIMESTAMP - interval '1 hour')::int AS user_hour,
      (SELECT COUNT(*) FROM obra_layer_uploads
        WHERE project_id = ${access.project_id} AND created_at > LOCALTIMESTAMP - interval '1 day')::int AS project_day
  `
  const r = rows[0]
  if (Number(r?.user_hour ?? 0) >= LAYER_UPLOAD_QUOTA.perUserHour) {
    throw new ObraValidationError(
      `Alcanzaste el máximo de ${LAYER_UPLOAD_QUOTA.perUserHour} subidas de láminas grandes por hora. Intenta de nuevo más tarde.`,
    )
  }
  if (Number(r?.project_day ?? 0) >= LAYER_UPLOAD_QUOTA.perProjectDay) {
    throw new ObraValidationError(
      `Esta obra alcanzó el máximo diario de ${LAYER_UPLOAD_QUOTA.perProjectDay} subidas de láminas grandes. Intenta de nuevo mañana.`,
    )
  }
}

/** Mensaje cuando no hay Supabase Storage: indica el tamaño que sí cabe inline. */
function directUploadUnavailableMessage(): string {
  return `La subida de planos grandes requiere Supabase Storage; reduce el archivo a menos de ${formatMegabytes(PLAN_INLINE_MAX_BYTES)}.`
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
 * Permiso firmado (plans.manage) para que el navegador suba una lámina grande
 * DIRECTO al bucket privado, sin pasar el archivo por la server action. Solo
 * con Supabase Storage configurado; PNG, JPEG o WebP de hasta 25 MB; con
 * cuota (LAYER_UPLOAD_QUOTA). La ruta (obra/<proyecto>/uploads/<uuid>.<ext>)
 * queda registrada a nombre de quien la pidió y se usa después, por esa misma
 * persona, en createLayer({ image_upload: { path, width_px, height_px } }).
 */
export async function createLayerUploadTicket(
  userId: number,
  projectId: number,
  input: LayerUploadTicketInput,
): Promise<LayerUploadTicket> {
  const access = await requireProjectPermissionForUser(userId, projectId, "plans.manage")
  const o = requireObject(input, "Datos de la subida no válidos.")
  if (!isSupabaseStorageEnabled()) throw new ObraValidationError(directUploadUnavailableMessage())
  const mime = normalizeImageMime(o.mime)
  if (!mime) throw new ObraValidationError("La lámina debe ser una imagen PNG, JPG o WebP.")
  const size = o.size_bytes
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1) {
    throw new ObraValidationError("El tamaño del archivo no es válido.")
  }
  if (size > PLAN_UPLOAD_MAX_BYTES) {
    throw new ObraValidationError(
      `La lámina supera el máximo de ${formatMegabytes(PLAN_UPLOAD_MAX_BYTES)}. Exporta solo la lámina necesaria o con menor resolución.`,
    )
  }
  await assertUploadQuota(access)
  try {
    await sweepAbandonedLayerUploads()
  } catch (e) {
    console.error("[obra/layers] limpieza de subidas abandonadas", e)
  }
  const path = newLayerUploadPath(access.project_id, mime)
  const ins = await sql<{ id: number }[]>`
    INSERT INTO obra_layer_uploads (project_id, user_id, path, mime_type, size_bytes, expires_at)
    VALUES (
      ${access.project_id}, ${userId}, ${path}, ${mime}, ${size},
      LOCALTIMESTAMP + make_interval(secs => ${SIGNED_UPLOAD_EXPIRES_IN_S}::int)
    )
    RETURNING id
  `
  let signed: Awaited<ReturnType<typeof signObraUpload>>
  try {
    signed = await signObraUpload(path)
  } catch (e) {
    // Sin firma no hay subida posible: el permiso no cuenta para la cuota.
    await sql`DELETE FROM obra_layer_uploads WHERE id = ${Number(ins[0].id)}`.catch(() => undefined)
    throw e
  }
  return {
    path,
    upload_url: signed.upload_url,
    token: signed.token,
    expires_in: signed.expires_in,
    max_bytes: PLAN_UPLOAD_MAX_BYTES,
    mime,
  }
}

/**
 * Crea una capa (plans.manage). La lámina llega inline (`image`, data URL) o
 * ya subida al bucket (`image_upload`, ver createLayerUploadTicket), nunca
 * ambas. Si trae imagen, la proporción del marco es alto/ancho de la imagen
 * real; si no, `aspect` (o 0,7). Ancho por defecto 50 m.
 * Si es DXF (`cad_origin`) y ya hay otra capa DXF en el mismo nivel, nace
 * alineada con ella usando las coordenadas del dibujo (alignCadFrame).
 */
export async function createLayer(userId: number, projectId: number, input: CreateLayerInput): Promise<PlanLayer> {
  const access = await requireProjectPermissionForUser(userId, projectId, "plans.manage")
  const o = requireObject(input, "Datos de la capa no válidos.")
  const name = normName(o.name)
  const discipline = normDiscipline(o.discipline)
  const level = normLevel(o.level)
  const levelLabel = normLevelLabel(o.level_label)
  const widthM = o.width_m === undefined || o.width_m === null ? DEFAULT_FRAME.width_m : normWidth(o.width_m)
  const hasInline = o.image !== undefined && o.image !== null
  const hasUpload = o.image_upload !== undefined && o.image_upload !== null
  if (hasInline && hasUpload) {
    throw new ObraValidationError("Envía la lámina de una sola forma: como imagen o como archivo ya subido, no ambas.")
  }
  const image = normImage(o.image)
  const upload = hasUpload ? normImageUpload(o.image_upload, access.project_id) : null
  const cadOrigin = normCadOrigin(o.cad_origin)

  // Lámina subida directo: antes de tocar el objeto se comprueba que ninguna capa lo use
  // (verifyUploadedObraImage borra los archivos inválidos y no debe borrar la imagen de otra capa)
  // y que la ruta tenga un permiso de subida de ESTA persona sin usar.
  if (upload) {
    await assertUploadUnused(sql, upload.path)
    await requireOwnUploadTicket(sql, access, upload.path, false)
  }
  if (image) imageAspect(image.width_px, image.height_px)
  try {
    // Con las dimensiones declaradas, antes de leer el objeto (las reales se revisan otra vez).
    if (upload) imageAspect(upload.width_px, upload.height_px)
    return await createLayerWithImage()
  } catch (e) {
    // La lámina subida no llegó a una capa por un error de validación: se descarta (la siguiente
    // vez se sube de nuevo). Otros errores (red, BD) la dejan para reintentar con la misma ruta;
    // si nunca se usa, la borra sweepAbandonedLayerUploads.
    if (upload && e instanceof ObraValidationError) await discardOwnUpload(access, upload.path)
    throw e
  }

  async function createLayerWithImage(): Promise<PlanLayer> {
    let uploaded: { path: string; mime: ImageMime; size: number; width_px: number; height_px: number } | null = null
    if (upload) {
      const v = await verifyUploadedObraImage(upload.path, PLAN_UPLOAD_MAX_BYTES)
      // Las dimensiones reales del archivo mandan sobre las declaradas.
      uploaded = {
        path: upload.path,
        mime: v.mime,
        size: v.size,
        width_px: v.width_px ?? upload.width_px,
        height_px: v.height_px ?? upload.height_px,
      }
    }
    const picture = image
      ? { mime: image.mime, width_px: image.width_px, height_px: image.height_px, bytes: image.bytes.length }
      : uploaded
        ? { mime: uploaded.mime, width_px: uploaded.width_px, height_px: uploaded.height_px, bytes: uploaded.size }
        : null
    const aspect = picture
      ? imageAspect(picture.width_px, picture.height_px)
      : o.aspect === undefined || o.aspect === null
        ? DEFAULT_FRAME.aspect
        : normAspect(o.aspect)

    // Se reserva el id antes de subir la imagen: así la subida (red) ocurre fuera
    // de la transacción y la ruta del objeto lleva el id de la capa.
    const seq = await sql<{ id: number }[]>`SELECT nextval(pg_get_serial_sequence('obra_plan_layers', 'id'))::int AS id`
    const layerId = Number(seq[0].id)
    const stored = image
      ? await storeLayerImage(access.project_id, layerId, image)
      : { image_path: uploaded?.path ?? null, image_data: null }
    // Solo se limpian los objetos que esta llamada subió (la lámina inline y la copia para la IA):
    // la lámina subida directo se maneja aparte (ver arriba).
    const ownedPaths: string[] = image && stored.image_path ? [stored.image_path] : []
    let analysisPath: string | null = null

    try {
      if (uploaded && upload?.analysis) {
        analysisPath = await storeLayerAnalysisImage(access.project_id, layerId, upload.analysis)
        ownedPaths.push(analysisPath)
      }
      return (await sql.begin(async (tx) => {
        const s = asSql(tx)
        let ticketId: number | null = null
        if (uploaded) {
          await s`SELECT pg_advisory_xact_lock(${LAYER_UPLOAD_LOCK_NS}::int, ${access.project_id}::int)`
          await assertUploadUnused(s, uploaded.path)
          ticketId = await requireOwnUploadTicket(s, access, uploaded.path, true)
        }
        let frame = { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }
        let alignedWith: number | null = null
        if (cadOrigin) {
          const refs = await s<
            { id: number; width_m: number; offset_x_m: number; offset_y_m: number; rotation_deg: number; cad_origin: unknown }[]
          >`
            SELECT id, width_m, offset_x_m, offset_y_m, rotation_deg, cad_origin
            FROM obra_plan_layers
            WHERE project_id = ${access.project_id} AND level = ${level} AND deleted_at IS NULL AND cad_origin IS NOT NULL
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          `
          const refCad = refs[0] ? parseCadOrigin(refs[0].cad_origin) : null
          if (refs[0] && refCad) {
            const aligned = alignCadFrame(cadOrigin, widthM, {
              cad: refCad,
              frame: {
                width_m: Number(refs[0].width_m),
                offset_x_m: Number(refs[0].offset_x_m),
                offset_y_m: Number(refs[0].offset_y_m),
                rotation_deg: Number(refs[0].rotation_deg),
              },
            })
            if (aligned) {
              frame = aligned
              alignedWith = Number(refs[0].id)
            }
          }
        }
        await s`
          INSERT INTO obra_plan_layers (
            id, project_id, name, discipline, level, level_label, image_path, image_data, mime_type,
            width_px, height_px, width_m, aspect, offset_x_m, offset_y_m, rotation_deg, cad_origin, uploaded_by,
            analysis_image_path
          ) VALUES (
            ${layerId}, ${access.project_id}, ${name}, ${discipline}, ${level}, ${levelLabel},
            ${stored.image_path}, ${stored.image_data}, ${picture?.mime ?? null},
            ${picture?.width_px ?? null}, ${picture?.height_px ?? null}, ${widthM}, ${aspect},
            ${frame.offset_x_m}, ${frame.offset_y_m}, ${frame.rotation_deg},
            ${cadOrigin ? s.json(cadOrigin) : null}, ${userId}, ${analysisPath}
          )
        `
        if (ticketId != null) {
          await s`UPDATE obra_layer_uploads SET used_at = LOCALTIMESTAMP, layer_id = ${layerId} WHERE id = ${ticketId}`
        }
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
              has_image: Boolean(picture),
              mime_type: picture?.mime ?? null,
              bytes: picture?.bytes ?? 0,
              ...(uploaded ? { direct_upload: true, analysis_copy: analysisPath != null } : {}),
              width_m: widthM,
              ...(cadOrigin ? { dxf: true, aligned_with_layer_id: alignedWith } : {}),
            },
          },
          tx,
        )
        const layer = await getLayerById(s, access.project_id, layerId)
        if (!layer) throw new Error("No se pudo leer la capa recién creada")
        return layer
      })) as PlanLayer
    } catch (e) {
      if (ownedPaths.length > 0) await deleteObraObjects(ownedPaths)
      throw e
    }
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
    // Las sugerencias pendientes de la capa (elementos detectados) y de los hallazgos ubicados en
    // ella ya no se pueden aplicar: pasan a 'superseded'. Se bloquean ANTES que la capa, el mismo
    // orden que approveSuggestion (sugerencia → capa), para no interbloquearse.
    const pending = await s<{ id: number }[]>`
      SELECT s.id FROM obra_ai_suggestions s
      WHERE s.project_id = ${access.project_id} AND s.status = 'pending'
        AND (
          s.layer_id = ${id}
          OR s.finding_id IN (SELECT p.finding_id FROM obra_finding_pins p WHERE p.layer_id = ${id})
        )
      ORDER BY s.id
      FOR UPDATE OF s
    `
    const rows = await s<{ name: string; discipline: string; level: number }[]>`
      UPDATE obra_plan_layers SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND project_id = ${access.project_id} AND deleted_at IS NULL
      RETURNING name, discipline, level
    `
    if (!rows[0]) throw new ObraAccessError(404, NOT_FOUND)
    const superseded =
      pending.length > 0
        ? await s<{ id: number }[]>`
            UPDATE obra_ai_suggestions SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
            WHERE id IN ${s(pending.map((r) => Number(r.id)))} AND status = 'pending'
            RETURNING id
          `
        : []
    await writeAudit(
      {
        project_id: access.project_id,
        actor_user_id: userId,
        action: "layer.deleted",
        entity_type: "layer",
        entity_id: id,
        details: {
          name: rows[0].name,
          discipline: rows[0].discipline,
          level: Number(rows[0].level),
          ...(superseded.length > 0 ? { superseded_suggestion_ids: superseded.map((r) => Number(r.id)) } : {}),
        },
      },
      tx,
    )
  })
  return { project_id: access.project_id }
}

/**
 * URL firmada de descarga (plans.view, válida `expiresIn` s) de la lámina de
 * una capa guardada en el bucket, o null si es inline o no hay Supabase.
 * Permite que /api/obra/layers/[id]/image redirija las láminas grandes en vez
 * de pasar sus bytes por la función.
 */
export async function getLayerImageSignedUrl(userId: number, layerId: number, expiresIn = 300): Promise<string | null> {
  const { access, layerId: id } = await authorizeLayer(userId, layerId, "plans.view")
  const rows = await sql<{ image_path: string | null; image_data: string | null }[]>`
    SELECT image_path, image_data FROM obra_plan_layers
    WHERE id = ${id} AND project_id = ${access.project_id} AND deleted_at IS NULL
  `
  const row = rows[0]
  if (!row || (!row.image_path && !row.image_data)) throw new ObraAccessError(404, "La capa no tiene imagen.")
  if (!row.image_path || !isSupabaseStorageEnabled()) return null
  return createObraSignedDownloadUrl(row.image_path, expiresIn)
}

/** Imagen de una capa (plans.view), con el tipo real detectado en sus bytes (inline o del bucket, hasta 25 MB). */
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
