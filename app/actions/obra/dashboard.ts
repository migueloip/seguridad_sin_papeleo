"use server"

/**
 * Acción del tablero de obra por rol. La lógica vive en
 * lib/obra/server/dashboard.ts.
 */
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import { getDashboard } from "@/lib/obra/server/dashboard"
import type { ActionResult, ObraDashboard } from "@/lib/obra/types"

export async function getObraDashboard(projectId: number): Promise<ActionResult<ObraDashboard>> {
  try {
    const userId = await requireSessionUserId()
    const data = await getDashboard(userId, projectId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}
