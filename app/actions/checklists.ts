"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getSetting } from "./settings"
import { getModel } from "@/lib/ai"
import { revalidatePath } from "next/cache"

export type ChecklistItemInput = {
  id?: string
  text: string
  checked?: boolean
  hasIssue?: boolean
  note?: string
}

export type ChecklistItemsPayload = {
  items: ChecklistItemInput[]
}

export type ChecklistExtractionResult = {
  name?: string | null
  description?: string | null
  items?: ChecklistItemsPayload
}

export async function extractChecklistFromImage(
  base64: string,
  mime: string,
): Promise<ChecklistExtractionResult> {
  const apiKey =
    (await getSetting("ai_api_key")) || process.env.AI_API_KEY || process.env.GOOGLE_API_KEY || ""
  if (!apiKey) {
    return {}
  }

  const provider = "google"
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const prompt =
    `Analiza esta imagen de un checklist o formulario de inspección de seguridad laboral y ` +
    `extrae los ítems de revisión más relevantes. ` +
    `Responde SOLO con un JSON con la siguiente estructura:\n` +
    `{\n` +
    `  "name": "Nombre corto del checklist o inspección",\n` +
    `  "description": "Descripción breve del objetivo del checklist",\n` +
    `  "items": {\n` +
    `    "items": [\n` +
    `      {\n` +
    `        "id": "item-1",\n` +
    `        "text": "Texto del ítem a revisar",\n` +
    `        "checked": false,\n` +
    `        "hasIssue": false,\n` +
    `        "note": ""\n` +
    `      }\n` +
    `    ]\n` +
    `  }\n` +
    `}\n` +
    `Si no puedes identificar nombre o descripción, usa null. ` +
    `Incluye entre 5 y 30 ítems claros y accionables enfocados en seguridad y prevención de riesgos.`

  const { text } = await generateText({
    model: getModel(provider, model, apiKey) as unknown as LanguageModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: `data:${mime};base64,${base64}` },
        ],
      },
    ],
  })

  const cleanedText = text.replace(/```json\n?|\n?```/g, "").trim()

  let parsed: unknown = {}
  try {
    parsed = JSON.parse(cleanedText)
  } catch {
    const jsonMatch = cleanedText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0])
      } catch {
        parsed = {}
      }
    }
  }

  const result: ChecklistExtractionResult = {}
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>

    if (typeof obj.name === "string" || obj.name === null) {
      result.name = obj.name as string | null
    }
    if (typeof obj.description === "string" || obj.description === null) {
      result.description = obj.description as string | null
    }

    const itemsSource: unknown = obj.items

    let itemsArray: unknown
    if (itemsSource && typeof itemsSource === "object" && !Array.isArray(itemsSource)) {
      const asObj = itemsSource as Record<string, unknown>
      if (Array.isArray(asObj.items)) {
        itemsArray = asObj.items
      }
    }
    if (!itemsArray && Array.isArray(itemsSource)) {
      itemsArray = itemsSource
    }
    if (!itemsArray && Array.isArray(parsed)) {
      itemsArray = parsed
    }

    if (Array.isArray(itemsArray)) {
      const normalized: ChecklistItemInput[] = itemsArray
        .map((raw, index) => {
          if (!raw || typeof raw !== "object") return null
          const item = raw as Record<string, unknown>

          let textValue: string | null = null
          if (typeof item.text === "string") {
            textValue = item.text
          } else if (typeof item.title === "string") {
            textValue = item.title
          } else if (typeof item.descripcion === "string") {
            textValue = item.descripcion
          }
          if (!textValue) return null

          const out: ChecklistItemInput = {
            text: textValue,
          }

          if (typeof item.id === "string") {
            out.id = item.id
          } else {
            out.id = `item-${index + 1}`
          }

          if (typeof item.checked === "boolean") {
            out.checked = item.checked
          }
          if (typeof item.hasIssue === "boolean") {
            out.hasIssue = item.hasIssue
          } else if (typeof item.issue === "boolean") {
            out.hasIssue = item.issue
          }
          if (typeof item.note === "string") {
            out.note = item.note
          } else if (typeof item.observacion === "string") {
            out.note = item.observacion
          }

          return out
        })
        .filter((x): x is ChecklistItemInput => !!x)

      if (normalized.length > 0) {
        result.items = { items: normalized }
      }
    }
  }

  return result
}

export type CreateChecklistTemplateInput = {
  name: string
  description?: string
  items: ChecklistItemsPayload
}

export async function createChecklistTemplate(
  data: CreateChecklistTemplateInput,
): Promise<{ id: number }> {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para crear checklists")
  }

  const rows = await sql<{ id: number }>`
    INSERT INTO checklist_templates (user_id, category_id, name, description, items, created_at, updated_at)
    VALUES (${userId}, NULL, ${data.name}, ${data.description || null}, ${JSON.stringify(data.items)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id
  `

  const row = rows[0]
  if (!row) {
    throw new Error("No se pudo crear el checklist")
  }

  return { id: Number(row.id) }
}

// ---------------------------------------------------------------------------
// Flujo de completar checklists
// ---------------------------------------------------------------------------

export type ChecklistResponseItem = {
  id: string
  text: string
  checked: boolean
  hasIssue: boolean
  note: string
}

export type ChecklistTemplateSummary = {
  id: number
  name: string
  description: string | null
  items: ChecklistResponseItem[]
  item_count: number
  created_at: string
}

export type CompletedChecklistSummary = {
  id: number
  template_id: number | null
  template_name: string | null
  project_id: number | null
  project_name: string | null
  inspector_name: string | null
  location: string | null
  notes: string | null
  status: string
  completed_at: string
  total_items: number
  checked_items: number
  issue_items: number
  items: ChecklistResponseItem[]
}

// El JSONB de items/responses se guarda como { items: [...] }. Esto lo normaliza
// a un array tipado, tolerando formatos antiguos (array plano, string, etc.).
function normalizeChecklistItems(raw: unknown): ChecklistResponseItem[] {
  let source: unknown = raw
  if (typeof raw === "string" && raw) {
    try {
      source = JSON.parse(raw)
    } catch {
      source = []
    }
  }
  let arr: unknown = source
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const o = source as Record<string, unknown>
    arr = Array.isArray(o.items) ? o.items : []
  }
  if (!Array.isArray(arr)) return []
  return arr
    .map((it, i): ChecklistResponseItem | null => {
      if (!it || typeof it !== "object") return null
      const o = it as Record<string, unknown>
      const text =
        typeof o.text === "string" ? o.text : typeof o.title === "string" ? o.title : ""
      if (!text.trim()) return null
      return {
        id: typeof o.id === "string" && o.id ? o.id : `item-${i + 1}`,
        text,
        checked: o.checked === true,
        hasIssue: o.hasIssue === true,
        note: typeof o.note === "string" ? o.note : "",
      }
    })
    .filter((x): x is ChecklistResponseItem => x !== null)
}

export async function getChecklistTemplates(): Promise<ChecklistTemplateSummary[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  const rows = await sql<{
    id: number
    name: string
    description: string | null
    items: unknown
    created_at: string
  }>`
    SELECT id, name, description, items, created_at::text as created_at
    FROM checklist_templates
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `
  return rows.map((r) => {
    const items = normalizeChecklistItems(r.items)
    return {
      id: Number(r.id),
      name: r.name,
      description: r.description,
      items,
      item_count: items.length,
      created_at: String(r.created_at),
    }
  })
}

export async function getCompletedChecklists(): Promise<CompletedChecklistSummary[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  const rows = await sql<{
    id: number
    template_id: number | null
    template_name: string | null
    project_id: number | null
    project_name: string | null
    inspector_name: string | null
    location: string | null
    notes: string | null
    status: string
    completed_at: string
    responses: unknown
  }>`
    SELECT
      c.id, c.template_id, t.name as template_name,
      c.project_id, p.name as project_name,
      c.inspector_name, c.location, c.notes, c.status,
      c.completed_at::text as completed_at, c.responses
    FROM completed_checklists c
    LEFT JOIN checklist_templates t ON c.template_id = t.id
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE c.user_id = ${userId}
    ORDER BY c.completed_at DESC
  `
  return rows.map((r) => {
    const items = normalizeChecklistItems(r.responses)
    return {
      id: Number(r.id),
      template_id: r.template_id === null ? null : Number(r.template_id),
      template_name: r.template_name,
      project_id: r.project_id === null ? null : Number(r.project_id),
      project_name: r.project_name,
      inspector_name: r.inspector_name,
      location: r.location,
      notes: r.notes,
      status: r.status,
      completed_at: String(r.completed_at),
      total_items: items.length,
      checked_items: items.filter((i) => i.checked).length,
      issue_items: items.filter((i) => i.hasIssue).length,
      items,
    }
  })
}

export type CompleteChecklistInput = {
  template_id?: number | null
  project_id?: number | null
  inspector_name?: string | null
  location?: string | null
  notes?: string | null
  items: ChecklistResponseItem[]
  createFindings?: boolean
}

export async function completeChecklist(
  data: CompleteChecklistInput,
): Promise<{ id: number; findingsCreated: number }> {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para completar checklists")
  }
  const items = Array.isArray(data.items) ? normalizeChecklistItems({ items: data.items }) : []
  if (items.length === 0) {
    throw new Error("El checklist no tiene ítems")
  }

  const rows = await sql<{ id: number }>`
    INSERT INTO completed_checklists
      (template_id, project_id, inspector_name, location, completed_at, responses, notes, status, user_id)
    VALUES (
      ${data.template_id || null},
      ${data.project_id || null},
      ${data.inspector_name || null},
      ${data.location || null},
      CURRENT_TIMESTAMP,
      ${JSON.stringify({ items })}::jsonb,
      ${data.notes || null},
      'completed',
      ${userId}
    )
    RETURNING id
  `
  const completedId = Number(rows[0]?.id)
  if (!completedId) {
    throw new Error("No se pudo guardar el checklist")
  }

  // Por cada ítem marcado con problema, crear un hallazgo vinculado.
  let findingsCreated = 0
  if (data.createFindings) {
    const issueItems = items.filter((i) => i.hasIssue)
    for (const it of issueItems) {
      await sql`
        INSERT INTO findings
          (checklist_id, project_id, title, description, severity, location, status, user_id)
        VALUES (
          ${completedId},
          ${data.project_id || null},
          ${it.text.slice(0, 250)},
          ${it.note || null},
          'medium',
          ${data.location || null},
          'open',
          ${userId}
        )
      `
      findingsCreated += 1
    }
  }

  revalidatePath("/checklists")
  if (findingsCreated > 0) revalidatePath("/hallazgos")
  return { id: completedId, findingsCreated }
}

export async function deleteChecklistTemplate(id: number): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) return
  await sql`DELETE FROM checklist_templates WHERE id = ${id} AND user_id = ${userId}`
  revalidatePath("/checklists")
}

export async function deleteCompletedChecklist(id: number): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) return
  await sql`DELETE FROM completed_checklists WHERE id = ${id} AND user_id = ${userId}`
  revalidatePath("/checklists")
}

