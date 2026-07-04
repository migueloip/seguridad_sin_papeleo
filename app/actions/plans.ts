"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { Plan, PlanFloor, PlanZone, PlanType } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getSetting } from "./settings"
import { getModel } from "@/lib/ai"

export async function getPlans(projectId?: number) {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  if (projectId) {
    return await Promise.resolve(sql<Plan[]>`SELECT * FROM plans WHERE user_id = ${userId} AND project_id = ${projectId} ORDER BY created_at DESC`);
  } else {
    return await Promise.resolve(sql<Plan[]>`SELECT * FROM plans WHERE user_id = ${userId} ORDER BY created_at DESC`);
  }
}


// --- Legacy Actions (Restored) ---

export async function extractZonesFromPlan(base64: string, mime: string) {
  const apiKey =
    (await getSetting("ai_api_key")) || process.env.AI_API_KEY || process.env.GOOGLE_API_KEY || ""
  if (!apiKey) {
    throw new Error("Configura la API Key de IA en Configuración para usar el escáner de planos.")
  }
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const prompt =
    `Eres un experto en prevención de riesgos laborales. Analiza este plano de obra/edificio y detecta las ZONAS DE RIESGO. ` +
    `Devuelve SOLO un JSON con esta estructura exacta:\n` +
    `{"floors":[{"name":"<piso o 'General'>","zones":[{"name":"<nombre de la zona>","code":"<Alto|Medio|Bajo>","x":<0..1>,"y":<0..1>,"width":<0..1>,"height":<0..1>}]}]}\n` +
    `x, y, width y height son fracciones normalizadas (0 a 1) del rectángulo que delimita la zona sobre la imagen ` +
    `(x,y = esquina superior izquierda). "code" es el nivel de riesgo. Identifica entre 2 y 8 zonas relevantes ` +
    `(trabajo en altura, riesgo eléctrico, circulación, almacenamiento de inflamables, maquinaria, etc.). ` +
    `No incluyas texto fuera del JSON.`
  const { text } = await generateText({
    model: getModel("google", model, apiKey) as unknown as LanguageModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: `data:${mime};base64,${base64}` },
        ],
      },
    ],
  })
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
  }
  return { floors: [] }
}

export async function createPlan(data: Partial<Plan>) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");

  const [newPlan] = await (sql<Plan[]>`
    INSERT INTO plans (
      user_id, project_id, name, plan_type, file_name, file_url, mime_type, extracted, created_at, updated_at
    ) VALUES (
      ${userId}, ${data.project_id || null}, ${data.name || "Sin nombre"}, ${data.plan_type || "General"}, 
      ${data.file_name || ""}, ${data.file_url || null}, ${data.mime_type || null}, ${data.extracted ? sql.json(data.extracted as Record<string, unknown>) : null},
      NOW(), NOW()
    )
    RETURNING *
  ` as Promise<Plan[]>);
  return newPlan;
}

export async function savePlanFloorsAndZones(
  planId: number,
  floors: Array<{ name?: string; level?: number; zones?: Array<{ name?: string; code?: string; type?: string }> }>,
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");

  // Simple transaction simulation: delete old, insert new
  // Note: 'postgres' library usually handles transactions via sql.begin but we'll stick to simple queries for restore
  // Deleting existing structure for this plan to replace with new state

  // First get or create floors and zones. 
  // Since the UI seems to send a full JSON blob, we might just store it in 'extracted' column of plans table 
  // OR if we have real tables plan_floors and plan_zones (which defined in db.ts), we should populate them.

  // Checking db.ts... yes, PlanFloor and PlanZone exist.

  await sql`DELETE FROM plan_zones WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plan_floors WHERE plan_id = ${planId}`;

  for (const floor of floors) {
    const [savedFloor] = await Promise.resolve(sql<PlanFloor[]>`
      INSERT INTO plan_floors (user_id, plan_id, name, level)
      VALUES (${userId}, ${planId}, ${floor.name}, ${floor.level || 0})
      RETURNING *
    `);

    if (savedFloor && floor.zones) {
      for (const zone of floor.zones) {
        await sql`
          INSERT INTO plan_zones (user_id, plan_id, floor_id, name, code, zone_type)
          VALUES (${userId}, ${planId}, ${savedFloor.id}, ${zone.name}, ${zone.code}, ${zone.type || 'general'})
        `;
      }
    }
  }

  // Also update extracted column for quick access if needed
  await sql`
    UPDATE plans SET extracted = ${sql.json({ floors })}, updated_at = NOW() WHERE id = ${planId}
  `;

  revalidatePath("/proyectos");
}

export async function getPlanDetail(planId: number) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");

  const [plan] = await Promise.resolve(sql<Plan[]>`SELECT * FROM plans WHERE id = ${planId}`);
  if (!plan) return { plan: null, floors: [] };

  const floors = await Promise.resolve(sql<PlanFloor[]>`SELECT * FROM plan_floors WHERE plan_id = ${planId} ORDER BY id`);
  const zones = await Promise.resolve(sql<PlanZone[]>`SELECT * FROM plan_zones WHERE plan_id = ${planId}`);

  // Reconstruct structure
  const resultFloors = floors.map(f => ({
    ...f,
    zones: zones.filter(z => z.floor_id === f.id)
  }));

  // If no relational data, check JSON
  const extracted = plan.extracted as { floors?: unknown } | null
  if (resultFloors.length === 0 && extracted && extracted.floors) {
    return { plan, floors: extracted.floors };
  }

  return { plan, floors: resultFloors };
}

export async function deletePlan(planId: number) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");
  await sql`DELETE FROM plans WHERE id = ${planId}`;
  revalidatePath("/proyectos");
}

export async function getPlanTypes() {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  return await Promise.resolve(sql<PlanType[]>`SELECT * FROM plan_types ORDER BY name`);
}

export async function createPlanType(data: { name: string; description?: string }) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");
  await sql`INSERT INTO plan_types (user_id, name, description) VALUES (${userId}, ${data.name}, ${data.description || null})`;
  revalidatePath("/proyectos");
}

export async function updatePlanType(id: number, data: { name: string; description?: string }) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");
  await sql`UPDATE plan_types SET name = ${data.name}, description = ${data.description || null} WHERE id = ${id}`;
  revalidatePath("/proyectos");
}

export async function deletePlanType(id: number) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");
  await sql`DELETE FROM plan_types WHERE id = ${id}`;
  revalidatePath("/proyectos");
}

export async function getPlanZonesByProject(projectId?: number) {
  const userId = await getCurrentUserId()
  if (!userId) return []

  // Join plans, floors, and zones to get full context
  // If projectId is provided, filter by it. Otherwise show all for user (or filter by user? usually by project context)

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
  } else {
    // If no project specified, maybe return all user's zones? Or empty?
    // Safer to return user's zones
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
}

export async function updatePlanData(planId: number, data: Record<string, unknown>) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");

  await sql`
    UPDATE plans SET extracted = ${sql.json(data)}, updated_at = NOW() WHERE id = ${planId} AND user_id = ${userId}
  `;
  revalidatePath("/proyectos");
}
