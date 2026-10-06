"use server"

/**
 * Acciones de capas de plano de obra. Cada export es un endpoint público; la
 * lógica, la validación y la autorización viven en lib/obra/server/layers.ts.
 * Las acciones por id de capa revalidan el proyecto resuelto desde la BD.
 */
import { revalidatePath } from "next/cache"
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import { createLayer, deleteLayer, listLayers, updateLayer } from "@/lib/obra/server/layers"
import type { ActionResult, Discipline, LayerFrame, PlanLayer } from "@/lib/obra/types"

export async function listObraLayers(projectId: number): Promise<ActionResult<PlanLayer[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listLayers(userId, projectId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function createObraLayer(
  projectId: number,
  input: {
    name: string
    discipline: Discipline
    level: number
    level_label?: string | null
    image?: { data_url: string; width_px: number; height_px: number } | null
    width_m?: number
    aspect?: number
  },
): Promise<ActionResult<PlanLayer>> {
  try {
    const userId = await requireSessionUserId()
    const data = await createLayer(userId, projectId, input)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateObraLayer(
  layerId: number,
  patch: {
    name?: string
    discipline?: Discipline
    level?: number
    level_label?: string | null
    frame?: Partial<LayerFrame>
    opacity?: number
  },
): Promise<ActionResult<PlanLayer>> {
  try {
    const userId = await requireSessionUserId()
    const data = await updateLayer(userId, layerId, patch)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function deleteObraLayer(layerId: number): Promise<ActionResult<null>> {
  try {
    const userId = await requireSessionUserId()
    const { project_id } = await deleteLayer(userId, layerId)
    revalidatePath(`/obra/${project_id}`, "layout")
    return { ok: true, data: null }
  } catch (e) {
    return toActionError(e)
  }
}
