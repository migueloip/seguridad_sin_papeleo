import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

export type AiProvider = "google" | "openai" | "anthropic" | "custom"

export const AI_PROVIDERS: { value: AiProvider; label: string; defaultModel: string }[] = [
  { value: "google", label: "Google Gemini", defaultModel: "gemini-2.5-flash" },
  { value: "openai", label: "OpenAI (GPT)", defaultModel: "gpt-4o-mini" },
  { value: "anthropic", label: "Anthropic (Claude)", defaultModel: "claude-sonnet-5" },
  { value: "custom", label: "Compatible con OpenAI (URL personalizada)", defaultModel: "" },
]

export function defaultModelFor(provider: string): string {
  return AI_PROVIDERS.find((p) => p.value === provider)?.defaultModel || "gemini-2.5-flash"
}

/**
 * Devuelve el modelo del proveedor configurado.
 * - google / openai / anthropic: SDK oficial; baseUrl opcional (proxies).
 * - custom: cualquier endpoint compatible con la API de OpenAI (OpenRouter,
 *   Ollama `http://localhost:11434/v1`, LM Studio, Groq, DeepSeek, etc.);
 *   baseUrl es obligatoria y la API key puede ser vacía (servidores locales).
 */
export function getModel(provider: string, model: string, apiKey: string, baseUrl?: string | null) {
  const baseURL = baseUrl?.trim() ? baseUrl.trim().replace(/\/+$/, "") : undefined

  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
      return openai(model || "gpt-4o-mini")
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })
      return anthropic(model || "claude-sonnet-5")
    }
    case "custom": {
      const compatible = createOpenAICompatible({
        name: "custom",
        baseURL: baseURL || "http://localhost:11434/v1",
        ...(apiKey ? { apiKey } : {}),
      })
      return compatible(model)
    }
    default: {
      // google (y valor por defecto para compatibilidad con datos antiguos)
      const google = createGoogleGenerativeAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
      const lower = (model || "gemini-2.5-flash").toLowerCase()
      const m = lower
        .replace(/(-latest)+$/i, "-latest")
        .replace(/^gemini-1.5-flash$/i, "gemini-1.5-flash-latest")
        .replace(/^gemini-1.5-pro$/i, "gemini-1.5-pro-latest")
        .replace(/^gemini-2.0-flash$/i, "gemini-2.5-flash")
        .replace(/^gemini-2.0-pro$/i, "gemini-2.5-flash")
      return google(m)
    }
  }
}
