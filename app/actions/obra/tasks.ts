"use server"

/**
 * Acciones de tareas de obra. Cada export es un endpoint público; la lógica,
 * la validación y la autorización viven en lib/obra/server/tasks.ts. Las
 * acciones por id de tarea revalidan el proyecto resuelto desde la BD.
 */
import { revalidatePath } from "next/cache"
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import { createTask, listTasks, setTaskStatus, toggleChecklistItem, updateTask } from "@/lib/obra/server/tasks"
import type { ActionResult, ObraTask, TaskInput, TaskStatus } from "@/lib/obra/types"

export async function listObraTasks(
  projectId: number,
  filter?: { status?: TaskStatus[]; mine?: boolean; inspection_id?: number | null },
): Promise<ActionResult<ObraTask[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listTasks(userId, projectId, filter)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function createObraTask(projectId: number, input: TaskInput): Promise<ActionResult<ObraTask>> {
  try {
    const userId = await requireSessionUserId()
    const data = await createTask(userId, projectId, input)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateObraTask(taskId: number, patch: Partial<TaskInput>): Promise<ActionResult<ObraTask>> {
  try {
    const userId = await requireSessionUserId()
    const data = await updateTask(userId, taskId, patch)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function setObraTaskStatus(taskId: number, status: TaskStatus, notes?: string): Promise<ActionResult<ObraTask>> {
  try {
    const userId = await requireSessionUserId()
    const data = await setTaskStatus(userId, taskId, status, notes)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function toggleObraTaskChecklist(taskId: number, index: number, done: boolean): Promise<ActionResult<ObraTask>> {
  try {
    const userId = await requireSessionUserId()
    const data = await toggleChecklistItem(userId, taskId, index, done)
    revalidatePath(`/obra/${data.project_id}`, "layout")
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}
