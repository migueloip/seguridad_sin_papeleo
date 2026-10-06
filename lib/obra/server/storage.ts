/**
 * Almacenamiento de imágenes del módulo Obra Integral (láminas de capas y
 * fotos de hallazgos). Solo servidor; sin "use server".
 *
 * - Con SUPABASE_URL y SUPABASE_SERVICE_KEY: bucket PRIVADO "obra-planos"
 *   (se crea una vez por proceso, con file_size_limit y allowed_mime_types;
 *   si ya existía, se verifica que sea privado). Las lecturas usan el
 *   endpoint autenticado con la service key; nunca se exponen URLs públicas.
 * - Sin Supabase: la imagen se guarda inline como data URL (image_data).
 * - Láminas grandes: el navegador sube el archivo DIRECTO al bucket con una
 *   URL firmada de subida (signObraUpload) a obra/<proyecto>/uploads/<uuid>.<ext>,
 *   sin pasar por la server action (Netlify limita el cuerpo a ~6 MB), y luego
 *   el servidor verifica el objeto (verifyUploadedObraImage).
 *
 * Contrato de la API REST de Storage (storage-api / storage-js): los errores
 * llegan con HTTP 400 y el código semántico en el cuerpo
 * ({ statusCode: "404" | "409" | "413" | …, error, message }), salvo los 5xx
 * y el Range imposible (416). Ver tests/obra/fake-supabase-storage.ts.
 *
 * Seguridad: solo se aceptan PNG, JPEG y WebP y se verifican los "magic
 * bytes" reales (el tipo declarado no basta). SVG se rechaza siempre (puede
 * contener scripts). El tipo que se sirve es el detectado en los bytes, no el
 * declarado por el cliente. Inline: hasta 7 MB decodificados; subida directa
 * de láminas: hasta PLAN_UPLOAD_MAX_BYTES (25 MB).
 */
import crypto from "node:crypto"
import { ObraValidationError } from "../access"

export const OBRA_BUCKET = "obra-planos"

/** Prefijo con que se guardan en findings.photos las fotos subidas al bucket privado. */
export const OBRA_STORAGE_PREFIX = "obra-storage:"

/** Tamaño máximo decodificado de una imagen inline o de una foto de hallazgo (7 MB). */
export const MAX_IMAGE_BYTES = 7 * 1024 * 1024

/**
 * Tamaño máximo de una lámina subida directo al bucket (25 MB). Espejo de
 * PLAN_UPLOAD_MAX_BYTES en lib/obra/client-files.ts (el test de integración
 * de storage verifica que coincidan). También es el file_size_limit del bucket.
 */
export const PLAN_UPLOAD_MAX_BYTES = 25 * 1024 * 1024

/**
 * Largo máximo del data URL que el navegador manda inline a la server action
 * (espejo de PLAN_IMAGE_MAX_BYTES en lib/obra/client-files.ts: Netlify acepta
 * ~6 MB por request y se deja margen).
 */
export const PLAN_INLINE_DATA_URL_MAX_CHARS = 4_500_000

/** Peso máximo (bytes) de una lámina que cabe inline en ese data URL. */
export const PLAN_INLINE_MAX_BYTES = Math.floor((PLAN_INLINE_DATA_URL_MAX_CHARS - "data:image/jpeg;base64,".length) / 4) * 3

/** Vigencia de las URL firmadas de subida: Supabase la fija en 2 horas (uploadSignedUrlExpirationTime). */
export const SIGNED_UPLOAD_EXPIRES_IN_S = 7200

/** Dimensión máxima aceptada (px) de una imagen. */
export const MAX_IMAGE_DIMENSION_PX = 50_000

export const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const
export type ImageMime = (typeof ALLOWED_IMAGE_MIMES)[number]

const EXTENSIONS: Record<ImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

const FETCH_TIMEOUT_MS = 20_000

/** Bytes del inicio de un JPEG que se leen, como máximo, para encontrar su SOF (EXIF/ICC pueden ser largos). */
const JPEG_HEADER_SCAN_BYTES = 512 * 1024

export type DecodedImage = {
  bytes: Buffer
  mime: ImageMime
  ext: string
  /** Dimensiones leídas de la cabecera del archivo (null si no se pudieron leer). */
  width_px: number | null
  height_px: number | null
}

/** "25 MB", "3,2 MB" (MiB, truncado a un decimal, con coma decimal). */
export function formatMegabytes(bytes: number): string {
  const tenths = Math.floor((bytes / (1024 * 1024)) * 10)
  const whole = Math.floor(tenths / 10)
  const dec = tenths % 10
  return dec === 0 ? `${whole} MB` : `${whole},${dec} MB`
}

/** Tipo de imagen permitido a partir de un MIME declarado ("image/jpg" → "image/jpeg"), o null. */
export function normalizeImageMime(v: unknown): ImageMime | null {
  if (typeof v !== "string") return null
  const m = v.toLowerCase().split(";")[0].trim()
  if (m === "image/jpg" || m === "image/pjpeg") return "image/jpeg"
  return (ALLOWED_IMAGE_MIMES as readonly string[]).includes(m) ? (m as ImageMime) : null
}

// ---------------------------------------------------------------------------
// Detección de formato y dimensiones
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Tipo real según los primeros bytes (PNG, JPEG o WebP) o null. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (!bytes || bytes.length < 12) return null
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp"
  return null
}

function validSize(w: number, h: number): { width: number; height: number } | null {
  if (!Number.isInteger(w) || !Number.isInteger(h)) return null
  if (w < 1 || h < 1 || w > MAX_IMAGE_DIMENSION_PX || h > MAX_IMAGE_DIMENSION_PX) return null
  return { width: w, height: h }
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/** Ancho y alto (px) leídos de la cabecera de un PNG, JPEG o WebP; null si no se pueden leer. */
export function readImageSize(bytes: Buffer, mime: ImageMime): { width: number; height: number } | null {
  try {
    if (mime === "image/png") {
      if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") return null
      return validSize(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
    }
    if (mime === "image/webp") {
      if (bytes.length < 30) return null
      const chunk = bytes.toString("ascii", 12, 16)
      if (chunk === "VP8X") return validSize(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3))
      if (chunk === "VP8L") {
        const b0 = bytes[21]
        const b1 = bytes[22]
        const b2 = bytes[23]
        const b3 = bytes[24]
        return validSize(1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)))
      }
      if (chunk === "VP8 ") return validSize(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff)
      return null
    }
    // JPEG: recorrer los segmentos hasta el primer SOF.
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++
        continue
      }
      const marker = bytes[i + 1]
      if (marker === 0xff) {
        i++
        continue
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      if (marker === 0xd9 || marker === 0xda) return null
      const length = bytes.readUInt16BE(i + 2)
      if (length < 2) return null
      if (JPEG_SOF_MARKERS.has(marker)) return validSize(bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5))
      i += 2 + length
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Data URL → bytes validados
// ---------------------------------------------------------------------------

const DATA_URL_HEADER_RE = /^data:(image\/(?:png|jpeg|jpg|webp));base64$/i
const BASE64_BODY_RE = /^[A-Za-z0-9+/]*={0,2}$/

/** Largo máximo del texto base64 de una imagen de 7 MB (más margen de relleno). */
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4

/**
 * Valida y decodifica una data URL de imagen. Solo PNG, JPEG o WebP en
 * base64, hasta 7 MB decodificados y con firma real coincidente con un
 * formato permitido (SVG y cualquier otro contenido se rechazan).
 */
export function decodeImageDataUrl(dataUrl: unknown, label = "La imagen"): DecodedImage {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw new ObraValidationError(`${label} debe ser una imagen PNG, JPG o WebP.`)
  }
  const comma = dataUrl.indexOf(",")
  if (comma < 0 || comma > 100) throw new ObraValidationError(`${label} no tiene un formato válido.`)
  const header = dataUrl.slice(0, comma)
  if (!DATA_URL_HEADER_RE.test(header)) {
    throw new ObraValidationError(`${label} debe ser PNG, JPG o WebP (no se aceptan SVG ni otros formatos).`)
  }
  const body = dataUrl.slice(comma + 1)
  if (body.length > MAX_BASE64_CHARS) throw new ObraValidationError(`${label} supera el máximo de 7 MB.`)
  if (body.length === 0 || body.length % 4 !== 0 || !BASE64_BODY_RE.test(body)) {
    throw new ObraValidationError(`${label} no tiene un contenido base64 válido.`)
  }
  const bytes = Buffer.from(body, "base64")
  if (bytes.length > MAX_IMAGE_BYTES) throw new ObraValidationError(`${label} supera el máximo de 7 MB.`)
  const mime = sniffImageMime(bytes)
  if (!mime) {
    throw new ObraValidationError(`${label} no es una imagen PNG, JPG o WebP válida (el contenido no coincide).`)
  }
  const size = readImageSize(bytes, mime)
  return { bytes, mime, ext: EXTENSIONS[mime], width_px: size?.width ?? null, height_px: size?.height ?? null }
}

/** Data URL canónica (con el tipo real detectado) para guardar inline. */
export function toDataUrl(img: { bytes: Buffer; mime: ImageMime }): string {
  return `data:${img.mime};base64,${img.bytes.toString("base64")}`
}

/** Valida bytes leídos del almacenamiento: tamaño (hasta maxBytes) y firma real. */
export function validateStoredBytes(bytes: Buffer, maxBytes: number = MAX_IMAGE_BYTES): { bytes: Buffer; mime: ImageMime } {
  if (bytes.length === 0 || bytes.length > maxBytes) throw new Error("Imagen almacenada con tamaño inválido")
  const mime = sniffImageMime(bytes)
  if (!mime) throw new Error("Imagen almacenada con formato no permitido")
  return { bytes, mime }
}

// ---------------------------------------------------------------------------
// Supabase Storage (bucket privado)
// ---------------------------------------------------------------------------

type SupabaseConfig = { baseUrl: string; key: string }

/** Configuración de Supabase Storage o null si no está disponible. */
export function getSupabaseStorageConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_KEY?.trim()
  if (!url || !key) return null
  try {
    const u = new URL(url)
    if (u.protocol !== "https:" && u.protocol !== "http:") return null
    return { baseUrl: u.origin, key }
  } catch {
    return null
  }
}

export function isSupabaseStorageEnabled(): boolean {
  return getSupabaseStorageConfig() !== null
}

function requireConfig(): SupabaseConfig {
  const cfg = getSupabaseStorageConfig()
  if (!cfg) throw new Error("Almacenamiento no configurado")
  return cfg
}

function authHeaders(cfg: SupabaseConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key }
}

function timeout(): AbortSignal {
  return AbortSignal.timeout(FETCH_TIMEOUT_MS)
}

const OBJECT_PATH_RE = /^obra\/\d{1,10}\/(?:[A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+\.(?:png|jpg|webp)$/

function assertObjectPath(path: string): void {
  if (typeof path !== "string" || !OBJECT_PATH_RE.test(path)) throw new Error("Ruta de almacenamiento inválida")
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/")
}

const OBJECT_ROUTES = {
  object: "object",
  authenticated: "object/authenticated",
  "upload-sign": "object/upload/sign",
  sign: "object/sign",
} as const

function objectUrl(cfg: SupabaseConfig, kind: keyof typeof OBJECT_ROUTES, path: string): string {
  const middle = OBJECT_ROUTES[kind]
  return `${cfg.baseUrl}/storage/v1/${middle}/${OBRA_BUCKET}/${encodePath(path)}`
}

type StorageErrorInfo = { status: number; code: string; error: string; message: string }

/** Lee el error de Storage: el código semántico viene en el cuerpo (statusCode), no en el HTTP 400. */
async function readStorageError(res: Response): Promise<StorageErrorInfo> {
  const text = await res.text().catch(() => "")
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>
  } catch {
    // cuerpo no JSON (proxy, HTML de error…)
  }
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const semantic = Number(body.statusCode)
  return {
    status: Number.isInteger(semantic) && semantic > 0 ? semantic : res.status,
    code: str(body.code),
    error: str(body.error),
    message: str(body.message),
  }
}

function describeError(res: Response, err: StorageErrorInfo): string {
  const detail = [err.status !== res.status ? String(err.status) : "", err.code || err.error].filter(Boolean).join(" ")
  return `HTTP ${res.status}${detail ? `, ${detail}` : ""}`
}

function isDuplicate(err: StorageErrorInfo): boolean {
  return err.status === 409 || /duplicate|already exists/i.test(`${err.error} ${err.message}`)
}

const BUCKET_LIMITS = { file_size_limit: PLAN_UPLOAD_MAX_BYTES, allowed_mime_types: [...ALLOWED_IMAGE_MIMES] }

let bucketReady: Promise<void> | null = null

function bucketRequest(cfg: SupabaseConfig, method: "POST" | "PUT" | "GET", body?: Record<string, unknown>): Promise<Response> {
  const url = method === "POST" ? `${cfg.baseUrl}/storage/v1/bucket` : `${cfg.baseUrl}/storage/v1/bucket/${OBRA_BUCKET}`
  return fetch(url, {
    method,
    headers: { ...authHeaders(cfg), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: timeout(),
  })
}

/**
 * Bucket que ya existía (p.ej. creado por una versión anterior sin límites):
 * si es público se hace privado (o se rechaza usarlo) y, si no tiene límite de
 * tamaño ni tipos permitidos, se le ponen. Si no se puede leer su
 * configuración se mantiene el comportamiento anterior (se usa tal cual).
 */
async function verifyExistingBucket(cfg: SupabaseConfig): Promise<void> {
  const res = await bucketRequest(cfg, "GET")
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    return
  }
  const b = (await res.json().catch(() => null)) as { public?: unknown; file_size_limit?: unknown; allowed_mime_types?: unknown } | null
  if (!b || typeof b !== "object") return
  const isPublic = b.public === true
  const lacksLimits = b.file_size_limit == null || !Array.isArray(b.allowed_mime_types) || b.allowed_mime_types.length === 0
  if (!isPublic && !lacksLimits) return
  const attempts: Record<string, unknown>[] = [
    { public: false, ...BUCKET_LIMITS },
    // file_size_limit mayor que el límite global del proyecto (EntityTooLarge): sin límite propio.
    { public: false, allowed_mime_types: BUCKET_LIMITS.allowed_mime_types },
  ]
  for (const body of attempts) {
    const upd = await bucketRequest(cfg, "PUT", body)
    await upd.body?.cancel().catch(() => undefined)
    if (upd.ok) return
  }
  if (isPublic) throw new Error(`El bucket ${OBRA_BUCKET} es público y no se pudo hacer privado; no se guardarán imágenes ahí.`)
}

/** Crea el bucket privado (con límites) una vez por proceso; si ya existe, lo verifica. */
function ensureBucket(cfg: SupabaseConfig): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      let res = await bucketRequest(cfg, "POST", { id: OBRA_BUCKET, name: OBRA_BUCKET, public: false, ...BUCKET_LIMITS })
      if (res.ok) {
        await res.body?.cancel().catch(() => undefined)
        return
      }
      let err = await readStorageError(res)
      if (err.status === 413) {
        // El file_size_limit supera el límite global del proyecto: se crea sin límite propio.
        res = await bucketRequest(cfg, "POST", {
          id: OBRA_BUCKET,
          name: OBRA_BUCKET,
          public: false,
          allowed_mime_types: BUCKET_LIMITS.allowed_mime_types,
        })
        if (res.ok) {
          await res.body?.cancel().catch(() => undefined)
          return
        }
        err = await readStorageError(res)
      }
      if (isDuplicate(err)) return verifyExistingBucket(cfg)
      throw new Error(`No se pudo crear el bucket de almacenamiento (${describeError(res, err)})`)
    })().catch((e) => {
      bucketReady = null
      throw e
    })
  }
  return bucketReady
}

/** Solo para tests: olvida que el bucket ya se creó. */
export function resetStorageStateForTests(): void {
  bucketReady = null
}

function randomName(): string {
  return crypto.randomBytes(12).toString("hex")
}

async function uploadObject(cfg: SupabaseConfig, path: string, img: { bytes: Buffer; mime: ImageMime }): Promise<void> {
  assertObjectPath(path)
  await ensureBucket(cfg)
  const res = await fetch(objectUrl(cfg, "object", path), {
    method: "POST",
    headers: { ...authHeaders(cfg), "Content-Type": img.mime, "x-upsert": "false" },
    body: new Uint8Array(img.bytes),
    redirect: "error",
    signal: timeout(),
  })
  if (!res.ok) throw new Error(`No se pudo subir la imagen (${describeError(res, await readStorageError(res))})`)
  await res.body?.cancel().catch(() => undefined)
}

/** Lee el cuerpo de una respuesta hasta `max` bytes; si `strict`, superar el máximo es un error. */
async function readBodyCapped(res: Response, max: number, strict: boolean): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (total + value.length > max) {
        if (strict) throw new Error("Imagen almacenada demasiado grande")
        chunks.push(value.subarray(0, max - total))
        total = max
        break
      }
      chunks.push(value)
      total += value.length
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks, total)
}

/** Descarga un objeto del bucket privado (hasta maxBytes) y valida que sea una imagen permitida. */
export async function downloadObraObject(
  path: string,
  maxBytes: number = MAX_IMAGE_BYTES,
): Promise<{ bytes: Buffer; mime: ImageMime }> {
  const cfg = requireConfig()
  assertObjectPath(path)
  const res = await fetch(objectUrl(cfg, "authenticated", path), {
    headers: authHeaders(cfg),
    redirect: "error",
    signal: timeout(),
  })
  if (!res.ok) throw new Error(`No se pudo leer la imagen (${describeError(res, await readStorageError(res))})`)
  const declared = Number(res.headers.get("content-length") ?? "0")
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined)
    throw new Error("Imagen almacenada demasiado grande")
  }
  return validateStoredBytes(await readBodyCapped(res, maxBytes, true), maxBytes)
}

/** Borra un objeto (mejor esfuerzo; se usa para limpiar si falla la transacción o el archivo es inválido). */
export async function deleteObraObject(path: string): Promise<void> {
  const cfg = getSupabaseStorageConfig()
  if (!cfg) return
  try {
    assertObjectPath(path)
    const res = await fetch(`${cfg.baseUrl}/storage/v1/object/${OBRA_BUCKET}`, {
      method: "DELETE",
      headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
      redirect: "error",
      signal: timeout(),
    })
    await res.body?.cancel().catch(() => undefined)
  } catch {
    // Mejor esfuerzo: un objeto huérfano en un bucket privado no es visible para nadie.
  }
}

// ---------------------------------------------------------------------------
// Subida directa (URL firmada) y verificación del objeto subido
// ---------------------------------------------------------------------------

const LAYER_UPLOAD_PATH_RE =
  /^obra\/(\d{1,10})\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/

/** Carpeta del bucket donde el navegador sube las láminas de un proyecto. */
export function layerUploadPrefix(projectId: number): string {
  return `obra/${projectId}/uploads/`
}

/** Ruta nueva e impredecible para una lámina: obra/<proyecto>/uploads/<uuid>.<ext>. */
export function newLayerUploadPath(projectId: number, mime: ImageMime): string {
  return `${layerUploadPrefix(projectId)}${crypto.randomUUID()}.${EXTENSIONS[mime]}`
}

/** ¿Es una ruta de subida de láminas (formato exacto, sin "..") de ESE proyecto? */
export function isLayerUploadPath(projectId: number, path: unknown): path is string {
  if (typeof path !== "string" || path.length > 120 || path.includes("..")) return false
  if (!path.startsWith(layerUploadPrefix(projectId))) return false
  const m = LAYER_UPLOAD_PATH_RE.exec(path)
  return m !== null && Number(m[1]) === projectId
}

export type SignedUpload = { upload_url: string; token: string; expires_in: number }

/**
 * Firma una subida (POST /object/upload/sign/{bucket}/{ruta}, sin upsert) y
 * devuelve la URL ABSOLUTA a la que el navegador hace PUT del archivo, sin
 * credenciales: el token de la URL la autoriza solo para esa ruta y por 2 h.
 */
export async function signObraUpload(path: string): Promise<SignedUpload> {
  const cfg = requireConfig()
  assertObjectPath(path)
  await ensureBucket(cfg)
  const res = await fetch(objectUrl(cfg, "upload-sign", path), {
    method: "POST",
    headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
    body: "{}",
    redirect: "error",
    signal: timeout(),
  })
  if (!res.ok) throw new Error(`No se pudo firmar la subida (${describeError(res, await readStorageError(res))})`)
  const body = (await res.json().catch(() => null)) as { url?: unknown; token?: unknown } | null
  // La API responde la URL relativa a /storage/v1: "/object/upload/sign/{bucket}/{ruta}?token=…".
  const relative = typeof body?.url === "string" ? body.url : ""
  if (!relative.startsWith("/object/upload/sign/")) throw new Error("Respuesta inesperada al firmar la subida")
  const uploadUrl = new URL(`${cfg.baseUrl}/storage/v1${relative}`)
  const token = uploadUrl.searchParams.get("token") || (typeof body?.token === "string" ? body.token : "")
  if (!token) throw new Error("La firma de subida no trajo token")
  if (uploadUrl.origin !== cfg.baseUrl || uploadUrl.toString().split("?")[0] !== objectUrl(cfg, "upload-sign", path)) {
    throw new Error("La URL firmada no corresponde a la ruta pedida")
  }
  uploadUrl.searchParams.set("token", token)
  return { upload_url: uploadUrl.toString(), token, expires_in: SIGNED_UPLOAD_EXPIRES_IN_S }
}

/**
 * Tamaño y tipo declarado de un objeto (HEAD /object/authenticated/…), o null
 * si no existe. Storage responde HTTP 400 (sin cuerpo, por ser HEAD) cuando el
 * objeto no existe, igual que storage-js `exists()`: 400 y 404 = no existe.
 */
export async function statObraObject(path: string): Promise<{ size: number; content_type: string | null } | null> {
  const cfg = requireConfig()
  assertObjectPath(path)
  const res = await fetch(objectUrl(cfg, "authenticated", path), {
    method: "HEAD",
    headers: authHeaders(cfg),
    redirect: "error",
    signal: timeout(),
  })
  if (res.status === 400 || res.status === 404) return null
  if (!res.ok) throw new Error(`No se pudo consultar la imagen subida (HTTP ${res.status})`)
  const contentType = res.headers.get("content-type")
  const size = Number(res.headers.get("content-length"))
  if (Number.isSafeInteger(size) && size >= 0 && res.headers.has("content-length")) return { size, content_type: contentType }
  // Sin Content-Length (algún proxy lo quita en HEAD): se pide la ficha del objeto.
  const info = await fetch(`${cfg.baseUrl}/storage/v1/object/info/authenticated/${OBRA_BUCKET}/${encodePath(path)}`, {
    headers: authHeaders(cfg),
    redirect: "error",
    signal: timeout(),
  })
  if (!info.ok) {
    const err = await readStorageError(info)
    if (err.status === 404) return null
    throw new Error(`No se pudo consultar la imagen subida (${describeError(info, err)})`)
  }
  const json = (await info.json().catch(() => null)) as { size?: unknown; content_type?: unknown } | null
  const s = Number(json?.size)
  if (!Number.isSafeInteger(s) || s < 0) throw new Error("La ficha de la imagen subida no informa su tamaño")
  return { size: s, content_type: typeof json?.content_type === "string" ? json.content_type : contentType }
}

/** Primeros `length` bytes de un objeto (Range: bytes=0-<length-1>), sin descargar el resto. */
export async function readObraObjectPrefix(path: string, length: number): Promise<Buffer> {
  const cfg = requireConfig()
  assertObjectPath(path)
  const n = Math.max(1, Math.floor(length))
  const res = await fetch(objectUrl(cfg, "authenticated", path), {
    headers: { ...authHeaders(cfg), Range: `bytes=0-${n - 1}` },
    redirect: "error",
    signal: timeout(),
  })
  if (!res.ok) throw new Error(`No se pudo leer la imagen subida (${describeError(res, await readStorageError(res))})`)
  // 206 con el tramo pedido; si el servidor ignora el Range (200) se corta la lectura en n bytes.
  return readBodyCapped(res, n, false)
}

export type VerifiedUpload = {
  mime: ImageMime
  ext: string
  size: number
  width_px: number | null
  height_px: number | null
}

/**
 * Verifica una lámina subida directo al bucket: que exista, que pese entre 1
 * byte y maxBytes, que su tipo declarado (si Storage lo informa) sea PNG, JPEG
 * o WebP y que sus primeros bytes sean de un PNG, JPEG o WebP real (lee
 * también sus dimensiones de la cabecera). Si el objeto es demasiado grande o
 * no es una imagen permitida, lo BORRA y lanza ObraValidationError.
 * Quien llama debe haber comprobado antes que la ruta es del proyecto y que
 * ninguna capa la usa (para no borrar la imagen de otra capa).
 */
export async function verifyUploadedObraImage(path: string, maxBytes: number = PLAN_UPLOAD_MAX_BYTES): Promise<VerifiedUpload> {
  const stat = await statObraObject(path)
  if (!stat) throw new ObraValidationError("No se encontró la imagen subida. Vuelve a subir el archivo.")
  if (stat.size === 0 || stat.size > maxBytes) {
    await deleteObraObject(path)
    throw new ObraValidationError(
      stat.size === 0
        ? "La imagen subida está vacía. Vuelve a subir el archivo."
        : `La imagen subida supera el máximo de ${formatMegabytes(maxBytes)}; se descartó.`,
    )
  }
  const declaredOk = stat.content_type == null || normalizeImageMime(stat.content_type) !== null
  const head = declaredOk ? await readObraObjectPrefix(path, 64) : Buffer.alloc(0)
  const mime = sniffImageMime(head)
  if (!mime) {
    await deleteObraObject(path)
    throw new ObraValidationError(
      "La imagen subida no es un PNG, JPG o WebP válido (el contenido no coincide); se descartó.",
    )
  }
  let size = readImageSize(head, mime)
  if (!size && mime === "image/jpeg" && stat.size > head.length) {
    size = readImageSize(await readObraObjectPrefix(path, Math.min(stat.size, JPEG_HEADER_SCAN_BYTES)), mime)
  }
  return { mime, ext: EXTENSIONS[mime], size: stat.size, width_px: size?.width ?? null, height_px: size?.height ?? null }
}

/**
 * URL firmada de DESCARGA (POST /object/sign/…) de un objeto del bucket, válida
 * por `expiresIn` segundos (1 a 3600). Pensada para que la ruta de imagen de capa
 * redirija las láminas grandes en vez de pasar sus bytes por la función
 * (Netlify también limita el tamaño de la respuesta). Autorizar ANTES de
 * llamarla.
 */
export async function createObraSignedDownloadUrl(path: string, expiresIn = 300): Promise<string> {
  const cfg = requireConfig()
  assertObjectPath(path)
  const res = await fetch(objectUrl(cfg, "sign", path), {
    method: "POST",
    headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: Math.min(3600, Math.max(1, Math.floor(expiresIn))) }),
    redirect: "error",
    signal: timeout(),
  })
  if (!res.ok) throw new Error(`No se pudo firmar la descarga (${describeError(res, await readStorageError(res))})`)
  const body = (await res.json().catch(() => null)) as { signedURL?: unknown; signedUrl?: unknown } | null
  const relative = typeof body?.signedURL === "string" ? body.signedURL : typeof body?.signedUrl === "string" ? body.signedUrl : ""
  if (!relative.startsWith("/object/sign/")) throw new Error("Respuesta inesperada al firmar la descarga")
  return new URL(`${cfg.baseUrl}/storage/v1${relative}`).toString()
}

// ---------------------------------------------------------------------------
// API de alto nivel
// ---------------------------------------------------------------------------

export type StoredLayerImage = { image_path: string | null; image_data: string | null }

/**
 * Guarda la imagen de una capa: en Supabase (obra/{projectId}/{layerId}-{aleatorio}.{ext})
 * o, sin Supabase, como data URL inline.
 */
export async function storeLayerImage(projectId: number, layerId: number, img: DecodedImage): Promise<StoredLayerImage> {
  const cfg = getSupabaseStorageConfig()
  if (!cfg) return { image_path: null, image_data: toDataUrl(img) }
  const path = `obra/${projectId}/${layerId}-${randomName()}.${img.ext}`
  await uploadObject(cfg, path, img)
  return { image_path: path, image_data: null }
}

/**
 * Guarda la foto de un hallazgo y devuelve la referencia para findings.photos:
 * "obra-storage:obra/{projectId}/hallazgos/{aleatorio}.{ext}" con Supabase, o la
 * data URL canónica sin Supabase.
 */
export async function storeFindingPhoto(projectId: number, img: DecodedImage): Promise<{ ref: string; path: string | null }> {
  const cfg = getSupabaseStorageConfig()
  if (!cfg) return { ref: toDataUrl(img), path: null }
  const path = `obra/${projectId}/hallazgos/${randomName()}.${img.ext}`
  await uploadObject(cfg, path, img)
  return { ref: `${OBRA_STORAGE_PREFIX}${path}`, path }
}

/**
 * Lee la imagen de una capa (ruta del bucket o data URL inline). Las del
 * bucket pueden venir de una subida directa: hasta PLAN_UPLOAD_MAX_BYTES.
 */
export async function readStoredImage(stored: StoredLayerImage): Promise<{ bytes: Buffer; mime: ImageMime }> {
  if (stored.image_path) return downloadObraObject(stored.image_path, PLAN_UPLOAD_MAX_BYTES)
  if (stored.image_data) {
    const img = decodeImageDataUrl(stored.image_data)
    return { bytes: img.bytes, mime: img.mime }
  }
  throw new Error("Sin imagen")
}

/**
 * Lee una referencia de findings.photos creada por este módulo
 * ("obra-storage:<ruta>" o data URL). Para que /api/findings/photo pueda
 * servir las fotos subidas al bucket privado.
 */
export async function readObraStorageRef(ref: string): Promise<{ bytes: Buffer; mime: ImageMime }> {
  if (ref.startsWith(OBRA_STORAGE_PREFIX)) return downloadObraObject(ref.slice(OBRA_STORAGE_PREFIX.length))
  const img = decodeImageDataUrl(ref)
  return { bytes: img.bytes, mime: img.mime }
}
