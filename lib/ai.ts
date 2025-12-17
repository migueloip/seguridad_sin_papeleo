import { createGoogleGenerativeAI } from "@ai-sdk/google"

export function getModel(provider: string, model: string, apiKey: string) {
  const google = createGoogleGenerativeAI({ apiKey })
  const lower = model.toLowerCase()
  const m = lower
    .replace(/(-latest)+$/i, "-latest")
    .replace(/^gemini-1.5-flash$/i, "gemini-1.5-flash-latest")
    .replace(/^gemini-1.5-pro$/i, "gemini-1.5-pro-latest")
    .replace(/^gemini-2.0-flash$/i, "gemini-2.5-flash")
    .replace(/^gemini-2.0-pro$/i, "gemini-2.5-flash")
  return google(m)
}
