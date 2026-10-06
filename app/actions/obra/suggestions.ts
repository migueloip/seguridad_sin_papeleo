"use server"

/**
 * Acciones de la bandeja de sugerencias de IA (aprobación humana
 * obligatoria). Cada export es un endpoint público; la lógica, la validación
 * y la autorización viven en lib/obra/server/suggestions.ts.
 */
import { revalidatePath } from "next/cache"
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import {
  approveSuggestion,
  countPendingSuggestions,
  listSuggestions,
  rejectSuggestion,
  type ApproveResult,
} from "@/lib/obra/server/suggestions"
import type { ActionResult, AiSuggestion, SuggestionStatus } from "@/lib/obra/types"

export async function listObraSuggestions(
  projectId: number,
  filter?: { status?: SuggestionStatus[]; finding_id?: number; limit?: number },
): Promise<ActionResult<AiSuggestion[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listSuggestions(userId, projectId, filter)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

/** Pendientes que el usuario puede decidir (contador de la pestaña "Aprobaciones IA"; 0 si su rol no revisa). */
export async function countObraPendingApprovals(projectId: number): Promise<ActionResult<number>> {
  try {
    const userId = await requireSessionUserId()
    const data = await countPendingSuggestions(userId, projectId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function approveObraSuggestion(
  suggestionId: number,
  opts?: { edited_payload?: unknown; notes?: string },
): Promise<ActionResult<ApproveResult>> {
  try {
    const userId = await requireSessionUserId()
    const data = await approveSuggestion(userId, suggestionId, opts)
    revalidatePath(`/obra/${data.suggestion.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function rejectObraSuggestion(suggestionId: number, reason?: string): Promise<ActionResult<AiSuggestion>> {
  try {
    const userId = await requireSessionUserId()
    const data = await rejectSuggestion(userId, suggestionId, reason)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}
