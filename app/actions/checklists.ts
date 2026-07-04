"use server"
// @ts-nocheck - TypeScript postgres template literal type issue with v3

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getAiSettings } from "./settings"
import { getModel } from "@/lib/ai"

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
  const ai = await getAiSettings()
  if (!ai.ready) {
    return {}
  }
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
    model: getModel(ai.provider, ai.model, ai.apiKey, ai.baseUrl) as unknown as LanguageModel,
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

    let itemsSource: unknown = obj.items
    if (!itemsSource && Array.isArray(obj.items)) {
      itemsSource = obj.items
    }

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

export type ChecklistTemplateRow = {
  id: number
  name: string
  description: string | null
  item_count: number
  runs: number
  last_completed: string | null
}

export async function getChecklistTemplates(): Promise<ChecklistTemplateRow[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  const rows = await sql<ChecklistTemplateRow>`
    SELECT
      t.id,
      t.name,
      t.description,
      CASE
        WHEN jsonb_typeof(t.items) = 'array' THEN jsonb_array_length(t.items)
        WHEN jsonb_typeof(t.items->'items') = 'array' THEN jsonb_array_length(t.items->'items')
        ELSE 0
      END::int as item_count,
      (SELECT COUNT(*)::int FROM completed_checklists c WHERE c.template_id = t.id AND c.user_id = ${userId}) as runs,
      (SELECT MAX(c.completed_at)::text FROM completed_checklists c WHERE c.template_id = t.id AND c.user_id = ${userId}) as last_completed
    FROM checklist_templates t
    WHERE t.user_id = ${userId}
    ORDER BY t.name
  `
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    description: r.description,
    item_count: Number(r.item_count) || 0,
    runs: Number(r.runs) || 0,
    last_completed: r.last_completed,
  }))
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
    VALUES (${userId}, NULL, ${data.name}, ${data.description || null}, ${data.items}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id
  `

  const row = rows[0]
  if (!row) {
    throw new Error("No se pudo crear el checklist")
  }

  return { id: Number(row.id) }
}

// Normaliza items guardados en cualquiera de las formas históricas:
// array directo, {items:[...]}, o string doble-serializado.
function normalizeStoredItems(raw: unknown): ChecklistItemInput[] {
  let v: unknown = raw
  if (typeof v === "string") {
    try {
      v = JSON.parse(v)
    } catch {
      return []
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    v = (v as Record<string, unknown>).items
  }
  if (!Array.isArray(v)) return []
  return v
    .map((it, i) => {
      if (!it || typeof it !== "object") return null
      const o = it as Record<string, unknown>
      const text = typeof o.text === "string" ? o.text : null
      if (!text || !text.trim()) return null
      return {
        id: typeof o.id === "string" ? o.id : `item-${i + 1}`,
        text: text.trim(),
        note: typeof o.note === "string" ? o.note : undefined,
      } as ChecklistItemInput
    })
    .filter((x): x is ChecklistItemInput => !!x)
}

export type ChecklistTemplateDetail = {
  id: number
  name: string
  description: string | null
  items: ChecklistItemInput[]
}

export async function getChecklistTemplate(id: number): Promise<ChecklistTemplateDetail | null> {
  const userId = await getCurrentUserId()
  if (!userId) return null
  const rows = await sql`
    SELECT id, name, description, items FROM checklist_templates
    WHERE id = ${id} AND user_id = ${userId} LIMIT 1
  `
  const r = rows[0]
  if (!r) return null
  return {
    id: Number(r.id),
    name: String(r.name),
    description: r.description ? String(r.description) : null,
    items: normalizeStoredItems(r.items),
  }
}

export async function updateChecklistTemplate(
  id: number,
  data: { name?: string; description?: string | null; items?: ChecklistItemInput[] },
): Promise<boolean> {
  const userId = await getCurrentUserId()
  if (!userId) return false
  const current = await sql`
    SELECT id, name, description, items FROM checklist_templates
    WHERE id = ${id} AND user_id = ${userId} LIMIT 1
  `
  if (!current[0]) return false
  const nextName = data.name !== undefined ? data.name : current[0].name
  const nextDesc = data.description !== undefined ? data.description : current[0].description
  const nextItems =
    data.items !== undefined ? { items: data.items } : { items: normalizeStoredItems(current[0].items) }
  await sql`
    UPDATE checklist_templates
    SET name = ${nextName}, description = ${nextDesc}, items = ${nextItems}::jsonb, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id} AND user_id = ${userId}
  `
  return true
}

export async function deleteChecklistTemplate(id: number): Promise<{ ok: boolean; error?: string }> {
  const userId = await getCurrentUserId()
  if (!userId) return { ok: false, error: "Sesión inválida" }
  try {
    // Desvincula las aplicaciones históricas (se conservan) y borra la plantilla.
    await sql`UPDATE completed_checklists SET template_id = NULL WHERE template_id = ${id} AND user_id = ${userId}`
    await sql`DELETE FROM checklist_templates WHERE id = ${id} AND user_id = ${userId}`
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo eliminar" }
  }
}

export type ChecklistResponse = { ok: boolean | null; note?: string }

export type CompleteChecklistInput = {
  templateId: number
  projectId?: number | null
  inspectorName?: string
  location?: string
  notes?: string
  responses: Record<string, ChecklistResponse>
  createFindings?: boolean
}

/**
 * Registra una aplicación del checklist y, opcionalmente, crea un hallazgo
 * por cada ítem marcado con problema (ok === false).
 */
export async function completeChecklist(
  input: CompleteChecklistInput,
): Promise<{ id: number; findingsCreated: number }> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("Debes iniciar sesión")

  const tpl = await getChecklistTemplate(input.templateId)
  if (!tpl) throw new Error("Plantilla no encontrada")

  const inserted = await sql<{ id: number }>`
    INSERT INTO completed_checklists (user_id, template_id, project_id, inspector_name, location, responses, notes, status, completed_at)
    VALUES (${userId}, ${input.templateId}, ${input.projectId || null}, ${input.inspectorName || null},
            ${input.location || null}, ${input.responses}::jsonb, ${input.notes || null}, 'completed', CURRENT_TIMESTAMP)
    RETURNING id
  `
  const completedId = Number(inserted[0].id)

  let findingsCreated = 0
  if (input.createFindings !== false) {
    for (const item of tpl.items) {
      const resp = input.responses[item.id || ""]
      if (!resp || resp.ok !== false) continue
      const title = `${tpl.name}: ${item.text}`.slice(0, 180)
      const description = resp.note?.trim()
        ? resp.note.trim()
        : `Ítem con problema detectado al aplicar el checklist "${tpl.name}".`
      await sql`
        INSERT INTO findings (user_id, project_id, checklist_id, title, description, severity, location, status)
        VALUES (${userId}, ${input.projectId || null}, ${completedId}, ${title}, ${description}, 'medium', ${input.location || null}, 'open')
      `
      findingsCreated += 1
    }
  }

  revalidatePath("/checklists")
  revalidatePath("/hallazgos")
  if (input.projectId) revalidatePath(`/proyectos/${input.projectId}/hallazgos`)
  return { id: completedId, findingsCreated }
}

export type CompletedChecklistRow = {
  id: number
  template_name: string
  project_name: string | null
  inspector_name: string | null
  location: string | null
  completed_at: string
  passed: number
  failed: number
  skipped: number
}

export async function getCompletedChecklists(limit = 12): Promise<CompletedChecklistRow[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  const rows = await sql`
    SELECT c.id, c.inspector_name, c.location, c.completed_at::text AS completed_at, c.responses,
           COALESCE(t.name, 'Checklist eliminado') AS template_name,
           p.name AS project_name
    FROM completed_checklists c
    LEFT JOIN checklist_templates t ON t.id = c.template_id
    LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.user_id = ${userId}
    ORDER BY c.completed_at DESC
    LIMIT ${limit}
  `
  return rows.map((r) => {
    let responses: Record<string, unknown> = {}
    let raw: unknown = r.responses
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw)
      } catch {
        raw = {}
      }
    }
    if (raw && typeof raw === "object") responses = raw as Record<string, unknown>
    let passed = 0
    let failed = 0
    let skipped = 0
    for (const v of Object.values(responses)) {
      const ok = v && typeof v === "object" ? (v as { ok?: unknown }).ok : v
      if (ok === true) passed += 1
      else if (ok === false) failed += 1
      else skipped += 1
    }
    return {
      id: Number(r.id),
      template_name: String(r.template_name),
      project_name: r.project_name ? String(r.project_name) : null,
      inspector_name: r.inspector_name ? String(r.inspector_name) : null,
      location: r.location ? String(r.location) : null,
      completed_at: String(r.completed_at),
      passed,
      failed,
      skipped,
    }
  })
}

