"use server"

import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getSetting } from "./settings"
import { getModel } from "@/lib/ai"
import { formatRut } from "@/lib/utils"

interface ExtractedData {
  rut: string | null
  nombre: string | null
  fechaEmision: string | null
  fechaVencimiento: string | null
  tipoDocumento: string | null
  empresa: string | null
  cargo: string | null
}

export async function extractDocumentData(base64Image: string, mimeType: string): Promise<ExtractedData> {
  const apiKey =
    (await getSetting("ai_api_key")) || process.env.AI_API_KEY || process.env.GOOGLE_API_KEY || ""
  if (!apiKey) {
    return {
      rut: null,
      nombre: null,
      fechaEmision: null,
      fechaVencimiento: null,
      tipoDocumento: null,
      empresa: null,
      cargo: null,
    }
  }

  const provider = "google"
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"

  const prompt = `Analiza esta imagen de un documento y extrae la siguiente información en formato JSON:
- rut: RUT chileno (formato XX.XXX.XXX-X)
- nombre: Nombre completo de la persona
- fechaEmision: Fecha de emisión (formato DD/MM/YYYY)
- fechaVencimiento: Fecha de vencimiento (formato DD/MM/YYYY)
- tipoDocumento: Tipo de documento (ej: Licencia de Conducir, Certificado, Carnet, etc.)
- empresa: Empresa o institución emisora
- cargo: Cargo o categoría

Responde SOLO con el JSON, sin explicaciones adicionales. Si no puedes extraer algún campo, usa null.`

  try {
    const { text } = await generateText({
      model: getModel(provider, model, apiKey) as unknown as LanguageModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image", image: `data:${mimeType};base64,${base64Image}` },
          ],
        },
      ],
    })

    const cleanedText = text.replace(/```json\n?|\n?```/g, "").trim()
    try {
      return JSON.parse(cleanedText)
    } catch {
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    }

    return {
      rut: null,
      nombre: null,
      fechaEmision: null,
      fechaVencimiento: null,
      tipoDocumento: null,
      empresa: null,
      cargo: null,
    }
  } catch (error) {
    console.error("Error extracting document data with AI:", error)
    throw error
  }
}

export interface ClassificationResult {
  target: "document" | "finding" | "checklist"
  rut?: string | null
  documentType?: string | null
  checklistTemplate?: string | null
}

export async function classifyUpload(base64: string, mime: string): Promise<ClassificationResult> {
  const apiKey =
    (await getSetting("ai_api_key")) || process.env.AI_API_KEY || process.env.GOOGLE_API_KEY || ""
  if (!apiKey) {
    return { target: "document" }
  }
  const provider = "google"
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const prompt =
    `Clasifica el contenido de este archivo en una sola categoria: "document" | "finding" | "checklist". ` +
    `Devuelve JSON con campos: target, rut (formato XX.XXX.XXX-X si existe), documentType (si es documento), checklistTemplate (si es checklist). ` +
    `Responde solo el JSON.`
  const { text } = await generateText({
    model: getModel(provider, model, apiKey) as unknown as LanguageModel,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }, { type: "image", image: `data:${mime};base64,${base64}` }],
      },
    ],
  })
  const cleanedText = text.replace(/```json\n?|\n?```/g, "").trim()
  let parsed: ClassificationResult = { target: "document" }
  try {
    parsed = JSON.parse(cleanedText) as ClassificationResult
  } catch {
    const jsonMatch = cleanedText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]) as ClassificationResult
    }
  }
  if (parsed?.rut) {
    try {
      parsed.rut = formatRut(parsed.rut)
    } catch {}
  }
  return parsed
}
