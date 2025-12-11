"use server"

import { generateText } from "ai"
import { getSetting } from "./settings"
import { getModel } from "@/lib/ai"

interface ExtractedDocumentData {
  rut: string | null
  nombre: string | null
  fechaEmision: string | null
  fechaVencimiento: string | null
  tipoDocumento: string | null
  empresa: string | null
  cargo: string | null
}

export async function extractDocumentData(base64Image: string, mimeType: string): Promise<ExtractedDocumentData> {
  const ocrMethod = await getSetting("ocr_method")

  // Si el metodo es tesseract o no hay API key, retornamos datos vacios
  // El procesamiento de Tesseract se hace en el cliente
  if (ocrMethod === "tesseract") {
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

  // Usar IA con vision
  const apiKey = await getSetting("ai_api_key")
  if (!apiKey) {
    throw new Error("No se ha configurado la API Key de IA")
  }

  const aiModel = (await getSetting("ai_model")) || "gpt-4o-mini"
  const aiProvider = (await getSetting("ai_provider")) || "openai"

  try {
    const { text } = await generateText({
      model: getModel(aiProvider, aiModel, apiKey),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: `data:${mimeType};base64,${base64Image}`,
            },
            {
              type: "text",
              text: `Analiza esta imagen de un documento y extrae la siguiente informacion en formato JSON:
              - rut: numero de identificacion chileno (formato XX.XXX.XXX-X)
              - nombre: nombre completo de la persona
              - fechaEmision: fecha de emision del documento (formato DD/MM/YYYY)
              - fechaVencimiento: fecha de vencimiento (formato DD/MM/YYYY)
              - tipoDocumento: tipo de documento (ej: Licencia de Conducir, Certificado, Curso, etc.)
              - empresa: empresa o institucion emisora
              - cargo: cargo o rol de la persona si aplica

              Si no puedes encontrar algun dato, usa null.
              Responde SOLO con el JSON, sin texto adicional.`,
            },
          ],
        },
      ],
    })

    const cleanedText = text.replace(/```json\n?|\n?```/g, "").trim()
    const extractedData = JSON.parse(cleanedText)

    return {
      rut: extractedData.rut || null,
      nombre: extractedData.nombre || null,
      fechaEmision: extractedData.fechaEmision || null,
      fechaVencimiento: extractedData.fechaVencimiento || null,
      tipoDocumento: extractedData.tipoDocumento || null,
      empresa: extractedData.empresa || null,
      cargo: extractedData.cargo || null,
    }
  } catch (error) {
    console.error("Error extracting document data with AI:", error)
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
}

export async function getOcrMethod(): Promise<string> {
  const method = await getSetting("ocr_method")
  return method || "tesseract"
}
