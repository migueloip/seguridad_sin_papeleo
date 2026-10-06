/**
 * Foto de un hallazgo ubicado en el plano, con control de acceso de obra.
 *
 *   GET /api/obra/findings/[id]/photo?index=0   (sesión web por cookie)
 *
 * El proyecto se resuelve desde el pin del hallazgo en la BD y se exige
 * findings.view en ESE proyecto (o haberlo reportado). Sin acceso responde 404
 * para no revelar que existe. Solo se sirven PNG, JPEG o WebP verificados por
 * sus bytes, sin "sniffing" y en sandbox.
 */
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { ObraAccessError, ObraValidationError } from "@/lib/obra/access"
import { readFindingPhoto } from "@/lib/obra/server/pins"
import { parseIntId } from "@/lib/route"

function errorResponse(status: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  )
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params
  const id = parseIntId(String(rawId ?? ""))
  if (id == null) return errorResponse(404, "Foto no encontrada.")
  const rawIndex = new URL(req.url).searchParams.get("index") ?? "0"
  const index = /^\d{1,2}$/.test(rawIndex) ? Number(rawIndex) : -1
  if (index < 0) return errorResponse(404, "Foto no encontrada.")
  const session = await getSession()
  if (!session) return errorResponse(401, "Sesión no válida. Vuelve a iniciar sesión.")
  try {
    const img = await readFindingPhoto(Number(session.user_id), id, index)
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
    if (e instanceof ObraValidationError) return errorResponse(404, "Foto no encontrada.")
    console.error("[obra/finding-photo]", e)
    return errorResponse(500, "No se pudo leer la foto del hallazgo.")
  }
}
