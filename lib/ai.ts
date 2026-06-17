import { createGoogleGenerativeAI } from "@ai-sdk/google"

// Actualmente solo se soporta Google (Gemini): es el único SDK de proveedor
// instalado. El primer parámetro se mantiene por compatibilidad con las llamadas
// existentes y para poder enrutar a otros proveedores en el futuro.
export function getModel(_provider: string, model: string, apiKey: string) {
  const google = createGoogleGenerativeAI({ apiKey })
  const normalized = (model || "gemini-2.5-flash").trim()
  return google(normalized)
}
