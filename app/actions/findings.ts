"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"

export async function getFindings(projectId?: number, status?: string) {
  const userId = await getCurrentUserId()
  if (!userId) return []
  if (projectId && status) {
    return sql`
      SELECT f.*, p.name as project_name
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE f.project_id = ${projectId} AND f.status = ${status} AND f.user_id = ${userId}
      ORDER BY 
        CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        f.created_at DESC
    `
  }

  if (projectId) {
    return sql`
      SELECT f.*, p.name as project_name
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE f.project_id = ${projectId} AND f.user_id = ${userId}
      ORDER BY 
        CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        f.created_at DESC
    `
  }

  if (status) {
    return sql`
      SELECT f.*, p.name as project_name
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE f.status = ${status} AND f.user_id = ${userId}
      ORDER BY 
        CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        f.created_at DESC
    `
  }

  return sql`
    SELECT f.*, p.name as project_name
    FROM findings f
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE f.user_id = ${userId}
    ORDER BY 
      CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      f.created_at DESC
  `
}

export async function createFinding(data: {
  project_id?: number
  checklist_id?: number
  title: string
  description?: string
  severity: "low" | "medium" | "high" | "critical"
  location?: string
  responsible_person?: string
  due_date?: string
  photos?: string[]
}) {
  const userId = await getCurrentUserId()
  const result = await sql`
    INSERT INTO findings (project_id, checklist_id, title, description, severity, location, responsible_person, due_date, photos)
    VALUES (${data.project_id || null}, ${data.checklist_id || null}, ${data.title}, ${data.description || null},
            ${data.severity}, ${data.location || null}, ${data.responsible_person || null}, 
            ${data.due_date || null}, ${data.photos ? JSON.stringify(data.photos) : null})
    RETURNING id
  `
  const findingId = Number(result[0].id)
  await sql`UPDATE findings SET user_id = ${userId} WHERE id = ${findingId}`
  const inserted = await sql`SELECT * FROM findings WHERE id = ${findingId}`
  revalidatePath("/hallazgos")
  revalidatePath("/")
  return inserted[0]
}

export async function updateFinding(
  id: number,
  data: Partial<{
    title: string
    description: string
    severity: "low" | "medium" | "high" | "critical"
    location: string
    responsible_person: string
    due_date: string
    status: "open" | "in_progress" | "resolved" | "closed"
    resolution_notes: string
  }>,
) {
  const userId = await getCurrentUserId()
  const result = await sql`
    UPDATE findings
    SET 
      title = COALESCE(${data.title || null}, title),
      description = COALESCE(${data.description || null}, description),
      severity = COALESCE(${data.severity || null}, severity),
      location = COALESCE(${data.location || null}, location),
      responsible_person = COALESCE(${data.responsible_person || null}, responsible_person),
      due_date = COALESCE(${data.due_date || null}, due_date),
      status = COALESCE(${data.status || null}, status),
      resolution_notes = COALESCE(${data.resolution_notes || null}, resolution_notes),
      resolved_at = CASE WHEN ${data.status || null} = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `
  revalidatePath("/hallazgos")
  revalidatePath("/")
  return result[0]
}

export async function deleteFinding(id: number) {
  const userId = await getCurrentUserId()
  await sql`DELETE FROM findings WHERE id = ${id} AND user_id = ${userId}`
  revalidatePath("/hallazgos")
}
