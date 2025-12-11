"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"

export async function getProjects() {
  const userId = await getCurrentUserId()
  if (!userId) return []
  return sql`
    SELECT p.*,
      (SELECT COUNT(*) FROM workers w WHERE w.project_id = p.id AND w.status = 'active' AND w.user_id = ${userId}) as worker_count,
      (SELECT COUNT(*) FROM findings f WHERE f.project_id = p.id AND f.status = 'open' AND f.user_id = ${userId}) as open_findings
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
  const result = await sql`
    INSERT INTO projects (name, location, client, start_date, end_date, user_id)
    VALUES (${data.name}, ${data.location || null}, ${data.client || null}, 
            ${data.start_date || null}, ${data.end_date || null}, ${userId})
    RETURNING *
  `
  revalidatePath("/")
  return result[0]
}
