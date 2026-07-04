"use server"

import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getAiSettings, getSetting } from "./settings"
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

/**
 * Editor de documento con IA: interpreta una descripción en lenguaje natural
 * (p. ej. "curso de altura de María Soto, vigencia un año") y devuelve los
 * campos para rellenar el formulario. Sin API key devuelve todo en null.
 */
export async function parseDocumentDescription(text: string): Promise<{
  tipoDocumento: string | null
  nombre: string | null
  vigenciaMeses: number | null
  notas: string | null
}> {
  const empty = { tipoDocumento: null, nombre: null, vigenciaMeses: null, notas: null }
  const ai = await getAiSettings()
  if (!ai.ready || !text.trim()) return empty
  const prompt =
    `Eres un asistente que rellena un formulario de documento de seguridad laboral. ` +
    `A partir de la descripción del usuario, responde SOLO con un JSON:\n` +
    `{"tipoDocumento": "<tipo de documento o null>", "nombre": "<nombre del trabajador o null>", "vigenciaMeses": <meses de vigencia como número o null>, "notas": "<observaciones o null>"}\n` +
    `Descripción: "${text}"`
  const { text: out } = await generateText({
    model: getModel(ai.provider, ai.model, ai.apiKey, ai.baseUrl) as unknown as LanguageModel,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  })
  const cleaned = out.replace(/```json\n?|\n?```/g, "").trim()
  try {
    const p = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned) as Record<string, unknown>
    return {
      tipoDocumento: typeof p.tipoDocumento === "string" ? p.tipoDocumento : null,
      nombre: typeof p.nombre === "string" ? p.nombre : null,
      vigenciaMeses: Number.isFinite(Number(p.vigenciaMeses)) ? Number(p.vigenciaMeses) : null,
      notas: typeof p.notas === "string" ? p.notas : null,
    }
  } catch {
    return empty
  }
}

export async function extractDocumentData(base64Image: string, mimeType: string): Promise<ExtractedData> {
  const ai = await getAiSettings()
  if (!ai.ready) {
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
      model: getModel(ai.provider, ai.model, ai.apiKey, ai.baseUrl) as unknown as LanguageModel,
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
  const ai = await getAiSettings()
  if (!ai.ready) {
    return { target: "document" }
  }
  const prompt =
    `Clasifica el contenido de este archivo en una sola categoria: "document" | "finding" | "checklist". ` +
    `Devuelve JSON con campos: target, rut (formato XX.XXX.XXX-X si existe), documentType (si es documento), checklistTemplate (si es checklist). ` +
    `Responde solo el JSON.`
  const { text } = await generateText({
    model: getModel(ai.provider, ai.model, ai.apiKey, ai.baseUrl) as unknown as LanguageModel,
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
