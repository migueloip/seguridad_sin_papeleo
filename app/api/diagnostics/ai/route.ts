import { NextResponse } from "next/server"
import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getSetting } from "@/app/actions/settings"
import { getModel } from "@/lib/ai"
import { getSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
    }
    if ((session.role || "user") !== "admin") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 })
    }
    const provider = "google"
    const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
    const apiKey = await getSetting("ai_api_key")

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Falta configurar AI API Key", provider, model },
        { status: 400 },
      )
    }

    const prompt = "Responde 'ok' si puedes procesar esta prueba."
    const lm = getModel(provider, model, apiKey) as unknown as LanguageModel
    const { text } = await generateText({ model: lm, prompt })
    return NextResponse.json({ ok: true, provider, model, sample: String(text).slice(0, 200) })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "diagnostics error"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
