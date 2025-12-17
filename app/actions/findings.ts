"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getSetting } from "./settings"
import { getModel } from "@/lib/ai"

export async function getFindings(projectId?: number, status?: string) {
  const userId = await getCurrentUserId()
  if (!userId) return []
  if (projectId && status) {
    return sql`
      SELECT f.*, p.name as project_name
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE f.project_id = ${projectId} AND f.status = ${status} AND f.user_id = ${userId}
      ORDER BY 
        CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        f.created_at DESC
    `
  }

  if (projectId) {
    return sql`
      SELECT f.*, p.name as project_name
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE f.project_id = ${projectId} AND f.user_id = ${userId}
      ORDER BY 
        CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        f.created_at DESC
    `
  }

  if (status) {
    return sql`
      SELECT f.*, p.name as project_name
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE f.status = ${status} AND f.user_id = ${userId}
      ORDER BY 
        CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        f.created_at DESC
    `
  }

  return sql`
    SELECT f.*, p.name as project_name
    FROM findings f
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE f.user_id = ${userId}
    ORDER BY 
      CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      f.created_at DESC
  `
}

export async function createFinding(data: {
  project_id?: number
  checklist_id?: number
  title: string
  description?: string
  severity: "low" | "medium" | "high" | "critical"
  location?: string
  responsible_person?: string
  due_date?: string
  photos?: string[]
}) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para crear hallazgos")
  }
  const result = await sql<{ id: number }>`
    INSERT INTO findings (project_id, checklist_id, title, description, severity, location, responsible_person, due_date, photos)
    VALUES (${data.project_id || null}, ${data.checklist_id || null}, ${data.title}, ${data.description || null},
            ${data.severity}, ${data.location || null}, ${data.responsible_person || null}, 
            ${data.due_date || null}, ${data.photos ? JSON.stringify(data.photos) : null}::jsonb)
    RETURNING id
  `
  const findingId = Number(result[0].id)
  await sql`UPDATE findings SET user_id = ${userId} WHERE id = ${findingId}`
  const inserted = await sql`SELECT * FROM findings WHERE id = ${findingId}`
  revalidatePath("/hallazgos")
  if (data.project_id) {
    revalidatePath(`/proyectos/${data.project_id}/hallazgos`)
  }
  revalidatePath("/")
  return inserted[0]
}

export async function updateFinding(
  id: number,
  data: Partial<{
    title: string
    description: string
    severity: "low" | "medium" | "high" | "critical"
    location: string
    responsible_person: string
    due_date: string
    status: "open" | "in_progress" | "resolved" | "closed"
    resolution_notes: string
  }>,
) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para actualizar hallazgos")
  }
  const result = await sql`
    UPDATE findings
    SET 
      title = COALESCE(${data.title || null}, title),
      description = COALESCE(${data.description || null}, description),
      severity = COALESCE(${data.severity || null}, severity),
      location = COALESCE(${data.location || null}, location),
      responsible_person = COALESCE(${data.responsible_person || null}, responsible_person),
      due_date = COALESCE(${data.due_date || null}, due_date),
      status = COALESCE(${data.status || null}, status),
      resolution_notes = COALESCE(${data.resolution_notes || null}, resolution_notes),
      resolved_at = CASE WHEN ${data.status || null} = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `
  revalidatePath("/hallazgos")
  revalidatePath("/")
  return result[0]
}

export async function deleteFinding(id: number) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para eliminar hallazgos")
  }
  await sql`DELETE FROM findings WHERE id = ${id} AND user_id = ${userId}`
  revalidatePath("/hallazgos")
}

export async function scanFindingImage(base64Image: string, mimeType: string): Promise<{
  title?: string
  description?: string
  severity?: "low" | "medium" | "high" | "critical"
  location?: string
  responsible_person?: string
  due_date?: string
}> {
  const apiKey =
    (await getSetting("ai_api_key")) || process.env.AI_API_KEY || process.env.GOOGLE_API_KEY || ""
  if (!apiKey) {
    return {}
  }
  const provider = "google"
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const prompt =
    `Analiza la imagen y devuelve un JSON con: title, description, severity (low|medium|high|critical), location, responsible_person, due_date (YYYY-MM-DD). Si algun dato no se puede inferir usa null. Responde solo el JSON.`
  const { text } = await generateText({
    model: getModel(provider, model, apiKey) as unknown as LanguageModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: `data:${mimeType};base64,${base64Image}` },
        ],
      },
    ],
  })
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim()
  try {
    const parsed = JSON.parse(cleaned)
    return parsed
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
  }
  return {}
}

export async function generateCorrectiveAction(args: {
  title?: string
  description?: string
  severity?: "low" | "medium" | "high" | "critical"
  location?: string
  photos?: string[]
}): Promise<string> {
  const apiKey =
    (await getSetting("ai_api_key")) || process.env.AI_API_KEY || process.env.GOOGLE_API_KEY || ""
  if (!apiKey) {
    const lines = [
      "- Restringir y señalizar el área afectada.",
      "- Asignar responsable para ejecutar la corrección.",
      "- Definir plazo concreto y verificar cumplimiento.",
      "- Implementar medida de control adecuada al riesgo.",
      "- Registrar evidencia antes y después de la acción.",
    ]
    return lines.join("\n")
  }
  const provider = "google"
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const base =
    `Genera una accion correctiva concreta y accionable en espanol para un hallazgo de seguridad.\n` +
    `Incluye pasos claros, responsables, y plazos sugeridos.\n` +
    `Responde exclusivamente con una lista de viñetas, iniciando cada linea con "-".\n` +
    `No incluyas introducciones, encabezados, separadores ni conclusiones.\n` +
    `No uses frases como "Aqui tienes..." ni "Resumen".\n` +
    `Contexto:\n` +
    `Titulo: ${args.title || "-"}\n` +
    `Descripcion: ${args.description || "-"}\n` +
    `Severidad: ${args.severity || "-"}\n` +
    `Ubicacion: ${args.location || "-"}\n`
  const photo = Array.isArray(args.photos) && args.photos.length > 0 ? args.photos[0] : undefined
  const { text } = await generateText({
    model: getModel(provider, model, apiKey) as unknown as LanguageModel,
    messages: [
      {
        role: "user",
        content: photo
          ? [{ type: "text", text: base }, { type: "image", image: photo }]
          : [{ type: "text", text: base }],
      },
    ],
  })
  const cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*(aquí|aqui)\s+tienes[^\n]*\n?/i, "")
    .replace(/^\s*[-–—]{3,}\s*$/gm, "")
    .replace(/^\s*#{1,6}\s.*$/gm, "")
    .trim()
  return cleaned
}
