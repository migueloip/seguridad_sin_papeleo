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
}

export interface FloorItem {
  name: string
  zones: ZoneItem[]
}

export async function extractZonesFromPlan(base64Image: string, mimeType: string): Promise<{ floors: FloorItem[] }> {
  const apiKey = await getSetting("ai_api_key")
  if (!apiKey) return { floors: [{ name: "General", zones: [] }] }
  const provider = "google"
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const prompt =
    `Analiza este plano de obra y devuelve un JSON con las zonas agrupadas por piso.\n` +
    `Formato:\n` +
    `{\n` +
    `  "floors": [\n` +
    `    { "name": "Piso 1", "zones": [ { "name": "Zona A", "code": "A1" }, { "name": "Zona B" } ] },\n` +
    `    { "name": "Piso 2", "zones": [ { "name": "Sector Norte" } ] }\n` +
    `  ]\n` +
    `}\n` +
    `Si no puedes inferir el piso, usa "General". Usa nombres cortos y funcionales. Responde solo el JSON.`
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
