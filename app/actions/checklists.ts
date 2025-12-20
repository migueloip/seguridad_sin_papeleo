"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getSetting } from "./settings"
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

