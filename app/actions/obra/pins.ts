"use server"

/**
 * Acciones de hallazgos ubicados en el plano de obra. Cada export es un
 * endpoint público; la lógica, la validación y la autorización viven en
 * lib/obra/server/pins.ts. El análisis solo deja sugerencias pendientes.
 */
import { revalidatePath } from "next/cache"
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import {
  analyzeFinding,
  getFindingContext,
  listPins,
  listUnpinnedFindings,
  pinExistingFinding,
  reportFindingOnPlan,
} from "@/lib/obra/server/pins"
import type {
  ActionResult,
  AiSuggestion,
  Correlation,
  FindingCategory,
  FindingPin,
  ObraTask,
  Severity,
} from "@/lib/obra/types"

export async function listObraPins(projectId: number, opts?: { level?: number }): Promise<ActionResult<FindingPin[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listPins(userId, projectId, opts)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function reportObraFinding(
  projectId: number,
  input: {
    layer_id: number
    x: number
    y: number
    title: string
    description?: string | null
    severity: Severity
    category?: FindingCategory | null
    photo_data_url?: string | null
  },
): Promise<ActionResult<{ finding_id: number; pin: FindingPin; suggestions: AiSuggestion[] }>> {
  try {
    const userId = await requireSessionUserId()
    const data = await reportFindingOnPlan(userId, projectId, input)
    revalidatePath(`/obra/${data.pin.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function pinExistingObraFinding(
  projectId: number,
  input: { finding_id: number; layer_id: number; x: number; y: number; category?: FindingCategory | null },
): Promise<ActionResult<FindingPin>> {
  try {
    const userId = await requireSessionUserId()
    const data = await pinExistingFinding(userId, projectId, input)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function listUnpinnedObraFindings(
  projectId: number,
): Promise<ActionResult<{ id: number; title: string; severity: Severity; status: string; created_at: string }[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listUnpinnedFindings(userId, projectId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function analyzeObraFinding(
  findingId: number,
  opts?: { use_ai?: boolean },
): Promise<ActionResult<{ correlations: Correlation[]; suggestions: AiSuggestion[] }>> {
  try {
    const userId = await requireSessionUserId()
    const useAi = opts && typeof opts === "object" ? opts.use_ai : undefined
    const { project_id, correlations, suggestions } = await analyzeFinding(userId, findingId, { use_ai: useAi })
    revalidatePath(`/obra/${project_id}`, "layout")
    return { ok: true, data: { correlations, suggestions } }
  } catch (e) {
    return toActionError(e)
  }
}

export async function getObraFindingContext(
  findingId: number,
): Promise<
  ActionResult<{
    pin: FindingPin
    correlations: Correlation[]
    suggestions: AiSuggestion[]
    tasks: ObraTask[]
    photo_indexes: number[]
  }>
> {
  try {
    const userId = await requireSessionUserId()
    const data = await getFindingContext(userId, findingId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}
