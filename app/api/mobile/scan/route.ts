import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getMobileSessionFromRequest } from "@/lib/mobile-auth"
import { getSettingForUser, mobileJson, mobileOptions } from "@/lib/mobile-api"
import { getModel } from "@/lib/ai"

export function OPTIONS() {
  return mobileOptions()
}

/**
 * Análisis IA de una foto de hallazgo para la app de terreno (Bearer).
 * Devuelve título, descripción, severidad, ubicación y acciones sugeridas.
 */
export async function POST(req: Request) {
  const session = await getMobileSessionFromRequest(req)
  if (!session) return mobileJson({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { image?: unknown; mime?: unknown; mode?: unknown } | null
  const image = typeof body?.image === "string" ? body.image : ""
  const mime = typeof body?.mime === "string" ? body.mime : "image/jpeg"
  const mode = body?.mode === "epp" ? "epp" : "finding"
  if (!image) return mobileJson({ error: "image requerida (base64)" }, { status: 400 })

  const apiKey =
    (await getSettingForUser(session.user_id, "ai_api_key")) ||
    process.env.AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  if (!apiKey) return mobileJson({ error: "no_api_key" }, { status: 422 })

  const model = (await getSettingForUser(session.user_id, "ai_model")) || "gemini-2.5-flash"
  const prompt =
    mode === "epp"
      ? `Eres prevencionista de riesgos en una obra de construcción chilena. La imagen muestra a uno o más ` +
        `trabajadores: verifica su equipo de protección personal (casco, lentes, chaleco reflectante, guantes, ` +
        `calzado de seguridad, arnés si hay altura). Responde SOLO un JSON:\n` +
        `{"title": "resultado corto, ej: 'EPP incompleto: falta casco' o 'EPP conforme'", ` +
        `"description": "detalle de qué elementos están presentes y cuáles faltan o están en mal estado", ` +
        `"severity": "low si todo conforme, medium|high|critical según lo que falte", ` +
        `"location": "ubicación si se infiere o null", ` +
        `"actions": ["acción 1", "acción 2"]}`
      : `Eres prevencionista de riesgos en una obra de construcción chilena. Analiza la imagen y responde SOLO un JSON:\n` +
        `{"title": "riesgo detectado, corto", "description": "descripción formal del hallazgo y su riesgo", ` +
        `"severity": "low|medium|high|critical", "location": "ubicación si se infiere o null", ` +
        `"actions": ["acción correctiva 1", "acción 2", "acción 3"]}`

  try {
    const { text } = await generateText({
      model: getModel("google", model, apiKey) as unknown as LanguageModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image", image: `data:${mime};base64,${image}` },
          ],
        },
      ],
    })
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/)
      if (m) parsed = JSON.parse(m[0])
    }
    const sev = String(parsed.severity || "medium")
    return mobileJson({
      title: typeof parsed.title === "string" ? parsed.title : null,
      description: typeof parsed.description === "string" ? parsed.description : null,
      severity: ["low", "medium", "high", "critical"].includes(sev) ? sev : "medium",
      location: typeof parsed.location === "string" ? parsed.location : null,
      actions: Array.isArray(parsed.actions)
        ? parsed.actions.filter((a): a is string => typeof a === "string").slice(0, 4)
        : [],
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "error"
    return mobileJson({ error: message }, { status: 500 })
  }
}
