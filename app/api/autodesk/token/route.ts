import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"

/**
 * Token de 2 patas de Autodesk Platform Services para el visor (Viewer).
 *
 * Hoy ningún cliente del repo usa esta ruta; se mantiene acotada por si se
 * integra el visor:
 * - Exige sesión real (el middleware solo mira que exista la cookie).
 * - Pide el scope mínimo del visor ("viewables:read"): el token llega al
 *   navegador, así que no puede servir para leer, escribir ni crear buckets
 *   de la cuenta de Autodesk.
 * - Devuelve solo access_token y expires_in, sin caché, y nunca los mensajes
 *   del proveedor (se registran en el servidor).
 */

const AUTODESK_TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token"
/** Scope mínimo para mostrar modelos ya traducidos en el visor. */
const VIEWER_SCOPE = "viewables:read"
const TIMEOUT_MS = 15_000
const UNAVAILABLE = "No se pudo obtener el token de Autodesk. Intenta de nuevo más tarde."

export async function GET() {
  // El middleware solo comprueba que exista la cookie; aquí se valida la sesión real.
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  const clientId = process.env.AUTODESK_CLIENT_ID
  const clientSecret = process.env.AUTODESK_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error("[autodesk/token] faltan AUTODESK_CLIENT_ID o AUTODESK_CLIENT_SECRET")
    return NextResponse.json({ error: "El visor de Autodesk no está configurado." }, { status: 503 })
  }

  const params = new URLSearchParams()
  params.set("grant_type", "client_credentials")
  params.set("scope", VIEWER_SCOPE)

  try {
    const res = await fetch(AUTODESK_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        // Autenticación del cliente por cabecera (recomendada por APS) en vez de en el cuerpo.
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      let detail = ""
      try {
        detail = (await res.text()).slice(0, 300)
      } catch {
        // sin cuerpo legible
      }
      console.error(`[autodesk/token] Autodesk respondió ${res.status}`, detail)
      return NextResponse.json({ error: UNAVAILABLE }, { status: 502 })
    }

    const data = (await res.json()) as { access_token?: unknown; expires_in?: unknown }
    const accessToken = typeof data?.access_token === "string" ? data.access_token : ""
    const expiresIn = typeof data?.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : null
    if (!accessToken || expiresIn == null) {
      console.error("[autodesk/token] respuesta de Autodesk sin token o sin expires_in")
      return NextResponse.json({ error: UNAVAILABLE }, { status: 502 })
    }

    // El token es una credencial: que ningún caché intermedio lo guarde.
    return NextResponse.json(
      { access_token: accessToken, expires_in: expiresIn },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (e) {
    console.error("[autodesk/token] error al pedir el token", e instanceof Error ? e.name : e)
    return NextResponse.json({ error: UNAVAILABLE }, { status: 502 })
  }
}
