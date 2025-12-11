"use server"

import { generateText } from "ai"
import { getSetting } from "./settings"
import { getModel } from "@/lib/ai"

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
  const apiKey = await getSetting("ai_api_key")
  if (!apiKey) {
    throw new Error("API Key de IA no configurada. Ve a Configuración para agregarla.")
  }

  const provider = (await getSetting("ai_provider")) || "openai"
  const model = (await getSetting("ai_model")) || "gpt-4o-mini"

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
      model: getModel(provider, model, apiKey) as any,
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

    // Parse the JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
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
