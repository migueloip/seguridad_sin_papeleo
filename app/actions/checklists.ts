"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getSetting } from "./settings"
import { getModel } from "@/lib/ai"

export type ChecklistTemplateAiItem = {
  id?: string
  text: string
  checked?: boolean
  hasIssue?: boolean
  note?: string
}

export type ChecklistTemplateItems = { items?: ChecklistTemplateAiItem[] } | null

export type ChecklistTemplateRow = {
  id: number
  user_id?: number
  category_id: number | null
  name: string
  description: string | null
  items: ChecklistTemplateItems
  created_at: string
  updated_at: string
  category_name: string | null
}

export type CompletedChecklistRow = {
  id: number
  user_id?: number
  template_id: number
  project_id: number | null
  inspector_name: string
  location: string | null
  responses: Record<string, boolean | string> | null
  notes: string | null
  status: string
  created_at: string
  completed_at: string
  template_name: string | null
  project_name: string | null
}

export async function getChecklistCategories(): Promise<
  Array<{ id: number; user_id?: number; name: string; description: string | null; created_at: string }>
> {
  const userId = await getCurrentUserId()
  return sql<{ id: number; user_id?: number; name: string; description: string | null; created_at: string }>`SELECT * FROM checklist_categories WHERE user_id = ${userId} ORDER BY name`
}

export async function getChecklistTemplates(categoryId?: number): Promise<ChecklistTemplateRow[]> {
  const userId = await getCurrentUserId()
  if (categoryId) {
    return sql<ChecklistTemplateRow>`
      SELECT ct.*, cc.name as category_name
      FROM checklist_templates ct
      LEFT JOIN checklist_categories cc ON ct.category_id = cc.id
      WHERE ct.user_id = ${userId} AND ct.category_id = ${categoryId}
      ORDER BY ct.name
    `
  }

  return sql<ChecklistTemplateRow>`
    SELECT ct.*, cc.name as category_name
    FROM checklist_templates ct
    LEFT JOIN checklist_categories cc ON ct.category_id = cc.id
    WHERE ct.user_id = ${userId}
    ORDER BY ct.name
  `
}

export async function getChecklistTemplateById(id: number): Promise<ChecklistTemplateRow | undefined> {
  const userId = await getCurrentUserId()
  const result = await sql<ChecklistTemplateRow>`
    SELECT ct.*, cc.name as category_name
    FROM checklist_templates ct
    LEFT JOIN checklist_categories cc ON ct.category_id = cc.id
    WHERE ct.id = ${id} AND ct.user_id = ${userId}
  `
  return result[0]
}

export async function getCompletedChecklists(projectId?: number): Promise<CompletedChecklistRow[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  if (projectId) {
    return sql<CompletedChecklistRow>`
      SELECT cc.*, ct.name as template_name, p.name as project_name
      FROM completed_checklists cc
      LEFT JOIN checklist_templates ct ON cc.template_id = ct.id
      LEFT JOIN projects p ON cc.project_id = p.id
      WHERE cc.project_id = ${projectId} AND cc.user_id = ${userId}
      ORDER BY cc.completed_at DESC
    `
  }

  return sql<CompletedChecklistRow>`
    SELECT cc.*, ct.name as template_name, p.name as project_name
    FROM completed_checklists cc
    LEFT JOIN checklist_templates ct ON cc.template_id = ct.id
    LEFT JOIN projects p ON cc.project_id = p.id
    WHERE cc.user_id = ${userId}
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
  const userId = await getCurrentUserId()
  const result = await sql`
    INSERT INTO completed_checklists (user_id, template_id, project_id, inspector_name, location, responses, notes)
    VALUES (${userId}, ${data.template_id}, ${data.project_id || null}, ${data.inspector_name}, 
            ${data.location || null}, ${JSON.stringify(data.responses)}::jsonb, ${data.notes || null})
    RETURNING *
  `
  revalidatePath("/checklists")
  return result[0]
}
export async function createChecklistCategory(name: string, description?: string) {
  const userId = await getCurrentUserId()
  const rows = await sql`
    INSERT INTO checklist_categories (user_id, name, description)
    VALUES (${userId}, ${name}, ${description || null})
    RETURNING id
  `
  return rows[0]
}

export async function createChecklistTemplate(input: {
  category_id?: number
  name: string
  description?: string
  items: Record<string, unknown>
}): Promise<{ id: number }> {
  const userId = await getCurrentUserId()
  const rows = await sql`
    INSERT INTO checklist_templates (user_id, category_id, name, description, items)
    VALUES (${userId}, ${input.category_id || null}, ${input.name}, ${input.description || null}, ${JSON.stringify(
    input.items,
  )}::jsonb)
    RETURNING id
  `
  return rows[0] as { id: number }
}

export async function extractChecklistFromImage(base64Image: string, mimeType: string): Promise<{
  name?: string
  description?: string
  items?: { items: Array<{ id?: string; text: string; checked?: boolean; hasIssue?: boolean; note?: string }> }
}> {
  const apiKey = await getSetting("ai_api_key")
  if (!apiKey) return {}
  const provider = "google"
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const prompt =
    `Analiza la imagen. Si corresponde a un checklist/lista de verificacion, devuelve JSON con:\n` +
    `name (titulo del checklist), description (breve descripcion/area), items: arreglo de objetos {text} representando cada punto.\n` +
    `Incluye solo items relevantes, maximo 20.\n` +
    `Si no corresponde a checklist, usa null.\n` +
    `Responde solo el JSON.`
  const { text } = await generateText({
    model: getModel(provider, model, apiKey) as unknown as LanguageModel,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }, { type: "image", image: `data:${mimeType};base64,${base64Image}` }],
      },
    ],
  })
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed?.items)) {
      const items = parsed.items.map((it: unknown, idx: number): ChecklistTemplateAiItem => {
        if (it && typeof it === "object") {
          const r = it as Record<string, unknown>
          const id = typeof r["id"] === "string" ? r["id"] : undefined
          const text = typeof r["text"] === "string" ? r["text"] : undefined
          return { id: id || `ai-${idx}`, text: text ?? "Item", checked: false, hasIssue: false }
        }
        return { id: `ai-${idx}`, text: typeof it === "string" ? it : String(it), checked: false, hasIssue: false }
      })
      return {
        name: parsed.name || undefined,
        description: parsed.description || undefined,
        items: { items },
      }
    }
    return parsed
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0])
      if (Array.isArray(parsed?.items)) {
        const items = parsed.items.map((it: unknown, idx: number): ChecklistTemplateAiItem => {
          if (it && typeof it === "object") {
            const r = it as Record<string, unknown>
            const id = typeof r["id"] === "string" ? r["id"] : undefined
            const text = typeof r["text"] === "string" ? r["text"] : undefined
            return { id: id || `ai-${idx}`, text: text ?? "Item", checked: false, hasIssue: false }
          }
          return { id: `ai-${idx}`, text: typeof it === "string" ? it : String(it), checked: false, hasIssue: false }
        })
        return {
          name: parsed.name || undefined,
          description: parsed.description || undefined,
          items: { items },
        }
      }
      return parsed
    }
  }
  return {}
}
