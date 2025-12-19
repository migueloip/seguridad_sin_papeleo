"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { toOptionalDate } from "@/lib/utils"

export type ProjectRow = {
  id: number
  user_id: number
  name: string
  location: string | null
  client: string | null
  start_date: string | null
  end_date: string | null
  status: string
  created_at: string
  updated_at: string
  worker_count: number
  open_findings: number
}

export async function getProjects(): Promise<ProjectRow[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  return sql<ProjectRow>`
    SELECT p.*,
      (SELECT COUNT(*)::int FROM workers w WHERE w.project_id = p.id AND w.status = 'active' AND w.user_id = ${userId}) as worker_count,
      (SELECT COUNT(*)::int FROM findings f WHERE f.project_id = p.id AND f.status = 'open' AND f.user_id = ${userId}) as open_findings
    FROM projects p
    WHERE p.user_id = ${userId}
    ORDER BY p.name
  `
}

export async function getProjectById(id: number) {
  const userId = await getCurrentUserId()
  const result = await sql`SELECT * FROM projects WHERE id = ${id} AND user_id = ${userId}`
  return result[0]
}

export async function createProject(data: {
  name: string
  location?: string
  client?: string
  start_date?: string
  end_date?: string
}) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para crear proyectos")
  }
  const start = toOptionalDate(data.start_date)
  const end = toOptionalDate(data.end_date)
  const result = await sql`
    INSERT INTO projects (name, location, client, start_date, end_date, user_id)
    VALUES (${data.name}, ${data.location || null}, ${data.client || null}, 
            ${start}, ${end}, ${userId})
    RETURNING *
  `
  revalidatePath("/")
  return result[0]
}

export async function deleteProject(id: number) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para eliminar proyectos")
  }
  await sql`DELETE FROM projects WHERE id = ${id} AND user_id = ${userId}`
  revalidatePath("/")
}
