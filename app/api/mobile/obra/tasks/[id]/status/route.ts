/**
 * API móvil: cambiar el estado de una tarea de obra (token Bearer).
 *
 *   POST /api/mobile/obra/tasks/[id]/status   body { status, notes? } → { task }
 *
 * La autorización se resuelve desde la tarea (su proyecto en la BD), con los
 * mismos permisos que en la web (lib/obra/server/tasks.ts → setTaskStatus).
 */
import { revalidatePath } from "next/cache"
import { ObraAccessError, ObraValidationError } from "@/lib/obra/access"
import { setTaskStatus } from "@/lib/obra/server/tasks"
import type { TaskStatus } from "@/lib/obra/types"
import { mobileJson, mobileOptions } from "@/lib/mobile-api"
import { getMobileSessionFromRequest } from "@/lib/mobile-auth"

export function OPTIONS() {
  return mobileOptions()
}

function errorResponse(e: unknown) {
  if (e instanceof ObraAccessError) return mobileJson({ error: e.message }, { status: e.status })
  if (e instanceof ObraValidationError) return mobileJson({ error: e.message }, { status: 400 })
  console.error("[obra/mobile]", e)
  return mobileJson({ error: "Ocurrió un error inesperado. Intenta de nuevo." }, { status: 500 })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getMobileSessionFromRequest(req)
  if (!session) return mobileJson({ error: "Sesión no válida. Vuelve a iniciar sesión." }, { status: 401 })
  const userId = Number(session.user_id)
  try {
    const { id } = await ctx.params
    if (!/^\d{1,10}$/.test(String(id ?? ""))) {
      return mobileJson({ error: "Tarea no encontrada." }, { status: 404 })
    }
    const body = (await req.json().catch(() => null)) as { status?: unknown; notes?: unknown } | null
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return mobileJson({ error: "Solicitud no válida." }, { status: 400 })
    }
    if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string") {
      return mobileJson({ error: "Las notas no son válidas." }, { status: 400 })
    }
    const task = await setTaskStatus(
      userId,
      Number(id),
      body.status as TaskStatus,
      (body.notes as string | null | undefined) ?? undefined,
    )
    try {
      revalidatePath(`/obra/${task.project_id}`, "layout")
    } catch {
      // Fuera del runtime de Next (p.ej. tests) no hay caché que invalidar.
    }
    return mobileJson({ task })
  } catch (e) {
    return errorResponse(e)
  }
}
