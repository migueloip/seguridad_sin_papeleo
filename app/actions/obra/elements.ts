"use server"

/**
 * Acciones de elementos de plano de obra. Cada export es un endpoint público;
 * la lógica, la validación y la autorización viven en
 * lib/obra/server/elements.ts. La detección con IA solo crea una sugerencia
 * pendiente: nunca inserta elementos.
 */
import { revalidatePath } from "next/cache"
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import {
  createElements,
  deleteElement,
  listElements,
  requestLayerExtraction,
  updateElement,
} from "@/lib/obra/server/elements"
import type {
  ActionResult,
  ElementAttributes,
  ElementGeometry,
  ElementType,
  PlanElement,
  PlanElementDraft,
} from "@/lib/obra/types"

export async function listObraElements(
  projectId: number,
  opts?: { level?: number; layer_id?: number },
): Promise<ActionResult<PlanElement[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listElements(userId, projectId, opts)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function createObraElements(
  layerId: number,
  drafts: PlanElementDraft[],
  source: "manual" | "dxf",
): Promise<ActionResult<{ inserted: number }>> {
  try {
    const userId = await requireSessionUserId()
    const { inserted, project_id } = await createElements(userId, layerId, drafts, source)
    revalidatePath(`/obra/${project_id}`, "layout")
    return { ok: true, data: { inserted } }
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateObraElement(
  elementId: number,
  patch: { element_type?: ElementType; label?: string | null; attributes?: ElementAttributes; geometry?: ElementGeometry },
): Promise<ActionResult<PlanElement>> {
  try {
    const userId = await requireSessionUserId()
    const data = await updateElement(userId, elementId, patch)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function deleteObraElement(elementId: number): Promise<ActionResult<null>> {
  try {
    const userId = await requireSessionUserId()
    const { project_id } = await deleteElement(userId, elementId)
    revalidatePath(`/obra/${project_id}`, "layout")
    return { ok: true, data: null }
  } catch (e) {
    return toActionError(e)
  }
}

export async function requestObraLayerExtraction(
  layerId: number,
): Promise<ActionResult<{ suggestion_id: number; element_count: number }>> {
  try {
    const userId = await requireSessionUserId()
    const { suggestion_id, element_count, project_id } = await requestLayerExtraction(userId, layerId)
    revalidatePath(`/obra/${project_id}`, "layout")
    return { ok: true, data: { suggestion_id, element_count } }
  } catch (e) {
    return toActionError(e)
  }
}
