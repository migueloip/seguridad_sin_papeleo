/**
 * Imagen de una capa de plano de obra, con control de acceso.
 *
 *   GET /api/obra/layers/[id]/image   (sesión web por cookie)
 *
 * El proyecto se resuelve desde la capa en la BD y se exige plans.view en ESE
 * proyecto (lib/obra/server/layers.ts → readLayerImage). Sin acceso responde
 * 404 para no revelar que la capa existe. El Content-Type es el detectado en
 * los bytes (solo PNG, JPEG o WebP) y se sirve sin "sniffing".
 */
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { ObraAccessError, ObraValidationError } from "@/lib/obra/access"
import { readLayerImage } from "@/lib/obra/server/layers"
import { parseIntId } from "@/lib/route"

function errorResponse(status: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  )
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params
  const id = parseIntId(String(rawId ?? ""))
  if (id == null) return errorResponse(404, "Capa no encontrada.")
  const session = await getSession()
  if (!session) return errorResponse(401, "Sesión no válida. Vuelve a iniciar sesión.")
  try {
    const img = await readLayerImage(Number(session.user_id), id)
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
