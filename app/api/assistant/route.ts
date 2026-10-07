import { streamText, convertToModelMessages, type LanguageModel, type UIMessage } from "ai"
import { getModel } from "@/lib/ai"
import { getAiSettings } from "@/lib/settings"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"

export const maxDuration = 30

/** Máximo de mensajes aceptados por conversación (evita cuerpos gigantes contra la IA). */
const MAX_MESSAGES = 100

export async function POST(req: Request) {
  // El middleware solo comprueba que exista la cookie; aquí se valida la sesión real.
  const session = await getSession()
  if (!session) {
    return new Response("No autenticado", { status: 401 })
  }
  const userId = Number(session.user_id)

  let body: { messages?: unknown; projectId?: unknown }
  try {
    body = (await req.json()) as { messages?: unknown; projectId?: unknown }
  } catch {
    return new Response("Solicitud inválida", { status: 400 })
  }
  if (!Array.isArray(body?.messages) || body.messages.length > MAX_MESSAGES) {
    return new Response("Solicitud inválida", { status: 400 })
  }
  const messages = body.messages as UIMessage[]
  const rawPid = Number(body.projectId)
  const projectId = Number.isSafeInteger(rawPid) && rawPid > 0 ? rawPid : null

  const ai = await getAiSettings()
  if (!ai.ready) {
    return new Response("Configura la IA (proveedor y API key) en Configuración para usar el asistente.", {
      status: 400,
    })
  }

  // Datos del ESTADO VIGENTE (sin filtro de fecha), por usuario (RLS) y proyecto si aplica.
  let context = ""
  try {
    if (userId) {
      const pid = projectId
      const [fr, dr, wr, recent] = await Promise.all([
        sql<{
          total: number
          open: number
          resolved: number
          critical_open: number
          high_open: number
          overdue: number
        }[]>`
          SELECT
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE status IN ('open', 'in_progress'))::int as open,
            COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))::int as resolved,
            COUNT(*) FILTER (WHERE severity = 'critical' AND status IN ('open', 'in_progress'))::int as critical_open,
            COUNT(*) FILTER (WHERE severity = 'high' AND status IN ('open', 'in_progress'))::int as high_open,
            COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int as overdue
          FROM findings
          WHERE user_id = ${userId} AND (${pid}::int IS NULL OR project_id = ${pid}::int)
        `,
        sql<{ total: number; expired: number; expiring: number }[]>`
          SELECT
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE)::int as expired,
            COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + INTERVAL '30 days')::int as expiring
          FROM documents
          WHERE user_id = ${userId}
        `,
        sql<{ total: number }[]>`
          SELECT COUNT(*)::int as total FROM workers
          WHERE user_id = ${userId} AND (${pid}::int IS NULL OR project_id = ${pid}::int)
        `,
        sql<{ id: number; title: string; severity: string }[]>`
          SELECT id, title, severity FROM findings
          WHERE user_id = ${userId} AND status IN ('open', 'in_progress')
            AND (${pid}::int IS NULL OR project_id = ${pid}::int)
          ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, created_at DESC
          LIMIT 8
        `,
      ])

      const f = fr[0] || { total: 0, open: 0, resolved: 0, critical_open: 0, high_open: 0, overdue: 0 }
      const d = dr[0] || { total: 0, expired: 0, expiring: 0 }
      const w = wr[0] || { total: 0 }
      const grave = Number(f.critical_open) + Number(f.high_open)
      const recentTxt = (recent || []).map((r) => `#${r.id} ${r.title} (${r.severity})`).join("; ")

      context =
        `\n\nDATOS ACTUALES DEL PROYECTO (estado vigente; úsalos y no inventes cifras):\n` +
        `- Hallazgos: ${f.total} en total · ${f.open} abiertos/en proceso · ${f.resolved} resueltos · ${f.overdue} atrasados. ` +
        `Abiertos críticos: ${f.critical_open}; abiertos altos: ${f.high_open}; hallazgos "graves" abiertos (críticos + altos) = ${grave}.\n` +
        `- Documentos: ${d.total} en total · ${d.expiring} por vencer (≤30 días) · ${d.expired} vencidos.\n` +
        `- Personal: ${w.total} trabajadores.\n` +
        (recentTxt ? `- Hallazgos abiertos prioritarios: ${recentTxt}.\n` : "")
    }
  } catch {
    // Sin datos: el asistente responde igual, indicando que no pudo leer el proyecto.
  }

  const model = getModel(ai.provider, ai.model, ai.apiKey, ai.baseUrl) as unknown as LanguageModel
  const system =
    `Eres el asistente de Easysecure, experto en prevención de riesgos para obras de construcción en Chile. ` +
    `Respondes preguntas sobre este proyecto (hallazgos, documentos y vencimientos, personal, planos de riesgo, ` +
    `informes y cumplimiento) usando los DATOS ACTUALES que se te entregan. Si te preguntan algo que no está en ` +
    `esos datos, dilo con claridad. Sé breve, accionable y responde en español usando Markdown.` +
    context

  const result = streamText({
    model,
    system,
    messages: convertToModelMessages(messages),
  })

  return result.toUIMessageStreamResponse()
}
