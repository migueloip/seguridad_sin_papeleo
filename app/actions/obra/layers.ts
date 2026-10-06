"use server"

/**
 * Acciones de capas de plano de obra. Cada export es un endpoint público; la
 * lógica, la validación y la autorización viven en lib/obra/server/layers.ts.
 * Las acciones por id de capa revalidan el proyecto resuelto desde la BD.
 */
import { revalidatePath } from "next/cache"
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import { createLayer, createLayerUploadTicket, deleteLayer, listLayers, updateLayer } from "@/lib/obra/server/layers"
import type { ActionResult, CadOrigin, Discipline, LayerFrame, LayerUploadTicket, PlanLayer } from "@/lib/obra/types"

export async function listObraLayers(projectId: number): Promise<ActionResult<PlanLayer[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listLayers(userId, projectId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

/**
 * Permiso firmado para subir una lámina grande DIRECTO a Supabase Storage
 * (PUT del navegador a `upload_url`); después se llama a createObraLayer con
 * `image_upload: { path, width_px, height_px }`. Sin Supabase responde un
 * error que indica el tamaño máximo que se puede enviar inline.
 */
export async function createObraLayerUploadTicket(
  projectId: number,
  input: { mime: string; size_bytes: number },
): Promise<ActionResult<LayerUploadTicket>> {
  try {
    const userId = await requireSessionUserId()
    const data = await createLayerUploadTicket(userId, projectId, input)
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
    /** Lámina ya subida con createObraLayerUploadTicket (alternativa a `image`). */
    image_upload?: { path: string; width_px: number; height_px: number } | null
    width_m?: number
    aspect?: number
    /** Solo DXF: origen CAD de la lámina, para alinearla con las otras capas DXF del nivel. */
    cad_origin?: CadOrigin | null
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
