"use server"

/**
 * Acciones del equipo de obra. Cada export es un endpoint público; la lógica
 * y la autorización viven en lib/obra/server/members.ts. Las altas se hacen
 * solo por invitación (app/actions/obra/invitations.ts).
 */
import { revalidatePath } from "next/cache"
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import {
  listLinkableWorkers,
  listMembers,
  removeMember,
  updateMemberRole,
} from "@/lib/obra/server/members"
import type { ActionResult, ObraMember, ObraRole } from "@/lib/obra/types"

export async function listObraMembers(projectId: number): Promise<ActionResult<ObraMember[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listMembers(userId, projectId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateObraMemberRole(
  projectId: number,
  memberUserId: number,
  role: ObraRole,
): Promise<ActionResult<ObraMember>> {
  try {
    const userId = await requireSessionUserId()
    const data = await updateMemberRole(userId, projectId, memberUserId, role)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function removeObraMember(projectId: number, memberUserId: number): Promise<ActionResult<null>> {
  try {
    const userId = await requireSessionUserId()
    await removeMember(userId, projectId, memberUserId)
    revalidatePath(`/obra/${Number(projectId)}`, "layout")
    return { ok: true, data: null }
  } catch (e) {
    return toActionError(e)
  }
}

export async function listObraLinkableWorkers(
  projectId: number,
): Promise<ActionResult<{ id: number; name: string; rut: string | null }[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listLinkableWorkers(userId, projectId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}
