/**
 * Almacenamiento de imágenes del módulo Obra Integral (láminas de capas y
 * fotos de hallazgos). Solo servidor; sin "use server".
 *
 * - Con SUPABASE_URL y SUPABASE_SERVICE_KEY: bucket PRIVADO "obra-planos"
 *   (se crea una vez por proceso). Las lecturas usan el endpoint autenticado
 *   con la service key; nunca se exponen URLs públicas.
 * - Sin Supabase: la imagen se guarda inline como data URL (image_data).
 *
 * Seguridad: solo se aceptan PNG, JPEG y WebP de hasta 7 MB decodificados y
 * se verifican los "magic bytes" reales (el tipo declarado no basta). SVG se
 * rechaza siempre (puede contener scripts). El tipo que se sirve es el
 * detectado en los bytes, no el declarado por el cliente.
 */
import crypto from "node:crypto"
import { ObraValidationError } from "../access"

export const OBRA_BUCKET = "obra-planos"

/** Prefijo con que se guardan en findings.photos las fotos subidas al bucket privado. */
export const OBRA_STORAGE_PREFIX = "obra-storage:"

/** Tamaño máximo decodificado de una imagen (7 MB). */
export const MAX_IMAGE_BYTES = 7 * 1024 * 1024

/** Dimensión máxima aceptada (px) de una imagen. */
export const MAX_IMAGE_DIMENSION_PX = 50_000

export const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const
export type ImageMime = (typeof ALLOWED_IMAGE_MIMES)[number]

const EXTENSIONS: Record<ImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

const FETCH_TIMEOUT_MS = 20_000

export type DecodedImage = {
  bytes: Buffer
  mime: ImageMime
  ext: string
  /** Dimensiones leídas de la cabecera del archivo (null si no se pudieron leer). */
  width_px: number | null
  height_px: number | null
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

/** Valida bytes leídos del almacenamiento: tamaño y firma real. */
export function validateStoredBytes(bytes: Buffer): { bytes: Buffer; mime: ImageMime } {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error("Imagen almacenada con tamaño inválido")
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

function authHeaders(cfg: SupabaseConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key }
}

const OBJECT_PATH_RE = /^obra\/\d{1,10}\/(?:[A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+\.(?:png|jpg|webp)$/

function assertObjectPath(path: string): void {
  if (!OBJECT_PATH_RE.test(path)) throw new Error("Ruta de almacenamiento inválida")
}

function objectUrl(cfg: SupabaseConfig, kind: "object" | "authenticated", path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/")
  const middle = kind === "authenticated" ? "object/authenticated" : "object"
  return `${cfg.baseUrl}/storage/v1/${middle}/${OBRA_BUCKET}/${encoded}`
}

let bucketReady: Promise<void> | null = null

/** Crea el bucket privado una vez por proceso (ignora "ya existe"). */
function ensureBucket(cfg: SupabaseConfig): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const res = await fetch(`${cfg.baseUrl}/storage/v1/bucket`, {
        method: "POST",
        headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
        body: JSON.stringify({ id: OBRA_BUCKET, name: OBRA_BUCKET, public: false }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.ok || res.status === 409) return
      const text = await res.text().catch(() => "")
      if (/already exists|duplicate/i.test(text)) return
      throw new Error(`No se pudo crear el bucket de almacenamiento (HTTP ${res.status})`)
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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`No se pudo subir la imagen (HTTP ${res.status})`)
}

/** Descarga un objeto del bucket privado y valida que sea una imagen permitida. */
export async function downloadObraObject(path: string): Promise<{ bytes: Buffer; mime: ImageMime }> {
  const cfg = getSupabaseStorageConfig()
  if (!cfg) throw new Error("Almacenamiento no configurado")
  assertObjectPath(path)
  const res = await fetch(objectUrl(cfg, "authenticated", path), {
    headers: authHeaders(cfg),
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`No se pudo leer la imagen (HTTP ${res.status})`)
  const declared = Number(res.headers.get("content-length") ?? "0")
  if (declared > MAX_IMAGE_BYTES) throw new Error("Imagen almacenada demasiado grande")
  const bytes = Buffer.from(await res.arrayBuffer())
  return validateStoredBytes(bytes)
}

/** Borra un objeto (mejor esfuerzo; se usa para limpiar si falla la transacción). */
export async function deleteObraObject(path: string): Promise<void> {
  const cfg = getSupabaseStorageConfig()
  if (!cfg) return
  try {
    assertObjectPath(path)
    await fetch(`${cfg.baseUrl}/storage/v1/object/${OBRA_BUCKET}`, {
      method: "DELETE",
      headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    // Mejor esfuerzo: un objeto huérfano en un bucket privado no es visible para nadie.
  }
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

/** Lee una imagen guardada por este módulo (ruta del bucket o data URL inline). */
export async function readStoredImage(stored: StoredLayerImage): Promise<{ bytes: Buffer; mime: ImageMime }> {
  if (stored.image_path) return downloadObraObject(stored.image_path)
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
