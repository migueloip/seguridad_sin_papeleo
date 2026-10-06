"use server"

/**
 * Acción de lectura de la auditoría de obra. La lógica vive en
 * lib/obra/server/audit.ts.
 */
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import { listAudit } from "@/lib/obra/server/audit"
import type { ActionResult, AuditEntry } from "@/lib/obra/types"

export async function listObraAudit(
  projectId: number,
  opts?: { limit?: number; before_id?: number },
): Promise<ActionResult<AuditEntry[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listAudit(userId, projectId, opts)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}
