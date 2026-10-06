/**
 * API móvil de tareas de obra (app de terreno, token Bearer).
 *
 *   GET /api/mobile/obra/tasks                 → { projects: ObraProjectSummary[] }
 *       (pending_suggestions es 0 en las obras donde el rol no tiene ai.review)
 *   GET /api/mobile/obra/tasks?project_id=N    → { tasks: ObraTask[] } (las visibles para el usuario)
 *       parámetros opcionales: status=pendiente,en_progreso  mine=1
 */
import { ObraAccessError, ObraValidationError } from "@/lib/obra/access"
import { listMyProjects } from "@/lib/obra/server/dashboard"
import { listTasks } from "@/lib/obra/server/tasks"
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

export async function GET(req: Request) {
  const session = await getMobileSessionFromRequest(req)
  if (!session) return mobileJson({ error: "Sesión no válida. Vuelve a iniciar sesión." }, { status: 401 })
  const userId = Number(session.user_id)
  try {
    const url = new URL(req.url)
    const rawProject = url.searchParams.get("project_id")
    if (rawProject === null || rawProject.trim() === "") {
      const projects = await listMyProjects(userId)
      return mobileJson({ projects })
    }
    if (!/^\d{1,10}$/.test(rawProject.trim())) {
      return mobileJson({ error: "El parámetro project_id no es válido." }, { status: 400 })
    }
    const projectId = Number(rawProject.trim())
    const rawStatus = url.searchParams.get("status")
    const status = rawStatus
      ? (rawStatus
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean) as TaskStatus[])
      : undefined
    const mineParam = url.searchParams.get("mine")
    const mine = mineParam === "1" || mineParam === "true"
    const tasks = await listTasks(userId, projectId, { status, mine })
    return mobileJson({ tasks })
  } catch (e) {
    return errorResponse(e)
  }
}
