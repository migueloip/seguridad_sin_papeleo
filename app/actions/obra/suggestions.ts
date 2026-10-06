"use server"

/**
 * Acciones de la bandeja de sugerencias de IA (aprobación humana
 * obligatoria). Cada export es un endpoint público; la lógica, la validación
 * y la autorización viven en lib/obra/server/suggestions.ts.
 */
import { revalidatePath } from "next/cache"
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import { approveSuggestion, listSuggestions, rejectSuggestion } from "@/lib/obra/server/suggestions"
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

export async function approveObraSuggestion(
  suggestionId: number,
  opts?: { edited_payload?: unknown; notes?: string },
): Promise<
  ActionResult<{ suggestion: AiSuggestion; applied_entity_type: string | null; applied_entity_id: number | null }>
> {
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
