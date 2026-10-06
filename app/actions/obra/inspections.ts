"use server"

/**
 * Acciones de revisiones de obra. Cada export es un endpoint público; la
 * lógica y la autorización viven en lib/obra/server/inspections.ts.
 */
import { revalidatePath } from "next/cache"
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import {
  closeInspection,
  createInspection,
  listInspections,
  updateInspection,
} from "@/lib/obra/server/inspections"
import type { ActionResult, InspectionStatus, ObraInspection } from "@/lib/obra/types"

export async function listObraInspections(projectId: number): Promise<ActionResult<ObraInspection[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listInspections(userId, projectId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function createObraInspection(
  projectId: number,
  input: { title: string; scheduled_for: string; lead_user_id?: number | null; notes?: string | null },
): Promise<ActionResult<ObraInspection>> {
  try {
    const userId = await requireSessionUserId()
    const data = await createInspection(userId, projectId, input)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateObraInspection(
  inspectionId: number,
  patch: {
    title?: string
    scheduled_for?: string
    lead_user_id?: number | null
    notes?: string | null
    status?: InspectionStatus
  },
): Promise<ActionResult<ObraInspection>> {
  try {
    const userId = await requireSessionUserId()
    const data = await updateInspection(userId, inspectionId, patch)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function closeObraInspection(
  inspectionId: number,
  input: { summary: string; carry_over_open_tasks: boolean },
): Promise<ActionResult<ObraInspection>> {
  try {
    const userId = await requireSessionUserId()
    const data = await closeInspection(userId, inspectionId, input)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}
