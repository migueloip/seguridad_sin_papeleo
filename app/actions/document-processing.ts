"use server"

import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getAiSettings } from "./settings"
import { getModel } from "@/lib/ai"
import { getCurrentUserId } from "@/lib/auth"
import { formatRut } from "@/lib/utils"

// Límites de entrada (este archivo es "use server": cada export es un endpoint
// público, así que todo se valida aquí aunque el cliente ya lo haga).
/** Máximo del base64 de una imagen/PDF (8 MB, igual que bodySizeLimit). */
const MAX_BASE64_CHARS = 8 * 1024 * 1024
/** Máximo de la descripción en lenguaje natural del editor de documentos. */
const MAX_DESCRIPTION_CHARS = 4000

const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/
const MIME_RE = /^(image\/[a-z0-9.+-]{1,60}|application\/pdf)$/i

async function requireUserId(): Promise<number> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("No autenticado")
  return Number(userId)
}

function assertFileInput(base64: unknown, mime: unknown): { base64: string; mime: string } {
  if (typeof base64 !== "string" || !base64) throw new Error("No se recibió el archivo.")
  if (base64.length > MAX_BASE64_CHARS) throw new Error("El archivo supera el tamaño máximo (8 MB).")
  if (!BASE64_RE.test(base64)) throw new Error("El archivo no tiene un formato válido.")
  if (typeof mime !== "string" || !MIME_RE.test(mime)) {
    throw new Error("Tipo de archivo no soportado. Usa una imagen o un PDF.")
  }
  return { base64, mime: mime.toLowerCase() }
}

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
  await requireUserId()
  const empty = { tipoDocumento: null, nombre: null, vigenciaMeses: null, notas: null }
  if (typeof text !== "string") throw new Error("La descripción no es válida.")
  if (text.length > MAX_DESCRIPTION_CHARS) {
    throw new Error(`La descripción es demasiado larga (máximo ${MAX_DESCRIPTION_CHARS} caracteres).`)
  }
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
  await requireUserId()
  const file = assertFileInput(base64Image, mimeType)
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
            { type: "image", image: `data:${file.mime};base64,${file.base64}` },
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
  await requireUserId()
  const file = assertFileInput(base64, mime)
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
        content: [{ type: "text", text: prompt }, { type: "image", image: `data:${file.mime};base64,${file.base64}` }],
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
