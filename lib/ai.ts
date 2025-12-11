import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"

export function getModel(provider: string, model: string, apiKey: string) {
  const p = provider.toLowerCase()
  if (p === "openai") {
    const openai = createOpenAI({ apiKey })
    return openai(model)
  }
  if (p === "anthropic") {
    const anthropic = createAnthropic({ apiKey })
    return anthropic(model)
  }
  if (p === "google") {
    const google = createGoogleGenerativeAI({ apiKey })
    return google(model)
  }
  if (p === "groq") {
    const groq = createOpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" })
    return groq(model)
  }
  const openai = createOpenAI({ apiKey })
  return openai(model)
}
