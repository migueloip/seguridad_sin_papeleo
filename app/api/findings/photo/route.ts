import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"

/** Tiempo máximo para descargar una foto desde Storage. */
const FETCH_TIMEOUT_MS = 10_000

/**
 * Cabeceras comunes. La foto es privada del usuario (nada de cachés
 * compartidos) y se sirve sin "sniffing" y en sandbox, para que una data URL
 * o un objeto con tipo HTML/SVG no pueda ejecutar scripts en nuestro origen.
 */
function photoHeaders(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
  }
}

/**
 * Origen permitido para descargar fotos remotas: exactamente el de
 * SUPABASE_URL. Cualquier otra URL (otro host, otro puerto, http en vez de
 * https, credenciales embebidas...) se rechaza para evitar SSRF.
 */
function allowedRemoteUrl(raw: string): URL | null {
  const base = process.env.SUPABASE_URL
  if (!base) return null
  let allowedOrigin: string
  let target: URL
  try {
    allowedOrigin = new URL(base).origin
    target = new URL(raw)
  } catch {
    return null
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return null
  if (target.username || target.password) return null
  if (target.origin !== allowedOrigin) return null
  return target
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const idParam = url.searchParams.get("id")
    const indexParam = url.searchParams.get("index")
    const id = idParam ? Number(idParam) : NaN
    const idx = indexParam ? Number(indexParam) : 0
    if (!Number.isFinite(id) || idx < 0) {
      return new NextResponse("bad request", { status: 400 })
    }
    const userId = await getCurrentUserId()
    if (!userId) {
      return new NextResponse("unauthorized", { status: 401 })
    }
    const rows = await sql<{ photos?: unknown }[]>`SELECT photos FROM findings WHERE id = ${id} AND user_id = ${userId} LIMIT 1`
    const row = rows[0]
    if (!row || row.photos === null || row.photos === undefined) {
      return new NextResponse("not found", { status: 404 })
    }
    const arr = Array.isArray(row.photos) ? (row.photos as unknown[]) : []
    const item = arr[idx]
    if (!item || typeof item !== "string") {
      return new NextResponse("not found", { status: 404 })
    }
    if (item.startsWith("data:")) {
      const m = item.match(/^data:([^;]+);base64,(.+)$/)
      if (!m) return new NextResponse("unsupported", { status: 415 })
      const mime = m[1]
      const b64 = m[2]
      const buf = Buffer.from(b64, "base64")
      return new NextResponse(buf, { headers: photoHeaders(mime) })
    }
    if (item.startsWith("http://") || item.startsWith("https://")) {
      const target = allowedRemoteUrl(item)
      if (!target) return new NextResponse("unsupported", { status: 415 })
      const res = await fetch(target.toString(), {
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      const contentType = res.headers.get("content-type") || "application/octet-stream"
      const arrayBuf = await res.arrayBuffer()
      return new NextResponse(arrayBuf, { headers: photoHeaders(contentType) })
    }
    return new NextResponse("unsupported", { status: 415 })
  } catch {
    return new NextResponse("error", { status: 500 })
  }
}
