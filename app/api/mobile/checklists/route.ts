import { sql } from "@/lib/db"
import { getMobileSessionFromRequest } from "@/lib/mobile-auth"
import { mobileJson, mobileOptions } from "@/lib/mobile-api"

export function OPTIONS() {
  return mobileOptions()
}

type Item = { id: string; text: string }

function normalizeItems(raw: unknown): Item[] {
  let v: unknown = raw
  if (typeof v === "string") {
    try {
      v = JSON.parse(v)
    } catch {
      return []
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) v = (v as Record<string, unknown>).items
  if (!Array.isArray(v)) return []
  return v
    .map((it, i) => {
      if (!it || typeof it !== "object") return null
      const o = it as Record<string, unknown>
      const text = typeof o.text === "string" ? o.text.trim() : ""
      if (!text) return null
      return { id: typeof o.id === "string" ? o.id : `item-${i + 1}`, text }
    })
    .filter((x): x is Item => !!x)
}

/** Plantillas de checklist del usuario (con ítems) para la app de terreno. */
export async function GET(req: Request) {
  const session = await getMobileSessionFromRequest(req)
  if (!session) return mobileJson({ error: "unauthorized" }, { status: 401 })

  const rows = await sql<{ id: number; name: string; description: string | null; items: unknown; last_completed: string | null }>`
    SELECT t.id, t.name, t.description, t.items,
      (SELECT MAX(c.completed_at)::text FROM completed_checklists c
        WHERE c.template_id = t.id AND c.user_id = ${session.user_id}) AS last_completed
    FROM checklist_templates t
    WHERE t.user_id = ${session.user_id}
    ORDER BY t.name
  `
  return mobileJson({
    templates: rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      description: r.description,
      items: normalizeItems(r.items),
      last_completed: r.last_completed,
    })),
  })
}

type CompleteBody = {
  template_id?: unknown
  project_id?: unknown
  inspector_name?: unknown
  location?: unknown
  notes?: unknown
  responses?: unknown
  create_findings?: unknown
}

/**
 * Registra la aplicación de un checklist desde terreno y crea hallazgos por
 * cada ítem con problema (mismo comportamiento que la web).
 */
export async function POST(req: Request) {
  const session = await getMobileSessionFromRequest(req)
  if (!session) return mobileJson({ error: "unauthorized" }, { status: 401 })
  const userId = session.user_id

  const body = (await req.json().catch(() => null)) as CompleteBody | null
  const templateId = Number(body?.template_id)
  const responses =
    body?.responses && typeof body.responses === "object"
      ? (body.responses as Record<string, { ok?: boolean | null; note?: string }>)
      : null
  if (!Number.isFinite(templateId) || !responses) {
    return mobileJson({ error: "template_id y responses son requeridos" }, { status: 400 })
  }

  const tplRows = await sql<{ id: number; name: string; items: unknown }>`
    SELECT id, name, items FROM checklist_templates
    WHERE id = ${templateId} AND user_id = ${userId} LIMIT 1
  `
  const tpl = tplRows[0]
  if (!tpl) return mobileJson({ error: "plantilla no encontrada" }, { status: 404 })
  const items = normalizeItems(tpl.items)

  const projectId = Number.isFinite(Number(body?.project_id)) && body?.project_id != null ? Number(body.project_id) : null
  const inspector = typeof body?.inspector_name === "string" ? body.inspector_name : session.name || null
  const location = typeof body?.location === "string" ? body.location : null
  const notes = typeof body?.notes === "string" ? body.notes : null

  const inserted = await sql<{ id: number }>`
    INSERT INTO completed_checklists (user_id, template_id, project_id, inspector_name, location, responses, notes, status, completed_at)
    VALUES (${userId}, ${templateId}, ${projectId}, ${inspector}, ${location}, ${responses}::jsonb, ${notes}, 'completed', CURRENT_TIMESTAMP)
    RETURNING id
  `
  const completedId = Number(inserted[0].id)

  let findingsCreated = 0
  if (body?.create_findings !== false) {
    for (const item of items) {
      const resp = responses[item.id]
      if (!resp || resp.ok !== false) continue
      const title = `${tpl.name}: ${item.text}`.slice(0, 180)
      const description = resp.note?.trim()
        ? resp.note.trim()
        : `Ítem con problema detectado al aplicar el checklist "${tpl.name}" desde terreno.`
      await sql`
        INSERT INTO findings (user_id, project_id, checklist_id, title, description, severity, location, status)
        VALUES (${userId}, ${projectId}, ${completedId}, ${title}, ${description}, 'medium', ${location}, 'open')
      `
      findingsCreated += 1
    }
  }

  return mobileJson({ id: completedId, findings_created: findingsCreated })
}
