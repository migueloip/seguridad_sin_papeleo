"use server"

import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getSetting } from "./settings"
import { getModel } from "@/lib/ai"
import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import type { Plan, PlanFloor, PlanZone } from "@/lib/db"
import { revalidatePath } from "next/cache"

export interface ZoneItem {
  name: string
  code?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface FloorItem {
  name: string
  zones: ZoneItem[]
  frame?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export async function extractZonesFromPlan(base64Image: string, mimeType: string): Promise<{ floors: FloorItem[] }> {
  const apiKey = await getSetting("ai_api_key")
  if (!apiKey) return { floors: [{ name: "General", zones: [] }] }
  const provider = "google"
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const prompt =
    `Analiza este plano de obra y devuelve un JSON con las zonas agrupadas por piso.\n` +
    `La representación debe seguir lo más fielmente posible la geometría y la distribución real del plano.\n` +
    `Evita reordenar las zonas como si fuera un esquema nuevo o un mapa de bloques abstracto.\n` +
    `Las zonas deben ubicarse donde están en el plano escaneado (como si pusieras rectángulos transparentes encima del plano original).\n` +
    `Identifica únicamente espacios arquitectónicos claramente delimitados (habitaciones, salas, terrazas, pasillos, escaleras, garaje, etc.).\n` +
    `No generes zonas separadas para textos, etiquetas, cotas, mobiliario, puertas, ventanas ni símbolos.\n` +
    `Ignora también anotaciones de texto o nombres dibujados sobre el plano: solo importa la geometría de los recintos.\n` +
    `Para cada piso, define las zonas funcionales principales, sin mezclar sectores lejanos en un solo bloque cuando visualmente están separados.\n` +
    `Cuando sea posible, incluye en el nombre una referencia a sus medidas aproximadas\n` +
    `(por ejemplo: "Dormitorios (aprox 10x5 m)").\n` +
    `Primero determina el rectángulo mínimo que contiene SOLO el edificio o la planta (sin margenes ni textos alrededor).\n` +
    `Representa ese rectángulo como "frame" con coordenadas normalizadas x, y, width, height en el rango 0 a 1 relativas a toda la imagen.\n` +
    `Luego, para cada zona, usa coordenadas normalizadas x, y, width, height en el rango 0 a 1 RELATIVAS al frame (0 = borde izquierdo/superior del frame, 1 = borde derecho/inferior del frame).\n` +
    `Formato EXACTO de respuesta (solo JSON):\n` +
    `{\n` +
    `  "floors": [\n` +
    `    {\n` +
    `      "name": "Piso 1",\n` +
    `      "frame": { "x": 0.05, "y": 0.08, "width": 0.9, "height": 0.84 },\n` +
    `      "zones": [\n` +
    `        { "name": "Zona A (aprox 10x5 m)", "code": "A1", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.15 },\n` +
    `        { "name": "Zona B", "code": "B1", "x": 0.45, "y": 0.25, "width": 0.25, "height": 0.2 }\n` +
    `      ]\n` +
    `    },\n` +
    `    {\n` +
    `      "name": "Piso 2",\n` +
    `      "zones": [ { "name": "Sector Norte", "x": 0.1, "y": 0.05, "width": 0.6, "height": 0.3 } ]\n` +
    `    }\n` +
    `  ]\n` +
    `}\n` +
    `Reglas:\n` +
    `- Si no puedes inferir el piso, usa "General".\n` +
    `- Usa nombres cortos y funcionales que representen sectores reales del plano.\n` +
    `- Limita el número de zonas a un máximo de 12 por piso, agrupando espacios muy pequeños en la zona funcional más cercana.\n` +
    `- frame.x y frame.y representan la esquina superior izquierda del edificio dentro de la imagen completa.\n` +
    `- frame.width y frame.height representan el ancho y alto relativos del edificio dentro de la imagen completa.\n` +
    `- En cada zona, x e y representan la esquina superior izquierda de la zona dentro del frame.\n` +
    `- En cada zona, width y height representan el ancho y alto relativos de la zona dentro del frame.\n` +
    `- No reordenes ni redistribuyas las zonas; solo coloca rectángulos aproximados encima del plano existente.\n` +
    `- Evita que las zonas se solapen de forma exagerada salvo que el plano sea ambiguo.\n` +
    `- Responde SOLO el JSON, sin explicaciones ni markdown.`
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
    const floors = Array.isArray(parsed?.floors) ? parsed.floors : []
    return { floors }
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0])
      const floors = Array.isArray(parsed?.floors) ? parsed.floors : []
      return { floors }
    }
  }
  return { floors: [] }
}

export async function createPlan(data: {
  project_id?: number
  name: string
  plan_type: string
  file_name: string
  file_url?: string
  mime_type?: string
  extracted?: { floors: FloorItem[] }
}): Promise<Plan> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("Unauthorized")
  const result = await sql<Plan>`
    INSERT INTO plans (user_id, project_id, name, plan_type, file_name, file_url, mime_type, extracted, created_at, updated_at)
    VALUES (${userId}, ${data.project_id || null}, ${data.name}, ${data.plan_type}, ${data.file_name}, ${data.file_url || null}, ${data.mime_type || null}, ${data.extracted ? JSON.stringify(data.extracted) : null}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING *
  `
  revalidatePath("/planos")
  revalidatePath("/")
  return result[0]
}

export async function savePlanFloorsAndZones(planId: number, floors: FloorItem[]): Promise<{ floors: PlanFloor[] }> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("Unauthorized")
  // Clean existing
  await sql`DELETE FROM plan_zones WHERE plan_id = ${planId} AND user_id = ${userId}`
  await sql`DELETE FROM plan_floors WHERE plan_id = ${planId} AND user_id = ${userId}`
  // Insert floors and zones
  const insertedFloors: PlanFloor[] = []
  for (const f of floors) {
    const floorRow = await sql<PlanFloor>`
      INSERT INTO plan_floors (user_id, plan_id, name, level, created_at)
      VALUES (${userId}, ${planId}, ${f.name || "General"}, NULL, CURRENT_TIMESTAMP)
      RETURNING *
    `
    const floorId = floorRow[0].id
    insertedFloors.push(floorRow[0])
    for (const z of Array.isArray(f.zones) ? f.zones : []) {
      const zoneRow = await sql<PlanZone>`
        INSERT INTO plan_zones (user_id, plan_id, floor_id, name, code, zone_type, created_at)
        VALUES (${userId}, ${planId}, ${floorId}, ${z.name || "Zona"}, ${z.code || null}, ${null}, CURRENT_TIMESTAMP)
        RETURNING *
      `
    }
  }
  revalidatePath("/planos")
  return { floors: insertedFloors }
}

export async function getPlans(): Promise<Plan[]> {
  const userId = await getCurrentUserId()
  return sql<Plan>`SELECT * FROM plans WHERE user_id = ${userId} ORDER BY updated_at DESC`
}

export async function getPlanDetail(planId: number): Promise<{
  plan: Plan | null
  floors: (PlanFloor & { zones: PlanZone[] })[]
}> {
  const userId = await getCurrentUserId()
  const planRows = await sql<Plan>`SELECT * FROM plans WHERE id = ${planId} AND user_id = ${userId} LIMIT 1`
  if (planRows.length === 0) return { plan: null, floors: [] }
  const floorRows = await sql<PlanFloor>`SELECT * FROM plan_floors WHERE plan_id = ${planId} AND user_id = ${userId} ORDER BY name`
  const zonesRows = await sql<PlanZone>`SELECT * FROM plan_zones WHERE plan_id = ${planId} AND user_id = ${userId} ORDER BY name`
  const zonesByFloor: Record<number, PlanZone[]> = {}
  for (const z of zonesRows) {
    const fid = z.floor_id
    if (!fid) continue
    zonesByFloor[fid] = zonesByFloor[fid] || []
    zonesByFloor[fid].push(z)
  }
  const floors = floorRows.map((f) => ({ ...f, zones: zonesByFloor[f.id] || [] }))
  return { plan: planRows[0], floors }
}

export type PlanZoneOption = {
  id: number
  name: string
  code: string | null
  floor_name: string | null
  plan_name: string | null
  project_id: number | null
}

export async function getPlanZonesByProject(projectId?: number): Promise<PlanZoneOption[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  const projectParam = projectId ?? null
  const rows = await sql<{
    id: number
    name: string
    code: string | null
    floor_name: string | null
    plan_name: string | null
    project_id: number | null
  }>`
    SELECT
      z.id,
      z.name,
      z.code,
      pf.name AS floor_name,
      p.name AS plan_name,
      p.project_id
    FROM plan_zones z
    LEFT JOIN plan_floors pf ON z.floor_id = pf.id
    LEFT JOIN plans p ON z.plan_id = p.id
    WHERE
      z.user_id = ${userId}
      AND (${projectParam}::int IS NULL OR p.project_id = ${projectParam}::int)
    ORDER BY
      COALESCE(p.name, '') ASC,
      COALESCE(pf.name, '') ASC,
      z.name ASC
  `
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    floor_name: r.floor_name,
    plan_name: r.plan_name,
    project_id: r.project_id,
  }))
}
