"use server"

import { sql } from "@/lib/db"
import { revalidatePath } from "next/cache"

export async function getChecklistCategories() {
  return sql`SELECT * FROM checklist_categories ORDER BY name`
}

export async function getChecklistTemplates(categoryId?: number) {
  if (categoryId) {
    return sql`
      SELECT ct.*, cc.name as category_name
      FROM checklist_templates ct
      LEFT JOIN checklist_categories cc ON ct.category_id = cc.id
      WHERE ct.category_id = ${categoryId}
      ORDER BY ct.name
    `
  }

  return sql`
    SELECT ct.*, cc.name as category_name
    FROM checklist_templates ct
    LEFT JOIN checklist_categories cc ON ct.category_id = cc.id
    ORDER BY ct.name
  `
}

export async function getChecklistTemplateById(id: number) {
  const result = await sql`
    SELECT ct.*, cc.name as category_name
    FROM checklist_templates ct
    LEFT JOIN checklist_categories cc ON ct.category_id = cc.id
    WHERE ct.id = ${id}
  `
  return result[0]
}

export async function getCompletedChecklists(projectId?: number) {
  if (projectId) {
    return sql`
      SELECT cc.*, ct.name as template_name, p.name as project_name
      FROM completed_checklists cc
      LEFT JOIN checklist_templates ct ON cc.template_id = ct.id
      LEFT JOIN projects p ON cc.project_id = p.id
      WHERE cc.project_id = ${projectId}
      ORDER BY cc.completed_at DESC
    `
  }

  return sql`
    SELECT cc.*, ct.name as template_name, p.name as project_name
    FROM completed_checklists cc
    LEFT JOIN checklist_templates ct ON cc.template_id = ct.id
    LEFT JOIN projects p ON cc.project_id = p.id
    ORDER BY cc.completed_at DESC
  `
}

export async function saveCompletedChecklist(data: {
  template_id: number
  project_id?: number
  inspector_name: string
  location?: string
  responses: Record<string, boolean | string>
  notes?: string
}) {
  const result = await sql`
    INSERT INTO completed_checklists (template_id, project_id, inspector_name, location, responses, notes)
    VALUES (${data.template_id}, ${data.project_id || null}, ${data.inspector_name}, 
            ${data.location || null}, ${JSON.stringify(data.responses)}, ${data.notes || null})
    RETURNING *
  `
  revalidatePath("/checklists")
  return result[0]
}
