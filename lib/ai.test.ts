// @vitest-environment node
/**
 * Regresión: los 4 proveedores de IA deben funcionar con la versión de "ai"
 * instalada. Antes, @ai-sdk/openai|anthropic|openai-compatible v4 (spec "v4")
 * convivían con ai v5 (que solo acepta spec "v2") y toda llamada fallaba con
 * "Unsupported model version" salvo Google. Cada test apunta el proveedor a un
 * servidor HTTP local que imita la API real y ejecuta generateText de verdad.
 */
import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { generateText, type LanguageModel } from "ai"
import { getModel } from "./ai"

type Hit = { path: string; auth: string | undefined; body: unknown }
const hits: Hit[] = []
let server: http.Server
let base = ""

function reply(res: http.ServerResponse, json: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify(json))
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const path = req.url || ""
      hits.push({
        path,
        auth: (req.headers.authorization as string | undefined) ?? (req.headers["x-api-key"] as string | undefined) ?? (req.headers["x-goog-api-key"] as string | undefined),
        body: raw ? JSON.parse(raw) : null,
      })
      const created = Math.floor(Date.now() / 1000)
      if (path.endsWith("/responses")) {
        return reply(res, {
          id: "resp_1",
          object: "response",
          created_at: created,
          model: "gpt-test",
          status: "completed",
          output: [
            {
              type: "message",
              id: "msg_1",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "ok openai", annotations: [] }],
            },
          ],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        })
      }
      if (path.endsWith("/chat/completions")) {
        return reply(res, {
          id: "chatcmpl_1",
          object: "chat.completion",
          created,
          model: "compat-test",
          choices: [{ index: 0, message: { role: "assistant", content: "ok compatible" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        })
      }
      if (path.endsWith("/messages")) {
        return reply(res, {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-test",
          content: [{ type: "text", text: "ok anthropic" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 3, output_tokens: 2 },
        })
      }
      if (path.includes(":generateContent")) {
        return reply(res, {
          candidates: [{ content: { role: "model", parts: [{ text: "ok google" }] }, finishReason: "STOP", index: 0 }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
        })
      }
      res.writeHead(404)
      res.end("not found")
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function ask(provider: string, model: string, baseUrl: string) {
  const lm = getModel(provider, model, "clave-de-prueba", baseUrl) as unknown as LanguageModel
  const { text } = await generateText({ model: lm, prompt: "Responde ok" })
  return text
}

describe("getModel con la versión instalada de ai", () => {
  it("OpenAI responde (API Responses)", async () => {
    expect(await ask("openai", "gpt-test", `${base}/v1`)).toBe("ok openai")
    expect(hits.at(-1)?.path).toBe("/v1/responses")
    expect(hits.at(-1)?.auth).toBe("Bearer clave-de-prueba")
  })

  it("Anthropic responde", async () => {
    expect(await ask("anthropic", "claude-test", `${base}/v1`)).toBe("ok anthropic")
    expect(hits.at(-1)?.path).toBe("/v1/messages")
    expect(hits.at(-1)?.auth).toBe("clave-de-prueba")
  })

  it("Compatible con OpenAI (URL personalizada) responde", async () => {
    expect(await ask("custom", "compat-test", `${base}/v1/`)).toBe("ok compatible")
    expect(hits.at(-1)?.path).toBe("/v1/chat/completions")
  })

  it("Google Gemini responde", async () => {
    expect(await ask("google", "gemini-2.5-flash", `${base}/v1beta`)).toBe("ok google")
    expect(hits.at(-1)?.path).toBe("/v1beta/models/gemini-2.5-flash:generateContent")
  })
})
