import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"

/**
 * Convierte un plano CAD (DXF/DWG en base64) a imagen con un conversor
 * externo (CAD_CONVERTER_URL). Exige sesión real.
 *
 * - El cuerpo se lee con un tope de tamaño (no se carga entero en memoria si
 *   es más grande de lo permitido).
 * - La llamada al conversor tiene un tiempo máximo (AbortSignal.timeout).
 * - Los errores del conversor se registran en el servidor; al cliente solo le
 *   llega un mensaje genérico en español (nunca el texto del proveedor).
 */

/** Máximo del base64 de un archivo CAD (25 MB de texto). */
const MAX_CAD_BASE64_CHARS = 25 * 1024 * 1024
/** Máximo del cuerpo JSON: el base64 más un margen para el resto de los campos. */
const MAX_BODY_BYTES = MAX_CAD_BASE64_CHARS + 16 * 1024
/** Tiempo máximo de espera al conversor externo. */
const CONVERTER_TIMEOUT_MS = 60_000
/** Máximo del data URL que devuelve el conversor (≈ 30 MB de texto). */
const MAX_RESULT_DATA_URL_CHARS = 30 * 1024 * 1024

const FALLBACK = "Exporta el plano como imagen o PDF."
const FALLBACK_INLINE = "exporta el plano como imagen o PDF."
const TOO_LARGE = "El archivo CAD supera el tamaño máximo permitido."

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

/** Lee el cuerpo como texto UTF-8 sin pasar de `maxBytes`; null si lo supera. */
async function readBodyLimited(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!req.body) return ""
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function isTimeout(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name
  return name === "TimeoutError" || name === "AbortError"
}

export async function POST(req: Request) {
  // El middleware solo comprueba que exista la cookie; aquí se valida la sesión real.
  const session = await getSession()
  if (!session) {
    return jsonError("No autenticado", 401)
  }

  try {
    const raw = await readBodyLimited(req, MAX_BODY_BYTES)
    if (raw === null) return jsonError(TOO_LARGE, 413)
    let body: { base64?: unknown; ext?: unknown }
    try {
      const parsed: unknown = JSON.parse(raw)
      body = parsed && typeof parsed === "object" ? (parsed as { base64?: unknown; ext?: unknown }) : {}
    } catch {
      return jsonError("Solicitud no válida.", 400)
    }
    const base64 = typeof body.base64 === "string" ? body.base64.trim() : ""
    const extRaw = typeof body.ext === "string" ? body.ext.trim().toLowerCase() : ""
    if (!base64) {
      return jsonError("Falta contenido del archivo CAD", 400)
    }
    if (base64.length > MAX_CAD_BASE64_CHARS) {
      return jsonError(TOO_LARGE, 413)
    }
    if (!extRaw || (extRaw !== "dxf" && extRaw !== "dwg")) {
      return jsonError("Extensión de archivo CAD no soportada", 400)
    }
    const converterUrl = process.env.CAD_CONVERTER_URL
    if (!converterUrl) {
      return jsonError(`No hay conversor CAD configurado. Configura CAD_CONVERTER_URL o ${FALLBACK_INLINE}`, 400)
    }

    let upstream: Response
    try {
      upstream = await fetch(converterUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, ext: extRaw }),
        signal: AbortSignal.timeout(CONVERTER_TIMEOUT_MS),
      })
    } catch (e) {
      if (isTimeout(e)) {
        console.error(`[cad-to-image] el conversor no respondió en ${CONVERTER_TIMEOUT_MS} ms`)
        return jsonError(`El conversor CAD no respondió a tiempo. Intenta de nuevo o ${FALLBACK_INLINE}`, 504)
      }
      console.error("[cad-to-image] no se pudo contactar al conversor", e)
      return jsonError(`No se pudo contactar al conversor CAD. ${FALLBACK}`, 502)
    }

    if (!upstream.ok) {
      // El detalle del proveedor se queda en el servidor (puede traer rutas, versiones o datos internos).
      let detail = ""
      try {
        detail = (await upstream.text()).slice(0, 500)
      } catch {
        // sin cuerpo legible
      }
      console.error(`[cad-to-image] el conversor respondió ${upstream.status}`, detail)
      return jsonError(`El conversor CAD no pudo procesar el archivo. ${FALLBACK}`, 502)
    }

    let data: { dataUrl?: unknown; mimeType?: unknown } | null = null
    try {
      data = (await upstream.json()) as { dataUrl?: unknown; mimeType?: unknown } | null
    } catch (e) {
      if (isTimeout(e)) {
        console.error(`[cad-to-image] el conversor no terminó de responder en ${CONVERTER_TIMEOUT_MS} ms`)
        return jsonError(`El conversor CAD no respondió a tiempo. Intenta de nuevo o ${FALLBACK_INLINE}`, 504)
      }
      data = null
    }
    const dataUrl = data && typeof data.dataUrl === "string" ? data.dataUrl : ""
    const mime = /^data:(image\/[a-z0-9.+-]+)[;,]/i.exec(dataUrl)?.[1]?.toLowerCase() ?? null
    if (!mime || dataUrl.length > MAX_RESULT_DATA_URL_CHARS) {
      console.error("[cad-to-image] respuesta del conversor sin una imagen válida", {
        length: dataUrl.length,
        prefix: dataUrl.slice(0, 40),
      })
      return jsonError(`Respuesta inválida del conversor CAD. ${FALLBACK}`, 502)
    }
    return NextResponse.json({ dataUrl, mimeType: mime })
  } catch (e) {
    console.error("[cad-to-image] error inesperado", e)
    return jsonError(`Error procesando archivo CAD. ${FALLBACK}`, 500)
  }
}
