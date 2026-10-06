"use server"

import { revalidatePath } from "next/cache"
import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { sql } from "@/lib/db"
import type { Plan, PlanFloor, PlanZone, PlanType } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { getModel } from "@/lib/ai"
import { getAiSettings } from "./settings"

// ---------------------------------------------------------------------------
// Validación de entradas (helpers internos, no exportados: este archivo es
// "use server" y cada export es un endpoint público).
// ---------------------------------------------------------------------------

type JsonParam = Parameters<typeof sql.json>[0]

/** Tamaño máximo del base64 de una imagen de plano (8 MB, igual que bodySizeLimit). */
const MAX_IMAGE_BASE64_CHARS = 8 * 1024 * 1024
/** Tamaño máximo de file_url (puede ser una data URL del plano). */
const MAX_FILE_URL_CHARS = 8 * 1024 * 1024
const MAX_FLOORS = 50
const MAX_ZONES_PER_FLOOR = 100
const MAX_TOTAL_ZONES = 500

const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/
const IMAGE_MIME_RE = /^image\/[a-z0-9.+-]{1,60}$/i

async function requireUserId(): Promise<number> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("No autenticado")
  return Number(userId)
}

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** Texto plano sin caracteres de control, recortado a `max` caracteres. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max)
}

function optionalText(value: unknown, max: number): string | null {
  const t = cleanText(value, max)
  return t ? t : null
}

/** Coordenada normalizada 0..1 (o undefined si no viene o no es numérica). */
function unitOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.min(1, Math.max(0, n))
}

type ZoneInput = {
  name?: string
  code?: string
  type?: string
  cause?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

type FloorInput = { name?: string; level?: number; zones?: ZoneInput[] }

type NormalizedZone = {
  name: string
  code: string | null
  type: string
  cause?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

type NormalizedFloor = { name: string; level: number; zones: NormalizedZone[] }

function normalizeZone(raw: unknown): NormalizedZone {
  const z = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const zone: NormalizedZone = {
    name: cleanText(z.name, 100) || "Zona",
    code: optionalText(z.code, 50),
    type: cleanText(z.type, 50) || "general",
  }
  const cause = optionalText(z.cause, 500)
  if (cause) zone.cause = cause
  for (const key of ["x", "y", "width", "height"] as const) {
    const v = unitOrUndefined(z[key])
    if (v !== undefined) zone[key] = v
  }
  return zone
}

function normalizeFloors(input: unknown): NormalizedFloor[] {
  if (!Array.isArray(input)) throw new Error("El formato de pisos no es válido.")
  if (input.length > MAX_FLOORS) throw new Error(`Un plano admite como máximo ${MAX_FLOORS} pisos.`)
  let totalZones = 0
  return input.map((raw, i) => {
    const f = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
    const zonesRaw = f.zones === undefined || f.zones === null ? [] : f.zones
    if (!Array.isArray(zonesRaw)) throw new Error("El formato de zonas no es válido.")
    if (zonesRaw.length > MAX_ZONES_PER_FLOOR) {
      throw new Error(`Cada piso admite como máximo ${MAX_ZONES_PER_FLOOR} zonas.`)
    }
    totalZones += zonesRaw.length
    if (totalZones > MAX_TOTAL_ZONES) throw new Error(`Un plano admite como máximo ${MAX_TOTAL_ZONES} zonas.`)
    const levelNum = Number(f.level)
    const level = Number.isFinite(levelNum) ? Math.max(-20, Math.min(200, Math.trunc(levelNum))) : 0
    return {
      name: cleanText(f.name, 100) || `Piso ${i + 1}`,
      level,
      zones: zonesRaw.map(normalizeZone),
    }
  })
}

function assertImageInput(base64: unknown, mime: unknown): { base64: string; mime: string } {
  if (typeof base64 !== "string" || !base64) throw new Error("No se recibió la imagen del plano.")
  if (base64.length > MAX_IMAGE_BASE64_CHARS) throw new Error("La imagen del plano supera el tamaño máximo (8 MB).")
  if (!BASE64_RE.test(base64)) throw new Error("La imagen del plano no tiene un formato válido.")
  if (typeof mime !== "string" || !IMAGE_MIME_RE.test(mime)) {
    throw new Error("El archivo del plano debe ser una imagen (PNG, JPG, WebP...).")
  }
  return { base64, mime: mime.toLowerCase() }
}

function normalizePlanTypeInput(data: unknown): { name: string; description: string | null } {
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {}
  const name = cleanText(d.name, 100)
  if (!name) throw new Error("El nombre del tipo de plano es obligatorio.")
  return { name, description: optionalText(d.description, 1000) }
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

export async function getPlans(projectId?: number) {
  const userId = await getCurrentUserId()
  if (!userId) return []

  if (projectId) {
    return await sql<Plan[]>`SELECT * FROM plans WHERE user_id = ${userId} AND project_id = ${projectId} ORDER BY created_at DESC`
  }
  return await sql<Plan[]>`SELECT * FROM plans WHERE user_id = ${userId} ORDER BY created_at DESC`
}

// --- Legacy Actions (Restored) ---

export async function extractZonesFromPlan(base64: string, mime: string) {
  await requireUserId()
  const image = assertImageInput(base64, mime)
  const ai = await getAiSettings()
  if (!ai.ready) {
    throw new Error("Configura la API Key de IA en Configuración para usar el escáner de planos.")
  }
  const prompt =
    `Eres un experto en prevención de riesgos laborales. Analiza este plano de obra/edificio y detecta las ZONAS DE RIESGO. ` +
    `Devuelve SOLO un JSON con esta estructura exacta:\n` +
    `{"floors":[{"name":"<piso o 'General'>","zones":[{"name":"<nombre de la zona>","code":"<Alto|Medio|Bajo>","x":<0..1>,"y":<0..1>,"width":<0..1>,"height":<0..1>}]}]}\n` +
    `x, y, width y height son fracciones normalizadas (0 a 1) del rectángulo que delimita la zona sobre la imagen ` +
    `(x,y = esquina superior izquierda). "code" es el nivel de riesgo. Identifica entre 2 y 8 zonas relevantes ` +
    `(trabajo en altura, riesgo eléctrico, circulación, almacenamiento de inflamables, maquinaria, etc.). ` +
    `No incluyas texto fuera del JSON.`
  const { text } = await generateText({
    model: getModel(ai.provider, ai.model, ai.apiKey, ai.baseUrl) as unknown as LanguageModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: `data:${image.mime};base64,${image.base64}` },
        ],
      },
    ],
  })
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        // Respuesta de la IA ilegible: se devuelve vacío más abajo.
      }
    }
  }
  return { floors: [] }
}

export async function createPlan(data: Partial<Plan>) {
  const userId = await requireUserId()
  const d = data && typeof data === "object" ? data : {}

  // El proyecto (si viene) debe ser del mismo usuario.
  let projectId: number | null = null
  if (d.project_id !== undefined && d.project_id !== null) {
    projectId = toPositiveInt(d.project_id)
    if (!projectId) throw new Error("Proyecto no válido.")
    const owned = await sql<{ id: number }[]>`SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${userId} LIMIT 1`
    if (!owned[0]) throw new Error("Proyecto no encontrado.")
  }

  let fileUrl: string | null = null
  if (typeof d.file_url === "string" && d.file_url) {
    if (d.file_url.length > MAX_FILE_URL_CHARS) throw new Error("El archivo del plano supera el tamaño máximo (8 MB).")
    fileUrl = d.file_url
  }

  let extracted: JsonParam | null = null
  if (d.extracted !== undefined && d.extracted !== null) {
    if (typeof d.extracted !== "object" || Array.isArray(d.extracted)) {
      throw new Error("Los datos extraídos del plano no son válidos.")
    }
    extracted = d.extracted as JsonParam
  }

  const [newPlan] = await sql<Plan[]>`
    INSERT INTO plans (
      user_id, project_id, name, plan_type, file_name, file_url, mime_type, extracted, created_at, updated_at
    ) VALUES (
      ${userId}, ${projectId}, ${cleanText(d.name, 255) || "Sin nombre"}, ${cleanText(d.plan_type, 50) || "General"},
      ${cleanText(d.file_name, 255)}, ${fileUrl}, ${optionalText(d.mime_type, 100)},
      ${extracted === null ? null : sql.json(extracted)},
      NOW(), NOW()
    )
    RETURNING *
  `
  return newPlan
}

export async function savePlanFloorsAndZones(planId: number, floors: FloorInput[]) {
  const userId = await requireUserId()
  const id = toPositiveInt(planId)
  if (!id) throw new Error("Plano no válido.")
  const normalized = normalizeFloors(floors)

  // Reemplazo atómico de pisos y zonas: si algo falla no queda el plano a medias.
  await sql.begin(async (tx) => {
    const q = tx as unknown as typeof sql
    // Bloquea el plano y verifica que sea del usuario ANTES de borrar o escribir nada.
    const owned = await q<{ id: number }[]>`
      SELECT id FROM plans WHERE id = ${id} AND user_id = ${userId} FOR UPDATE
    `
    if (!owned[0]) throw new Error("Plano no encontrado.")

    await q`DELETE FROM plan_zones WHERE plan_id = ${id}`
    await q`DELETE FROM plan_floors WHERE plan_id = ${id}`

    for (const floor of normalized) {
      const [savedFloor] = await q<{ id: number }[]>`
        INSERT INTO plan_floors (user_id, plan_id, name, level)
        VALUES (${userId}, ${id}, ${floor.name}, ${floor.level})
        RETURNING id
      `
      if (!savedFloor || floor.zones.length === 0) continue
      const zoneRows = floor.zones.map((zone) => ({
        user_id: userId,
        plan_id: id,
        floor_id: savedFloor.id,
        name: zone.name,
        code: zone.code,
        zone_type: zone.type,
      }))
      await q`
        INSERT INTO plan_zones ${q(zoneRows, "user_id", "plan_id", "floor_id", "name", "code", "zone_type")}
      `
    }

    // Copia en `extracted` (conserva coordenadas para el mapa de riesgos).
    await q`
      UPDATE plans
      SET extracted = ${q.json({ floors: normalized } as JsonParam)}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
    `
  })

  revalidatePath("/proyectos")
}

export async function getPlanDetail(planId: number) {
  const userId = await requireUserId()
  const id = toPositiveInt(planId)
  if (!id) return { plan: null, floors: [] }

  const [plan] = await sql<Plan[]>`SELECT * FROM plans WHERE id = ${id} AND user_id = ${userId} LIMIT 1`
  if (!plan) return { plan: null, floors: [] }

  const floors = await sql<PlanFloor[]>`SELECT * FROM plan_floors WHERE plan_id = ${id} ORDER BY id`
  const zones = await sql<PlanZone[]>`SELECT * FROM plan_zones WHERE plan_id = ${id}`

  // Reconstruye la estructura piso → zonas.
  const resultFloors = floors.map((f) => ({
    ...f,
    zones: zones.filter((z) => z.floor_id === f.id),
  }))

  // Sin datos relacionales, usa la copia JSON.
  const extracted = plan.extracted as { floors?: unknown } | null
  if (resultFloors.length === 0 && extracted && extracted.floors) {
    return { plan, floors: extracted.floors }
  }

  return { plan, floors: resultFloors }
}

export async function deletePlan(planId: number) {
  const userId = await requireUserId()
  const id = toPositiveInt(planId)
  if (!id) throw new Error("Plano no válido.")
  // Un solo DELETE filtrado por dueño: un plano ajeno simplemente no se borra.
  await sql`DELETE FROM plans WHERE id = ${id} AND user_id = ${userId}`
  revalidatePath("/proyectos")
}

export async function getPlanTypes() {
  const userId = await getCurrentUserId()
  if (!userId) return []
  return await sql<PlanType[]>`SELECT * FROM plan_types WHERE user_id = ${userId} ORDER BY name`
}

export async function createPlanType(data: { name: string; description?: string }) {
  const userId = await requireUserId()
  const input = normalizePlanTypeInput(data)
  await sql`INSERT INTO plan_types (user_id, name, description) VALUES (${userId}, ${input.name}, ${input.description})`
  revalidatePath("/proyectos")
}

export async function updatePlanType(id: number, data: { name: string; description?: string }) {
  const userId = await requireUserId()
  const typeId = toPositiveInt(id)
  if (!typeId) throw new Error("Tipo de plano no válido.")
  const input = normalizePlanTypeInput(data)
  await sql`
    UPDATE plan_types SET name = ${input.name}, description = ${input.description}
    WHERE id = ${typeId} AND user_id = ${userId}
  `
  revalidatePath("/proyectos")
}

export async function deletePlanType(id: number) {
  const userId = await requireUserId()
  const typeId = toPositiveInt(id)
  if (!typeId) throw new Error("Tipo de plano no válido.")
  await sql`DELETE FROM plan_types WHERE id = ${typeId} AND user_id = ${userId}`
  revalidatePath("/proyectos")
}

export async function getPlanZonesByProject(projectId?: number) {
  const userId = await getCurrentUserId()
  if (!userId) return []

  // Une planos, pisos y zonas; siempre limitado a los planos del usuario.
  if (projectId) {
    return await sql`
      SELECT
        pz.id,
        pz.name,
        pz.code,
        pf.name as floor_name,
        p.name as plan_name,
        p.project_id
      FROM plan_zones pz
      JOIN plan_floors pf ON pz.floor_id = pf.id
      JOIN plans p ON pz.plan_id = p.id
      WHERE p.project_id = ${projectId} AND p.user_id = ${userId}
      ORDER BY p.name, pf.level, pz.name
    `
  }
  return await sql`
    SELECT
      pz.id,
      pz.name,
      pz.code,
      pf.name as floor_name,
      p.name as plan_name,
      p.project_id
    FROM plan_zones pz
    JOIN plan_floors pf ON pz.floor_id = pf.id
    JOIN plans p ON pz.plan_id = p.id
    WHERE p.user_id = ${userId}
    ORDER BY p.project_id, p.name, pf.level, pz.name
  `
}

export async function updatePlanData(planId: number, data: Record<string, unknown>) {
  const userId = await requireUserId()
  const id = toPositiveInt(planId)
  if (!id) throw new Error("Plano no válido.")
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Los datos del plano no son válidos.")
  }

  await sql`
    UPDATE plans SET extracted = ${sql.json(data as JsonParam)}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
  `
  revalidatePath("/proyectos")
}
