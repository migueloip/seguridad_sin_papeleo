"use server"

/**
 * Acciones de obra: listado de obras del usuario y su acceso a una obra.
 * Cada export es un endpoint público; la lógica vive en lib/obra/server.
 */
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import { listMyProjects } from "@/lib/obra/server/dashboard"
import { getAccessInfo } from "@/lib/obra/server/members"
import type { ActionResult, ObraProjectSummary, ProjectAccess } from "@/lib/obra/types"

export async function listMyObraProjects(): Promise<ActionResult<ObraProjectSummary[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listMyProjects(userId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function getObraAccess(projectId: number): Promise<ActionResult<ProjectAccess & { permissions: string[] }>> {
  try {
    const userId = await requireSessionUserId()
    const data = await getAccessInfo(userId, projectId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}
