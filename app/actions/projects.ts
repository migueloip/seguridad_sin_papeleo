"use server"

import { sql } from "@/lib/db"
import { revalidatePath } from "next/cache"

export async function getProjects() {
  return sql`
    SELECT p.*,
      (SELECT COUNT(*) FROM workers w WHERE w.project_id = p.id AND w.status = 'active') as worker_count,
      (SELECT COUNT(*) FROM findings f WHERE f.project_id = p.id AND f.status = 'open') as open_findings
    FROM projects p
    ORDER BY p.name
  `
}

export async function getProjectById(id: number) {
  const result = await sql`SELECT * FROM projects WHERE id = ${id}`
  return result[0]
}

export async function createProject(data: {
  name: string
  location?: string
  client?: string
  start_date?: string
  end_date?: string
}) {
  const result = await sql`
    INSERT INTO projects (name, location, client, start_date, end_date)
    VALUES (${data.name}, ${data.location || null}, ${data.client || null}, 
            ${data.start_date || null}, ${data.end_date || null})
    RETURNING *
  `
  revalidatePath("/")
  return result[0]
}
