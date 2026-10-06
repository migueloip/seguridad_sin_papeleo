/**
 * Servidor HTTP local que imita la API REST de Supabase Storage (storage-api)
 * para los tests de integración del módulo Obra. No es un mock de fetch: la
 * app habla HTTP de verdad (fetch de Node, XMLHttpRequest de jsdom) contra
 * este servidor, con las mismas rutas, cabeceras, códigos y cuerpos de error
 * que el servicio real.
 *
 * Contrato reproducido (verificado contra el código fuente de
 * github.com/supabase/storage, rama master, y de @supabase/storage-js 2.7.1):
 *
 * - Prefijo /storage/v1. Las rutas "autenticadas" exigen
 *   `Authorization: Bearer <service key>`; sin cabecera o con otra clave
 *   responden como el plugin JWT real (AccessDenied).
 * - Errores REST: el cuerpo es { statusCode: "<código semántico>", code,
 *   error, message } y el estado HTTP es 400 para cualquier error que no sea
 *   500 (error-handler.ts usa userStatusCode = 400). Ej.: objeto inexistente →
 *   HTTP 400 con statusCode "404" y error "not_found"; duplicado → HTTP 400
 *   con statusCode "409" y error "Duplicate". La excepción es un Range
 *   imposible: HTTP 416 (invalidRangeHeaderError usa withStatusCode(416)).
 * - POST /bucket { id, name, public, file_size_limit, allowed_mime_types }:
 *   file_size_limit en bytes (o "25MB", decimal) y no puede superar el límite
 *   global del proyecto (EntityTooLarge); repetido → BucketAlreadyExists.
 *   GET/PUT/DELETE /bucket/{id}.
 * - POST /object/upload/sign/{bucket}/{ruta} → { url, token } con url
 *   RELATIVA a /storage/v1 ("/object/upload/sign/{bucket}/{ruta}?token=…").
 *   El token es un JWT HS256 { url: "{bucket}/{ruta}", upsert, scope, iat,
 *   exp } que vence a las 2 h (uploadSignedUrlExpirationTime). El upsert sale
 *   del token (cabecera x-upsert al FIRMAR), no del PUT.
 * - PUT /object/upload/sign/{bucket}/{ruta}?token=… SIN Authorization: token
 *   inválido/vencido → InvalidJWT; token de otra ruta → InvalidSignature.
 *   Cuerpo binario: Content-Type validado contra allowed_mime_types
 *   (InvalidMimeType, statusCode "415") y Content-Length contra el límite del
 *   bucket/global (EntityTooLarge, statusCode "413"); si la ruta ya existe y el
 *   token no es upsert → KeyAlreadyExists ("409", "Duplicate"). Respuesta
 *   200 { Key: "{bucket}/{ruta}" }. El token NO se invalida al usarse (igual
 *   que el real): lo que impide reusarlo es que la ruta ya exista.
 * - POST/PUT /object/{bucket}/{ruta} (subida autenticada, x-upsert),
 *   DELETE /object/{bucket} { prefixes } y DELETE /object/{bucket}/{ruta}.
 * - GET y HEAD /object/authenticated/{bucket}/{ruta} (y /object/{bucket}/{ruta}
 *   con JWT opcional): Accept-Ranges, Content-Type, ETag, Last-Modified,
 *   Cache-Control, Content-Length; Range "bytes=a-b" / "bytes=a-" / "bytes=-n"
 *   → 206 + Content-Range (semántica S3: un Range mal formado se ignora y se
 *   devuelve 200 completo; uno fuera del archivo → 416).
 * - GET /object/info/authenticated/{bucket}/{ruta} → JSON con size,
 *   content_type, etag…; POST /object/sign/… y GET /object/sign/…?token=…
 *   (URL firmada de descarga).
 * - CORS como el gateway (Kong): Access-Control-Allow-Origin: * y preflight
 *   OPTIONS que refleja las cabeceras pedidas.
 *
 * Limitación conocida: no implementa multipart/form-data (la app sube el
 * cuerpo binario) ni subidas resumables (TUS).
 */
import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"

export type FakeBucket = {
  id: string
  name: string
  public: boolean
  file_size_limit: number | null
  allowed_mime_types: string[] | null
  created_at: string
  updated_at: string
}

export type FakeObject = {
  bucket: string
  name: string
  id: string
  version: string
  bytes: Buffer
  contentType: string
  cacheControl: string
  etag: string
  createdAt: Date
  updatedAt: Date
}

export type FakeRequest = {
  method: string
  /** Ruta sin el prefijo /storage/v1 (p.ej. "/object/upload/sign/obra-planos/obra/1/uploads/x.png"). */
  path: string
  /** Si traía `Authorization: Bearer <service key>` válido. */
  authorized: boolean
  status: number
  headers: { "content-type"?: string; "x-upsert"?: string; range?: string; "content-length"?: string }
}

export type FakeFailure = {
  /** Método HTTP al que aplica (por defecto, todos). */
  method?: string
  /** Fragmento o expresión que debe calzar con la ruta sin /storage/v1 (por defecto, todas). */
  path?: string | RegExp
  /**
   * Código HTTP a responder (por defecto 500) o "network" para cortar la
   * conexión. Si se omite y hay delayMs, no falla: solo agrega latencia.
   */
  status?: number | "network"
  /** Espera antes de responder (ms). */
  delayMs?: number
  /** Cuerpo JSON de la respuesta (por defecto, un error interno como el real). */
  body?: unknown
  /** Cuántas veces aplicar (por defecto, hasta setFailure(null)). */
  times?: number
}

export type FakeStorage = {
  /** Origen del servidor (http://127.0.0.1:<puerto>): úsalo como SUPABASE_URL. */
  url: string
  stop: () => Promise<void>
  /** Objetos guardados, por "{bucket}/{ruta}". */
  objects: Map<string, FakeObject>
  buckets: Map<string, FakeBucket>
  /** Registro de cada request recibido (en orden). */
  requests: FakeRequest[]
  /** Inyecta (o quita, con null) una falla para los próximos requests que calcen. */
  setFailure: (failure: FakeFailure | null) => void
  /** Adelanta el reloj del servidor (para vencer tokens firmados). */
  advanceTime: (seconds: number) => void
}

export type FakeStorageOptions = {
  serviceKey: string
  /** Límite global de archivo del proyecto (plan Free: 50 MB). */
  globalFileSizeLimit?: number
  /** Vigencia de las URL firmadas de subida, en segundos (Supabase: 7200). */
  signedUploadExpiresIn?: number
}

// ---------------------------------------------------------------------------
// Errores con el formato real
// ---------------------------------------------------------------------------

class StorageHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly error: string,
    message: string,
    /** Estado HTTP real: 400 salvo 500 (o el forzado con withStatusCode). */
    readonly httpStatus: number = statusCode === 500 ? 500 : 400,
  ) {
    super(message)
  }

  body() {
    return { statusCode: String(this.statusCode), code: this.code, error: this.error, message: this.message }
  }
}

const ERR = {
  noSuchBucket: () => new StorageHttpError(404, "NoSuchBucket", "Bucket not found", "Bucket not found"),
  noSuchKey: () => new StorageHttpError(404, "NoSuchKey", "not_found", "Object not found"),
  accessDenied: (message: string) => new StorageHttpError(403, "AccessDenied", "Unauthorized", message),
  invalidJwt: (message: string) => new StorageHttpError(400, "InvalidJWT", "InvalidJWT", message),
  invalidSignature: (message = "Invalid signature") => new StorageHttpError(400, "InvalidSignature", "InvalidSignature", message),
  keyAlreadyExists: () => new StorageHttpError(409, "KeyAlreadyExists", "Duplicate", "The resource already exists"),
  bucketAlreadyExists: () => new StorageHttpError(409, "BucketAlreadyExists", "Duplicate", "The resource already exists"),
  entityTooLarge: () =>
    new StorageHttpError(413, "EntityTooLarge", "Payload too large", "The object exceeded the maximum allowed size"),
  invalidMimeType: (mime: string) =>
    new StorageHttpError(415, "InvalidMimeType", "invalid_mime_type", `mime type ${mime} is not supported`),
  invalidRange: () => new StorageHttpError(416, "InvalidRange", "invalid_range", "invalid range provided", 416),
  invalidKey: (key: string) => new StorageHttpError(400, "InvalidKey", "InvalidKey", `Invalid key: ${key}`),
  invalidBucketName: () => new StorageHttpError(400, "InvalidBucketName", "Invalid Input", "Bucket name invalid"),
  invalidRequest: (message: string) => new StorageHttpError(400, "InvalidRequest", "Bad Request", message),
  noContent: () => new StorageHttpError(400, "InvalidRequest", "InvalidRequest", "No content provided"),
}

// ---------------------------------------------------------------------------
// JWT HS256 (tokens de URL firmada)
// ---------------------------------------------------------------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest())
  return `${head}.${body}.${sig}`
}

/** Verifica firma y vencimiento con los mensajes de jose (la librería del servicio real). */
function verifyJwt(token: string, secret: string, nowSec: number): Record<string, unknown> {
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("Invalid Compact JWS")
  const expected = b64url(crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest())
  const a = Buffer.from(parts[2])
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("signature verification failed")
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
  } catch {
    throw new Error("JWT Claims Set must be a top-level JSON object")
  }
  if (typeof payload.exp === "number" && payload.exp <= nowSec) throw new Error('"exp" claim timestamp check failed')
  return payload
}

// ---------------------------------------------------------------------------
// Validaciones del servicio real (limits.ts, validators/mime-type.ts)
// ---------------------------------------------------------------------------

const VALID_OBJECT_KEY = /^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/
const VALID_BUCKET_NAME = /^[A-Za-z0-9_!.*'() &$=@;:+,?-]*$/

function mustBeValidKey(key: string): void {
  if (!key || !VALID_OBJECT_KEY.test(key)) throw ERR.invalidKey(key)
}

function parseMediaType(mime: string, allowWildcard = false): string | null {
  const m = /^[\t ]*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\/([!#$%&'*+.^_`|~0-9A-Za-z-]+)[\t ]*(;.*)?$/.exec(mime)
  if (!m) return null
  const type = m[1].toLowerCase()
  const sub = m[2].toLowerCase()
  if (type.includes("*") || (sub.includes("*") && !(allowWildcard && sub === "*"))) return null
  return `${type}/${sub}`
}

function validateMimeType(mime: string, allowed: string[]): void {
  const requested = parseMediaType(mime)
  if (!requested) throw ERR.invalidMimeType(mime)
  const wildcard = `${requested.slice(0, requested.indexOf("/") + 1)}*`
  if (!allowed.some((a) => a === requested || a === wildcard)) throw ERR.invalidMimeType(mime)
}

function parseFileSizeLimit(v: unknown, globalLimit: number): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  let n: number
  if (typeof v === "number") n = v
  else if (typeof v === "string") {
    const m = /(^[0-9]+(?:\.[0-9]+)?)(gb|mb|kb|b)$/i.exec(v)
    if (!m) throw ERR.invalidRequest("Invalid file size format, hint: use 20GB / 20MB / 30KB / 3B")
    const mult = { gb: 1e9, mb: 1e6, kb: 1e3, b: 1 }[m[2].toLowerCase() as "gb" | "mb" | "kb" | "b"]
    n = Math.round(parseFloat(m[1]) * mult)
  } else throw ERR.invalidRequest("body/file_size_limit must be integer or string")
  if (!Number.isInteger(n) || n < 0) throw ERR.invalidRequest("body/file_size_limit must be >= 0")
  if (n > globalLimit) throw ERR.entityTooLarge()
  return n
}

function normalizeAllowedMimeTypes(v: unknown): string[] | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (!Array.isArray(v)) throw ERR.invalidRequest("body/allowed_mime_types must be array")
  const out = new Set<string>()
  for (const raw of v) {
    if (typeof raw !== "string") throw ERR.invalidRequest("body/allowed_mime_types/0 must be string")
    if (!raw) continue
    const parsed = parseMediaType(raw, true)
    if (!parsed) throw ERR.invalidMimeType(raw)
    out.add(parsed)
  }
  return [...out]
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

type Ctx = {
  req: http.IncomingMessage
  res: http.ServerResponse
  method: string
  route: string
  query: URLSearchParams
  auth: "service" | "invalid" | "none"
}

function readBody(req: http.IncomingMessage, cap = Infinity): Promise<{ bytes: Buffer; total: number }> {
  if (req.readableEnded) return Promise.resolve({ bytes: Buffer.alloc(0), total: 0 })
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let kept = 0
    let total = 0
    req.on("data", (c: Buffer) => {
      total += c.length
      if (kept < cap) {
        const take = Math.min(c.length, cap - kept)
        chunks.push(take === c.length ? c : c.subarray(0, take))
        kept += take
      }
    })
    req.on("end", () => resolve({ bytes: Buffer.concat(chunks), total }))
    req.on("error", reject)
  })
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const { bytes } = await readBody(req, 1024 * 1024)
  if (bytes.length === 0) return {}
  try {
    const v = JSON.parse(bytes.toString("utf8"))
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not object")
    return v as Record<string, unknown>
  } catch {
    throw ERR.invalidRequest("Body is not valid JSON")
  }
}

function send(ctx: Ctx, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const isBuffer = Buffer.isBuffer(body)
  const payload = body === undefined ? undefined : isBuffer ? (body as Buffer) : Buffer.from(JSON.stringify(body))
  const h: Record<string, string> = { ...headers }
  if (payload && !isBuffer) h["Content-Type"] = "application/json; charset=utf-8"
  if (payload && h["Content-Length"] === undefined) h["Content-Length"] = String(payload.length)
  ctx.res.writeHead(status, h)
  ctx.res.end(ctx.method === "HEAD" ? undefined : payload)
}

export async function startFakeStorage(options: FakeStorageOptions): Promise<FakeStorage> {
  const serviceKey = options.serviceKey
  const globalLimit = options.globalFileSizeLimit ?? 50 * 1024 * 1024
  const uploadExpiresIn = options.signedUploadExpiresIn ?? 7200
  const jwtSecret = crypto.randomBytes(32).toString("hex")
  const objects = new Map<string, FakeObject>()
  const buckets = new Map<string, FakeBucket>()
  const requests: FakeRequest[] = []
  let failure: FakeFailure | null = null
  let clockOffsetMs = 0

  const nowMs = () => Date.now() + clockOffsetMs
  const nowSec = () => Math.floor(nowMs() / 1000)

  function authOf(req: http.IncomingMessage): Ctx["auth"] {
    const jwt = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")
    if (!jwt) return "none"
    const a = Buffer.from(jwt)
    const b = Buffer.from(serviceKey)
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? "service" : "invalid"
  }

  /** Plugin JWT de las rutas autenticadas (con o sin el esquema de cabecera authorization). */
  function requireAuth(ctx: Ctx, headerSchema: boolean): void {
    if (ctx.auth === "service") return
    if (ctx.auth === "none" && headerSchema) throw ERR.invalidRequest("headers must have required property 'authorization'")
    throw ERR.accessDenied(ctx.auth === "none" ? "Invalid Compact JWS" : "signature verification failed")
  }

  function findBucket(id: string): FakeBucket {
    const b = buckets.get(id)
    if (!b) throw ERR.noSuchBucket()
    return b
  }

  /** Bucket visible para el request (privado → solo con JWT válido, como getObject/getObjectInfo). */
  function visibleBucket(ctx: Ctx, id: string): FakeBucket {
    const b = buckets.get(id)
    if (!b) throw ERR.noSuchBucket()
    if (ctx.auth !== "service" && !b.public) throw ERR.noSuchBucket()
    return b
  }

  function findObject(bucket: string, name: string): FakeObject {
    const o = objects.get(`${bucket}/${name}`)
    if (!o) throw ERR.noSuchKey()
    return o
  }

  function splitBucketPath(rest: string): { bucket: string; name: string } {
    const i = rest.indexOf("/")
    if (i <= 0 || i === rest.length - 1) throw ERR.invalidRequest("params/* must have required property '*'")
    return { bucket: rest.slice(0, i), name: rest.slice(i + 1) }
  }

  /** fileUploadFromRequest (cuerpo binario) + uploader.upload + completeUpload. */
  async function storeFromRequest(ctx: Ctx, bucketId: string, name: string, upsert: boolean): Promise<FakeObject> {
    mustBeValidKey(name)
    const bucket = findBucket(bucketId)
    const contentType = String(ctx.req.headers["content-type"] ?? "")
    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      await readBody(ctx.req, 0)
      throw ERR.invalidRequest("El servidor falso no implementa multipart/form-data: sube el cuerpo binario.")
    }
    const mime = contentType || "application/octet-stream"
    const maxFileSize = typeof bucket.file_size_limit === "number" ? Math.min(bucket.file_size_limit, globalLimit) : globalLimit
    if (bucket.allowed_mime_types && bucket.allowed_mime_types.length > 0) {
      try {
        validateMimeType(mime, bucket.allowed_mime_types)
      } catch (e) {
        await readBody(ctx.req, 0)
        throw e
      }
    }
    const declared = Number(ctx.req.headers["content-length"])
    const { bytes, total } = await readBody(ctx.req, maxFileSize + 1)
    if ((Number.isFinite(declared) && declared > maxFileSize) || total > maxFileSize) throw ERR.entityTooLarge()
    const key = `${bucketId}/${name}`
    const current = objects.get(key)
    if (current && !upsert) throw ERR.keyAlreadyExists()
    const now = new Date(nowMs())
    const obj: FakeObject = {
      bucket: bucketId,
      name,
      id: current?.id ?? crypto.randomUUID(),
      version: crypto.randomUUID(),
      bytes,
      contentType: mime,
      cacheControl: String(ctx.req.headers["cache-control"] ?? "no-cache"),
      etag: `"${crypto.createHash("md5").update(bytes).digest("hex")}"`,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    }
    objects.set(key, obj)
    return obj
  }

  function assetHeaders(obj: FakeObject): Record<string, string> {
    const ct = obj.contentType.toLowerCase().includes("text/html") ? "text/plain" : obj.contentType
    return {
      "Accept-Ranges": "bytes",
      "Content-Type": ct,
      ETag: obj.etag,
      "X-Robots-Tag": "none",
      "Last-Modified": obj.updatedAt.toUTCString(),
      "Cache-Control": obj.cacheControl,
    }
  }

  /** AssetRenderer con backend S3: Range simple → 206; mal formado → se ignora; fuera de rango → 416. */
  function sendAsset(ctx: Ctx, obj: FakeObject): void {
    const headers = assetHeaders(obj)
    const size = obj.bytes.length
    const range = typeof ctx.req.headers.range === "string" ? ctx.req.headers.range : ""
    const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
    if (m && (m[1] || m[2])) {
      let from: number
      let to: number
      if (!m[1]) {
        const suffix = Number(m[2])
        if (suffix <= 0 || size === 0) throw ERR.invalidRange()
        from = Math.max(size - suffix, 0)
        to = size - 1
      } else {
        from = Number(m[1])
        to = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
        if (from >= size || (m[2] && Number(m[2]) < from)) throw ERR.invalidRange()
      }
      const part = obj.bytes.subarray(from, to + 1)
      send(ctx, 206, part, { ...headers, "Content-Range": `bytes ${from}-${to}/${size}`, "Content-Length": String(part.length) })
      return
    }
    send(ctx, 200, obj.bytes, { ...headers, "Content-Length": String(size) })
  }

  function sendHead(ctx: Ctx, obj: FakeObject): void {
    ctx.res.writeHead(200, { ...assetHeaders(obj), "Content-Length": String(obj.bytes.length) })
    ctx.res.end()
  }

  function sendInfo(ctx: Ctx, obj: FakeObject): void {
    send(ctx, 200, {
      id: obj.id,
      name: obj.name,
      version: obj.version,
      bucket_id: obj.bucket,
      size: obj.bytes.length,
      content_type: obj.contentType,
      cache_control: obj.cacheControl,
      etag: obj.etag,
      metadata: null,
      last_modified: obj.updatedAt.toISOString(),
      created_at: obj.createdAt.toISOString(),
    })
  }

  function verifyObjectToken(ctx: Ctx, bucket: string, name: string, scope: "upload" | "download"): Record<string, unknown> {
    const token = ctx.query.get("token")
    if (!token) throw ERR.invalidRequest("querystring must have required property 'token'")
    let payload: Record<string, unknown>
    try {
      payload = verifyJwt(token, jwtSecret, nowSec())
    } catch (e) {
      throw ERR.invalidJwt((e as Error).message)
    }
    if (payload.scope !== scope) throw ERR.invalidSignature(`Token is not scoped for ${scope}`)
    if (payload.url !== `${bucket}/${name}`) throw ERR.invalidSignature()
    return payload
  }

  function bucketJson(b: FakeBucket) {
    return { ...b, owner: "", owner_id: "", type: "STANDARD" }
  }

  async function routeBucket(ctx: Ctx, rest: string): Promise<void> {
    if (rest === "" || rest === "/") {
      requireAuth(ctx, false)
      if (ctx.method === "GET") return send(ctx, 200, [...buckets.values()].map(bucketJson))
      if (ctx.method !== "POST") throw ERR.invalidRequest("Método no soportado")
      const body = await readJson(ctx.req)
      if (typeof body.name !== "string") throw ERR.invalidRequest("body must have required property 'name'")
      const name = body.name
      const id = typeof body.id === "string" && body.id ? body.id : name
      if (name.trim() !== name || !name || name.length > 100 || !VALID_BUCKET_NAME.test(name)) throw ERR.invalidBucketName()
      const fileSizeLimit = parseFileSizeLimit(body.file_size_limit, globalLimit)
      const allowed = normalizeAllowedMimeTypes(body.allowed_mime_types)
      if (buckets.has(id)) throw ERR.bucketAlreadyExists()
      const now = new Date(nowMs()).toISOString()
      buckets.set(id, {
        id,
        name,
        public: body.public === true,
        file_size_limit: fileSizeLimit ?? null,
        allowed_mime_types: allowed ?? null,
        created_at: now,
        updated_at: now,
      })
      return send(ctx, 200, { name })
    }
    const id = decodeURIComponent(rest.replace(/^\//, ""))
    requireAuth(ctx, false)
    if (ctx.method === "GET") return send(ctx, 200, bucketJson(findBucket(id)))
    if (ctx.method === "PUT") {
      const b = findBucket(id)
      const body = await readJson(ctx.req)
      const fileSizeLimit = parseFileSizeLimit(body.file_size_limit, globalLimit)
      const allowed = normalizeAllowedMimeTypes(body.allowed_mime_types)
      if (typeof body.public === "boolean") b.public = body.public
      if (fileSizeLimit !== undefined) b.file_size_limit = fileSizeLimit
      if (allowed !== undefined) b.allowed_mime_types = allowed
      b.updated_at = new Date(nowMs()).toISOString()
      return send(ctx, 200, { message: "Successfully updated" })
    }
    if (ctx.method === "DELETE") {
      findBucket(id)
      if ([...objects.values()].some((o) => o.bucket === id)) {
        throw new StorageHttpError(409, "InvalidRequest", "InvalidRequest", "The bucket you tried to delete is not empty")
      }
      buckets.delete(id)
      return send(ctx, 200, { message: "Successfully deleted" })
    }
    throw ERR.invalidRequest("Método no soportado")
  }

  async function routeObject(ctx: Ctx, rest: string): Promise<void> {
    const m = ctx.method
    // --- URL firmada de subida ---
    if (rest.startsWith("upload/sign/")) {
      const { bucket, name } = splitBucketPath(rest.slice("upload/sign/".length))
      if (m === "POST") {
        requireAuth(ctx, false)
        await readBody(ctx.req, 0)
        mustBeValidKey(name)
        findBucket(bucket)
        const upsert = ctx.req.headers["x-upsert"] === "true"
        if (!upsert && objects.has(`${bucket}/${name}`)) throw ERR.keyAlreadyExists()
        const url = `${bucket}/${name}`
        const claims = { url, upsert, scope: "upload", iat: nowSec(), exp: nowSec() + uploadExpiresIn }
        const token = signJwt(claims, jwtSecret)
        return send(ctx, 200, { url: `/object/upload/sign/${url}?token=${token}`, token })
      }
      if (m === "PUT") {
        const payload = verifyObjectToken(ctx, bucket, name, "upload")
        const obj = await storeFromRequest(ctx, bucket, name, payload.upsert === true)
        return send(ctx, 200, { Key: `${obj.bucket}/${obj.name}` })
      }
    }
    // --- URL firmada de descarga ---
    if (rest.startsWith("sign/")) {
      const { bucket, name } = splitBucketPath(rest.slice("sign/".length))
      if (m === "POST") {
        requireAuth(ctx, false)
        const body = await readJson(ctx.req)
        const expiresIn = Number(body.expiresIn)
        if (!Number.isInteger(expiresIn) || expiresIn < 1) throw ERR.invalidRequest("body/expiresIn must be >= 1")
        findBucket(bucket)
        findObject(bucket, name)
        const url = `${bucket}/${name}`
        const token = signJwt({ url, scope: "download", iat: nowSec(), exp: nowSec() + expiresIn }, jwtSecret)
        return send(ctx, 200, { signedURL: `/object/sign/${url}?token=${token}` })
      }
      if (m === "GET" || m === "HEAD") {
        verifyObjectToken(ctx, bucket, name, "download")
        findBucket(bucket)
        return sendAsset(ctx, findObject(bucket, name))
      }
    }
    // --- Lectura autenticada ---
    if (rest.startsWith("authenticated/") && (m === "GET" || m === "HEAD")) {
      const { bucket, name } = splitBucketPath(rest.slice("authenticated/".length))
      requireAuth(ctx, true)
      visibleBucket(ctx, bucket)
      const obj = findObject(bucket, name)
      return m === "HEAD" ? sendHead(ctx, obj) : sendAsset(ctx, obj)
    }
    if (rest.startsWith("info/authenticated/") && m === "GET") {
      const { bucket, name } = splitBucketPath(rest.slice("info/authenticated/".length))
      requireAuth(ctx, true)
      visibleBucket(ctx, bucket)
      return sendInfo(ctx, findObject(bucket, name))
    }
    if (rest.startsWith("info/public/") && m === "GET") {
      const { bucket, name } = splitBucketPath(rest.slice("info/public/".length))
      const b = findBucket(bucket)
      if (!b.public) throw ERR.noSuchBucket()
      return sendInfo(ctx, findObject(bucket, name))
    }
    if (rest.startsWith("info/") && m === "GET") {
      const { bucket, name } = splitBucketPath(rest.slice("info/".length))
      visibleBucket(ctx, bucket)
      return sendInfo(ctx, findObject(bucket, name))
    }
    if (rest.startsWith("public/") && (m === "GET" || m === "HEAD")) {
      const { bucket, name } = splitBucketPath(rest.slice("public/".length))
      const b = findBucket(bucket)
      if (!b.public) throw ERR.noSuchBucket()
      const obj = findObject(bucket, name)
      return m === "HEAD" ? sendHead(ctx, obj) : sendAsset(ctx, obj)
    }
    // --- DELETE /object/{bucket} { prefixes } ---
    if (m === "DELETE" && !rest.includes("/")) {
      requireAuth(ctx, false)
      const body = await readJson(ctx.req)
      const prefixes = body.prefixes
      if (!Array.isArray(prefixes) || prefixes.length === 0) {
        throw ERR.invalidRequest("body/prefixes must NOT have fewer than 1 items")
      }
      const bucket = decodeURIComponent(rest)
      const deleted: Record<string, unknown>[] = []
      for (const p of prefixes) {
        const name = typeof p === "string" ? p : p && typeof p === "object" ? String((p as { path?: unknown }).path ?? "") : ""
        const key = `${bucket}/${name}`
        const obj = objects.get(key)
        if (obj) {
          objects.delete(key)
          deleted.push({ name: obj.name, bucket_id: obj.bucket, id: obj.id, version: obj.version })
        }
      }
      return send(ctx, 200, deleted)
    }
    // --- /object/{bucket}/{ruta} ---
    const { bucket, name } = splitBucketPath(rest)
    if (m === "POST" || m === "PUT") {
      requireAuth(ctx, false)
      const upsert = m === "PUT" || ctx.req.headers["x-upsert"] === "true"
      if (m === "PUT") findObject(bucket, name)
      const obj = await storeFromRequest(ctx, bucket, name, upsert)
      return send(ctx, 200, { Id: obj.id, Key: `${obj.bucket}/${obj.name}` })
    }
    if (m === "DELETE") {
      requireAuth(ctx, false)
      findBucket(bucket)
      findObject(bucket, name)
      objects.delete(`${bucket}/${name}`)
      return send(ctx, 200, { message: "Successfully deleted" })
    }
    if (m === "GET" || m === "HEAD") {
      // allowInvalidJwt: sin JWT válido solo se ven buckets públicos.
      visibleBucket(ctx, bucket)
      const obj = findObject(bucket, name)
      return m === "HEAD" ? sendHead(ctx, obj) : sendAsset(ctx, obj)
    }
    throw ERR.invalidRequest("Método no soportado")
  }

  function failureFor(method: string, route: string): FakeFailure | null {
    if (!failure) return null
    if (failure.method && failure.method.toUpperCase() !== method) return null
    if (failure.path) {
      const ok = typeof failure.path === "string" ? route.includes(failure.path) : failure.path.test(route)
      if (!ok) return null
    }
    const f = failure
    if (typeof f.times === "number") {
      f.times -= 1
      if (f.times <= 0) failure = null
    }
    return f
  }

  const server = http.createServer((req, res) => {
    const method = String(req.method ?? "GET").toUpperCase()
    const u = new URL(req.url ?? "/", "http://fake-storage")
    const pathname = u.pathname
    const route = pathname.startsWith("/storage/v1/") ? pathname.slice("/storage/v1".length) : pathname
    const ctx: Ctx = { req, res, method, route, query: u.searchParams, auth: authOf(req) }
    const log: FakeRequest = {
      method,
      path: route,
      authorized: ctx.auth === "service",
      status: 0,
      headers: {
        "content-type": req.headers["content-type"],
        "x-upsert": req.headers["x-upsert"] as string | undefined,
        range: req.headers.range,
        "content-length": req.headers["content-length"],
      },
    }
    res.on("finish", () => {
      log.status = res.statusCode
    })
    // CORS del gateway: cualquier origen; el preflight refleja las cabeceras pedidas.
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type, ETag")
    if (method === "OPTIONS") {
      requests.push(log)
      res.writeHead(200, {
        "Access-Control-Allow-Methods": "GET, HEAD, PUT, PATCH, POST, DELETE",
        "Access-Control-Allow-Headers": String(req.headers["access-control-request-headers"] ?? "authorization, content-type"),
        "Access-Control-Max-Age": "3600",
        "Content-Length": "0",
      })
      res.end()
      return
    }
    requests.push(log)

    const run = async () => {
      const f = failureFor(method, route)
      if (f?.delayMs) await new Promise((r) => setTimeout(r, f.delayMs))
      if (f && (f.status !== undefined || !f.delayMs)) {
        await readBody(req, 0)
        if (f.status === "network") {
          req.socket.destroy()
          return
        }
        const status = f.status ?? 500
        send(ctx, status, f.body ?? { statusCode: String(status), code: "InternalError", error: "Internal", message: "Falla inyectada" })
        return
      }
      if (!pathname.startsWith("/storage/v1/")) {
        await readBody(req, 0)
        send(ctx, 404, { statusCode: "404", error: "Not Found", message: `Route ${method}:${pathname} not found` })
        return
      }
      let rest: string
      try {
        rest = route
          .split("/")
          .map((s) => decodeURIComponent(s))
          .join("/")
      } catch {
        throw ERR.invalidRequest("URI mal formada")
      }
      if (rest === "/bucket" || rest.startsWith("/bucket/")) return routeBucket(ctx, rest.slice("/bucket".length))
      if (rest.startsWith("/object/")) return routeObject(ctx, rest.slice("/object/".length))
      await readBody(req, 0)
      send(ctx, 404, { statusCode: "404", error: "Not Found", message: `Route ${method}:${pathname} not found` })
    }

    run().catch(async (e: unknown) => {
      await readBody(req, 0).catch(() => undefined)
      if (res.headersSent) {
        res.end()
        return
      }
      if (e instanceof StorageHttpError) {
        send(ctx, e.httpStatus, e.body())
        return
      }
      send(ctx, 500, { statusCode: "500", code: "InternalError", error: "Internal", message: "Internal Server Error" })
    })
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    objects,
    buckets,
    requests,
    setFailure: (f) => {
      failure = f ? { ...f } : null
    },
    advanceTime: (seconds) => {
      clockOffsetMs += seconds * 1000
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
