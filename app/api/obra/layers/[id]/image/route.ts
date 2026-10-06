/**
 * Imagen de una capa de plano de obra, con control de acceso.
 *
 *   GET /api/obra/layers/[id]/image   (sesión web por cookie)
 *
 * El proyecto se resuelve desde la capa en la BD y se exige plans.view en ESE
 * proyecto (lib/obra/server/layers.ts). Sin acceso responde 404 para no revelar
 * que la capa existe.
 *
 * - Lámina en el bucket privado de Supabase: redirige (302) a una URL firmada
 *   de corta duración, para no pasar hasta 25 MB por la función (memoria y
 *   límite de tamaño de respuesta del hosting). El objeto se validó al crear la
 *   capa (tipo declarado y magic bytes) y no se puede sobrescribir.
 * - Lámina inline (sin Supabase) o si la firma falla: devuelve los bytes, con el
 *   Content-Type detectado en ellos (solo PNG, JPEG o WebP) y sin "sniffing".
 */
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { ObraAccessError, ObraValidationError } from "@/lib/obra/access"
import { getLayerImageSignedUrl, readLayerImage } from "@/lib/obra/server/layers"
import { parseIntId } from "@/lib/route"

/** Vigencia de la URL firmada; la redirección se cachea menos tiempo para que nunca apunte a una vencida. */
const SIGNED_URL_TTL_S = 900
const REDIRECT_MAX_AGE_S = 600

function errorResponse(status: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  )
}

async function signedLayerUrl(userId: number, layerId: number): Promise<string | null> {
  try {
    return await getLayerImageSignedUrl(userId, layerId, SIGNED_URL_TTL_S)
  } catch (e) {
    if (e instanceof ObraAccessError || e instanceof ObraValidationError) throw e
    // Si Storage no firma (red, configuración), se intenta servir los bytes directamente.
    console.error("[obra/layer-image] no se pudo firmar la descarga", e)
    return null
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params
  const id = parseIntId(String(rawId ?? ""))
  if (id == null) return errorResponse(404, "Capa no encontrada.")
  const session = await getSession()
  if (!session) return errorResponse(401, "Sesión no válida. Vuelve a iniciar sesión.")
  const userId = Number(session.user_id)
  try {
    const signed = await signedLayerUrl(userId, id)
    if (signed) {
      return new NextResponse(null, {
        status: 302,
        headers: {
          Location: signed,
          "Cache-Control": `private, max-age=${REDIRECT_MAX_AGE_S}`,
          "Referrer-Policy": "no-referrer",
        },
      })
    }
    const img = await readLayerImage(userId, id)
    return new NextResponse(new Uint8Array(img.bytes), {
      status: 200,
      headers: {
        "Content-Type": img.mime,
        "Content-Length": String(img.bytes.length),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    })
  } catch (e) {
    if (e instanceof ObraAccessError) return errorResponse(e.status, e.message)
    if (e instanceof ObraValidationError) return errorResponse(400, e.message)
    console.error("[obra/layer-image]", e)
    return errorResponse(500, "No se pudo leer la imagen del plano.")
  }
}
